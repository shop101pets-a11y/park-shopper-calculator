const TAX_RATE = 0.065;
const FEE_LOW = 3;
const FEE_HIGH = 5;
const FEE_THRESHOLD = 25;
const SHIPPING_FEES = { light: 7.75, normal: 8.35, heavy: 9.86, none: 0 };

/**
 * Core pricing formulas. Tax applies to the extended price (unit price x
 * quantity); the shopper fee is per unit (one shopping trip per item), so
 * its $25 threshold checks the unit price, then scales by quantity.
 */
function calcExtendedPrice(price, quantity) {
  return price * quantity;
}

function calcTax(price, quantity) {
  return Math.round(calcExtendedPrice(price, quantity) * TAX_RATE * 100) / 100;
}

function calcShopperFeePerUnit(price) {
  return price < FEE_THRESHOLD ? FEE_LOW : FEE_HIGH;
}

function calcShopperFee(price, quantity) {
  return calcShopperFeePerUnit(price) * quantity;
}

function calcItemTotal(price, quantity) {
  return Math.round((calcExtendedPrice(price, quantity) + calcTax(price, quantity) + calcShopperFee(price, quantity)) * 100) / 100;
}

function formatMoney(n) {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

let items = [];

const form = document.getElementById('item-form');
const nameInput = document.getElementById('item-name');
const priceInput = document.getElementById('item-price');
const quantityInput = document.getElementById('item-quantity');
const itemsList = document.getElementById('items-list');
const emptyState = document.getElementById('empty-state');
const summaryOutput = document.getElementById('summary-output');
const copyBtn = document.getElementById('copy-btn');
const clearAllBtn = document.getElementById('clear-all');
const weightInputs = document.querySelectorAll('input[name="package-weight"]');
const createLinkBtn = document.getElementById('create-link-btn');
const paymentLinkResult = document.getElementById('payment-link-result');
const paymentLinkUrlInput = document.getElementById('payment-link-url');
const copyLinkBtn = document.getElementById('copy-link-btn');
const paymentLinkError = document.getElementById('payment-link-error');

function getSelectedWeight() {
  return document.querySelector('input[name="package-weight"]:checked').value;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const price = parseFloat(priceInput.value);
  const quantity = parseInt(quantityInput.value, 10);
  if (!name || isNaN(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1) return;

  items.push({ id: Date.now(), name, price, quantity });
  nameInput.value = '';
  priceInput.value = '';
  quantityInput.value = '1';
  nameInput.focus();
  render();
});

clearAllBtn.addEventListener('click', () => {
  items = [];
  render();
});

itemsList.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-remove');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  items = items.filter((item) => item.id !== id);
  render();
});

weightInputs.forEach((input) => input.addEventListener('change', render));

copyBtn.addEventListener('click', async () => {
  const text = summaryOutput.textContent;
  if (!text) return;
  await copyText(text);
  copyBtn.textContent = 'Copied!';
  copyBtn.classList.add('copied');
  setTimeout(() => {
    copyBtn.textContent = 'Copy to clipboard';
    copyBtn.classList.remove('copied');
  }, 1500);
});

copyLinkBtn.addEventListener('click', async () => {
  const url = paymentLinkUrlInput.value;
  if (!url) return;
  await copyText(url);
  copyLinkBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyLinkBtn.textContent = 'Copy link';
  }, 1500);
});

createLinkBtn.addEventListener('click', async () => {
  if (!items.length) return;

  paymentLinkError.style.display = 'none';
  paymentLinkResult.style.display = 'none';
  createLinkBtn.disabled = true;
  createLinkBtn.textContent = 'Creating link...';

  try {
    const response = await fetch('/api/create-payment-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((item) => ({ name: item.name, price: item.price, quantity: item.quantity })),
        packageWeight: getSelectedWeight(),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }

    paymentLinkUrlInput.value = data.url;
    paymentLinkResult.style.display = 'flex';
  } catch (err) {
    paymentLinkError.textContent = `Couldn't create payment link: ${err.message}`;
    paymentLinkError.style.display = 'block';
  } finally {
    createLinkBtn.disabled = false;
    createLinkBtn.textContent = 'Create Square payment link';
  }
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.style.position = 'fixed';
    temp.style.opacity = '0';
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
  }
}

