import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { session, step, ts, variant } = req.body;
    if (!session || !step) return res.status(400).json({ error: 'Missing session or step' });

    const event = { session, step, ts: ts || Date.now() };
    if (variant) event.variant = variant;

    // Append to events list
    await kv.rpush('funnel:events', JSON.stringify(event));

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Event save error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
}
