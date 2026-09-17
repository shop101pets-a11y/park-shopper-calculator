const { getSql, ensureSchema, shoppingRequestToJson } = require('./_db');
const { archiveRequestImage } = require('./_google');

const PATCHABLE_COLUMNS = {
  tags: 'tags',
  status: 'status',
  notes: 'notes',
  customer: 'customer',
  contactPhone: 'contact_phone',
  contactEmail: 'contact_email',
  contactInstagram: 'contact_instagram',
  contactPreference: 'contact_preference',
  price: 'price',
  squareOrderId: 'square_order_id',
};

module.exports = async (req, res) => {
  try {
    const sql = getSql();
    await ensureSchema(sql);

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT * FROM shopping_requests
        WHERE deleted_at IS NULL
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
        case 'price': {
          const price = value === '' || value === null || value === undefined ? null : Number(value);
          if (price !== null && !Number.isFinite(price)) {
            res.status(400).json({ error: 'price must be a number' });
            return;
          }
          updated = await sql`UPDATE shopping_requests SET price = ${price} WHERE id = ${id} RETURNING *`;
          break;
        }
        case 'squareOrderId':
          updated = await sql`UPDATE shopping_requests SET square_order_id = ${value} WHERE id = ${id} RETURNING *`;
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
      // Soft delete rather than removing the row - it stays in the
      // (submitted_at, item_description) dedup index, so re-syncing the
      // same Google Sheet response never re-inserts it as if it were new.
      const updated = await sql`
        UPDATE shopping_requests SET deleted_at = now()
        WHERE id = ${id} AND deleted_at IS NULL
        RETURNING id, reference_image_file_id, reference_image_url
      `;
      if (!updated.length) {
        res.status(404).json({ error: 'Request not found' });
        return;
      }
      await archiveRequestImage({
        referenceImageFileId: updated[0].reference_image_file_id,
        referenceImageUrl: updated[0].reference_image_url,
      });
      res.status(200).json({ deleted: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