function render() {
  itemsList.innerHTML = '';
  emptyState.style.display = items.length ? 'none' : 'block';
  createLinkBtn.disabled = !items.length;

  items.forEach((item) => {
    const tax = calcTax(item.price, item.quantity);
    const fee = calcShopperFee(item.price, item.quantity);
    const total = calcItemTotal(item.price, item.quantity);
    const qtySuffix = item.quantity > 1 ? ` x${item.quantity}` : '';

    const li = document.createElement('li');
    li.className = 'item-row';
    li.innerHTML = `
      <div class="item-info">
        <span class="item-name">${escapeHtml(item.name)}${qtySuffix}</span>
        <span class="item-detail">${formatMoney(item.price)}${qtySuffix} + ${formatMoney(tax)} tax + ${formatMoney(fee)} fee</span>
      </div>
      <span class="item-total">${formatMoney(total)}</span>
      <button class="btn-remove" data-id="${item.id}" title="Remove" type="button">&times;</button>
    `;
    itemsList.appendChild(li);
  });

  summaryOutput.textContent = buildSummary();
  paymentLinkResult.style.display = 'none';
  paymentLinkError.style.display = 'none';
}

function buildSummary() {
  if (!items.length) return '';

  const blocks = items.map((item) => {
    const extended = calcExtendedPrice(item.price, item.quantity);
    const tax = calcTax(item.price, item.quantity);
    const fee = calcShopperFee(item.price, item.quantity);
    const total = calcItemTotal(item.price, item.quantity);
    const qtySuffix = item.quantity > 1 ? ` x${item.quantity}` : '';
    return [
      `${item.name}${qtySuffix} - ${formatMoney(extended)} (+${formatMoney(tax)} tax)`,
      `shopper fee - ${formatMoney(fee)}`,
      `total ${formatMoney(total)}`,
    ].join('\n');
  });

  const weight = getSelectedWeight();
  const shippingFee = SHIPPING_FEES[weight];
  const itemsTotal = items.reduce((sum, item) => sum + calcItemTotal(item.price, item.quantity), 0);
  const orderTotal = Math.round((itemsTotal + shippingFee) * 100) / 100;

  let text = blocks.join('\n\n');
  text += `\n\n---\nshipping - ${formatMoney(shippingFee)}\norder total ${formatMoney(orderTotal)}`;

  return text;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Tabs ---
const appEl = document.querySelector('.app');
const tabs = {
  calculator: { btn: document.getElementById('tab-calculator'), view: document.getElementById('calculator-view'), wide: false },
  finances: { btn: document.getElementById('tab-finances'), view: document.getElementById('finances-view'), wide: true },
  tracking: { btn: document.getElementById('tab-tracking'), view: document.getElementById('tracking-view'), wide: true },
  shoppingList: { btn: document.getElementById('tab-shopping-list'), view: document.getElementById('shopping-list-view'), wide: true },
};

Object.entries(tabs).forEach(([name, tab]) => {
  tab.btn.addEventListener('click', () => switchTab(name));
});

function switchTab(activeName) {
  let wide = false;
  Object.entries(tabs).forEach(([name, tab]) => {
    const isActive = name === activeName;
    tab.view.classList.toggle('hidden', !isActive);
    tab.btn.classList.toggle('active', isActive);
    tab.btn.setAttribute('aria-selected', String(isActive));
    if (isActive) wide = tab.wide;
  });
  appEl.classList.toggle('wide', wide);
  if (activeName === 'tracking') loadTracking();
  if (activeName === 'shoppingList') loadShoppingList();
}

// --- Finances ---
// Rows pulled from Square give us the revenue side (customer, item, qty,
// itemPrice, shipping, shopperFee). Discount is picked by hand and drives
// cost; shippingCost is entered by hand, since Square has no visibility
// into what we actually pay for either.
let financeRows = [];

// itemPrice already includes 6.5% tax (retail * 1.065), so scaling it by
// (1 - discount) applies the discount to retail and keeps the same tax rate:
// (retail * (1 - discount)) * 1.065 === itemPrice * (1 - discount)
function calcCost(row) {
  return row.itemPrice * (1 - row.discount / 100);
}

const syncOrdersBtn = document.getElementById('sync-orders-btn');
const syncError = document.getElementById('sync-error');
const financeTableBody = document.getElementById('finance-table-body');
const financeEmptyState = document.getElementById('finance-empty-state');
const statOrders = document.getElementById('stat-orders');
const statCredit = document.getElementById('stat-credit');
const statDebit = document.getElementById('stat-debit');
const statEarnings = document.getElementById('stat-earnings');
const statShopperFee = document.getElementById('stat-shopper-fee');
const statTips = document.getElementById('stat-tips');

async function loadFinanceRows() {
  try {
    const response = await fetch('/api/finance-rows');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }
    financeRows = data.rows;
    renderFinances();
  } catch (err) {
    syncError.textContent = `Couldn't load saved orders: ${err.message}`;
    syncError.style.display = 'block';
  }
}

