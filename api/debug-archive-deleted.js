const { getSql, ensureSchema } = require('./_db');
const { moveFileToFolder, extractDriveFileId } = require('./_google');

// Temporary one-time backfill: moves reference photos for requests that were
// already soft-deleted before the archive-on-delete feature existed (so
// their photos never got moved automatically). Remove after running once.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const doneFolderId = process.env.GOOGLE_DRIVE_DONE_FOLDER_ID;
  if (!doneFolderId) {
    res.status(500).json({ error: 'GOOGLE_DRIVE_DONE_FOLDER_ID is not set' });
    return;
  }

  try {
    const sql = getSql();
    await ensureSchema(sql);

    const rows = await sql`
      SELECT id, item_description, reference_image_file_id, reference_image_url
      FROM shopping_requests
      WHERE deleted_at IS NOT NULL
        AND (reference_image_file_id IS NOT NULL OR reference_image_url IS NOT NULL)
    `;

    let moved = 0;
    let skipped = 0;
    const errors = [];

    for (const row of rows) {
      const fileId = row.reference_image_file_id || extractDriveFileId(row.reference_image_url);
      if (!fileId) {
        skipped += 1;
        continue;
      }
      try {
        await moveFileToFolder(fileId, doneFolderId);
        moved += 1;
      } catch (err) {
        errors.push({ id: row.id, item: row.item_description, error: err.message });
      }
    }

    res.status(200).json({ totalCandidates: rows.length, moved, skipped, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
