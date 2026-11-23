// All dynamic content is inserted with textContent, never innerHTML (output encoding).
const main = document.getElementById('main');
const nav = document.getElementById('nav');
let me = null;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CATEGORIES = ['Travel', 'Meals', 'Lodging', 'Office Supplies', 'Internet & Phone', 'Training'];
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const money = (s) => inr.format(Number(s));
const day = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
};
const stamp = (iso) =>
  `${day(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso)))} ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))}`;

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v !== undefined) node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) node.append(kid);
  return node;
}

async function api(path, options = {}) {
  const headers = options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : {};
  const res = await fetch(path, { credentials: 'same-origin', ...options, headers });
  if (res.status === 204) return null;
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? 'Request failed'), { status: res.status, body: data?.error });
  return data;
}

const errorBox = (msg) => el('p', { class: 'error', role: 'alert' }, msg);
const field = (id, label, input) => el('div', {}, el('label', { for: id }, label), input);

function render(...nodes) {
  main.replaceChildren(...nodes);
  main.focus();
}

function renderNav() {
  nav.replaceChildren();
  if (!me) return;
  const link = (h, t) => el('a', { href: h }, t);
  nav.append(link('#/claims', me.role === 'Finance' ? 'All claims' : 'My claims'));
  if (me.role !== 'Finance' && me.managerId) nav.append(link('#/new', 'New claim'));
  if (me.role === 'Manager') nav.append(link('#/team', 'Approval queue'));
  if (me.role === 'Finance') nav.append(link('#/report', 'Monthly report'));
  nav.append(
    el('button', { type: 'button', onclick: async () => { await api('/api/auth/logout', { method: 'POST' }); me = null; renderNav(); location.hash = '#/login'; route(); } }, `Log out (${me.name})`),
  );
}

function loginView() {
  const err = el('div');
  const email = el('input', { id: 'email', type: 'email', autocomplete: 'username', required: true });
  const password = el('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const form = el('form', { onsubmit: async (e) => {
    e.preventDefault();
    try {
      me = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
      renderNav();
      location.hash = '#/claims';
      route();
    } catch (x) {
      err.replaceChildren(errorBox(x.message));
    }
  } }, field('email', 'Email', email), field('password', 'Password', password), el('button', { class: 'primary', type: 'submit' }, 'Log in'));
  render(el('h2', {}, 'Log in'), err, form);
}

function claimsTable(items, withEmployee) {
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, ['ID', ...(withEmployee ? ['Employee'] : []), 'Date', 'Category', 'Description', 'Amount', 'Status'].map((h) => el('th', { scope: 'col', class: h === 'Amount' ? 'num' : '' }, h)))),
    el('tbody', {}, items.map((c) => el('tr', {},
      el('td', {}, el('a', { href: `#/claim/${c.id}` }, c.id)),
      withEmployee ? el('td', {}, c.employeeName) : null,
      el('td', {}, day(c.date)), el('td', {}, c.category), el('td', {}, c.description),
      el('td', { class: 'num' }, money(c.amount)), el('td', {}, c.status))))));
}

async function listView(params) {
  const q = new URLSearchParams(params);
  const data = await api(`/api/claims?${q}`);
  const page = data.page;
  const sel = (id, label, opts, val) => field(id, label, el('select', { id, name: id }, el('option', { value: '' }, 'Any'), opts.map((o) => el('option', { value: o, selected: o === val }, o))));
  const month = el('input', { id: 'month', name: 'month', type: 'month', value: params.month ?? '' });
  const form = el('form', { class: 'row', onsubmit: (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const next = new URLSearchParams();
    for (const [k, v] of f) if (v) next.set(k, v);
    location.hash = `#/claims?${next}`;
  } }, sel('status', 'Status', ['Submitted', 'Approved', 'Rejected'], params.status), field('month', 'Month', month), sel('category', 'Category', CATEGORIES, params.category), el('button', { class: 'primary', type: 'submit' }, 'Filter'));
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pageLink = (p, text) => { const n = new URLSearchParams(params); n.set('page', String(p)); return el('a', { href: `#/claims?${n}` }, text); };
  render(el('h2', {}, me.role === 'Finance' ? 'All claims' : 'My claims'), form,
    el('p', {}, `${data.total} claims, total ${money(data.sumAmount)}`),
    data.items.length ? claimsTable(data.items, me.role === 'Finance') : el('p', { class: 'muted' }, 'No claims found.'),
    el('p', {}, `Page ${page} of ${pages} `, page > 1 ? pageLink(page - 1, 'Previous') : null, ' ', page < pages ? pageLink(page + 1, 'Next') : null));
}

function claimForm(existing, onDone) {
  const err = el('div');
  const warn = el('div');
  const v = existing ?? {};
  const date = el('input', { id: 'date', type: 'date', value: v.date ?? '', required: true });
  const category = el('select', { id: 'category', required: true }, CATEGORIES.map((c) => el('option', { value: c, selected: c === v.category }, c)));
  const amount = el('input', { id: 'amount', inputmode: 'decimal', value: v.amount ?? '', required: true });
  const description = el('textarea', { id: 'description', rows: '3', required: true }, v.description ?? '');
  const receipt = el('input', { id: 'receipt', type: 'file', accept: '.jpg,.jpeg,.png,.pdf' });
  let confirm = false;
  const submit = async (e) => {
    e?.preventDefault();
    const fd = new FormData();
    fd.set('date', date.value); fd.set('category', category.value); fd.set('amount', amount.value); fd.set('description', description.value);
    if (confirm) fd.set('confirmDuplicate', 'true');
    if (receipt.files[0]) fd.set('receipt', receipt.files[0]);
    try {
      const saved = await api(existing ? `/api/claims/${existing.id}` : '/api/claims', { method: existing ? 'PATCH' : 'POST', body: fd });
      onDone(saved);
    } catch (x) {
      warn.replaceChildren();
      if (x.body?.code === 'DUPLICATE_CLAIM') {
        err.replaceChildren();
        warn.append(el('div', { class: 'warn', role: 'alert' }, el('p', {}, 'Warning: a similar claim (same date, category and amount) already exists.'),
          el('button', { class: 'primary', type: 'button', onclick: () => { confirm = true; submit(); } }, 'Submit anyway')));
      } else {
        err.replaceChildren(errorBox(x.message), ...(x.body?.fields ?? []).map((f) => errorBox(`${f.field}: ${f.message}`)));
      }
    }
  };
  return el('form', { onsubmit: submit }, err, warn, field('date', 'Date', date), field('category', 'Category', category),
    field('amount', 'Amount (INR)', amount), field('description', 'Description (3-200 characters)', description),
    field('receipt', 'Receipt (JPG, PNG or PDF, max 2 MB)', receipt), el('button', { class: 'primary', type: 'submit' }, existing ? 'Save changes' : 'Submit claim'));
}