syncOrdersBtn.addEventListener('click', async () => {
  syncError.style.display = 'none';
  syncOrdersBtn.disabled = true;
  syncOrdersBtn.textContent = 'Syncing...';

  try {
    const response = await fetch('/api/sync-orders');
    const data = await response.json();

    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }

    financeRows = data.rows;
    renderFinances();
  } catch (err) {
    syncError.textContent = `Couldn't sync from Square: ${err.message}`;
    syncError.style.display = 'block';
  } finally {
    syncOrdersBtn.disabled = false;
    syncOrdersBtn.textContent = 'Sync from Square';
  }
});

// --- Pirate Ship shipping cost import ---
const shippingFileInput = document.getElementById('shipping-file-input');
const previewImportBtn = document.getElementById('preview-import-btn');
const importPreview = document.getElementById('import-preview');
const importMatchesEl = document.getElementById('import-matches');
const importUnmatchedEl = document.getElementById('import-unmatched');
const confirmImportBtn = document.getElementById('confirm-import-btn');
const importError = document.getElementById('import-error');

let pendingImportMatches = [];

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

shippingFileInput.addEventListener('change', () => {
  previewImportBtn.disabled = !shippingFileInput.files.length;
  importPreview.style.display = 'none';
  importError.style.display = 'none';
});

