const { getSql, ensureSchema, shoppingRequestToJson } = require('./_db');
const { getGoogleAccessToken, extractDriveFileId } = require('./_google');
const { parseFormRows, normalizeTimestamp } = require('./_shopping-list-parser');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    res.status(500).json({ error: 'GOOGLE_SHEETS_SPREADSHEET_ID is not configured on the server' });
    return;
  }

  try {
    const token = await getGoogleAccessToken();
    const authHeader = { Authorization: `Bearer ${token}` };

    // Discover the first sheet's title rather than assuming a fixed name -
    // Google Forms names it "Form Responses 1" by default, but that's
    // editable, and hardcoding it would silently break if renamed.
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
      { headers: authHeader }
    );
    const meta = await metaRes.json();
    if (!metaRes.ok) {
      throw new Error(meta.error?.message || 'Could not read spreadsheet metadata');
    }
    const sheetTitle = meta.sheets?.[0]?.properties?.title;
    if (!sheetTitle) {
      throw new Error('Spreadsheet has no sheets');
    }

    const valuesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${sheetTitle}'!A:BZ`)}`,
      { headers: authHeader }
    );
    const valuesData = await valuesRes.json();
    if (!valuesRes.ok) {
      throw new Error(valuesData.error?.message || 'Could not read spreadsheet values');
    }

    const [headers, ...rawRows] = valuesData.values || [];
    if (!headers) {
      res.status(200).json({ requests: [], _debug: { rowsFound: 0 } });
      return;
    }

    // Sheets API omits trailing empty cells per row - pad to header length
    // and turn each row into a header-keyed object, matching the shape the
    // shared parser expects (same as the xlsx path).
    const rows = rawRows.map((cells) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cells[i] ?? null; });
      return obj;
    });

    const candidates = parseFormRows(headers, rows, (row) => (
      row.Timestamp ? normalizeTimestamp(new Date(row.Timestamp)) : null
    )).filter((c) => c.item);

    const sql = getSql();
    await ensureSchema(sql);

    for (const r of candidates) {
      await sql`
        INSERT INTO shopping_requests
          (customer, contact_phone, contact_email, contact_instagram, contact_preference,
           item_description, quantity, size, reference_image_url, reference_image_file_id, notes, source, submitted_at)
        VALUES
          (${r.customer}, ${r.phone || null}, ${r.email || null}, ${r.instagram || null}, ${r.contactPreference},
           ${r.item}, ${r.quantity || 1}, ${r.size || null}, ${r.referenceImageUrl || null},
           ${extractDriveFileId(r.referenceImageUrl)}, ${r.notes || null}, 'google_sheets_sync', ${r.submittedAt || null})
        ON CONFLICT (submitted_at, item_description) DO NOTHING
      `;
    }

    const persisted = await sql`
      SELECT * FROM shopping_requests
      ORDER BY submitted_at DESC NULLS LAST, id DESC
    `;

    res.status(200).json({
      requests: persisted.map(shoppingRequestToJson),
      _debug: { rowsInSheet: rawRows.length, candidatesParsed: candidates.length },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
