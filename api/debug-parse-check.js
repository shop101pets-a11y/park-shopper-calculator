const { getGoogleAccessToken } = require('./_google');
const { parseFormRows, normalizeTimestamp } = require('./_shopping-list-parser');

// Temporary: re-parses the live sheet with the current parser (no DB
// writes) and returns candidates matching a search string, to check
// whether an existing DB row's stale/missing fields (e.g. no image) would
// come out correct if parsed fresh today. Remove after checking.
module.exports = async (req, res) => {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const search = (req.query?.item || '').toLowerCase();
  if (!spreadsheetId || !search) {
    res.status(400).json({ error: 'item query param is required' });
    return;
  }

  try {
    const token = await getGoogleAccessToken();
    const authHeader = { Authorization: `Bearer ${token}` };

    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
      { headers: authHeader }
    );
    const meta = await metaRes.json();
    const sheetTitle = meta.sheets?.[0]?.properties?.title;

    const valuesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${sheetTitle}'!A:BZ`)}`,
      { headers: authHeader }
    );
    const valuesData = await valuesRes.json();

    const [headers, ...rawRows] = valuesData.values || [];
    const rows = rawRows.map((cells) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cells[i] ?? null; });
      return obj;
    });

    const candidates = parseFormRows(headers, rows, (row) => (
      row.Timestamp ? normalizeTimestamp(new Date(row.Timestamp)) : null
    )).filter((c) => c.item && c.item.toLowerCase().includes(search));

    res.status(200).json({ matchCount: candidates.length, candidates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
