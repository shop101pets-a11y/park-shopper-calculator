const { getSql, ensureSchema, shoppingRequestToJson } = require('./_db');
const { uploadFileToDrive, archiveRequestImage } = require('./_google');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const uploadFolderId = process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID;
  if (!uploadFolderId) {
    res.status(500).json({ error: 'GOOGLE_DRIVE_UPLOAD_FOLDER_ID is not configured on the server' });
    return;
  }

  const { id, imageBase64, contentType } = req.body || {};
  if (!id || !imageBase64) {
    res.status(400).json({ error: 'id and imageBase64 are required' });
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

    const mimeType = contentType || 'image/jpeg';
    const extension = mimeType.split('/')[1] || 'jpg';
    const buffer = Buffer.from(imageBase64, 'base64');

    const fileId = await uploadFileToDrive({
      name: `manual-${id}-${Date.now()}.${extension}`,
      folderId: uploadFolderId,
      buffer,
      contentType: mimeType,
    });

    const previousFileId = existing[0].reference_image_file_id;

    const updated = await sql`
      UPDATE shopping_requests
      SET reference_image_file_id = ${fileId}, reference_image_url = null
      WHERE id = ${id}
      RETURNING *
    `;

    // Whatever photo this replaces (if any) is done being useful here -
    // archive it the same way a delete would, best-effort.
    if (previousFileId) {
      await archiveRequestImage({ referenceImageFileId: previousFileId, referenceImageUrl: null });
    }

    res.status(200).json({ request: shoppingRequestToJson(updated[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
