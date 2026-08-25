const TAX_RATE = 0.065;
const FEE_LOW = 3;
const FEE_HIGH = 5;
const FEE_THRESHOLD = 25;

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

copyBtn.addEventListener('click', async () => {
  const text = summaryOutput.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const range = document.createRange();
    range.selectNode(summaryOutput);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.execCommand('copy');
    window.getSelection().removeAllRanges();
  }
  copyBtn.textContent = 'Copied!';
  copyBtn.classList.add('copied');
  setTimeout(() => {
    copyBtn.textContent = 'Copy to clipboard';
    copyBtn.classList.remove('copied');
  }, 1500);
});

function render() {
  itemsList.innerHTML = '';
  emptyState.style.display = items.length ? 'none' : 'block';

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

  let text = blocks.join('\n\n');

  if (items.length > 1) {
    const grandTotal = items.reduce((sum, item) => sum + calcItemTotal(item.price), 0);
    text += `\n\n---\nGrand total (${items.length} items): ${formatMoney(Math.round(grandTotal * 100) / 100)}`;
  }

  return text;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

render();
