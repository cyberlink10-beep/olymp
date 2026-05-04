import { put, list } from '@vercel/blob';

const FILENAME = 'site-data.json';
const ADMIN_PASSWORD = 'geroi2025';

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
};

async function readBlob() {
  const { blobs } = await list({ prefix: FILENAME, limit: 50 });
  const found = blobs.find(b => b.pathname === FILENAME);
  if (!found) return {};
  // Cache-buster: Vercel Blob CDN caches the URL; use uploadedAt timestamp + random
  // so we always get the latest content (last write).
  const ts = found.uploadedAt ? new Date(found.uploadedAt).getTime() : Date.now();
  const bust = `?v=${ts}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await fetch(found.url + bust, { cache: 'no-store' });
  if (!r.ok) return {};
  try { return await r.json(); } catch { return {}; }
}

async function listAllBlobs() {
  const { blobs } = await list({ limit: 100 });
  return blobs.map(b => ({ pathname: b.pathname, url: b.url, size: b.size, uploadedAt: b.uploadedAt }));
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      noStore(res);
      // Debug mode: ?debug=1 returns blob list info
      const url0 = new URL(req.url, 'http://x');
      if (url0.searchParams.get('debug') === '1') {
        const blobs = await listAllBlobs();
        return res.status(200).json({ blobs, FILENAME, blobCount: blobs.length });
      }
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
      // default → DEEP MERGE with existing data
      const url = new URL(req.url, 'http://x');
      const isReplace = url.searchParams.get('replace') === '1';
      const existing = isReplace ? {} : await readBlob();
      const merged = { ...existing };
      for (const k of Object.keys(incoming)) {
        if (k === 'geroi_korpuses' && Array.isArray(existing[k]) && Array.isArray(incoming[k])) {
          // merge korpuses by id, deep-merge floorPolygons
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

      const putResult = await put(FILENAME, JSON.stringify(merged), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      noStore(res);
      return res.status(200).json({
        ok: true,
        keys: Object.keys(merged),
        putUrl: putResult?.url,
        putPathname: putResult?.pathname,
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
