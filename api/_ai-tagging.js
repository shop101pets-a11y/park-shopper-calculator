const { fetchDriveFile } = require('./_google');

const MODEL = 'claude-haiku-4-5-20251001';

const PROMPT = `You are tagging a customer's item request for a Disney theme park personal shopper business. The shopper searches these tags later to find everything related to a character or item type in one search, even when customers word requests differently (e.g. "Belle sweatshirt" and "Beauty and the Beast sweatshirt" should both be findable under one tag).

Given the item description below (and a photo, if provided), return ONLY a JSON array of up to 8 short, lowercase tags - no other text, no markdown. Cover: character name(s), franchise/movie, item type (sweatshirt, keychain, ears, mug, tumbler, tote, pin, plush, etc.), and any obvious theme, holiday, or color.

Item description: "{ITEM}"`;

function parseTagsResponse(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8);
    }
  } catch {
    // fall through
  }
  return [];
}

// Returns [] on any failure (missing key, API error, bad response) rather
// than throwing - tag generation is a nice-to-have, it should never block
// a request from being saved.
async function generateTags({ itemDescription, imageFileId }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !itemDescription) return [];

  const content = [{ type: 'text', text: PROMPT.replace('{ITEM}', itemDescription) }];

  if (imageFileId) {
    try {
      const { buffer, contentType } = await fetchDriveFile(imageFileId);
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: contentType, data: buffer.toString('base64') },
      });
    } catch {
      // Proceed text-only if the photo can't be fetched.
    }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const text = data.content?.[0]?.text;
    return text ? parseTagsResponse(text) : [];
  } catch {
    return [];
  }
}

module.exports = { generateTags };
