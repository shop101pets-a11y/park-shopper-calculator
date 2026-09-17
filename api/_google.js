const { createSign } = require('node:crypto');

// Service-account JWT Bearer flow (RFC 7523) - no external dependency, no
// interactive consent. Lets our server read our own private Sheet/Drive
// files without making them publicly shared.

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signJwt(claims, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKeyPem, 'base64url');
  return `${unsigned}.${signature}`;
}

async function getGoogleAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60000) {
    return cachedToken;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error('Google service account credentials are not configured on the server');
  }

  let privateKey = rawKey.replace(/\\n/g, '\n').trim();
  // Tolerate a copy-paste that only grabbed the base64 body, missing the
  // PEM header/footer lines - easy mistake given how JSON files render
  // multi-line string values.
  if (!privateKey.includes('-----BEGIN')) {
    privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----\n`;
  }

  const now = Math.floor(Date.now() / 1000);
  const jwt = signJwt(
    {
      iss: email,
      // Drive needs write access (not just .readonly) to move a file
      // between folders - Sheets stays read-only, we never write to the
      // form's response spreadsheet itself.
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    privateKey
  );

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google auth failed: ${data.error_description || data.error || JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// Drive file IDs are a long alphanumeric/-/_ run, consistently present
// regardless of which exact Drive URL shape a given link uses.
function extractDriveFileId(url) {
  if (!url) return null;
  const match = String(url).match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

async function fetchDriveFile(fileId) {
  const token = await getGoogleAccessToken();
  const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!driveRes.ok) {
    throw new Error(`Drive returned ${driveRes.status}`);
  }
  const contentType = driveRes.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await driveRes.arrayBuffer());
  return { buffer, contentType };
}

// Moves a file into a different folder (e.g. once its request is done) by
// swapping its parent - Drive files can have multiple parents, so this
// removes whichever ones it's currently in and adds the new one.
async function moveFileToFolder(fileId, destFolderId) {
  const token = await getGoogleAccessToken();
  const authHeader = { Authorization: `Bearer ${token}` };

  const getRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
    headers: authHeader,
  });
  const fileData = await getRes.json();
  if (!getRes.ok) {
    throw new Error(fileData.error?.message || `Drive returned ${getRes.status}`);
  }

  const currentParents = (fileData.parents || []).join(',');
  const params = new URLSearchParams({ addParents: destFolderId });
  if (currentParents) params.set('removeParents', currentParents);

  const updateRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?${params}`, {
    method: 'PATCH',
    headers: authHeader,
  });
  if (!updateRes.ok) {
    const data = await updateRes.json();
    throw new Error(data.error?.message || `Drive returned ${updateRes.status}`);
  }
}

// Best-effort: moves a request's reference photo into the "done" folder
// (configured via GOOGLE_DRIVE_DONE_FOLDER_ID) so it's out of the active
// upload folder and easy to spot for manual cleanup later. Never throws -
// callers use this as a side effect of deleting a request, and a photo
// that fails to move (already moved, permission not granted yet, etc.)
// shouldn't block the actual delete.
async function archiveRequestImage({ referenceImageFileId, referenceImageUrl }) {
  const doneFolderId = process.env.GOOGLE_DRIVE_DONE_FOLDER_ID;
  if (!doneFolderId) return;

  const fileId = referenceImageFileId || extractDriveFileId(referenceImageUrl);
  if (!fileId) return;

  try {
    await moveFileToFolder(fileId, doneFolderId);
  } catch {
    // ignored - see comment above
  }
}

module.exports = { getGoogleAccessToken, extractDriveFileId, fetchDriveFile, moveFileToFolder, archiveRequestImage };
