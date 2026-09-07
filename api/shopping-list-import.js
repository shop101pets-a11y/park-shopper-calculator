const XLSX = require('xlsx');
const { getSql, ensureSchema, shoppingRequestToJson } = require('./_db');

// This Google Form branches on "how many items" into differently-shaped
// column groups (1-item, 2-item, 3-item, 4-item, "more than 4" free text).
// Rather than hardcode column positions per branch (fragile - breaks if the
// form is edited), we scan the header row for "Item N of M" columns and
// pull each one's image/quantity/size from the next few columns
// *positionally* (that adjacency held consistently across every branch we
// inspected). Contact info and notes have no real field label in this form
// (Google exports them as "Column 30" / a comments column), so those are
// matched by their literal header text instead.

const ITEM_HEADER_RE = /^Item \d+ of \d+/;
const IMAGE_HEADER_RE = /image|picture/i;
const QUANTITY_HEADER_RE = /quantity/i;
const SIZE_HEADER_RE = /size/i;
const OVERFLOW_HEADER_RE = /please add description of items/i;
const CONTACT_HEADER = 'Column 30';
const NOTES_HEADER_RE = /questions.*comments|comments.*feedback|feeback/i;

function findItemGroups(headers) {
  const groups = [];
  headers.forEach((header, index) => {
    if (!header || !ITEM_HEADER_RE.test(header)) return;
    const group = { nameHeader: header };
    for (let i = index + 1; i < Math.min(index + 4, headers.length); i++) {
      const h = headers[i];
      if (!h) continue;
      if (!group.imageHeader && IMAGE_HEADER_RE.test(h)) group.imageHeader = h;
      else if (!group.quantityHeader && QUANTITY_HEADER_RE.test(h)) group.quantityHeader = h;
      else if (!group.sizeHeader && SIZE_HEADER_RE.test(h)) group.sizeHeader = h;
    }
    groups.push(group);
  });
  return groups;
}

function parseContact(raw) {
  if (!raw || !String(raw).trim()) {
    return { customer: 'Unknown', phone: null, email: null, instagram: null };
  }
  let text = String(raw).trim();

  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const email = emailMatch ? emailMatch[0] : null;
  if (email) text = text.replace(email, '');

  const phoneMatch = text.match(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  const phone = phoneMatch ? phoneMatch[0].trim() : null;
  if (phone) text = text.replace(phone, '');

  let instagram = null;
  if (/instagram|tiktok|\bIG\b/i.test(text)) {
    instagram = text.replace(/instagram|tiktok|\bIG\b/gi, '').replace(/[:@]/g, ' ').replace(/\s+/g, ' ').trim();
    text = '';
  }

  const nameGuess = text.replace(/^[\s\-:,]+|[\s\-:,]+$/g, '').replace(/\s+/g, ' ').trim();
  const customer = nameGuess || instagram || email || phone || 'Unknown';

  return { customer, phone, email, instagram: instagram || null };
}

function guessContactPreference({ phone, email, instagram }) {
  if (phone) return 'phone';
  if (email) return 'email';
  if (instagram) return 'instagram';
  return 'phone';
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const [headers] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  const itemGroups = findItemGroups(headers);
  const overflowHeaders = headers.filter((h) => h && OVERFLOW_HEADER_RE.test(h));
  const notesHeader = headers.find((h) => h && NOTES_HEADER_RE.test(h));

  const candidates = [];

  rows.forEach((row, rowIndex) => {
    const contact = parseContact(row[CONTACT_HEADER]);
    const notes = notesHeader ? row[notesHeader] : null;
    const submittedAt = row.Timestamp || null;

    let itemsFoundInRow = 0;

    for (const group of itemGroups) {
      const itemName = row[group.nameHeader];
      if (!itemName || !String(itemName).trim()) continue;
      itemsFoundInRow += 1;

      candidates.push({
        rowIndex,
        customer: contact.customer,
        phone: contact.phone,
        email: contact.email,
        instagram: contact.instagram,
        contactPreference: guessContactPreference(contact),
        item: String(itemName).trim(),
        quantity: Number(group.quantityHeader ? row[group.quantityHeader] : 1) || 1,
        size: group.sizeHeader ? row[group.sizeHeader] : null,
        referenceImageUrl: group.imageHeader ? row[group.imageHeader] : null,
        notes: notes || null,
        submittedAt,
      });
    }

    // "More than 4 items" branch: free text, can't be reliably split into
    // discrete items - one candidate row per response, flagged for the
    // shopper to break up manually if needed.
    for (const header of overflowHeaders) {
      const text = row[header];
      if (!text || !String(text).trim()) continue;
      itemsFoundInRow += 1;
      candidates.push({
        rowIndex,
        customer: contact.customer,
        phone: contact.phone,
        email: contact.email,
        instagram: contact.instagram,
        contactPreference: guessContactPreference(contact),
        item: String(text).trim(),
        quantity: 1,
        size: null,
        referenceImageUrl: null,
        notes: notes || null,
        submittedAt,
        needsSplitting: true,
      });
    }

    if (itemsFoundInRow === 0) {
      candidates.push({
        rowIndex,
        customer: contact.customer,
        phone: contact.phone,
        email: contact.email,
        instagram: contact.instagram,
        contactPreference: guessContactPreference(contact),
        item: '',
        quantity: 1,
        size: null,
        referenceImageUrl: null,
        notes: notes || null,
        submittedAt,
        unparsed: true,
      });
    }
  });

  return candidates;
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

      for (const r of requests) {
        await sql`
          INSERT INTO shopping_requests
            (customer, contact_phone, contact_email, contact_instagram, contact_preference,
             item_description, quantity, size, reference_image_url, notes, source, submitted_at)
          VALUES
            (${r.customer}, ${r.phone || null}, ${r.email || null}, ${r.instagram || null}, ${r.contactPreference},
             ${r.item}, ${r.quantity || 1}, ${r.size || null}, ${r.referenceImageUrl || null}, ${r.notes || null},
             'google_form_import', ${r.submittedAt || null})
        `;
      }

      res.status(200).json({ imported: requests.length });
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