previewImportBtn.addEventListener('click', async () => {
  const file = shippingFileInput.files[0];
  if (!file) return;

  importError.style.display = 'none';
  previewImportBtn.disabled = true;
  previewImportBtn.textContent = 'Reading file...';

  try {
    const fileBase64 = await readFileAsBase64(file);
    const response = await fetch('/api/match-shipping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'preview', fileBase64 }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }

    pendingImportMatches = data.matches;
    renderImportPreview(data.matches, data.unmatched);
  } catch (err) {
    importError.textContent = `Couldn't preview import: ${err.message}`;
    importError.style.display = 'block';
  } finally {
    previewImportBtn.disabled = false;
    previewImportBtn.textContent = 'Preview import';
  }
});

confirmImportBtn.addEventListener('click', async () => {
  if (!pendingImportMatches.length) return;

  importError.style.display = 'none';
  confirmImportBtn.disabled = true;
  confirmImportBtn.textContent = 'Applying...';

  try {
    const response = await fetch('/api/match-shipping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'apply', matches: pendingImportMatches }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }

    importPreview.style.display = 'none';
    shippingFileInput.value = '';
    previewImportBtn.disabled = true;
    pendingImportMatches = [];
    await loadFinanceRows();
  } catch (err) {
    importError.textContent = `Couldn't apply import: ${err.message}`;
    importError.style.display = 'block';
  } finally {
    confirmImportBtn.disabled = false;
    confirmImportBtn.textContent = 'Confirm import';
  }
});

function renderImportPreview(matches, unmatched) {
  importMatchesEl.innerHTML = matches.map((m) => `
    <div class="import-match${m.ambiguous ? ' ambiguous' : ''}">
      <div class="import-match-title">${escapeHtml(m.recipient)} → ${escapeHtml(m.matchedCustomer)} - ${formatMoney(m.cost)}</div>
      <div class="import-match-detail">
        ${m.ambiguous ? 'Multiple orders found for this name, picked closest by date. ' : ''}
        Split across: ${m.rows.map((r) => `${escapeHtml(r.item)} (${formatMoney(r.shippingCost)})`).join(', ')}
      </div>
    </div>
  `).join('');

  importUnmatchedEl.innerHTML = unmatched.map((u) => `
    <div class="import-unmatched-item">${escapeHtml(u.recipient)} - ${formatMoney(u.cost)}: ${escapeHtml(u.reason)}</div>
  `).join('');

  importPreview.style.display = matches.length || unmatched.length ? 'flex' : 'none';
}

financeTableBody.addEventListener('change', async (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const id = Number(e.target.closest('tr').dataset.id);
  const row = financeRows.find((r) => r.id === id);
  if (!row) return;

  const value = Number(e.target.value);
  const previousValue = row[field];
  row[field] = value;
  renderFinances();

  try {
    const response = await fetch('/api/finance-rows', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, field, value }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }
  } catch (err) {
    row[field] = previousValue;
    renderFinances();
    syncError.textContent = `Couldn't save change: ${err.message}`;
    syncError.style.display = 'block';
  }
});

function renderFinances() {
  financeTableBody.innerHTML = '';
  financeEmptyState.style.display = financeRows.length ? 'none' : 'block';

  const orderIds = new Set();
  let debitBalance = 0;
  let creditBalance = 0;
  let shopperFeeSum = 0;
  let tipSum = 0;

  financeRows.forEach((row) => {
    orderIds.add(row.orderId);

    const total = row.itemPrice + row.shopperFee + row.tip + row.shipping;
    const cost = calcCost(row);
    const totalCost = cost + row.shippingCost + row.squareFee;
    debitBalance += total;
    creditBalance += totalCost;
    shopperFeeSum += row.shopperFee;
    tipSum += row.tip;

    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    tr.innerHTML = `
      <td>${escapeHtml(row.customer)}</td>
      <td>${escapeHtml(row.item)}</td>
      <td>${row.quantity}</td>
      <td>${formatMoney(row.itemPrice)}</td>
      <td>${formatMoney(row.shopperFee)}</td>
      <td>${formatMoney(row.tip)}</td>
      <td>${formatMoney(row.shipping)}</td>
      <td>${formatMoney(total)}</td>
      <td>
        <select data-field="discount">
          <option value="20" ${row.discount === 20 ? 'selected' : ''}>20%</option>
          <option value="35" ${row.discount === 35 ? 'selected' : ''}>35%</option>
        </select>
      </td>
      <td>${formatMoney(cost)}</td>
      <td><input type="number" step="0.01" min="0" data-field="shippingCost" value="${row.shippingCost}"></td>
      <td>${formatMoney(row.squareFee)}</td>
      <td>${formatMoney(totalCost)}</td>
      <td>${formatMoney(total - totalCost)}</td>
    `;
    financeTableBody.appendChild(tr);
  });

  statOrders.textContent = orderIds.size;
  statCredit.textContent = formatMoney(Math.round(creditBalance * 100) / 100);
  statDebit.textContent = formatMoney(Math.round(debitBalance * 100) / 100);
  statEarnings.textContent = formatMoney(Math.round((debitBalance - creditBalance) * 100) / 100);
  statShopperFee.textContent = formatMoney(Math.round(shopperFeeSum * 100) / 100);
  statTips.textContent = formatMoney(Math.round(tipSum * 100) / 100);
}

// --- Tracking ---
const trackingTableBody = document.getElementById('tracking-table-body');
const trackingEmptyState = document.getElementById('tracking-empty-state');
const finishPackingBtn = document.getElementById('finish-packing-btn');

trackingTableBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-copy-tracking');
  if (!btn) return;

  await copyText(btn.dataset.tracking);
  const original = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => {
    btn.textContent = original;
  }, 1500);
});

