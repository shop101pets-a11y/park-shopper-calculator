const { getSql, ensureSchema } = require('./_db');
const { getGoogleAccessToken, extractDriveFileId, moveFileToFolder } = require('./_google');

// Temporary: the Form's response folder turned out to hold 12 separate
// per-question subfolders (one per "item N of M" position across every
// branch) rather than one flat folder - the original orphan sweep only
// checked whichever one a single known active file happened to be in.
// This checks all of them. Dry-run by default; ?apply=1 to actually move.
module.exports = async (req, res) => {
  const doneFolderId = process.env.GOOGLE_DRIVE_DONE_FOLDER_ID;
  const parentFolderId = process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID;
  if (!doneFolderId || !parentFolderId) {
    res.status(500).json({ error: 'GOOGLE_DRIVE_DONE_FOLDER_ID and GOOGLE_DRIVE_UPLOAD_FOLDER_ID must be set' });
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
      active.map((r) => r.reference_image_file_id || extractDriveFileId(r.reference_image_url)).filter(Boolean)
    );

    const token = await getGoogleAccessToken();
    const authHeader = { Authorization: `Bearer ${token}` };

    // List every subfolder directly inside the parent, excluding the done
    // folder itself (which sits alongside them).
    const subParams = new URLSearchParams({
      q: `'${parentFolderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
      pageSize: '200',
    });
    const subRes = await fetch(`https://www.googleapis.com/drive/v3/files?${subParams}`, { headers: authHeader });
    const subData = await subRes.json();
    if (!subRes.ok) throw new Error(subData.error?.message || 'Could not list subfolders');

    const subfolders = (subData.files || []).filter((f) => f.id !== doneFolderId);

    const perFolder = [];
    let allOrphans = [];

    for (const folder of subfolders) {
      let files = [];
      let pageToken;
      do {
        const params = new URLSearchParams({
          q: `'${folder.id}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id, name)',
          pageSize: '1000',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: authHeader });
        const listData = await listRes.json();
        if (!listRes.ok) throw new Error(listData.error?.message || `Could not list ${folder.name}`);
        files = files.concat(listData.files || []);
        pageToken = listData.nextPageToken;
      } while (pageToken);

      const orphans = files.filter((f) => !activeFileIds.has(f.id));
      perFolder.push({ folder: folder.name, totalFiles: files.length, orphanCount: orphans.length });
      allOrphans = allOrphans.concat(orphans);
    }

    if (req.query?.apply !== '1') {
      res.status(200).json({
        subfoldersChecked: subfolders.map((f) => f.name),
        perFolder,
        totalOrphans: allOrphans.length,
        orphans: allOrphans.map((f) => ({ id: f.id, name: f.name })),
      });
      return;
    }

    let moved = 0;
    const errors = [];
    for (const f of allOrphans) {
      try {
        await moveFileToFolder(f.id, doneFolderId);
        moved += 1;
      } catch (err) {
        errors.push({ id: f.id, name: f.name, error: err.message });
      }
    }

    res.status(200).json({ totalOrphans: allOrphans.length, moved, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
