const { getSql, ensureSchema } = require('./_db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const sql = getSql();
    await ensureSchema(sql);

    const rows = await sql`
      SELECT
        order_id,
        customer,
        tracking_number,
        carrier,
        tracking_url,
        order_created_at,
        array_agg(item ORDER BY id) AS items
      FROM finance_rows
      GROUP BY order_id, customer, tracking_number, carrier, tracking_url, order_created_at
      ORDER BY order_created_at DESC NULLS LAST
    `;

    res.status(200).json({
      orders: rows.map((row) => ({
        orderId: row.order_id,
        customer: row.customer,
        trackingNumber: row.tracking_number,
        carrier: row.carrier,
        trackingUrl: row.tracking_url,
        orderDate: row.order_created_at,
        items: row.items,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
