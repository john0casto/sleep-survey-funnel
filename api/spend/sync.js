import { kv } from '@vercel/kv';

// Required env vars:
//   META_MARKETING_TOKEN  — long-lived Meta Marketing API access token (ads_read scope)
//   META_AD_ACCOUNT_ID    — e.g. "1234567890" (without the "act_" prefix)
//   META_CAMPAIGN_FILTER  — optional, comma-separated campaign IDs to include
//   CRON_SECRET           — optional, required query param if not hit from Vercel cron

async function fetchMetaSpend({ token, adAccountId, daysBack }) {
  const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);

  const url = new URL(`https://graph.facebook.com/v21.0/act_${adAccountId}/insights`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('fields', 'campaign_id,campaign_name,spend,date_start');
  url.searchParams.set('level', 'campaign');
  url.searchParams.set('time_increment', '1');
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('limit', '1000');

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Meta API ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.data || [];
}

export default async function handler(req, res) {
  const META_TOKEN = process.env.META_MARKETING_TOKEN;
  const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;
  const CAMPAIGN_FILTER = (process.env.META_CAMPAIGN_FILTER || '').split(',').map(s => s.trim()).filter(Boolean);
  const CRON_SECRET = process.env.CRON_SECRET;

  if (!META_TOKEN || !AD_ACCOUNT_ID) {
    return res.status(500).json({ error: 'Missing META_MARKETING_TOKEN or META_AD_ACCOUNT_ID env vars' });
  }

  // Allow: Vercel cron (x-vercel-cron header), or matching ?secret=... query param
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secretOk = CRON_SECRET && req.query && req.query.secret === CRON_SECRET;
  if (!isVercelCron && !secretOk) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const daysBack = parseInt(req.query && req.query.days, 10) || 31;
    const rows = await fetchMetaSpend({ token: META_TOKEN, adAccountId: AD_ACCOUNT_ID, daysBack });

    const filtered = CAMPAIGN_FILTER.length > 0
      ? rows.filter(r => CAMPAIGN_FILTER.includes(String(r.campaign_id)))
      : rows;

    // Upsert as hash: key = "YYYY-MM-DD:campaignId"
    const updates = {};
    filtered.forEach(r => {
      const key = `${r.date_start}:${r.campaign_id}`;
      updates[key] = JSON.stringify({
        date: r.date_start,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name || '',
        spend: parseFloat(r.spend) || 0,
        ts: Date.now()
      });
    });

    if (Object.keys(updates).length > 0) {
      await kv.hset('funnel:spend', updates);
    }

    res.status(200).json({
      ok: true,
      synced: Object.keys(updates).length,
      total_rows: rows.length,
      filtered_rows: filtered.length,
      date_range: { days_back: daysBack }
    });
  } catch (e) {
    console.error('Spend sync error:', e);
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
