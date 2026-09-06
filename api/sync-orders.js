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
      filter: { state_filter: { states: ['OPEN', 'COMPLETED'] } },
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
    // Orders stay OPEN (not COMPLETED) until every fulfillment is complete -
    // for us that means "marked as shipped," which can be days after payment.
    // Paid-in-full is what actually matters here, so check the balance
    // directly instead of relying on order state.
    const paidOrders = allOrders.filter((order) => (order.net_amount_due_money?.amount || 0) === 0);
    const orders = paidOrders.filter(
      (order) => order.metadata && order.metadata.source === OUR_SOURCE_TAG
    );

    const squareFeeCentsByOrderId = await fetchSquareFeesByOrderId(
      baseUrl, accessToken, locationId, new Set(orders.map((o) => o.id))
    );

    const freshRows = orders.flatMap((order) => parseOrderIntoRows(order, squareFeeCentsByOrderId[order.id] || 0));

    const sql = getSql();
    await ensureSchema(sql);

    for (const row of freshRows) {
      await sql`
        INSERT INTO finance_rows (order_id, line_uid, customer, item, quantity, item_price, shopper_fee, tip, shipping, square_fee, order_created_at, tracking_number, carrier, tracking_url)
        VALUES (${row.orderId}, ${row.lineUid}, ${row.customer}, ${row.item}, ${row.quantity}, ${row.itemPrice}, ${row.shopperFee}, ${row.tip}, ${row.shipping}, ${row.squareFee}, ${row.orderCreatedAt}, ${row.trackingNumber}, ${row.carrier}, ${row.trackingUrl})
        ON CONFLICT (order_id, line_uid) DO UPDATE
          SET square_fee = EXCLUDED.square_fee,
              tracking_number = EXCLUDED.tracking_number,
              carrier = EXCLUDED.carrier,
              tracking_url = EXCLUDED.tracking_url,
              order_created_at = COALESCE(finance_rows.order_created_at, EXCLUDED.order_created_at)
      `;
    }

    const persisted = await sql`SELECT * FROM finance_rows ORDER BY order_created_at DESC NULLS LAST, id DESC`;

    const untagged = paidOrders.filter((o) => !(o.metadata && o.metadata.source === OUR_SOURCE_TAG));

    res.status(200).json({
      rows: persisted.map(rowToJson),
      _debug: {
        totalOrdersFetched: allOrders.length,
        paidOrders: paidOrders.length,
        taggedOrders: orders.length,
        rowsFoundThisSync: freshRows.length,
        rowsPersisted: persisted.length,
        untaggedSample: untagged.slice(0, 10).map((o) => ({
          id: o.id,
          createdAt: o.created_at,
          metadata: o.metadata || null,
          lineItemNames: (o.line_items || []).map((li) => li.name),
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Square's processing fee lives on the Payment, not the Order, so it takes a
// separate call. Payments carry an order_id, letting us sum fees per order
// (a split tender could mean more than one payment per order).
async function fetchSquareFeesByOrderId(baseUrl, accessToken, locationId, orderIds) {
  const feesByOrderId = {};
  if (orderIds.size === 0) return feesByOrderId;

  const params = new URLSearchParams({ location_id: locationId, sort_order: 'DESC', limit: '100' });
  const response = await fetch(`${baseUrl}/v2/payments?${params}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Square-Version': SQUARE_VERSION,
    },
  });

  if (!response.ok) return feesByOrderId;

  const data = await response.json();
  for (const payment of data.payments || []) {
    if (!payment.order_id || !orderIds.has(payment.order_id)) continue;
    const feeCents = (payment.processing_fee || []).reduce((sum, fee) => sum + (fee.amount_money?.amount || 0), 0);
    feesByOrderId[payment.order_id] = (feesByOrderId[payment.order_id] || 0) + feeCents;
  }

  return feesByOrderId;
}

function parseOrderIntoRows(order, squareFeeCents) {
  const lineItems = order.line_items || [];
  const shipmentDetails = order.fulfillments?.[0]?.shipment_details;
  const customer = shipmentDetails?.recipient?.display_name || 'Unknown';
  const trackingNumber = shipmentDetails?.tracking_number || null;
  const carrier = shipmentDetails?.carrier || null;
  const trackingUrl = shipmentDetails?.tracking_url || null;

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
    // The fee line's own quantity mirrors the item's, so its total_money
    // (not base_price_money, which is now just the per-unit fee) is the
    // full shopper fee for this line.
    pairs.push({ itemLine: line, feeCents: feeLine?.total_money?.amount || 0 });
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
      orderCreatedAt: order.created_at,
      customer,
      trackingNumber,
      carrier,
      trackingUrl,
      item: itemLine.name,
      quantity: Number(itemLine.quantity) || 1,
      itemPrice: lineTotalCents / 100,
      shipping: shareOf(lineTotalCents, shippingCents) / 100,
      tip: shareOf(lineTotalCents, tipCents) / 100,
      squareFee: shareOf(lineTotalCents, squareFeeCents) / 100,
      shopperFee: feeCents / 100,
    };
  });
}
