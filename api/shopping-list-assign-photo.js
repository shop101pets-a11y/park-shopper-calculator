const { getSql, ensureSchema, shoppingRequestToJson } = require('./_db');
const { archiveRequestImage } = require('./_google');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { id, fileId } = req.body || {};
  if (!id || !fileId) {
    res.status(400).json({ error: 'id and fileId are required' });
    return;
  }

  try {
    const sql = getSql();
    await ensureSchema(sql);

    const existing = await sql`
      SELECT reference_image_file_id FROM shopping_requests
      WHERE id = ${id} AND deleted_at IS NULL
    `;
    if (!existing.length) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    const previousFileId = existing[0].reference_image_file_id;

    const updated = await sql`
      UPDATE shopping_requests
      SET reference_image_file_id = ${fileId}, reference_image_url = null
      WHERE id = ${id}
      RETURNING *
    `;

    // Whatever photo this replaces (if any) is done being useful here -
    // archive it the same way a delete would, best-effort.
    if (previousFileId && previousFileId !== fileId) {
      await archiveRequestImage({ referenceImageFileId: previousFileId, referenceImageUrl: null });
    }

    res.status(200).json({ request: shoppingRequestToJson(updated[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
