import axios from 'axios';
import { loadConfig, cacheGet, cacheSet } from './fetcher.js';

const UP = 'https://trustpositif.komdigi.go.id/Rest_server';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const http = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent': UA,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://trustpositif.komdigi.go.id',
    Referer: 'https://trustpositif.komdigi.go.id/',
  },
});

const up = (msg, status = 502) => {
  const e = new Error(msg);
  e.status = status;
  return e;
};

// ---------- normalisasi domain ----------
// Terima: "https://www.Contoh.com/path?x=1", " contoh.com. ", "contoh.com:8080"
// Hasil: "contoh.com" (apex disimpan terpisah untuk fallback)
export function normalizeDomain(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // buang skema
  s = s.split(/[/?#]/)[0]; // buang path/query/hash
  s = s.replace(/:\d+$/, ''); // buang port
  s = s.replace(/\.+$/, ''); // buang titik di akhir
  if (!s || s.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  return s;
}

// apex = dua label terakhir, kecuali TLD dua tingkat umum (co.id, ac.id, dll)
const TWO_LEVEL = new Set([
  'co.id', 'ac.id', 'or.id', 'net.id', 'web.id', 'sch.id', 'go.id', 'mil.id', 'my.id', 'biz.id',
  'co.uk', 'org.uk', 'ac.uk', 'co.jp', 'ne.jp', 'or.jp', 'com.au', 'net.au', 'org.au', 'co.nz',
  'com.br', 'com.my', 'com.sg', 'co.in', 'co.za', 'com.tr', 'com.cn',
]);

export function apexOf(domain) {
  const p = domain.split('.');
  if (p.length <= 2) return domain;
  const last2 = p.slice(-2).join('.');
  const take = TWO_LEVEL.has(last2) ? 3 : 2;
  return p.slice(-take).join('.');
}

// ---------- panggil upstream ----------
async function queryUpstream(names) {
  const body = new URLSearchParams();
  body.set('name', names.join('\n'));
  let r;
  try {
    r = await http.post(`${UP}/getrecordsname`, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (e) {
    throw up(`upstream gagal: ${e.message}`);
  }
  const data = r.data;
  if (!data || !Array.isArray(data.values)) throw up('bentuk respons upstream tidak dikenal');
  return data.values;
}

async function queryTotals() {
  const hit = cacheGet('totals');
  if (hit) return hit;
  let r;
  try {
    r = await http.get(`${UP}/gettotalrecordsperkategori`);
  } catch (e) {
    throw up(`upstream gagal: ${e.message}`);
  }
  const row = Array.isArray(r.data) ? r.data[0] : null;
  if (!row) throw up('bentuk statistik upstream tidak dikenal');
  const ttl = loadConfig().request?.cacheTtlStats || 3600;
  cacheSet('totals', row, ttl);
  return row;
}

// ---------- cek satu/banyak domain ----------
// Hasil per domain: { domain, blocked, status, ket, matched, normalized }
async function checkMany(domains) {
  const ttl = loadConfig().request?.cacheTtl || 600;
  const out = new Map();
  const miss = [];

  for (const d of domains) {
    const hit = cacheGet(`d:${d}`);
    if (hit) out.set(d, hit);
    else miss.push(d);
  }

  if (miss.length) {
    // upstream membalas urutan berbeda -> cocokkan lewat field Domain
    const rows = await queryUpstream(miss);
    const byName = new Map(rows.map((r) => [String(r.Domain || '').toLowerCase(), r]));
    for (const d of miss) {
      const r = byName.get(d);
      const val = {
        domain: d,
        blocked: r ? String(r.Status).toLowerCase() === 'ada' : null,
        status: r ? r.Status : null,
        ket: r?.ket || null,
      };
      cacheSet(`d:${d}`, val, ttl);
      out.set(d, val);
    }
  }

  return domains.map((d) => out.get(d));
}

export async function checkDomain(raw, opts = {}) {
  const normalized = normalizeDomain(raw);
  if (!normalized) throw up(`domain tidak valid: ${raw}`, 400);

  const [base] = await checkMany([normalized]);
  const apex = apexOf(normalized);
  let apexResult = null;

  // subdomain sering tidak terdaftar terpisah — cek apex-nya juga
  if (base.blocked === false && apex !== normalized) {
    const [a] = await checkMany([apex]);
    apexResult = a;
  }

  const blocked = Boolean(base.blocked || apexResult?.blocked);
  return {
    input: raw,
    domain: normalized,
    apex,
    blocked,
    status: base.status,
    ket: base.ket,
    matched: base.blocked ? normalized : apexResult?.blocked ? apex : null,
    apexCheck: apexResult,
  };
}

export async function checkBatch(rawList) {
  const list = [];
  const invalid = [];
  const seen = new Set();

  for (const raw of rawList) {
    const d = normalizeDomain(raw);
    if (!d) {
      invalid.push(raw);
      continue;
    }
    if (seen.has(d)) continue;
    seen.add(d);
    list.push({ raw, domain: d });
  }

  const results = await checkMany(list.map((x) => x.domain));

  // fallback apex untuk subdomain yang tidak terdaftar
  const needApex = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.blocked === false) {
      const apex = apexOf(r.domain);
      if (apex !== r.domain) needApex.push(apex);
    }
  }
  const apexMap = new Map();
  if (needApex.length) {
    const uniq = [...new Set(needApex)];
    const rows = await checkMany(uniq);
    for (const r of rows) apexMap.set(r.domain, r);
  }

  return {
    total: list.length,
    checked: list.map(({ raw, domain }, i) => {
      const r = results[i];
      const apex = apexOf(domain);
      const ap = r.blocked === false && apex !== domain ? apexMap.get(apex) : null;
      return {
        input: raw,
        domain,
        apex,
        blocked: Boolean(r.blocked || ap?.blocked),
        status: r.status,
        ket: r.ket,
        matched: r.blocked ? domain : ap?.blocked ? apex : null,
        ...(ap ? { apexCheck: ap } : {}),
      };
    }),
    invalid,
  };
}

// ---------- statistik ----------
// nama kolom upstream -> {slug, label}
const KATEGORI = {
  TotalPornografi: ['pornografi', 'Pornografi'],
  TotalRadikalisme: ['radikalisme', 'Radikalisme'],
  TotalSARA: ['sara', 'SARA'],
  TotalKekerasan: ['kekerasan', 'Kekerasan'],
  TotalKekerasanPornografiAnak: ['kekerasan-pornografi-anak', 'Kekerasan & Pornografi Anak'],
  TotalPerjudian: ['perjudian', 'Perjudian'],
  TotalInvestasiIlegal: ['investasi-ilegal', 'Investasi Ilegal'],
  TotalFitnah: ['fitnah', 'Fitnah / Pencemaran Nama Baik'],
  TotalPenipuanOnline: ['penipuan-online', 'Penipuan Online'],
  TotalHKI: ['hki', 'Pelanggaran HKI'],
  TotalPelanggaranKeamananInformasi: ['keamanan-informasi', 'Pelanggaran Keamanan Informasi'],
  TotalPelanggaranUUITE: ['uu-ite', 'Pelanggaran UU ITE'],
  TotalPerdaganganProdukAturanKhusus: ['produk-aturan-khusus', 'Perdagangan Produk dengan Aturan Khusus'],
  TotalKontenNegatifDirekomendasikanInstansiSektor: ['rekomendasi-instansi', 'Konten Negatif Rekomendasi Instansi Sektor'],
  TotalKontenMeresahkanMasyarakat: ['meresahkan-masyarakat', 'Konten Meresahkan Masyarakat'],
  TotalSeparatisme: ['separatisme', 'Separatisme'],
  TotalKontenMelanggarNilaiSosialBudaya: ['nilai-sosial-budaya', 'Melanggar Nilai Sosial Budaya'],
  TotalHOAKS: ['hoaks', 'HOAKS'],
  TotalPemerasan: ['pemerasan', 'Pemerasan'],
  TotalKontenMemfasilitasiKontenNegatif: ['fasilitasi-konten-negatif', 'Memfasilitasi Konten Negatif'],
};

export async function getStats() {
  const row = await queryTotals();
  const items = [];
  let total = 0;
  for (const [key, [slug, label]] of Object.entries(KATEGORI)) {
    const n = Number(row[key] || 0);
    total += n;
    items.push({ slug, label, total: n });
  }
  return {
    lastUpdate: row.lastdate || null,
    total: Number.isFinite(total) ? total : null,
    categories: items,
  };
}

export async function getKategori() {
  const { categories } = await getStats();
  return categories;
}

export async function getMeta() {
  const stats = await getStats().catch(() => null);
  return {
    source: 'https://trustpositif.komdigi.go.id',
    operator: 'Kominfo / Komdigi — TrustPositif (Nawala)',
    lastUpdate: stats?.lastUpdate || null,
    totalRecords: stats?.total ?? null,
    notes: [
      'Daftar lengkap (domains) hanya tersedia dalam bentuk tersamarkan di /assets/db/domains.',
      'Pencarian resmi hanya mencocokkan domain persis (apex), bukan subdomain atau URL.',
      'API ini menormalkan input (buang skema/path/port) dan otomatis mengecek apex untuk subdomain.',
    ],
  };
}
