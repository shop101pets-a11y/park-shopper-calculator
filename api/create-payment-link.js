const { randomUUID } = require('node:crypto');
const { SQUARE_VERSION, getSquareConfig } = require('./_square');

const TAX_RATE = '6.5';
const FEE_LOW_CENTS = 300;
const FEE_HIGH_CENTS = 500;
const FEE_THRESHOLD_CENTS = 2500;
const SHIPPING_FEE_CENTS = { light: 775, normal: 835, heavy: 986, none: 0 };

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
  if (shippingCents === undefined) {
    res.status(400).json({ error: 'packageWeight must be one of: light, normal, heavy, none' });
    return;
  }

  const { accessToken, locationId, baseUrl } = getSquareConfig();
  if (!accessToken || !locationId) {
    res.status(500).json({ error: 'Square credentials are not configured on the server' });
    return;
  }

  const taxUid = 'sales-tax';
  const lineItems = [];

  for (const item of items) {
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const price = Number(item.price);
    const quantity = Number.isInteger(item.quantity) ? item.quantity : parseInt(item.quantity, 10) || 1;
    if (!name || !Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1) {
      res.status(400).json({ error: `Invalid item: ${JSON.stringify(item)}` });
      return;
    }

    // Fee is per unit (one shopping trip per item), so its $25 threshold
    // checks the unit price, then scales by quantity - same math as app.js.
    const priceCents = Math.round(price * 100);
    const feeCentsPerUnit = priceCents < FEE_THRESHOLD_CENTS ? FEE_LOW_CENTS : FEE_HIGH_CENTS;

    lineItems.push({
      name,
      quantity: String(quantity),
      base_price_money: { amount: priceCents, currency: 'USD' },
      applied_taxes: [{ tax_uid: taxUid }],
    });
    lineItems.push({
      name: `${name} - shopper fee`,
      quantity: '1',
      base_price_money: { amount: feeCentsPerUnit * quantity, currency: 'USD' },
    });
  }

  const requestBody = {
    idempotency_key: randomUUID(),
    order: {
      location_id: locationId,
      line_items: lineItems,
      taxes: [{ uid: taxUid, name: 'Sales Tax', percentage: TAX_RATE, scope: 'LINE_ITEM' }],
      metadata: { source: 'park-shopper-app' },
    },
    checkout_options: {
      ask_for_shipping_address: true,
      ...(shippingCents > 0 && {
        shipping_fee: {
          name: 'Shipping',
          charge: { amount: shippingCents, currency: 'USD' },
        },
      }),
      // Percentages/custom-amount behavior isn't controllable per-request -
      // it's an account-wide setting (Square Dashboard > Payments & orders >
      // Payment links > Settings > General > Tip options).
      allow_tipping: true,
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
