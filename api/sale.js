import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Support both GET (postback from CheckoutChamp) and POST
  try {
    const params = req.method === 'GET' ? req.query : req.body;
    const amount = parseFloat(params.amount || params.orderTotal || '99');
    const source = params.source || 'checkoutchamp';
    const session = params.session_id || params.session || 'sale_' + Date.now();
    const orderId = params.order_id || params.orderId || '';
    const email = params.email || params.emailAddress || '';
    const firstName = params.first || params.firstName || '';
    const lastName = params.last || params.lastName || '';

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
      email, firstName, lastName,
      ts: Date.now()
    };

    await kv.rpush('funnel:sales', JSON.stringify(sale));

    // Also record as a funnel event
    await kv.rpush('funnel:events', JSON.stringify({
      session, step: 'offer_sale', ts: Date.now()
    }));

    // Return 1x1 pixel for GET requests (postback), JSON for POST
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'no-store');
      // 1x1 transparent GIF
      const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      return res.status(200).send(pixel);
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Sale save error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
}
