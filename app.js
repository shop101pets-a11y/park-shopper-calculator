const TAX_RATE = 0.065;
const FEE_LOW = 3;
const FEE_HIGH = 5;
const FEE_THRESHOLD = 25;
const SHIPPING_FEES = { light: 7.75, normal: 8.35, heavy: 9.86 };

/**
 * Core pricing formulas.
 */
function calcTax(price) {
  return Math.round(price * TAX_RATE * 100) / 100;
}

function calcShopperFee(price) {
  return price < FEE_THRESHOLD ? FEE_LOW : FEE_HIGH;
}

function calcItemTotal(price) {
  return Math.round((price + calcTax(price) + calcShopperFee(price)) * 100) / 100;
}

function formatMoney(n) {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

let items = [];

const form = document.getElementById('item-form');
const nameInput = document.getElementById('item-name');
const priceInput = document.getElementById('item-price');
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
  if (!name || isNaN(price) || price < 0) return;

  items.push({ id: Date.now(), name, price });
  nameInput.value = '';
  priceInput.value = '';
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
        items: items.map((item) => ({ name: item.name, price: item.price })),
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
    const tax = calcTax(item.price);
    const fee = calcShopperFee(item.price);
    const total = calcItemTotal(item.price);

    const li = document.createElement('li');
    li.className = 'item-row';
    li.innerHTML = `
      <div class="item-info">
        <span class="item-name">${escapeHtml(item.name)}</span>
        <span class="item-detail">${formatMoney(item.price)} + ${formatMoney(tax)} tax + ${formatMoney(fee)} fee</span>
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
    const tax = calcTax(item.price);
    const fee = calcShopperFee(item.price);
    const total = calcItemTotal(item.price);
    return [
      `${item.name} - ${formatMoney(item.price)} (+${formatMoney(tax)} tax)`,
      `shopper fee - ${formatMoney(fee)}`,
      `total ${formatMoney(total)}`,
    ].join('\n');
  });

  const weight = getSelectedWeight();
  const shippingFee = SHIPPING_FEES[weight];
  const itemsTotal = items.reduce((sum, item) => sum + calcItemTotal(item.price), 0);
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
const tabCalculator = document.getElementById('tab-calculator');
const tabFinances = document.getElementById('tab-finances');
const calculatorView = document.getElementById('calculator-view');
const financesView = document.getElementById('finances-view');

tabCalculator.addEventListener('click', () => switchTab('calculator'));
tabFinances.addEventListener('click', () => switchTab('finances'));

function switchTab(tab) {
  const showFinances = tab === 'finances';
  calculatorView.classList.toggle('hidden', showFinances);
  financesView.classList.toggle('hidden', !showFinances);
  tabCalculator.classList.toggle('active', !showFinances);
  tabFinances.classList.toggle('active', showFinances);
  tabCalculator.setAttribute('aria-selected', String(!showFinances));
  tabFinances.setAttribute('aria-selected', String(showFinances));
}

render();
