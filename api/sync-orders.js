const { SQUARE_VERSION, getSquareConfig } = require('./_square');

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

    const orders = (data.orders || []).filter(
      (order) => order.metadata && order.metadata.source === OUR_SOURCE_TAG
    );

    const rows = orders.flatMap(parseOrderIntoRows);

    res.status(200).json({ rows });
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

  // Item lines and their "<name> - shopper fee" lines are adjacent, in the
  // order this app created them in (see api/create-payment-link.js).
  const itemLines = [];
  const feeByItemName = {};
  for (const line of lineItems) {
    if (line.name && line.name.endsWith(SHOPPER_FEE_SUFFIX)) {
      const itemName = line.name.slice(0, -SHOPPER_FEE_SUFFIX.length);
      feeByItemName[itemName] = (feeByItemName[itemName] || 0) + (line.base_price_money?.amount || 0);
    } else {
      itemLines.push(line);
    }
  }

  const itemTotalCents = itemLines.reduce((sum, line) => sum + (line.total_money?.amount || 0), 0);

  return itemLines.map((line) => {
    const lineTotalCents = line.total_money?.amount || 0;
    const shippingShareCents = itemTotalCents > 0
      ? Math.round((lineTotalCents / itemTotalCents) * shippingCents)
      : 0;

    return {
      orderId: order.id,
      customer,
      item: line.name,
      quantity: Number(line.quantity) || 1,
      itemPrice: lineTotalCents / 100,
      shipping: shippingShareCents / 100,
      shopperFee: (feeByItemName[line.name] || 0) / 100,
    };
  });
}
