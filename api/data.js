import { put, list } from '@vercel/blob';

const FILENAME = 'site-data.json';
const ADMIN_PASSWORD = 'geroi2025';

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
};

async function readBlob() {
  const { blobs } = await list({ prefix: FILENAME, limit: 1 });
  const found = blobs.find(b => b.pathname === FILENAME);
  if (!found) return {};
  const r = await fetch(found.url, { cache: 'no-store' });
  if (!r.ok) return {};
  try { return await r.json(); } catch { return {}; }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      noStore(res);
      const data = await readBlob();
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

      // ?replace=1 → replace whole blob (rare, used for cleanup)
      // default → MERGE with existing data (do not wipe other keys)
      const url = new URL(req.url, 'http://x');
      const isReplace = url.searchParams.get('replace') === '1';
      const existing = isReplace ? {} : await readBlob();
      const merged = { ...existing, ...incoming };

      await put(FILENAME, JSON.stringify(merged), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      noStore(res);
      return res.status(200).json({ ok: true, keys: Object.keys(merged) });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
