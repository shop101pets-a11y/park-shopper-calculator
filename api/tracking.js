const { getSql, ensureSchema } = require('./_db');
const { archiveRequestImage } = require('./_google');

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

module.exports = async (req, res) => {
  try {
    const sql = getSql();
    await ensureSchema(sql);

    if (req.method === 'POST') {
      const { orderIds } = req.body || {};
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        res.status(400).json({ error: 'orderIds is required and must be a non-empty array' });
        return;
      }
      let shoppingListDeleted = 0;
      for (const orderId of orderIds) {
        await sql`UPDATE finance_rows SET packed = true WHERE order_id = ${orderId}`;
        // Same order id tagged onto Shopping List items when their payment
        // link was generated (see create-payment-link.js / app.js) - once
        // an order is packed and shipped, those items are done and should
        // disappear from the Shopping List too. Soft delete, same as the
        // manual delete button, so it can't undo a resync either.
        const deleted = await sql`
          UPDATE shopping_requests SET deleted_at = now()
          WHERE square_order_id = ${orderId} AND deleted_at IS NULL
          RETURNING id, reference_image_file_id, reference_image_url
        `;
        shoppingListDeleted += deleted.length;
        for (const row of deleted) {
          await archiveRequestImage({
            referenceImageFileId: row.reference_image_file_id,
            referenceImageUrl: row.reference_image_url,
          });
        }
      }
      res.status(200).json({ updated: orderIds.length, shoppingListDeleted });
      return;
    }

    if (req.method === 'PATCH') {
      const { orderIds, trackingNumber } = req.body || {};
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        res.status(400).json({ error: 'orderIds is required and must be a non-empty array' });
        return;
      }
      const value = typeof trackingNumber === 'string' ? trackingNumber.trim() : '';
      // A typed-in number has no carrier link or known carrier; the old ones
      // (if any) belonged to the previous number, so drop them - the page
      // works the carrier and link out from the new number.
      await sql`
        UPDATE finance_rows
        SET tracking_number = ${value || null}, tracking_url = NULL, carrier = NULL
        WHERE order_id = ANY(${orderIds}::text[])
      `;
      res.status(200).json({ trackingNumber: value || null });
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const rows = await sql`
      SELECT * FROM finance_rows
      WHERE packed = false
      ORDER BY order_created_at DESC NULLS LAST, id DESC
    `;

    // Any unpacked orders from the same customer merge into one shipment,
    // regardless of date - e.g. holding a customer's order until a second
    // item is bought, then shipping together. Once "Finish packing" removes
    // an order from this pool, a later new order from the same customer
    // starts a fresh row rather than merging with the already-shipped one.
    const groups = new Map();
    for (const row of rows) {
      const key = normalizeName(row.customer);

      if (!groups.has(key)) {
        groups.set(key, {
          customer: row.customer,
          orderDate: row.order_created_at,
          items: [],
          orderIds: new Set(),
          trackingNumbers: new Set(),
          carriers: new Set(),
          trackingUrls: new Set(),
        });
      }

      const group = groups.get(key);
      group.items.push(row.item);
      group.orderIds.add(row.order_id);
      if (row.tracking_number) group.trackingNumbers.add(row.tracking_number);
      if (row.carrier) group.carriers.add(row.carrier);
      if (row.tracking_url) group.trackingUrls.add(row.tracking_url);
      if (row.order_created_at && (!group.orderDate || new Date(row.order_created_at) < new Date(group.orderDate))) {
        group.orderDate = row.order_created_at;
      }
    }

    // Contact details live on the Shopping List requests, not the Square
    // orders. Match on the order id the payment link was tagged with, falling
    // back to the customer's name. Deleted requests still count - packing an
    // order removes its Shopping List items, but the contact is still needed.
    const contactRows = await sql`
      SELECT customer, square_order_id, contact_phone, contact_instagram
      FROM shopping_requests
      WHERE contact_phone IS NOT NULL OR contact_instagram IS NOT NULL
      ORDER BY submitted_at DESC NULLS LAST, id DESC
    `;
    const contactByOrderId = new Map();
    const contactByName = new Map();
    for (const c of contactRows) {
      const contact = { phone: c.contact_phone || null, instagram: c.contact_instagram || null };
      if (c.square_order_id && !contactByOrderId.has(c.square_order_id)) contactByOrderId.set(c.square_order_id, contact);
      const key = normalizeName(c.customer);
      if (!contactByName.has(key)) contactByName.set(key, contact);
    }

    const orders = [...groups.values()]
      .map((g) => {
        const trackingNumbers = [...g.trackingNumbers];
        const orderIds = [...g.orderIds];
        const contact = orderIds.map((id) => contactByOrderId.get(id)).find(Boolean)
          || contactByName.get(normalizeName(g.customer))
          || {};
        return {
          orderIds,
          contactPhone: contact.phone || null,
          contactInstagram: contact.instagram || null,
          customer: g.customer,
          orderDate: g.orderDate,
          items: g.items,
          trackingNumber: trackingNumbers.join(', ') || null,
          carrier: [...g.carriers].join(', ') || null,
          // Only usable as a clickable link when there's exactly one shipment.
          trackingUrl: trackingNumbers.length === 1 ? [...g.trackingUrls][0] || null : null,
        };
      })
      .sort((a, b) => new Date(b.orderDate || 0) - new Date(a.orderDate || 0));

    res.status(200).json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
