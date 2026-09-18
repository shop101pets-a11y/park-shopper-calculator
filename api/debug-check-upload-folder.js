const { getGoogleAccessToken, listFilesInFolder } = require('./_google');

// Temporary: confirms GOOGLE_DRIVE_UPLOAD_FOLDER_ID points to a real,
// accessible, distinct folder (not the Form's response container) and
// that we can list its contents. Remove after checking.
module.exports = async (req, res) => {
  const folderId = process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID;
  const doneFolderId = process.env.GOOGLE_DRIVE_DONE_FOLDER_ID;
  if (!folderId) {
    res.status(500).json({ error: 'GOOGLE_DRIVE_UPLOAD_FOLDER_ID is not set' });
    return;
  }
  try {
    const token = await getGoogleAccessToken();
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meta = await metaRes.json();
    if (!metaRes.ok) {
      res.status(metaRes.status).json({ error: meta.error?.message || 'Could not read folder metadata' });
      return;
    }

    const files = await listFilesInFolder(folderId);

    res.status(200).json({
      folderId,
      folderName: meta.name,
      mimeType: meta.mimeType,
      sameAsDoneFolder: folderId === doneFolderId,
      fileCount: files.length,
      files: files.map((f) => f.name),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
