const { getSql, ensureSchema } = require('./_db');
const { listFilesInFolder, extractDriveFileId } = require('./_google');

// Lists photos sitting in the shared "drop new photos here" Drive folder
// that aren't yet linked to any active request - lets the shopper add
// photos to that folder themselves (their own Google account, so no
// service-account storage-quota issue) and assign each one from here.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const folderId = process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID;
  if (!folderId) {
    res.status(500).json({ error: 'GOOGLE_DRIVE_UPLOAD_FOLDER_ID is not configured on the server' });
    return;
  }

  try {
    const sql = getSql();
    await ensureSchema(sql);

    const active = await sql`
      SELECT reference_image_file_id, reference_image_url
      FROM shopping_requests
      WHERE deleted_at IS NULL
    `;
    const assignedFileIds = new Set(
      active
        .map((r) => r.reference_image_file_id || extractDriveFileId(r.reference_image_url))
        .filter(Boolean)
    );

    const files = await listFilesInFolder(folderId);
    const unassigned = files.filter((f) => !assignedFileIds.has(f.id));

    res.status(200).json({ photos: unassigned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
