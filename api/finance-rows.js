const { getSql, ensureSchema, rowToJson } = require('./_db');

const PATCHABLE_COLUMNS = { discount: 'discount', shippingCost: 'shipping_cost' };

module.exports = async (req, res) => {
  try {
    const sql = getSql();
    await ensureSchema(sql);

    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM finance_rows ORDER BY order_created_at DESC NULLS LAST, id DESC`;
      res.status(200).json({ rows: rows.map(rowToJson) });
      return;
    }

    if (req.method === 'PATCH') {
      const { id, field, value } = req.body || {};
      const column = PATCHABLE_COLUMNS[field];
      const numericValue = Number(value);

      if (!id || !column || !Number.isFinite(numericValue)) {
        res.status(400).json({ error: 'id, a valid field (discount, shippingCost), and a numeric value are required' });
        return;
      }

      const updated = column === 'discount'
        ? await sql`UPDATE finance_rows SET discount = ${numericValue} WHERE id = ${id} RETURNING *`
        : await sql`UPDATE finance_rows SET shipping_cost = ${numericValue} WHERE id = ${id} RETURNING *`;

      if (!updated.length) {
        res.status(404).json({ error: 'Row not found' });
        return;
      }

      res.status(200).json({ row: rowToJson(updated[0]) });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
