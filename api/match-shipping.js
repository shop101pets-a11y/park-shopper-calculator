const XLSX = require('xlsx');
const { getSql, ensureSchema } = require('./_db');

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Pirate Ship dates look like "8/27/26" or "8/26/26 9:40 PM EDT".
function parseUSDate(value) {
  if (!value) return null;
  const datePart = String(value).trim().split(' ')[0];
  const parts = datePart.split('/');
  if (parts.length !== 3) return null;
  let [m, d, y] = parts.map((p) => parseInt(p, 10));
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return null;
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { mode, fileBase64, matches } = req.body || {};

  try {
    const sql = getSql();
    await ensureSchema(sql);

    if (mode === 'apply') {
      if (!Array.isArray(matches)) {
        res.status(400).json({ error: 'matches array is required' });
        return;
      }
      let updated = 0;
      for (const match of matches) {
        for (const row of match.rows) {
          await sql`UPDATE finance_rows SET shipping_cost = ${row.shippingCost} WHERE id = ${row.id}`;
          updated += 1;
        }
      }
      res.status(200).json({ updated });
      return;
    }

    if (mode !== 'preview') {
      res.status(400).json({ error: 'mode must be "preview" or "apply"' });
      return;
    }

    if (!fileBase64) {
      res.status(400).json({ error: 'fileBase64 is required' });
      return;
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const shipmentRows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    const dbRows = await sql`SELECT * FROM finance_rows ORDER BY order_created_at DESC NULLS LAST, id DESC`;

    const orders = new Map();
    for (const row of dbRows) {
      if (!orders.has(row.order_id)) {
        orders.set(row.order_id, {
          orderId: row.order_id,
          customer: row.customer,
          orderDate: row.order_created_at,
          rows: [],
        });
      }
      orders.get(row.order_id).rows.push(row);
    }

    const byName = new Map();
    for (const order of orders.values()) {
      const key = normalizeName(order.customer);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(order);
    }

    const matchResults = [];
    const unmatched = [];

    for (const shipment of shipmentRows) {
      const recipient = shipment['Recipient'];
      const cost = Number(shipment['Cost']);
      const shipDateRaw = shipment['Ship Date'] || shipment['Label Created Date'];

      if (!recipient || !Number.isFinite(cost)) continue;

      const candidates = byName.get(normalizeName(recipient)) || [];
      if (candidates.length === 0) {
        unmatched.push({ recipient, cost, reason: 'No synced order found for this name' });
        continue;
      }

      let chosen = candidates[0];
      if (candidates.length > 1) {
        const shipDate = parseUSDate(shipDateRaw);
        if (shipDate) {
          chosen = candidates.reduce((best, order) => {
            if (!order.orderDate) return best;
            if (!best.orderDate) return order;
            const diff = Math.abs(shipDate - new Date(order.orderDate));
            const bestDiff = Math.abs(shipDate - new Date(best.orderDate));
            return diff < bestDiff ? order : best;
          }, candidates[0]);
        }
      }

      const itemTotalCents = chosen.rows.reduce((sum, r) => sum + Math.round(Number(r.item_price) * 100), 0);
      const costCents = Math.round(cost * 100);

      const rowsShare = chosen.rows.map((r) => {
        const lineCents = Math.round(Number(r.item_price) * 100);
        const shareCents = itemTotalCents > 0 ? Math.round((lineCents / itemTotalCents) * costCents) : 0;
        return { id: r.id, item: r.item, shippingCost: shareCents / 100 };
      });

      matchResults.push({
        recipient,
        cost,
        matchedCustomer: chosen.customer,
        matchedOrderId: chosen.orderId,
        matchedOrderDate: chosen.orderDate,
        ambiguous: candidates.length > 1,
        rows: rowsShare,
      });
    }

    res.status(200).json({ matches: matchResults, unmatched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
