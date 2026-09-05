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
    orderDate: row.order_created_at,
  };
}

module.exports = { getSql, ensureSchema, rowToJson };
