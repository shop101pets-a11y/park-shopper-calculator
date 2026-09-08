const XLSX = require('xlsx');
const { getSql, ensureSchema } = require('./_db');
const { parseFormRows, normalizeTimestamp } = require('./_shopping-list-parser');
const { extractDriveFileId } = require('./_google');
const { generateTags } = require('./_ai-tagging');

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const [headers] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  return parseFormRows(headers, rows, (row) => (
    row.Timestamp instanceof Date ? normalizeTimestamp(row.Timestamp) : null
  ));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { mode, fileBase64, requests } = req.body || {};

  try {
    if (mode === 'apply') {
      if (!Array.isArray(requests) || requests.length === 0) {
        res.status(400).json({ error: 'requests is required and must be a non-empty array' });
        return;
      }

      const sql = getSql();
      await ensureSchema(sql);

      let newlyTagged = 0;

      for (const r of requests) {
        const fileId = extractDriveFileId(r.referenceImageUrl);
        const inserted = await sql`
          INSERT INTO shopping_requests
            (customer, contact_phone, contact_email, contact_instagram, contact_preference,
             item_description, quantity, size, reference_image_url, reference_image_file_id, notes, source, submitted_at)
          VALUES
            (${r.customer}, ${r.phone || null}, ${r.email || null}, ${r.instagram || null}, ${r.contactPreference},
             ${r.item}, ${r.quantity || 1}, ${r.size || null}, ${r.referenceImageUrl || null},
             ${fileId}, ${r.notes || null}, 'google_form_import', ${r.submittedAt || null})
          ON CONFLICT (submitted_at, item_description) DO NOTHING
          RETURNING id
        `;

        if (inserted.length) {
          const tags = await generateTags({ itemDescription: r.item, imageFileId: fileId });
          if (tags.length) {
            await sql`UPDATE shopping_requests SET tags = ${tags} WHERE id = ${inserted[0].id}`;
            newlyTagged += 1;
          }
        }
      }

      res.status(200).json({ imported: requests.length, newlyTagged });
      return;
    }

    if (mode !== 'preview') {
      res.status(400).json({ error: 'mode must be "preview" or "apply"' });
      return;
    }

    if (!fileBase64) {
      res.status(400).json({ error: 'fileBase64 is required' });
      return;
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    const candidates = parseWorkbook(buffer).filter((c) => c.item);

    res.status(200).json({ candidates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
