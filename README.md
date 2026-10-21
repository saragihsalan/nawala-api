# nawala-api

REST API cek blokir domain **Nawala / TrustPositif Komdigi** — sumber `https://trustpositif.komdigi.go.id`.

## Endpoint

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/nawala-api/check?domain=` | cek satu domain / URL |
| POST | `/api/nawala-api/check` | cek banyak (body `{"domains":[...]}`, maks 50) |
| GET | `/api/nawala-api/check-bulk?domains=a.com,b.com` | cek banyak lewat query |
| GET | `/api/nawala-api/domain/:domain` | alias RESTful |
| GET | `/api/nawala-api/stats` | total entri blokir per kategori |
| GET | `/api/nawala-api/kategori` | 20 kategori konten negatif |
| GET | `/api/nawala-api/meta` | info sumber + catatan |
| GET | `/api/nawala-api/normalize?domain=` | uji normalisasi tanpa upstream |
| GET | `/health` | status layanan |
| POST | `/api/nawala-api/cache/clear` | bersihkan cache |

Docs: `/docs/nawala-api`.

## Cara kerja

1. Input dinormalkan: buang skema, path, query, port, titik akhir, huruf kecil.
2. Domain dicek ke `POST /Rest_server/getrecordsname` (`name=<domain>`, dipisah newline untuk batch).
3. Kalau input subdomain dan tidak ada di daftar, apex-nya ikut dicek (`www.x.com` → `x.com`).
   TLD dua tingkat (`co.id`, `co.uk`, dst.) ditangani supaya apex tidak salah potong.
4. Hasil di-cache 10 menit; statistik 1 jam.

Respons `check`:

```json
{
  "success": true,
  "input": "https://www.pornhub.com/video",
  "domain": "www.pornhub.com",
  "apex": "pornhub.com",
  "blocked": true,
  "status": "Tidak Ada",
  "ket": "-",
  "matched": "pornhub.com",
  "apexCheck": { "domain": "pornhub.com", "blocked": true, "status": "Ada", "ket": "Blocked" }
}
```

`matched` = domain yang benar-benar ada di daftar blokir.

## Catatan

- Daftar lengkap hanya tersedia tersamarkan di `/assets/db/domains` (±221 MB, `p****nisindonesia...`), jadi tidak dipakai.
- Pencarian resmi mencocokkan domain persis — subdomain harus lewat fallback apex.
- Statistik terakhir dari upstream: 2022-12-28 (tanggal dari server, bukan tanggal cek).

## Deploy

```bash
cd /opt && sudo git clone <repo> nawala-api && cd nawala-api
sudo docker compose up -d --build
curl -s localhost:3008/health
```

NPM: proxy `/api/nawala-api` dan `/docs/nawala-api` → `http://nawala-api:3000`.
