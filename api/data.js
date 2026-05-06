import { Redis } from '@upstash/redis';

const KEY = 'site-data';
const ADMIN_PASSWORD = 'geroi2025';

// Lazy init so we can return a descriptive error instead of crashing the function
let _redis = null;
let _redisErr = null;
function getRedis() {
  if (_redis) return _redis;
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_URL ||
    process.env.STORAGE_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_TOKEN ||
    process.env.STORAGE_REST_TOKEN;
  if (!url || !token) {
    _redisErr = 'Redis env vars not found. Available REDIS-like keys: ' + (Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH|STORAGE/i.test(k)).join(', ') || '(none)');
    return null;
  }
  _redis = new Redis({ url, token });
  return _redis;
}

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
};

async function readState() {
  const redis = getRedis();
  if (!redis) return {};
  try {
    const raw = await redis.get(KEY);
    if (!raw) return {};
    // Upstash auto-deserializes JSON; raw may be string or object depending on how it was set
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return {}; }
    }
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    return {};
  }
}

async function writeState(obj) {
  const redis = getRedis();
  if (!redis) throw new Error(_redisErr || 'Redis not configured');
  await redis.set(KEY, JSON.stringify(obj));
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      noStore(res);
      const url0 = new URL(req.url, 'http://x');
      if (url0.searchParams.get('debug') === '1') {
        const redis = getRedis();
        const envKeys = Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH|STORAGE/i.test(k));
        const data = redis ? await readState() : {};
        return res.status(200).json({
          backend: 'upstash-redis',
          key: KEY,
          redisConfigured: !!redis,
          redisError: _redisErr,
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

      // Deep-merge logic for korpuses (preserve nested floor polygons)
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
        backend: 'upstash-redis',
        keys: Object.keys(merged),
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
