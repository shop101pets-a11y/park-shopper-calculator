const { SQUARE_VERSION, getSquareConfig } = require('./_square');
const { getSql, ensureSchema, shoppingRequestToJson } = require('./_db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { accessToken, baseUrl } = getSquareConfig();
  if (!accessToken) {
    res.status(500).json({ error: 'Square credentials are not configured on the server' });
    return;
  }

  try {
    const sql = getSql();
    await ensureSchema(sql);

    // Every item included in a generated payment link gets tagged with that
    // order's id (see create-payment-link.js / app.js) - anything not yet
    // paid or purchased is a candidate to check.
    const pending = await sql`
      SELECT DISTINCT square_order_id FROM shopping_requests
      WHERE square_order_id IS NOT NULL AND status NOT IN ('paid', 'purchased') AND deleted_at IS NULL
    `;
    const orderIds = pending.map((r) => r.square_order_id);

    let updatedCount = 0;

    if (orderIds.length) {
      const squareRes = await fetch(`${baseUrl}/v2/orders/batch-retrieve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'Square-Version': SQUARE_VERSION,
        },
        body: JSON.stringify({ order_ids: orderIds }),
      });
      const data = await squareRes.json();
      if (!squareRes.ok) {
        const message = Array.isArray(data.errors)
          ? data.errors.map((e) => e.detail).join('; ')
          : JSON.stringify(data);
        throw new Error(message);
      }

      // An order stays OPEN until fulfillment (shipping) completes, well
      // after it's actually been paid - so check the balance directly
      // instead of relying on order state, same as the Finances sync does.
      const paidOrderIds = (data.orders || [])
        .filter((order) => (order.net_amount_due_money?.amount || 0) === 0)
        .map((order) => order.id);

      for (const orderId of paidOrderIds) {
        const updated = await sql`
          UPDATE shopping_requests
          SET status = 'paid'
          WHERE square_order_id = ${orderId} AND status NOT IN ('paid', 'purchased') AND deleted_at IS NULL
          RETURNING id
        `;
        updatedCount += updated.length;
      }
    }

    const persisted = await sql`
      SELECT * FROM shopping_requests
      WHERE deleted_at IS NULL
      ORDER BY submitted_at DESC NULLS LAST, id DESC
    `;

    res.status(200).json({
      requests: persisted.map(shoppingRequestToJson),
      _debug: { ordersChecked: orderIds.length, updatedCount },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
