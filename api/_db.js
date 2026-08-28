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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (order_id, item)
    )
  `;
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
    shipping: Number(row.shipping),
    discount: Number(row.discount),
    shippingCost: Number(row.shipping_cost),
  };
}

module.exports = { getSql, ensureSchema, rowToJson };
