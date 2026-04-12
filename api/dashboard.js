import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // DELETE = reset all data
  if (req.method === 'DELETE') {
    await kv.del('funnel:events', 'funnel:sales', 'funnel:leads', 'funnel:initiates', 'funnel:ic_seen');
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Get all data from KV lists
    const eventsRaw = await kv.lrange('funnel:events', 0, -1) || [];
    const salesRaw = await kv.lrange('funnel:sales', 0, -1) || [];
    const leadsRaw = await kv.lrange('funnel:leads', 0, -1) || [];
    const initiatesRaw = await kv.lrange('funnel:initiates', 0, -1) || [];

    // Parse — lrange may return strings or already-parsed objects
    const parse = (item) => typeof item === 'string' ? JSON.parse(item) : item;
    const events = eventsRaw.map(parse);
    const sales = salesRaw.map(parse);
    const leads = leadsRaw.map(parse);
    const initiates = initiatesRaw.map(parse);

    res.status(200).json({ events, sales, leads, initiates });
  } catch (e) {
    console.error('Dashboard data error:', e);
    res.status(500).json({ error: 'Internal error', events: [], sales: [], leads: [], initiates: [] });
  }
}
