const { SQUARE_VERSION, getSquareConfig } = require('./_square');
const { getSql, ensureSchema, rowToJson } = require('./_db');

const SHOPPER_FEE_SUFFIX = ' - shopper fee';
const OUR_SOURCE_TAG = 'park-shopper-app';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { accessToken, locationId, baseUrl } = getSquareConfig();
  if (!accessToken || !locationId) {
    res.status(500).json({ error: 'Square credentials are not configured on the server' });
    return;
  }

  const searchBody = {
    location_ids: [locationId],
    query: {
      filter: { state_filter: { states: ['COMPLETED'] } },
      sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
    },
    limit: 100,
  };

  try {
    const squareRes = await fetch(`${baseUrl}/v2/orders/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Square-Version': SQUARE_VERSION,
      },
      body: JSON.stringify(searchBody),
    });

    const data = await squareRes.json();

    if (!squareRes.ok) {
      const message = Array.isArray(data.errors)
        ? data.errors.map((e) => e.detail).join('; ')
        : JSON.stringify(data);
      res.status(squareRes.status).json({ error: message });
      return;
    }

    const allOrders = data.orders || [];
    const orders = allOrders.filter(
      (order) => order.metadata && order.metadata.source === OUR_SOURCE_TAG
    );

    const freshRows = orders.flatMap(parseOrderIntoRows);

    const sql = getSql();
    await ensureSchema(sql);

    for (const row of freshRows) {
      await sql`
        INSERT INTO finance_rows (order_id, line_uid, customer, item, quantity, item_price, shopper_fee, tip, shipping)
        VALUES (${row.orderId}, ${row.lineUid}, ${row.customer}, ${row.item}, ${row.quantity}, ${row.itemPrice}, ${row.shopperFee}, ${row.tip}, ${row.shipping})
        ON CONFLICT (order_id, line_uid) DO NOTHING
      `;
    }

    const persisted = await sql`SELECT * FROM finance_rows ORDER BY created_at DESC, id DESC`;

    res.status(200).json({
      rows: persisted.map(rowToJson),
      _debug: {
        totalCompletedOrders: allOrders.length,
        taggedOrders: orders.length,
        rowsFoundThisSync: freshRows.length,
        rowsPersisted: persisted.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function parseOrderIntoRows(order) {
  const lineItems = order.line_items || [];
  const customer = order.fulfillments?.[0]?.shipment_details?.recipient?.display_name || 'Unknown';

  const shippingCents = (order.service_charges || [])
    .filter((sc) => sc.name === 'Shipping')
    .reduce((sum, sc) => sum + (sc.total_money?.amount || 0), 0);

  const tipCents = order.total_tip_money?.amount || 0;

  // Item lines and their "<name> - shopper fee" lines are adjacent pairs, in
  // the order this app created them in (see api/create-payment-link.js).
  // Paired by position rather than by name, since an order can legitimately
  // contain multiple line items with the same name (e.g. the same item
  // added separately more than once) - matching by name would conflate them.
  const pairs = [];
  for (let i = 0; i < lineItems.length; i++) {
    const line = lineItems[i];
    if (line.name && line.name.endsWith(SHOPPER_FEE_SUFFIX)) continue;
    const next = lineItems[i + 1];
    const feeLine = next && next.name === `${line.name}${SHOPPER_FEE_SUFFIX}` ? next : null;
    pairs.push({ itemLine: line, feeCents: feeLine?.base_price_money?.amount || 0 });
  }

  const itemTotalCents = pairs.reduce((sum, p) => sum + (p.itemLine.total_money?.amount || 0), 0);

  const shareOf = (lineTotalCents, poolCents) => (itemTotalCents > 0
    ? Math.round((lineTotalCents / itemTotalCents) * poolCents)
    : 0);

  return pairs.map(({ itemLine, feeCents }) => {
    const lineTotalCents = itemLine.total_money?.amount || 0;

    return {
      orderId: order.id,
      lineUid: itemLine.uid,
      customer,
      item: itemLine.name,
      quantity: Number(itemLine.quantity) || 1,
      itemPrice: lineTotalCents / 100,
      shipping: shareOf(lineTotalCents, shippingCents) / 100,
      tip: shareOf(lineTotalCents, tipCents) / 100,
      shopperFee: feeCents / 100,
    };
  });
}
