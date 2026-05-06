import IORedis from 'ioredis';

const KEY = 'site-data';
const ADMIN_PASSWORD = 'geroi2025';

let _client = null;
let _err = null;
function getClient() {
  if (_client) return _client;
  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (!url) {
    _err = 'REDIS_URL not set. Available: ' + (Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH|STORAGE/i.test(k)).join(', ') || '(none)');
    return null;
  }
  try {
    _client = new IORedis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    _client.on('error', e => { console.error('Redis error:', e?.message); });
  } catch (e) {
    _err = String(e?.message || e);
    return null;
  }
  return _client;
}

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
};

async function readState() {
  const client = getClient();
  if (!client) return {};
  try {
    const raw = await client.get(KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
async function writeState(obj) {
  const client = getClient();
  if (!client) throw new Error(_err || 'Redis not configured');
  await client.set(KEY, JSON.stringify(obj));
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      noStore(res);
      const url0 = new URL(req.url, 'http://x');
      if (url0.searchParams.get('debug') === '1') {
        const client = getClient();
        const envKeys = Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH|STORAGE/i.test(k));
        const data = client ? await readState() : {};
        return res.status(200).json({
          backend: 'ioredis',
          key: KEY,
          redisConfigured: !!client,
          redisError: _err,
          envKeys,
          keyCount: Object.keys(data).length,
          keys: Object.keys(data),
        });
      }
      const data = await readState();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const auth = req.headers['x-admin-password'];
      if (auth !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      const incoming = JSON.parse(body);
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return res.status(400).json({ error: 'Body must be an object' });
      }

      const url = new URL(req.url, 'http://x');
      const isReplace = url.searchParams.get('replace') === '1';
      const existing = isReplace ? {} : await readState();

      const merged = { ...existing };
      for (const k of Object.keys(incoming)) {
        if (k === 'geroi_korpuses' && Array.isArray(existing[k]) && Array.isArray(incoming[k])) {
          const byId = new Map((existing[k] || []).map(x => [x.id, x]));
          for (const x of incoming[k]) {
            const ex = byId.get(x.id);
            if (ex) {
              byId.set(x.id, {
                ...ex,
                ...x,
                floorPolygons: { ...(ex.floorPolygons || {}), ...(x.floorPolygons || {}) },
              });
            } else {
              byId.set(x.id, x);
            }
          }
          merged[k] = Array.from(byId.values()).sort((a, b) => (a.id || 0) - (b.id || 0));
        } else {
          merged[k] = incoming[k];
        }
      }

      await writeState(merged);
      noStore(res);
      return res.status(200).json({
        ok: true,
        backend: 'ioredis',
        keys: Object.keys(merged),
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
