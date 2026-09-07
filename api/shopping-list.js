const { getSql, ensureSchema, shoppingRequestToJson } = require('./_db');

const PATCHABLE_COLUMNS = {
  tags: 'tags',
  status: 'status',
  notes: 'notes',
  customer: 'customer',
  contactPhone: 'contact_phone',
  contactEmail: 'contact_email',
  contactInstagram: 'contact_instagram',
  contactPreference: 'contact_preference',
};

module.exports = async (req, res) => {
  try {
    const sql = getSql();
    await ensureSchema(sql);

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT * FROM shopping_requests
        ORDER BY submitted_at DESC NULLS LAST, id DESC
      `;
      res.status(200).json({ requests: rows.map(shoppingRequestToJson) });
      return;
    }

    if (req.method === 'PATCH') {
      const { id, field, value } = req.body || {};
      if (!id || !PATCHABLE_COLUMNS[field]) {
        res.status(400).json({ error: `id and a valid field (${Object.keys(PATCHABLE_COLUMNS).join(', ')}) are required` });
        return;
      }

      let updated;
      switch (field) {
        case 'tags':
          updated = await sql`UPDATE shopping_requests SET tags = ${Array.isArray(value) ? value : []} WHERE id = ${id} RETURNING *`;
          break;
        case 'status':
          updated = await sql`UPDATE shopping_requests SET status = ${value} WHERE id = ${id} RETURNING *`;
          break;
        case 'notes':
          updated = await sql`UPDATE shopping_requests SET notes = ${value} WHERE id = ${id} RETURNING *`;
          break;
        case 'customer':
          updated = await sql`UPDATE shopping_requests SET customer = ${value} WHERE id = ${id} RETURNING *`;
          break;
        case 'contactPhone':
          updated = await sql`UPDATE shopping_requests SET contact_phone = ${value} WHERE id = ${id} RETURNING *`;
          break;
        case 'contactEmail':
          updated = await sql`UPDATE shopping_requests SET contact_email = ${value} WHERE id = ${id} RETURNING *`;
          break;
        case 'contactInstagram':
          updated = await sql`UPDATE shopping_requests SET contact_instagram = ${value} WHERE id = ${id} RETURNING *`;
          break;
        case 'contactPreference':
          updated = await sql`UPDATE shopping_requests SET contact_preference = ${value} WHERE id = ${id} RETURNING *`;
          break;
      }

      if (!updated.length) {
        res.status(404).json({ error: 'Request not found' });
        return;
      }
      res.status(200).json({ request: shoppingRequestToJson(updated[0]) });
      return;
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      await sql`DELETE FROM shopping_requests WHERE id = ${id}`;
      res.status(200).json({ deleted: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
