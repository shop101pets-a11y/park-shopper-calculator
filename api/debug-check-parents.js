const { getGoogleAccessToken } = require('./_google');

// Temporary: confirms a file's current parent folder(s) after a move, to
// verify it's only in the destination folder and not still also in the
// original one. Remove after checking.
module.exports = async (req, res) => {
  const fileId = req.query?.fileId;
  if (!fileId) {
    res.status(400).json({ error: 'fileId is required' });
    return;
  }
  try {
    const token = await getGoogleAccessToken();
    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,parents`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await driveRes.json();
    if (!driveRes.ok) {
      res.status(driveRes.status).json({ error: data.error?.message || 'Drive error' });
      return;
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
