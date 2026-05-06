import { list } from '@vercel/blob';
import { Redis } from '@upstash/redis';

const KEY = 'site-data';
const ADMIN_PASSWORD = 'geroi2025';
const PREFIX = 'site-data-';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = req.headers['x-admin-password'];
  if (auth !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Find latest Blob file
    const { blobs } = await list({ prefix: PREFIX, limit: 100 });
    if (!blobs.length) {
      return res.status(200).json({ ok: true, note: 'No Blob files found, nothing to migrate' });
    }
    const sorted = [...blobs].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    const latest = sorted[0];

    // Fetch latest Blob data
    const r = await fetch(latest.url, { cache: 'no-store' });
    if (!r.ok) return res.status(500).json({ error: 'Failed to fetch latest blob: ' + r.status });
    const data = await r.json();

    // Write to Redis (replacing existing)
    await redis.set(KEY, JSON.stringify(data));

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      migrated: latest.pathname,
      uploadedAt: latest.uploadedAt,
      keys: Object.keys(data),
      keyCount: Object.keys(data).length,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
