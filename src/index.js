import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerUi from 'swagger-ui-express';
import nawalaRouter from './routes-nawala.js';
import nawalaSpec from './docs/nawala.openapi.js';
import { loadConfig } from './fetcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const cfg = loadConfig();
const server = cfg.server || {};
const PORT = process.env.PORT || server.port || 3008;
const HOST = server.host || '0.0.0.0';

app.disable('x-powered-by');

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '256kb' }));

const apis = [
  {
    name: 'nawala-api',
    version: '1.0.0',
    description: 'Cek blokir domain Nawala / TrustPositif Komdigi — status blokir, kategori konten negatif, statistik',
    router: nawalaRouter,
    spec: nawalaSpec,
  },
];

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), upstream: cfg.baseUrl });
});

app.get('/api', (req, res) => {
  res.json({
    success: true,
    data: apis.map((a) => ({
      name: a.name,
      version: a.version,
      description: a.description,
      basePath: `/api/${a.name}`,
      docs: `/docs/${a.name}`,
      openapi: `/docs/${a.name}/openapi.json`,
    })),
  });
});

app.use('/docs', (req, res, next) => {
  if (req.path.endsWith('swagger-ui-init.js') || req.path.endsWith('openapi.json')) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

for (const api of apis) {
  app.get(`/docs/${api.name}/openapi.json`, (req, res) => res.json(api.spec));

  app.use(
    `/docs/${api.name}`,
    swaggerUi.serve,
    swaggerUi.setup(api.spec, {
      customSiteTitle: `${api.name} — Dokumentasi API`,
      swaggerOptions: { docExpansion: 'list', tryItOutEnabled: true },
    })
  );

  app.use(`/api/${api.name}`, api.router);
}

app.get('/docs', (req, res) => res.redirect(apis.length ? `/docs/${apis[0].name}` : '/api'));
app.get('/', (req, res) => res.redirect('/docs'));

app.use(express.static(path.join(__dirname, '../public')));

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route tidak ditemukan: ${req.method} ${req.path}`,
    hint: 'Lihat /api atau dokumentasi di /docs',
  });
});

app.use((err, req, res, next) => {
  console.error('ERROR:', err.message);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Terjadi kesalahan server.',
    ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  });
});

app.listen(PORT, HOST, () => {
  console.log(`✅ Nawala API berjalan di http://${HOST}:${PORT}`);
  console.log(`   Sumber data : ${cfg.baseUrl}`);
  console.log(`   Endpoint    : /api/nawala-api`);
  console.log(`   Dokumentasi : /docs/nawala-api`);
});
