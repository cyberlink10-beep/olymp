import { put, list } from '@vercel/blob';

export const config = { runtime: 'edge' };

const FILENAME = 'site-data.json';
// Admin password — must match client-side ADMIN_PASSWORD in admin.html
const ADMIN_PASSWORD = 'geroi2025';

const json = (data, status = 200, extraHeaders = {}) => new Response(
  JSON.stringify(data),
  {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...extraHeaders,
    },
  }
);

export default async function handler(req) {
  try {
    if (req.method === 'GET') {
      const { blobs } = await list({ prefix: FILENAME, limit: 1 });
      const found = blobs.find(b => b.pathname === FILENAME);
      if (!found) return json({});
      const r = await fetch(found.url, { cache: 'no-store' });
      if (!r.ok) return json({});
      const text = await r.text();
      return new Response(text, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    }

    if (req.method === 'POST') {
      const auth = req.headers.get('x-admin-password');
      if (auth !== ADMIN_PASSWORD) return json({ error: 'Unauthorized' }, 401);
      const body = await req.text();
      // validate it's parseable JSON
      JSON.parse(body);
      await put(FILENAME, body, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}
