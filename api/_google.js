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

  if (process.env.GOOGLE_KEY_DEBUG === 'true') {
    const err = new Error('KEY_DEBUG');
    err.debug = {
      length: rawKey.length,
      first20: rawKey.slice(0, 20),
      last20: rawKey.slice(-20),
      hasLiteralBackslashN: rawKey.includes('\\n'),
      hasRealNewline: rawKey.includes('\n'),
      startsWithQuote: rawKey.startsWith('"'),
      startsWithBrace: rawKey.trim().startsWith('{'),
      startsWithBegin: rawKey.trim().startsWith('-----BEGIN'),
    };
    throw err;
  }

  const privateKey = rawKey.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const jwt = signJwt(
    {
      iss: email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly',
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

module.exports = { getGoogleAccessToken, extractDriveFileId };