trackingTableBody.addEventListener('change', (e) => {
  const checkbox = e.target.closest('.packed-checkbox');
  if (!checkbox) return;
  checkbox.closest('tr').classList.toggle('packed-row', checkbox.checked);
});

finishPackingBtn.addEventListener('click', async () => {
  const checkedRows = [...trackingTableBody.querySelectorAll('.packed-checkbox:checked')];
  if (!checkedRows.length) return;

  if (!confirm(`Finish packing ${checkedRows.length} order${checkedRows.length > 1 ? 's' : ''}? They'll be removed from this list (Finances keeps all their data).`)) {
    return;
  }

  const orderIds = [...new Set(checkedRows.flatMap((cb) => JSON.parse(cb.dataset.orderIds)))];

  try {
    const response = await fetch('/api/tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }
    await loadTracking();
  } catch (err) {
    trackingEmptyState.textContent = `Couldn't finish packing: ${err.message}`;
    trackingEmptyState.style.display = 'block';
  }
});

async function loadTracking() {
  try {
    const response = await fetch('/api/tracking');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }
    renderTracking(data.orders);
  } catch (err) {
    trackingTableBody.innerHTML = '';
    trackingEmptyState.textContent = `Couldn't load tracking: ${err.message}`;
    trackingEmptyState.style.display = 'block';
  }
}

function renderTracking(orders) {
  trackingTableBody.innerHTML = '';
  trackingEmptyState.textContent = 'No orders yet.';
  trackingEmptyState.style.display = orders.length ? 'none' : 'block';

  orders.forEach((order) => {
    const tr = document.createElement('tr');
    const trackingCell = order.trackingNumber
      ? `
        <span class="tracking-cell">
          ${order.trackingUrl
            ? `<a href="${escapeHtml(order.trackingUrl)}" target="_blank" rel="noopener">${escapeHtml(order.trackingNumber)}</a>`
            : escapeHtml(order.trackingNumber)}
          <button class="btn-copy-tracking" type="button" data-tracking="${escapeHtml(order.trackingNumber)}">Copy</button>
        </span>
      `
      : '<span class="empty-state" style="padding:0;">Not yet shipped</span>';

    tr.innerHTML = `
      <td><input type="checkbox" class="packed-checkbox" data-order-ids='${JSON.stringify(order.orderIds)}'></td>
      <td>${escapeHtml(order.customer)}</td>
      <td>${escapeHtml(order.items.join(', '))}</td>
      <td>${escapeHtml(order.carrier || '')}</td>
      <td>${trackingCell}</td>
      <td>${order.orderDate ? new Date(order.orderDate).toLocaleDateString() : ''}</td>
    `;
    trackingTableBody.appendChild(tr);
  });
}

// --- Shopping List ---
let shoppingRequests = [];
let shoppingImportCandidates = [];
let shoppingView = 'product';
let shoppingTagFilter = '';