async function claimView(id) {
  const c = await api(`/api/claims/${id}`);
  const err = el('div');
  const own = c.employeeEmail === me.email;
  const actions = el('p');
  const reload = () => route();
  if (own && c.status === 'Submitted') {
    actions.append(el('button', { class: 'primary', type: 'button', onclick: () => render(el('h2', {}, `Edit ${c.id}`), claimForm(c, reload)) }, 'Edit'), ' ',
      el('button', { class: 'danger', type: 'button', onclick: async () => { if (confirmDelete()) { await api(`/api/claims/${id}`, { method: 'DELETE' }); location.hash = '#/claims'; } } }, 'Delete'));
  }
  if (me.role === 'Manager' && !own && c.status === 'Submitted') {
    const comment = el('input', { id: 'comment', type: 'text' });
    const act = async (path, body) => { try { await api(`/api/claims/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) }); location.hash = '#/team'; } catch (x) { err.replaceChildren(errorBox(x.message)); } };
    actions.append(el('button', { class: 'primary', type: 'button', onclick: () => act('approve', {}) }, 'Approve'), field('comment', 'Rejection comment (at least 5 characters)', comment),
      el('button', { class: 'danger', type: 'button', onclick: () => act('reject', { comment: comment.value }) }, 'Reject'));
  }
  const receipt = c.hasReceipt ? el('a', { href: `/api/claims/${id}/receipt`, target: '_blank', rel: 'noopener' }, 'View receipt') : el('span', { class: 'muted' }, 'No receipt provided');
  render(el('h2', {}, c.id), err,
    el('dl', {}, ...[['Employee', c.employeeName], ['Date', day(c.date)], ['Category', c.category], ['Amount', money(c.amount)], ['Description', c.description], ['Status', c.status], ['Decided by', c.decidedBy ?? '-'], ['Comment', c.decisionComment ?? '-']].flatMap(([k, val]) => [el('dt', {}, k), el('dd', {}, val)])),
    el('p', {}, receipt), actions, el('h3', {}, 'History'),
    el('ul', {}, c.history.map((h) => el('li', {}, `${h.type} by ${h.actor} on ${stamp(h.at)}${h.comment ? `: ${h.comment}` : ''}`))));
}

const confirmDelete = () => window.confirm('Delete this claim?');

async function teamView() {
  const data = await api('/api/team/claims?status=Submitted');
  render(el('h2', {}, 'Approval queue'), data.items.length ? claimsTable(data.items, true) : el('p', { class: 'muted' }, 'No pending claims.'));
}

async function reportView(month) {
  const m = month || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 7);
  const input = el('input', { id: 'month', type: 'month', value: m });
  const form = el('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); location.hash = `#/report?month=${input.value}`; } }, field('month', 'Month', input), el('button', { class: 'primary', type: 'submit' }, 'Show'));
  const r = await api(`/api/reports/monthly?month=${encodeURIComponent(m)}`);
  const table = (headers, rows) => el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, headers.map((h) => el('th', { scope: 'col' }, h)))), el('tbody', {}, rows.map((row) => el('tr', {}, row.map((c) => el('td', {}, c)))))));
  render(el('h2', {}, 'Monthly report'), form,
    el('p', {}, `Grand total ${money(r.grandTotal)}; ${r.approvedCount} approved claims.`),
    el('p', {}, el('a', { href: `/api/reports/monthly.csv?month=${encodeURIComponent(m)}` }, 'Download CSV')),
    el('h3', {}, 'By category'), table(['Category', 'Total', 'Count'], r.byCategory.map((x) => [x.category, money(x.total), String(x.count)])),
    el('h3', {}, 'By employee'), table(['Employee', 'Total', 'Count'], r.byEmployee.map((x) => [x.employeeName, money(x.total), String(x.count)])),
    el('h3', {}, 'Claims by status'), table(['Status', 'Count'], Object.entries(r.statusCounts).map(([k, n]) => [k, String(n)])));
}

async function route() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  if (!me) {
    try { me = await api('/api/me'); } catch { me = null; }
    renderNav();
  }
  if (!me) { loginView(); return; }
  try {
    if (path.startsWith('/claim/')) await claimView(path.slice(7));
    else if (path === '/new') render(el('h2', {}, 'New claim'), claimForm(null, (c) => { location.hash = `#/claim/${c.id}`; }));
    else if (path === '/team') await teamView();
    else if (path === '/report') await reportView(params.month);
    else await listView(params);
  } catch (x) {
    if (x.status === 401) { me = null; renderNav(); loginView(); return; }
    render(el('h2', {}, 'Error'), errorBox(x.message));
  }
}

window.addEventListener('hashchange', route);
route();
