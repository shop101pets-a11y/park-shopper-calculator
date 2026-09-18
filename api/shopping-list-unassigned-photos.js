const { listFilesInFolder } = require('./_google');

// Lists every photo sitting in the shared "drop photos here" Drive folder.
// These are reusable templates, not one-time uploads - the shopper can add
// photos to that folder themselves (their own Google account, so no
// service-account storage-quota issue) and assign the same one to as many
// no-photo cards as apply, any number of times.
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
    const photos = await listFilesInFolder(folderId);
    res.status(200).json({ photos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