const shoppingImportFileInput = document.getElementById('shopping-import-file-input');
const shoppingPreviewImportBtn = document.getElementById('shopping-preview-import-btn');
const shoppingImportError = document.getElementById('shopping-import-error');
const shoppingImportPreview = document.getElementById('shopping-import-preview');
const shoppingImportTableBody = document.getElementById('shopping-import-table-body');
const shoppingConfirmImportBtn = document.getElementById('shopping-confirm-import-btn');
const shoppingViewProductBtn = document.getElementById('shopping-view-product-btn');
const shoppingViewCustomerBtn = document.getElementById('shopping-view-customer-btn');
const shoppingTagFilterInput = document.getElementById('shopping-tag-filter');
const shoppingTagCloud = document.getElementById('shopping-tag-cloud');
const shoppingListContent = document.getElementById('shopping-list-content');
const shoppingListEmptyState = document.getElementById('shopping-list-empty-state');
const shoppingSyncBtn = document.getElementById('shopping-sync-btn');
const shoppingSyncError = document.getElementById('shopping-sync-error');

shoppingSyncBtn.addEventListener('click', async () => {
  shoppingSyncError.style.display = 'none';
  shoppingSyncBtn.disabled = true;
  shoppingSyncBtn.textContent = 'Syncing...';

  try {
    const response = await fetch('/api/shopping-list-sync');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }
    shoppingRequests = data.requests;
    renderShoppingList();
  } catch (err) {
    shoppingSyncError.textContent = `Couldn't sync: ${err.message}`;
    shoppingSyncError.style.display = 'block';
  } finally {
    shoppingSyncBtn.disabled = false;
    shoppingSyncBtn.textContent = 'Sync from Google Form';
  }
});

shoppingImportFileInput.addEventListener('change', () => {
  shoppingPreviewImportBtn.disabled = !shoppingImportFileInput.files.length;
  shoppingImportPreview.style.display = 'none';
  shoppingImportError.style.display = 'none';
});

