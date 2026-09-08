const { getGoogleAccessToken } = require('./_google');

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
    const token = await getGoogleAccessToken();
    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!driveRes.ok) {
      res.status(driveRes.status).json({ error: `Drive returned ${driveRes.status}` });
      return;
    }

    const contentType = driveRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await driveRes.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
