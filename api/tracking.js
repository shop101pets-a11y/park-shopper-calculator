const { getSql, ensureSchema } = require('./_db');

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// UTC calendar day the order was placed on.
function dayKey(dateStr) {
  return dateStr ? new Date(dateStr).toISOString().slice(0, 10) : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const sql = getSql();
    await ensureSchema(sql);

    const rows = await sql`SELECT * FROM finance_rows ORDER BY order_created_at DESC NULLS LAST, id DESC`;

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
          trackingNumbers: new Set(),
          carriers: new Set(),
          trackingUrls: new Set(),
        });
      }

      const group = groups.get(key);
      group.items.push(row.item);
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