shoppingPreviewImportBtn.addEventListener('click', async () => {
  const file = shoppingImportFileInput.files[0];
  if (!file) return;

  shoppingImportError.style.display = 'none';
  shoppingPreviewImportBtn.disabled = true;
  shoppingPreviewImportBtn.textContent = 'Reading file...';

  try {
    const fileBase64 = await readFileAsBase64(file);
    const response = await fetch('/api/shopping-list-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'preview', fileBase64 }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }

    shoppingImportCandidates = data.candidates.map((c) => ({ ...c, include: true }));
    renderShoppingImportPreview();
  } catch (err) {
    shoppingImportError.textContent = `Couldn't preview import: ${err.message}`;
    shoppingImportError.style.display = 'block';
  } finally {
    shoppingPreviewImportBtn.disabled = false;
    shoppingPreviewImportBtn.textContent = 'Preview import';
  }
});

function renderShoppingImportPreview() {
  shoppingImportTableBody.innerHTML = shoppingImportCandidates.map((c, index) => `
    <tr class="${c.needsSplitting || c.unparsed ? 'flagged-row' : ''}" data-index="${index}">
      <td><input type="checkbox" data-field="include" ${c.include ? 'checked' : ''}></td>
      <td><input type="text" data-field="customer" value="${escapeHtml(c.customer || '')}"></td>
      <td><input type="text" data-field="phone" value="${escapeHtml(c.phone || '')}"></td>
      <td><input type="text" data-field="email" value="${escapeHtml(c.email || '')}"></td>
      <td><input type="text" data-field="instagram" value="${escapeHtml(c.instagram || '')}"></td>
      <td>
        <select data-field="contactPreference">
          <option value="phone" ${c.contactPreference === 'phone' ? 'selected' : ''}>Phone</option>
          <option value="email" ${c.contactPreference === 'email' ? 'selected' : ''}>Email</option>
          <option value="instagram" ${c.contactPreference === 'instagram' ? 'selected' : ''}>Instagram</option>
        </select>
      </td>
      <td><input type="text" data-field="item" value="${escapeHtml(c.item || '')}"></td>
      <td><input type="number" min="1" data-field="quantity" value="${c.quantity || 1}"></td>
      <td><input type="text" data-field="size" value="${escapeHtml(c.size || '')}"></td>
    </tr>
  `).join('');
  shoppingImportPreview.style.display = shoppingImportCandidates.length ? 'block' : 'none';
}

shoppingImportTableBody.addEventListener('change', (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const index = Number(e.target.closest('tr').dataset.index);
  const candidate = shoppingImportCandidates[index];
  if (!candidate) return;

  if (field === 'include') candidate.include = e.target.checked;
  else if (field === 'quantity') candidate.quantity = parseInt(e.target.value, 10) || 1;
  else candidate[field] = e.target.value;
});

shoppingConfirmImportBtn.addEventListener('click', async () => {
  const toImport = shoppingImportCandidates.filter((c) => c.include && c.item && c.item.trim());
  if (!toImport.length) return;

  shoppingImportError.style.display = 'none';
  shoppingConfirmImportBtn.disabled = true;
  shoppingConfirmImportBtn.textContent = 'Importing...';

  try {
    const response = await fetch('/api/shopping-list-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'apply', requests: toImport }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }

    shoppingImportCandidates = [];
    shoppingImportPreview.style.display = 'none';
    shoppingImportFileInput.value = '';
    shoppingPreviewImportBtn.disabled = true;
    await loadShoppingList();
  } catch (err) {
    shoppingImportError.textContent = `Couldn't import: ${err.message}`;
    shoppingImportError.style.display = 'block';
  } finally {
    shoppingConfirmImportBtn.disabled = false;
    shoppingConfirmImportBtn.textContent = 'Confirm import';
  }
});

shoppingViewProductBtn.addEventListener('click', () => {
  shoppingView = 'product';
  shoppingViewProductBtn.classList.add('active');
  shoppingViewCustomerBtn.classList.remove('active');
  renderShoppingList();
});

shoppingViewCustomerBtn.addEventListener('click', () => {
  shoppingView = 'customer';
  shoppingViewCustomerBtn.classList.add('active');
  shoppingViewProductBtn.classList.remove('active');
  renderShoppingList();
});

shoppingTagFilterInput.addEventListener('input', () => {
  shoppingTagFilter = shoppingTagFilterInput.value.trim().toLowerCase();
  renderShoppingList();
});

async function loadShoppingList() {
  try {
    const response = await fetch('/api/shopping-list');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }
    shoppingRequests = data.requests;
    renderShoppingList();
  } catch (err) {
    shoppingListEmptyState.textContent = `Couldn't load shopping list: ${err.message}`;
    shoppingListEmptyState.style.display = 'block';
  }
}

function renderTagCloud() {
  const allTags = [...new Set(shoppingRequests.flatMap((r) => r.tags))].sort();
  shoppingTagCloud.innerHTML = allTags.map((tag) => `
    <button type="button" class="tag-chip${shoppingTagFilter === tag.toLowerCase() ? ' active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>
  `).join('');
}

shoppingTagCloud.addEventListener('click', (e) => {
  const chip = e.target.closest('.tag-chip');
  if (!chip) return;
  const tag = chip.dataset.tag.toLowerCase();
  shoppingTagFilter = shoppingTagFilter === tag ? '' : tag;
  shoppingTagFilterInput.value = shoppingTagFilter;
  renderShoppingList();
});

// Google Forms links to the customer's uploaded photo as a Drive "view"
// page, not a directly-renderable image URL. Google's unofficial hotlink
// thumbnail endpoints turned out to be unreliable in testing (429/404), so
// this goes through our own /api/drive-image proxy instead, which fetches
// the file via the real Drive API. Prefers the file ID already stored at
// import time; falls back to extracting one from the URL for older rows
// imported before that column existed.
function referenceImageProxyUrl(req) {
  const fileId = req.referenceImageFileId || (req.referenceImageUrl || '').match(/[-\w]{25,}/)?.[0];
  return fileId ? `/api/drive-image?fileId=${fileId}` : null;
}

function requestRowHtml(req) {
  const details = `${escapeHtml(req.item)}${req.quantity > 1 ? ` x${req.quantity}` : ''}${req.size ? ` (${escapeHtml(req.size)})` : ''}`;
  const thumbUrl = referenceImageProxyUrl(req);
  const linkTarget = req.referenceImageUrl || thumbUrl;
  const imageLink = linkTarget
    ? `<a href="${escapeHtml(linkTarget)}" target="_blank" rel="noopener">${
        thumbUrl
          ? `<img src="${escapeHtml(thumbUrl)}" class="ref-thumb" alt="reference photo" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'photo'}))">`
          : 'photo'
      }</a>`
    : '';
  return `
    <div class="shopping-request-row" data-id="${req.id}">
      <div>${details}${imageLink ? ` &middot; ${imageLink}` : ''}</div>
      <input type="text" class="tag-edit-input" data-field="tags" value="${escapeHtml(req.tags.join(', '))}" placeholder="tags, comma, separated">
      <select data-field="status">
        <option value="requested" ${req.status === 'requested' ? 'selected' : ''}>Requested</option>
        <option value="found" ${req.status === 'found' ? 'selected' : ''}>Found</option>
        <option value="sent" ${req.status === 'sent' ? 'selected' : ''}>Sent</option>
        <option value="paid" ${req.status === 'paid' ? 'selected' : ''}>Paid</option>
        <option value="purchased" ${req.status === 'purchased' ? 'selected' : ''}>Purchased</option>
      </select>
      <input type="text" class="tag-edit-input" data-field="customer" value="${escapeHtml(req.customer)}">
    </div>
  `;
}

function renderShoppingList() {
  renderTagCloud();

  const filtered = shoppingRequests.filter((r) => {
    if (!shoppingTagFilter) return true;
    const inTags = r.tags.some((t) => t.toLowerCase().includes(shoppingTagFilter));
    const inItem = r.item.toLowerCase().includes(shoppingTagFilter);
    return inTags || inItem;
  });

  shoppingListEmptyState.style.display = filtered.length ? 'none' : 'block';
  shoppingListEmptyState.textContent = shoppingRequests.length ? 'No requests match that filter.' : 'No requests yet - import your form responses above.';

  if (shoppingView === 'product') {
    shoppingListContent.innerHTML = filtered.map(requestRowHtml).join('');
    return;
  }

  const byCustomer = new Map();
  filtered.forEach((r) => {
    if (!byCustomer.has(r.customer)) byCustomer.set(r.customer, []);
    byCustomer.get(r.customer).push(r);
  });

  shoppingListContent.innerHTML = [...byCustomer.entries()].map(([customer, reqs]) => `
    <div class="shopping-group">
      <div class="shopping-group-title">
        <span>${escapeHtml(customer)}</span>
        <span class="count-badge">${reqs.length} item${reqs.length > 1 ? 's' : ''}</span>
      </div>
      ${reqs.map(requestRowHtml).join('')}
    </div>
  `).join('');
}

shoppingListContent.addEventListener('change', async (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const id = Number(e.target.closest('[data-id]').dataset.id);
  const req = shoppingRequests.find((r) => r.id === id);
  if (!req) return;

  const value = field === 'tags'
    ? e.target.value.split(',').map((t) => t.trim()).filter(Boolean)
    : e.target.value;

  const previousValue = req[field];
  req[field] = value;
  if (field === 'tags') renderTagCloud();

  try {
    const response = await fetch('/api/shopping-list', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, field, value }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }
  } catch (err) {
    req[field] = previousValue;
    renderShoppingList();
    shoppingListEmptyState.textContent = `Couldn't save change: ${err.message}`;
    shoppingListEmptyState.style.display = 'block';
  }
});

render();
loadFinanceRows();
