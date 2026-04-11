import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { session, first, last, email, phone, state, answers, ts } = req.body;
    if (!session) return res.status(400).json({ error: 'Missing session' });

    const lead = { session, first, last, email, phone, state, answers, ts: ts || Date.now() };

    await kv.rpush('funnel:leads', JSON.stringify(lead));

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Lead save error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
}
