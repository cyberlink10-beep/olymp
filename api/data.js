import { put, list } from '@vercel/blob';

const FILENAME = 'site-data.json';
// Admin password — must match client-side ADMIN_PASSWORD in admin.html
const ADMIN_PASSWORD = 'geroi2025';

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
};

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      noStore(res);
      const { blobs } = await list({ prefix: FILENAME, limit: 1 });
      const found = blobs.find(b => b.pathname === FILENAME);
      if (!found) return res.status(200).json({});
      const r = await fetch(found.url, { cache: 'no-store' });
      if (!r.ok) return res.status(200).json({});
      const text = await r.text();
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(text);
    }

    if (req.method === 'POST') {
      const auth = req.headers['x-admin-password'];
      if (auth !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
      // Vercel auto-parses JSON body when Content-Type is application/json
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      // validate JSON
      JSON.parse(body);
      await put(FILENAME, body, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      noStore(res);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
