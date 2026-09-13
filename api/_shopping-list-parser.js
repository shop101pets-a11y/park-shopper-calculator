// Shared parsing logic for the Google Form responses, used by both the
// manual xlsx upload (shopping-list-import.js) and the direct Sheets API
// sync (shopping-list-sync.js). Both feed this the same shape: a header
// array plus rows as plain objects keyed by header text.
//
// This form branches on "how many items" into differently-shaped column
// groups (1-item, 2-item, 3-item, 4-item, "more than 4" free text). Rather
// than hardcode column positions per branch (fragile - breaks if the form
// is edited), we scan the header row for "Item N of M" columns and pull
// each one's image/quantity/size from the next few columns *positionally*
// (that adjacency held consistently across every branch inspected).
// The contact field has no real question title in this form, so Google
// exports it as "Column N" where N is whatever position it currently sits
// at - that shifts any time a question is added/removed from the form (it
// moved from "Column 30" to "Column 44" after one such edit), so it's
// matched by that generic pattern rather than a hardcoded column number.
const ITEM_HEADER_RE = /^Item \d+ of \d+/;
const IMAGE_HEADER_RE = /image|picture/i;
const QUANTITY_HEADER_RE = /quantity/i;
const SIZE_HEADER_RE = /size/i;
const OVERFLOW_HEADER_RE = /please add description of items/i;
const CONTACT_HEADER_RE = /^Column \d+$/;
const CONTACT_PREFERENCE_HEADER_RE = /preferred communication/i;
const NOTES_HEADER_RE = /questions.*comments|comments.*feedback|feeback/i;

function normalizePreference(raw) {
  if (!raw || !String(raw).trim()) return null;
  const text = String(raw).toLowerCase();
  if (/email/.test(text)) return 'email';
  if (/instagram|tiktok|\bIG\b/i.test(text)) return 'instagram';
  if (/phone|call|text/.test(text)) return 'phone';
  return null;
}

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

// headers: string[]. rows: array of plain objects keyed by header text
// (values may be null/undefined for blank cells). submittedAtOf(row)
// should return an ISO date string or null - callers source this
// differently (xlsx cell vs. Sheets API string) so it's injected.
function parseFormRows(headers, rows, submittedAtOf) {
  const itemGroups = findItemGroups(headers);
  const overflowHeaders = headers.filter((h) => h && OVERFLOW_HEADER_RE.test(h));
  const contactHeader = headers.find((h) => h && CONTACT_HEADER_RE.test(h));
  const preferenceHeader = headers.find((h) => h && CONTACT_PREFERENCE_HEADER_RE.test(h));
  const notesHeader = headers.find((h) => h && NOTES_HEADER_RE.test(h));

  const candidates = [];

  rows.forEach((row, rowIndex) => {
    // Newer responses leave the dedicated contact column blank and put the
    // actual phone/email/instagram text in the "Preferred communication?"
    // answer instead (e.g. "Instagram @handle", "Call/text 201-805-6942") -
    // so fall back to parsing that free text when the contact column is empty.
    const rawContact = (contactHeader && row[contactHeader])
      || (preferenceHeader && row[preferenceHeader])
      || null;
    const contact = parseContact(rawContact);
    const contactPreference = normalizePreference(rawContact) || guessContactPreference(contact);
    const notes = notesHeader ? row[notesHeader] : null;
    const submittedAt = submittedAtOf(row);

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
        contactPreference,
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
        contactPreference,
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
        contactPreference,
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

// Truncates to whole-minute precision so the same submission always
// produces the same ISO string regardless of source. Second-precision
// truncation wasn't enough: the xlsx path reads the exact underlying
// timestamp, while the Sheets API returns a *formatted* string that
// rounds to the nearest second for display - the same submission can
// come back a second apart depending on source, which would still
// defeat the (submitted_at, item_description) dedup key at second
// precision. A customer re-requesting the identical item within the
// same minute is an acceptable, unlikely edge case to trade for that.
function normalizeTimestamp(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Date(Math.floor(date.getTime() / 60000) * 60000).toISOString();
}

module.exports = { parseFormRows, normalizeTimestamp };
