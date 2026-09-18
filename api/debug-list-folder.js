const { getGoogleAccessToken } = require('./_google');

// Temporary: shows mimeType alongside name/id, to check whether the
// configured folder actually contains image files or subfolders instead.
module.exports = async (req, res) => {
  const folderId = req.query?.folderId || process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID;
  if (!folderId) {
    res.status(400).json({ error: 'folderId is required (or set GOOGLE_DRIVE_UPLOAD_FOLDER_ID)' });
    return;
  }
  try {
    const token = await getGoogleAccessToken();
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType)',
      pageSize: '200',
    });
    const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await listRes.json();
    if (!listRes.ok) {
      res.status(listRes.status).json({ error: data.error?.message || 'Drive error' });
      return;
    }
    res.status(200).json({ folderId, count: data.files?.length, files: data.files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
