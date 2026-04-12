import { kv } from '@vercel/kv';
import crypto from 'crypto';

const FB_PIXEL_ID = '1630969037933313';
const FB_CAPI_TOKEN = 'EAAOrQQDYtRsBRFODGWcVBXE88blRBHmZAvfl5LfNmnc07mjnx1htvaEHCq9RIFfJDPKNfCmOvozx4cU73OVynC56HDQwkpsWc1CePQTJT0HfoxL82y3xR1ifPjp7jZCcjai1PT4vbzzKEd00InrWWYZA0j2A8Iowsv8oux7HrsXjMhZB7vcLduYT4IUdNWlMUAZDZD';
const CF_CONVERSION_BASE = 'https://priorityjusticeassist.com/cf/cv';

function sha256(v) {
  if (!v) return undefined;
  return crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
}

async function fireMetaInitiateCheckout({ amount, orderId, email, phone, firstName, lastName, state, dob, gender, fbp, fbc, clientIp, userAgent }) {
  const userData = {
    em: sha256(email),
    ph: phone ? sha256(String(phone).replace(/\D/g, '')) : undefined,
    fn: sha256(firstName),
    ln: sha256(lastName),
    st: sha256(state),
    country: sha256('us'),
    db: dob ? sha256(dob) : undefined,
    ge: gender ? sha256(String(gender).toLowerCase().charAt(0)) : undefined,
    fbp,
    fbc,
    client_ip_address: clientIp,
    client_user_agent: userAgent,
  };
  Object.keys(userData).forEach(k => userData[k] === undefined && delete userData[k]);

  const eventId = 'ic_' + (orderId || Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  const payload = {
    data: [{
      event_name: 'InitiateCheckout',
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
      console.warn('Meta CAPI InitiateCheckout non-2xx:', res.status, body);
    }
  } catch (e) {
    console.warn('Meta CAPI InitiateCheckout error:', e && e.message);
  }
}

async function fireCfConversion({ clickId, orderId }) {
  if (!clickId) return;
  const url = `${CF_CONVERSION_BASE}?click_id=${encodeURIComponent(clickId)}&ct=initiate_checkout&payout=0&txid=${encodeURIComponent('ic_' + (orderId || ''))}`;
  try {
    await fetch(url, { method: 'GET' });
  } catch (e) {
    console.warn('ClickFlare IC conversion error:', e && e.message);
  }
}

function respondPixel(res) {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store');
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  return res.status(200).send(pixel);
}

export default async function handler(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : (req.body || {});
    const amount = parseFloat(params.amount || params.orderTotal || '49.99');
    const orderId = params.order_id || params.orderId || '';
    const email = params.email || params.emailAddress || '';
    const firstName = params.first || params.firstName || '';
    const lastName = params.last || params.lastName || '';
    const phone = params.phone || '';
    const state = params.state || '';
    const dob = params.dob || '';
    const gender = params.gender || '';
    const clickId = params.clickid || params.cf_click_id || '';
    const fbp = params.fbp || '';
    const fbc = params.fbc || '';
    const userAgent = (req.headers && req.headers['user-agent']) || '';
    const xff = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '';
    const clientIp = typeof xff === 'string' ? xff.split(',')[0].trim() : '';

    // Deduplicate by order_id — if we already processed this order, skip all fires
    if (orderId) {
      const added = await kv.sadd('funnel:ic_seen', orderId);
      if (!added) {
        if (req.method === 'GET') return respondPixel(res);
        return res.status(200).json({ ok: true, duplicate: true });
      }
    }

    // Save to dashboard
    const session = params.session_id || params.session || 'ic_' + (orderId || Date.now());
    await kv.rpush('funnel:events', JSON.stringify({
      session, step: 'offer_initiate_checkout', ts: Date.now()
    }));

    // Fire Meta CAPI + ClickFlare in parallel
    await Promise.all([
      fireMetaInitiateCheckout({ amount, orderId, email, phone, firstName, lastName, state, dob, gender, fbp, fbc, clientIp, userAgent }),
      fireCfConversion({ clickId, orderId }),
    ]);

    if (req.method === 'GET') return respondPixel(res);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('checkout-started error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
}
