const BASE = 'https://trustpositif.komdigi.go.id';

// terima dua bentuk: map properti {a: {...}} ATAU schema penuh {type, properties}
const okJson = (desc, data) => ({
  description: desc,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          ...(data?.type === 'object' ? data.properties : data),
        },
      },
    },
  },
});
const errJson = (desc) => ({
  description: desc,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});
const q = (name, desc, example, required = false) => ({
  name,
  in: 'query',
  required,
  description: desc,
  schema: { type: 'string', example },
});
const p = (name, desc, example) => ({
  name,
  in: 'path',
  required: true,
  description: desc,
  schema: { type: 'string', example },
});
const getOp = (summary, params, resp) => ({
  summary,
  tags: ['nawala'],
  ...(params?.length ? { parameters: params } : {}),
  responses: { 200: resp, 400: errJson('Parameter tidak valid'), 502: errJson('Upstream gagal') },
});

const checkResult = {
  type: 'object',
  properties: {
    input: { type: 'string', description: 'Nilai yang dikirim klien' },
    domain: { type: 'string', description: 'Hasil normalisasi (tanpa skema/path/port, lowercase)' },
    apex: { type: 'string', description: 'Domain apex (mis. sub.contoh.co.id -> contoh.co.id)' },
    blocked: { type: 'boolean', description: 'true bila diblokir Nawala' },
    status: { type: 'string', nullable: true, enum: ['Ada', 'Tidak Ada'], description: 'Status mentah dari upstream' },
    ket: { type: 'string', nullable: true, example: 'Blocked' },
    matched: { type: 'string', nullable: true, description: 'Domain mana yang cocok di daftar blokir (domain atau apex)' },
    apexCheck: {
      type: 'object',
      nullable: true,
      description: 'Hasil pengecekan apex, hanya ada bila domain input berupa subdomain',
      properties: {
        domain: { type: 'string' },
        blocked: { type: 'boolean' },
        status: { type: 'string', nullable: true },
        ket: { type: 'string', nullable: true },
      },
    },
  },
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'nawala-api',
    version: '1.0.0',
    description:
      'REST API cek blokir domain Nawala / TrustPositif Komdigi (' + BASE + '). ' +
      'Mengecek status blokir, kategori konten negatif, dan statistik daftar blokir. ' +
      'Input dinormalkan otomatis (URL lengkap, port, huruf besar) dan subdomain ikut dicek ke apex-nya.',
    license: { name: 'MIT' },
  },
  servers: [{ url: '/api/nawala-api', description: 'Gateway' }],
  tags: [{ name: 'nawala', description: 'Cek blokir domain Nawala / TrustPositif' }],
  paths: {
    '/check': {
      get: getOp('Cek satu domain', [
        q('domain', 'Domain atau URL yang dicek', 'pornhub.com', true),
      ], okJson('Hasil pengecekan', checkResult)),
      post: {
        summary: 'Cek banyak domain sekaligus (maks. 50)',
        tags: ['nawala'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['domains'],
                properties: {
                  domains: {
                    type: 'array',
                    maxItems: 50,
                    items: { type: 'string' },
                    example: ['pornhub.com', 'https://www.xvideos.com/video', 'google.com'],
                  },
                },
              },
            },
          },
        },
        responses: {
          200: okJson('Hasil per domain', {
            total: { type: 'integer' },
            checked: { type: 'array', items: checkResult },
            invalid: { type: 'array', items: { type: 'string' }, description: 'Input yang tak bisa dinormalkan' },
          }),
          400: errJson('Body tidak valid'),
          502: errJson('Upstream gagal'),
        },
      },
    },
    '/check-bulk': {
      get: getOp('Cek banyak domain lewat query (pisah koma)', [
        q('domains', 'Daftar domain dipisah koma', 'pornhub.com,google.com', true),
      ], okJson('Hasil per domain', {
        total: { type: 'integer' },
        checked: { type: 'array', items: checkResult },
        invalid: { type: 'array', items: { type: 'string' } },
      })),
    },
    '/domain/{domain}': {
      get: getOp('Alias RESTful untuk /check', [p('domain', 'Domain atau URL', 'pornhub.com')], okJson('Hasil pengecekan', checkResult)),
    },
    '/stats': {
      get: getOp('Statistik jumlah entri blokir per kategori', [], okJson('Total per kategori', {
        lastUpdate: { type: 'string', nullable: true, example: '2022-12-28' },
        total: { type: 'integer', nullable: true },
        categories: {
          type: 'array',
          items: {
            type: 'object',
            properties: { slug: { type: 'string' }, label: { type: 'string' }, total: { type: 'integer' } },
          },
        },
      })),
    },
    '/kategori': {
      get: getOp('Daftar kategori konten negatif', [], okJson('Kategori', {
        total: { type: 'integer' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: { slug: { type: 'string' }, label: { type: 'string' }, total: { type: 'integer' } },
          },
        },
      })),
    },
    '/meta': {
      get: getOp('Metadata sumber data', [], okJson('Info sumber', {
        source: { type: 'string' },
        operator: { type: 'string' },
        lastUpdate: { type: 'string', nullable: true },
        totalRecords: { type: 'integer', nullable: true },
        notes: { type: 'array', items: { type: 'string' } },
      })),
    },
    '/normalize': {
      get: getOp('Normalisasi domain tanpa memanggil upstream', [q('domain', 'Domain/URL', 'https://www.Contoh.com:8080/path', true)], okJson('Hasil normalisasi', {
        input: { type: 'string' },
        domain: { type: 'string' },
      })),
    },
    '/health': {
      get: getOp('Status layanan', [], okJson('Status', {
        uptime: { type: 'number' },
        upstream: { type: 'string' },
        cache: { type: 'object', properties: { entries: { type: 'integer' } } },
      })),
    },
    '/cache': {
      get: getOp('Info cache', [], okJson('Jumlah entri cache', { entries: { type: 'integer' } })),
    },
    '/cache/clear': {
      post: {
        summary: 'Bersihkan cache',
        tags: ['nawala'],
        responses: { 200: okJson('Cache dibersihkan', { message: { type: 'string' } }) },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: 'object',
        properties: { success: { type: 'boolean', example: false }, message: { type: 'string' }, error: { type: 'string' } },
      },
    },
  },
};

export default spec;
