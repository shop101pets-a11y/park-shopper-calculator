const { neon } = require('@neondatabase/serverless');

let sqlClient = null;

function getSql() {
  if (!sqlClient) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured');
    }
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

async function ensureSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS finance_rows (
      id SERIAL PRIMARY KEY,
      order_id TEXT NOT NULL,
      customer TEXT NOT NULL,
      item TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      item_price NUMERIC NOT NULL,
      shopper_fee NUMERIC NOT NULL,
      shipping NUMERIC NOT NULL,
      discount NUMERIC NOT NULL DEFAULT 20,
      shipping_cost NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Migration: dedup used to be keyed on (order_id, item name), which
  // silently dropped legitimate rows when an order had multiple line items
  // with the same name (e.g. the same item added separately more than
  // once). Switched to Square's per-line uid, which is always unique.
  // Rows saved under the old scheme have no line_uid and are safe to drop -
  // re-syncing rebuilds them correctly under the new key.
  await sql`ALTER TABLE finance_rows ADD COLUMN IF NOT EXISTS line_uid TEXT`;
  await sql`DELETE FROM finance_rows WHERE line_uid IS NULL`;
  await sql`ALTER TABLE finance_rows DROP CONSTRAINT IF EXISTS finance_rows_order_id_item_key`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS finance_rows_order_line_uid_key ON finance_rows (order_id, line_uid)`;

  await sql`ALTER TABLE finance_rows ADD COLUMN IF NOT EXISTS tip NUMERIC NOT NULL DEFAULT 0`;

  // created_at was "when this row was saved to our database," not the
  // actual order date - meaningless for sorting since it depends on when a
  // sync happened to run, not when the customer ordered. order_created_at
  // holds the real date; existing rows get backfilled by sync-orders.js.
  await sql`ALTER TABLE finance_rows ADD COLUMN IF NOT EXISTS order_created_at TIMESTAMPTZ`;

  // Square's own processing fee on the payment, split across the order's
  // line items the same way shipping/tip are. Unlike shipping_cost (a
  // manual entry), this is synced data - refreshed on every sync rather
  // than only backfilled when missing.
  await sql`ALTER TABLE finance_rows ADD COLUMN IF NOT EXISTS square_fee NUMERIC NOT NULL DEFAULT 0`;

  // Pirate Ship writes tracking info back onto the Square order's shipment
  // fulfillment once a label is bought - often after the initial sync, so
  // this always refreshes rather than only backfilling when missing.
  await sql`ALTER TABLE finance_rows ADD COLUMN IF NOT EXISTS tracking_number TEXT`;
  await sql`ALTER TABLE finance_rows ADD COLUMN IF NOT EXISTS carrier TEXT`;
  await sql`ALTER TABLE finance_rows ADD COLUMN IF NOT EXISTS tracking_url TEXT`;

  // "Finish packing" hides rows from the Tracking tab only - Finances keeps
  // every dollar figure for these orders regardless of packed status.
  await sql`ALTER TABLE finance_rows ADD COLUMN IF NOT EXISTS packed BOOLEAN NOT NULL DEFAULT false`;
}

function rowToJson(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    customer: row.customer,
    item: row.item,
    quantity: Number(row.quantity),
    itemPrice: Number(row.item_price),
    shopperFee: Number(row.shopper_fee),
    tip: Number(row.tip),
    shipping: Number(row.shipping),
    discount: Number(row.discount),
    shippingCost: Number(row.shipping_cost),
    squareFee: Number(row.square_fee),
    orderDate: row.order_created_at,
    packed: row.packed,
    trackingNumber: row.tracking_number,
    carrier: row.carrier,
    trackingUrl: row.tracking_url,
  };
}

module.exports = { getSql, ensureSchema, rowToJson };
