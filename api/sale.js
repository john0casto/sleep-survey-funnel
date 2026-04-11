import { kv } from '@vercel/kv';
import crypto from 'crypto';

const FB_PIXEL_ID = '1630969037933313';
const FB_CAPI_TOKEN = 'EAAOrQQDYtRsBRFODGWcVBXE88blRBHmZAvfl5LfNmnc07mjnx1htvaEHCq9RIFfJDPKNfCmOvozx4cU73OVynC56HDQwkpsWc1CePQTJT0HfoxL82y3xR1ifPjp7jZCcjai1PT4vbzzKEd00InrWWYZA0j2A8Iowsv8oux7HrsXjMhZB7vcLduYT4IUdNWlMUAZDZD';
const CF_CONVERSION_BASE = 'https://priorityjusticeassist.com/cf/cv';

function sha256(v) {
  if (!v) return undefined;
  return crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
}

async function fireMetaPurchase({ amount, orderId, email, phone, firstName, lastName, state, fbp, fbc, clientIp, userAgent }) {
  const userData = {
    em: sha256(email),
    ph: phone ? sha256(String(phone).replace(/\D/g, '')) : undefined,
    fn: sha256(firstName),
    ln: sha256(lastName),
    st: sha256(state),
    country: sha256('us'),
    fbp,
    fbc,
    client_ip_address: clientIp,
    client_user_agent: userAgent,
  };
  // Strip undefineds so Meta doesn't reject
  Object.keys(userData).forEach(k => userData[k] === undefined && delete userData[k]);

  const eventId = 'purchase_' + (orderId || Date.now());
  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: 'https://www.healthrenewalrx.com/offer.html',
      user_data: userData,
      custom_data: {
        currency: 'USD',
        value: amount,
        order_id: orderId || undefined,
      },
    }],
  };

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${FB_PIXEL_ID}/events?access_token=${FB_CAPI_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('Meta CAPI Purchase non-2xx:', res.status, body);
    }
  } catch (e) {
    console.warn('Meta CAPI Purchase error:', e && e.message);
  }
}

async function fireCfConversion({ amount, clickId, orderId }) {
  if (!clickId) return;
  const url = `${CF_CONVERSION_BASE}?click_id=${encodeURIComponent(clickId)}&ct=purchase&payout=${encodeURIComponent(amount)}&txid=${encodeURIComponent(orderId || '')}`;
  try {
    await fetch(url, { method: 'GET' });
  } catch (e) {
    console.warn('ClickFlare conversion error:', e && e.message);
  }
}

export default async function handler(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : (req.body || {});
    const amount = parseFloat(params.amount || params.orderTotal || '49.99');
    const source = params.source || 'checkoutchamp';
    const session = params.session_id || params.session || 'sale_' + Date.now();
    const orderId = params.order_id || params.orderId || '';
    const email = params.email || params.emailAddress || '';
    const firstName = params.first || params.firstName || '';
    const lastName = params.last || params.lastName || '';
    const phone = params.phone || '';
    const state = params.state || '';
    const clickId = params.clickid || params.cf_click_id || '';
    const fbp = params.fbp || '';
    const fbc = params.fbc || '';
    const userAgent = (req.headers && req.headers['user-agent']) || '';
    const xff = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '';
    const clientIp = typeof xff === 'string' ? xff.split(',')[0].trim() : '';

    // Deduplicate by order_id — if we already recorded this order, skip
    if (orderId) {
      const existing = await kv.lrange('funnel:sales', 0, -1) || [];
      const parse = (item) => typeof item === 'string' ? JSON.parse(item) : item;
      const isDupe = existing.some(s => {
        const sale = parse(s);
        return sale.orderId === orderId;
      });
      if (isDupe) {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'image/gif');
          res.setHeader('Cache-Control', 'no-store');
          const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
          return res.status(200).send(pixel);
        }
        return res.status(200).json({ ok: true, duplicate: true });
      }
    }

    const sale = {
      amount, source, session, orderId,
      email, firstName, lastName, phone, state,
      ts: Date.now()
    };

    await kv.rpush('funnel:sales', JSON.stringify(sale));
    await kv.rpush('funnel:events', JSON.stringify({
      session, step: 'offer_sale', ts: Date.now()
    }));

    // Fire Meta CAPI Purchase + ClickFlare conversion in parallel
    await Promise.all([
      fireMetaPurchase({ amount, orderId, email, phone, firstName, lastName, state, fbp, fbc, clientIp, userAgent }),
      fireCfConversion({ amount, clickId, orderId }),
    ]);

    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'no-store');
      const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      return res.status(200).send(pixel);
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Sale save error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
}
