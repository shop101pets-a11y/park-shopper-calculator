const { fetchDriveFile } = require('./_google');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const fileId = req.query?.fileId;
  if (!fileId) {
    res.status(400).json({ error: 'fileId is required' });
    return;
  }

  try {
    const { buffer, contentType } = await fetchDriveFile(fileId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
