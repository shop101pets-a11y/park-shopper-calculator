const { moveFileToFolder } = require('./_google');

// Moves a photo out of the "drop photos here" folder into the done folder
// without assigning it to anything - for photos that turned out to not be
// needed (duplicates, wrong item, etc.) and shouldn't keep showing up as an
// option on every no-photo card.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const doneFolderId = process.env.GOOGLE_DRIVE_DONE_FOLDER_ID;
  if (!doneFolderId) {
    res.status(500).json({ error: 'GOOGLE_DRIVE_DONE_FOLDER_ID is not configured on the server' });
    return;
  }

  const { fileId } = req.body || {};
  if (!fileId) {
    res.status(400).json({ error: 'fileId is required' });
    return;
  }

  try {
    await moveFileToFolder(fileId, doneFolderId);
    res.status(200).json({ moved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
