const { moveFileToFolder } = require('./_google');

// Temporary: lets us verify the Drive folder-move mechanism works end to
// end (with a real, unswallowed error message) before relying on it inside
// the delete flow, where failures are intentionally silent. Remove once
// confirmed working.
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

  const { fileId } = req.body || {};
  if (!fileId) {
    res.status(400).json({ error: 'fileId is required' });
    return;
  }

  try {
    await moveFileToFolder(fileId, doneFolderId);
    res.status(200).json({ moved: true, doneFolderId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
