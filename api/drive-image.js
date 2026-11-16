const { fetchDriveFile, fetchDriveThumbnail } = require('./_google');

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
    // Cards and pickers ask for a small preview (?size=thumb); tapping a
    // photo opens the full original. Full-size originals through here are
    // what used up the free plan's origin transfer, so previews fall back to
    // the original only when Drive can't make a thumbnail.
    let image = null;
    let source = 'full';
    if (req.query?.size === 'thumb') {
      image = await fetchDriveThumbnail(fileId).catch(() => null);
      if (image) source = 'thumb';
    }
    if (!image) image = await fetchDriveFile(fileId);

    res.setHeader('Content-Type', image.contentType);
    res.setHeader('X-Image-Source', source);
    // s-maxage lets Vercel's CDN serve repeats itself - without it every
    // device re-downloads each photo through the function (origin transfer).
    // A file ID's contents never change, so cache hard.
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, immutable');
    res.status(200).send(image.buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
