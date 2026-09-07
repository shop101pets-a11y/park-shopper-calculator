const { getSql, ensureSchema } = require('./_db');

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Local (business timezone) calendar day the order was placed on. Using UTC
// here split same-evening orders across two "days" whenever they landed
// after 8pm Eastern (already UTC tomorrow), which broke same-day merging.
const BUSINESS_TIMEZONE = 'America/New_York';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE });

function dayKey(dateStr) {
  return dateStr ? dayFormatter.format(new Date(dateStr)) : null;
}

module.exports = async (req, res) => {
  try {
    const sql = getSql();
    await ensureSchema(sql);

    if (req.method === 'POST') {
      const { orderIds } = req.body || {};
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        res.status(400).json({ error: 'orderIds is required and must be a non-empty array' });
        return;
      }
      for (const orderId of orderIds) {
        await sql`UPDATE finance_rows SET packed = true WHERE order_id = ${orderId}`;
      }
      res.status(200).json({ updated: orderIds.length });
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const rows = await sql`
      SELECT * FROM finance_rows
      WHERE packed = false
      ORDER BY order_created_at DESC NULLS LAST, id DESC
    `;

    // Same customer, same day, one shipment - merge into a single row so a
    // multi-order combined shipment doesn't show as duplicate tracking rows.
    // Rows with no order date fall back to grouping by order_id alone, so
    // undated legacy rows never merge with something they shouldn't.
    const groups = new Map();
    for (const row of rows) {
      const day = dayKey(row.order_created_at);
      const key = day ? `${normalizeName(row.customer)}|${day}` : `order:${row.order_id}`;

      if (!groups.has(key)) {
        groups.set(key, {
          customer: row.customer,
          orderDate: row.order_created_at,
          items: [],
          orderIds: new Set(),
          trackingNumbers: new Set(),
          carriers: new Set(),
          trackingUrls: new Set(),
        });
      }

      const group = groups.get(key);
      group.items.push(row.item);
      group.orderIds.add(row.order_id);
      if (row.tracking_number) group.trackingNumbers.add(row.tracking_number);
      if (row.carrier) group.carriers.add(row.carrier);
      if (row.tracking_url) group.trackingUrls.add(row.tracking_url);
      if (row.order_created_at && (!group.orderDate || new Date(row.order_created_at) < new Date(group.orderDate))) {
        group.orderDate = row.order_created_at;
      }
    }

    const orders = [...groups.values()]
      .map((g) => {
        const trackingNumbers = [...g.trackingNumbers];
        return {
          orderIds: [...g.orderIds],
          customer: g.customer,
          orderDate: g.orderDate,
          items: g.items,
          trackingNumber: trackingNumbers.join(', ') || null,
          carrier: [...g.carriers].join(', ') || null,
          // Only usable as a clickable link when there's exactly one shipment.
          trackingUrl: trackingNumbers.length === 1 ? [...g.trackingUrls][0] || null : null,
        };
      })
      .sort((a, b) => new Date(b.orderDate || 0) - new Date(a.orderDate || 0));

    res.status(200).json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
