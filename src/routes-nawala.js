import { Router } from 'express';
import { loadConfig, cacheStats, cacheClear } from './fetcher.js';
import { checkDomain, checkBatch, getStats, getKategori, getMeta, normalizeDomain } from './nawala.js';

const router = Router();
const bad = (res, msg) => res.status(400).json({ success: false, error: msg });
const maxBatch = () => loadConfig().limits?.maxDomainsPerRequest || 50;

// ---------- health ----------
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), upstream: loadConfig().baseUrl, cache: cacheStats() });
});

// ---------- cek satu domain ----------
// /check?domain=pornhub.com  atau  /check?domain=https://www.pornhub.com/video
router.get('/check', async (req, res, next) => {
  try {
    const raw = req.query.domain ?? req.query.q ?? req.query.url;
    if (typeof raw !== 'string' || !raw.trim()) return bad(res, 'domain wajib diisi');
    const out = await checkDomain(raw);
    res.json({ success: true, ...out });
  } catch (e) {
    next(e);
  }
});

// ---------- cek banyak domain sekaligus ----------
// POST /check  {"domains": ["a.com", "https://b.com/x", ...]}
// atau GET /check-bulk?domains=a.com,b.com
router.post('/check', async (req, res, next) => {
  try {
    const list = req.body?.domains;
    if (!Array.isArray(list) || !list.length) return bad(res, 'body.domains harus array tidak kosong');
    if (list.length > maxBatch()) return bad(res, `maksimal ${maxBatch()} domain per request`);
    const out = await checkBatch(list);
    res.json({ success: true, ...out });
  } catch (e) {
    next(e);
  }
});

router.get('/check-bulk', async (req, res, next) => {
  try {
    const raw = req.query.domains;
    if (typeof raw !== 'string' || !raw.trim()) return bad(res, 'domains wajib diisi (pisahkan koma)');
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length > maxBatch()) return bad(res, `maksimal ${maxBatch()} domain per request`);
    const out = await checkBatch(list);
    res.json({ success: true, ...out });
  } catch (e) {
    next(e);
  }
});

// ---------- alias RESTful ----------
router.get('/domain/:domain', async (req, res, next) => {
  try {
    const out = await checkDomain(req.params.domain);
    res.json({ success: true, ...out });
  } catch (e) {
    next(e);
  }
});

// ---------- statistik & kategori ----------
router.get('/stats', async (req, res, next) => {
  try {
    const out = await getStats();
    res.json({ success: true, ...out });
  } catch (e) {
    next(e);
  }
});

router.get('/kategori', async (req, res, next) => {
  try {
    const items = await getKategori();
    res.json({ success: true, total: items.length, data: items });
  } catch (e) {
    next(e);
  }
});

// ---------- metadata sumber ----------
router.get('/meta', async (req, res, next) => {
  try {
    const out = await getMeta();
    res.json({ success: true, ...out });
  } catch (e) {
    next(e);
  }
});

// ---------- util: normalisasi tanpa memanggil upstream ----------
router.get('/normalize', (req, res) => {
  const raw = req.query.domain;
  if (typeof raw !== 'string' || !raw.trim()) return bad(res, 'domain wajib diisi');
  const domain = normalizeDomain(raw);
  if (!domain) return bad(res, 'domain tidak valid');
  res.json({ success: true, input: raw, domain });
});

// ---------- cache ----------
router.get('/cache', (req, res) => res.json({ success: true, ...cacheStats() }));
router.post('/cache/clear', (req, res) => {
  cacheClear();
  res.json({ success: true, message: 'cache dibersihkan' });
});

export default router;
