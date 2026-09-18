const { uploadFileToDrive, moveFileToFolder } = require('./_google');

// Temporary: verifies GOOGLE_DRIVE_UPLOAD_FOLDER_ID is set up correctly by
// uploading a tiny real test image, then archives it into the done folder
// so it doesn't linger in the active folder. Remove after checking.
module.exports = async (req, res) => {
  const uploadFolderId = process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID;
  if (!uploadFolderId) {
    res.status(500).json({ error: 'GOOGLE_DRIVE_UPLOAD_FOLDER_ID is not set' });
    return;
  }

  try {
    // 1x1 red pixel PNG.
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const buffer = Buffer.from(pngBase64, 'base64');

    const fileId = await uploadFileToDrive({
      name: `test-upload-${Date.now()}.png`,
      folderId: uploadFolderId,
      buffer,
      contentType: 'image/png',
    });

    const doneFolderId = process.env.GOOGLE_DRIVE_DONE_FOLDER_ID;
    let archived = false;
    if (doneFolderId) {
      await moveFileToFolder(fileId, doneFolderId);
      archived = true;
    }

    res.status(200).json({ uploaded: true, fileId, archived });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
