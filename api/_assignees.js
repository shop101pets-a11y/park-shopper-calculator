// The three people splitting the shopping list. Used to validate who a
// request can be assigned to and to balance new requests between them.
const ASSIGNEES = ['Sam', 'Dars', 'Joana'];

// Gives every active, unassigned request an owner. A customer's requests
// always stay together (they share one payment link and one shipment), so
// this works in whole customers:
//   - a customer who already has an owner keeps all their new items with them;
//   - everyone else goes, biggest customer first, to whoever currently has
//     the fewest items - which is what keeps the three loads as even as
//     the customer sizes allow.
// Balances on item count, since finding each item is the work.
async function assignUnassigned(sql) {
  const rows = await sql`
    SELECT id, customer, assignee FROM shopping_requests WHERE deleted_at IS NULL
  `;

  const load = Object.fromEntries(ASSIGNEES.map((name) => [name, 0]));
  const byCustomer = new Map();

  for (const row of rows) {
    if (!byCustomer.has(row.customer)) byCustomer.set(row.customer, { owner: null, unassignedIds: [] });
    const group = byCustomer.get(row.customer);
    if (ASSIGNEES.includes(row.assignee)) {
      load[row.assignee] += 1;
      group.owner = group.owner || row.assignee;
    } else {
      group.unassignedIds.push(row.id);
    }
  }

  const updates = [];
  const newCustomers = [];
  for (const group of byCustomer.values()) {
    if (!group.unassignedIds.length) continue;
    if (group.owner) {
      updates.push([group.owner, group.unassignedIds]);
      load[group.owner] += group.unassignedIds.length;
    } else {
      newCustomers.push(group);
    }
  }

  newCustomers.sort((a, b) => b.unassignedIds.length - a.unassignedIds.length);
  for (const group of newCustomers) {
    const person = ASSIGNEES.reduce((best, name) => (load[name] < load[best] ? name : best), ASSIGNEES[0]);
    updates.push([person, group.unassignedIds]);
    load[person] += group.unassignedIds.length;
  }

  let assigned = 0;
  for (const [person, ids] of updates) {
    await sql`UPDATE shopping_requests SET assignee = ${person} WHERE id = ANY(${ids}::int[])`;
    assigned += ids.length;
  }

  return { assigned, load };
}

module.exports = { ASSIGNEES, assignUnassigned };
