const { getSql, ensureSchema } = require('./_db');
const { getGoogleAccessToken, extractDriveFileId } = require('./_google');

// Temporary: finds files in the active upload folder that have no matching
// active (non-deleted) shopping_requests row, and optionally moves them to
// the done folder. Pass ?apply=1 to actually move; without it, dry-run only.
module.exports = async (req, res) => {
  const doneFolderId = process.env.GOOGLE_DRIVE_DONE_FOLDER_ID;
  if (!doneFolderId) {
    res.status(500).json({ error: 'GOOGLE_DRIVE_DONE_FOLDER_ID is not set' });
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
    const activeFileIds = new Set(
      active
        .map((r) => r.reference_image_file_id || extractDriveFileId(r.reference_image_url))
        .filter(Boolean)
    );

    const token = await getGoogleAccessToken();
    const authHeader = { Authorization: `Bearer ${token}` };

    // Find the active upload folder by checking a known active file's parent.
    const knownFileId = [...activeFileIds][0];
    if (!knownFileId) {
      res.status(500).json({ error: 'No active file to determine the source folder from' });
      return;
    }
    const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${knownFileId}?fields=parents`, {
      headers: authHeader,
    });
    const fileData = await fileRes.json();
    if (!fileRes.ok) {
      res.status(fileRes.status).json({ error: fileData.error?.message || 'Could not read known file' });
      return;
    }
    const sourceFolderId = fileData.parents?.[0];
    if (!sourceFolderId) {
      res.status(500).json({ error: 'Known active file has no parent folder' });
      return;
    }

    // List every file in that source folder (paginated).
    let allFiles = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        q: `'${sourceFolderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name)',
        pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: authHeader });
      const listData = await listRes.json();
      if (!listRes.ok) {
        res.status(listRes.status).json({ error: listData.error?.message || 'Could not list folder' });
        return;
      }
      allFiles = allFiles.concat(listData.files || []);
      pageToken = listData.nextPageToken;
    } while (pageToken);

    const orphans = allFiles.filter((f) => !activeFileIds.has(f.id));

    if (req.query?.apply !== '1') {
      res.status(200).json({
        sourceFolderId,
        totalFilesInFolder: allFiles.length,
        activeFileCount: activeFileIds.size,
        orphanCount: orphans.length,
        orphans: orphans.map((f) => ({ id: f.id, name: f.name })),
      });
      return;
    }

    const { moveFileToFolder } = require('./_google');
    let moved = 0;
    const errors = [];
    for (const f of orphans) {
      try {
        await moveFileToFolder(f.id, doneFolderId);
        moved += 1;
      } catch (err) {
        errors.push({ id: f.id, name: f.name, error: err.message });
      }
    }

    res.status(200).json({ orphanCount: orphans.length, moved, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
