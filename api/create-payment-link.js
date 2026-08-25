const { randomUUID } = require('node:crypto');

const TAX_RATE = '6.5';
const FEE_LOW_CENTS = 300;
const FEE_HIGH_CENTS = 500;
const FEE_THRESHOLD_CENTS = 2500;
const SHIPPING_FEE_CENTS = { light: 775, normal: 835, heavy: 986 };
const SQUARE_VERSION = '2024-08-21';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { items, packageWeight } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items is required and must be a non-empty array' });
    return;
  }

  const shippingCents = SHIPPING_FEE_CENTS[packageWeight];
  if (!shippingCents) {
    res.status(400).json({ error: 'packageWeight must be one of: light, normal, heavy' });
    return;
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!accessToken || !locationId) {
    res.status(500).json({ error: 'Square credentials are not configured on the server' });
    return;
  }

  const environment = process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const baseUrl = environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  const taxUid = 'sales-tax';
  const lineItems = [];

  for (const item of items) {
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const price = Number(item.price);
    if (!name || !Number.isFinite(price) || price < 0) {
      res.status(400).json({ error: `Invalid item: ${JSON.stringify(item)}` });
      return;
    }

    const priceCents = Math.round(price * 100);
    const feeCents = priceCents < FEE_THRESHOLD_CENTS ? FEE_LOW_CENTS : FEE_HIGH_CENTS;

    lineItems.push({
      name,
      quantity: '1',
      base_price_money: { amount: priceCents, currency: 'USD' },
      applied_taxes: [{ tax_uid: taxUid }],
    });
    lineItems.push({
      name: `${name} - shopper fee`,
      quantity: '1',
      base_price_money: { amount: feeCents, currency: 'USD' },
    });
  }

  const requestBody = {
    idempotency_key: randomUUID(),
    order: {
      location_id: locationId,
      line_items: lineItems,
      taxes: [{ uid: taxUid, name: 'Sales Tax', percentage: TAX_RATE, scope: 'LINE_ITEM' }],
    },
    checkout_options: {
      ask_for_shipping_address: true,
      shipping_fee: {
        name: `Shipping (${packageWeight})`,
        charge: { amount: shippingCents, currency: 'USD' },
      },
    },
  };

  try {
    const squareRes = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Square-Version': SQUARE_VERSION,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await squareRes.json();

    if (!squareRes.ok) {
      const message = Array.isArray(data.errors)
        ? data.errors.map((e) => e.detail).join('; ')
        : JSON.stringify(data);
      res.status(squareRes.status).json({ error: message });
      return;
    }

    res.status(200).json({ url: data.payment_link.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
