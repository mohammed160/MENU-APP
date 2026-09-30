/* Dashboard: edit the menu, upload high-quality photos, save to the server */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + '-' + Math.random().toString(36).slice(2, 8);

let MENU = null, TAB = 'orders', dirty = false;

/* ---------------- orders state & helpers ---------------- */
let ORDERS = [];
let ORDERS_COUNTS = { total: 0, new: 0, preparing: 0, out_for_delivery: 0, delivered: 0, cancelled: 0 };
let ordersFilter = 'active';
let ordersSearch = '';
let ordersDate = 'today';
let ordersPolling = null;
let searchTimer = null;
let soundEnabled = localStorage.getItem('admin_orders_sound') !== 'false';
const knownOrderIds = new Set();

const STATUS_LABELS = {
  new: 'جديد',
  preparing: 'قيد التجهيز',
  out_for_delivery: 'خرج للتوصيل',
  delivered: 'تم التسليم',
  cancelled: 'ملغي'
};
const STATUS_COLORS = {
  new: 'badge-blue',
  preparing: 'badge-amber',
  out_for_delivery: 'badge-purple',
  delivered: 'badge-green',
  cancelled: 'badge-red'
};
const METHOD_LABELS = {
  delivery: 'دليفري',
  takeaway: 'تيك أواي'
};
const PAY_LABELS = {
  cod: 'كاش عند الاستلام',
  instapay: 'انستا باي',
  wallet: 'محفظة إلكترونية'
};

function playOrderAlert() {
  if (!soundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(659.25, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

function relTime(iso) {
  if (!iso) return '';
  const diffSec = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diffSec < 60) return 'الآن';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `منذ ${diffHr} ساعة`;
  const diffDay = Math.floor(diffHr / 24);
  return `منذ ${diffDay} يوم`;
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString('ar-EG', { month: 'numeric', day: 'numeric' });
  return `${time} · ${date}`;
}

function customerNotifyUrl(o) {
  const name = o.customer?.name || 'عميلنا العزيز';
  const num = o.number;
  let msg = '';
  if (o.status === 'new') msg = `أهلاً ${name}، استلمنا طلبك رقم #${num} وجاري مراجعته الآن في المطعم.`;
  else if (o.status === 'preparing') msg = `أهلاً ${name}، طلبك رقم #${num} قيد التجهيز في المطبخ الآن وسيتم إرساله قريباً.`;
  else if (o.status === 'out_for_delivery') msg = `أهلاً ${name}، طلبك رقم #${num} خرج للتوصيل مع المندوب وفي الطريق إليك الآن.`;
  else if (o.status === 'delivered') msg = `أهلاً ${name}، تم تسليم طلبك رقم #${num} بنجاح. بالهناء والشفاء ونتمنى لك وجبة شهية!`;
  else if (o.status === 'cancelled') msg = `أهلاً ${name}، نعتذر منك، تم إلغاء طلبك رقم #${num}.${o.cancelReason ? ' سبب الإلغاء: ' + o.cancelReason : ''}`;
  let phone = (o.customer?.phone || '').replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '2' + phone;
  else if (!phone.startsWith('2') && phone.length === 10) phone = '20' + phone;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

async function loadOrders(silent = false) {
  try {
    const params = new URLSearchParams();
    if (ordersFilter !== 'all' && ordersFilter !== 'active') {
      params.set('status', ordersFilter);
    }
    if (ordersSearch.trim()) {
      params.set('q', ordersSearch.trim());
    }
    if (ordersDate === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      params.set('from', today.toISOString());
    } else if (ordersDate === '7d') {
      const d = new Date(Date.now() - 7 * 86400000);
      params.set('from', d.toISOString());
    }
    const res = await api('/api/admin/orders?' + params.toString());
    const isFirstRun = knownOrderIds.size === 0;
    ORDERS = res.orders || [];
    ORDERS_COUNTS = res.counts || ORDERS_COUNTS;

    let hasBrandNew = false;
    for (const o of ORDERS) {
      if (!knownOrderIds.has(o.id)) {
        knownOrderIds.add(o.id);
        if (o.status === 'new') hasBrandNew = true;
      }
    }
    if (hasBrandNew && !isFirstRun) {
      playOrderAlert();
      toast('🔔 وصل طلب جديد!');
    }

    renderTabs();
    if (TAB === 'orders') renderOrders();
  } catch (err) {
    if (!silent) toast(err.message || 'تعذر تحميل الطلبات', true);
  }
}

async function changeOrderStatus(id, newStatus, reason = '') {
  try {
    await api('/api/admin/orders/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus, cancelReason: reason })
    });
    toast('تم تحديث حالة الطلب ✓');
    await loadOrders(true);
  } catch (err) {
    toast(err.message || 'تعذر تحديث الحالة', true);
  }
}

async function deleteOrder(id) {
  try {
    await api('/api/admin/orders/' + id, { method: 'DELETE' });
    toast('تم حذف الطلب ✓');
    await loadOrders(true);
  } catch (err) {
    toast(err.message || 'تعذر حذف الطلب', true);
  }
}

function printOrderReceipt(o) {
  let pa = $('#printArea');
  if (!pa) {
    pa = document.createElement('div');
    pa.id = 'printArea';
    document.body.appendChild(pa);
  }
  const S = MENU?.settings || {};
  const restaurantName = esc(S.restaurant || 'المطعم');
  const isDel = o.type === 'delivery';
  const d = new Date(o.createdAt || Date.now());
  const dateStr = d.toLocaleDateString('ar-EG') + ' ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  const itemsHtml = (o.lines || []).map(l => {
    const name = esc(l.ar || l.en || 'صنف');
    const det = esc(l.detailAr || l.detail || '');
    const lineTot = (l.unit * l.qty) + (l.extras || []).reduce((s, x) => s + (x.price * l.qty), 0);
    const extrasHtml = (l.extras || []).map(x => `<div class="p-extra">+ ${esc(x.ar || x.en)} (${x.price} جنيه)</div>`).join('');
    const noteHtml = l.note ? `<div class="p-note">ملاحظة: ${esc(l.note)}</div>` : '';
    return `<div class="p-item">
      <div class="p-row">
        <span>${l.qty}x ${name}${det ? ` (${det})` : ''}</span>
        <span class="p-bold">${lineTot} جنيه</span>
      </div>
      ${extrasHtml}
      ${noteHtml}
    </div>`;
  }).join('');

  pa.innerHTML = `
    <h2>${restaurantName}</h2>
    <div class="p-center p-bold p-large">طلب #${o.number}</div>
    <div class="p-center">${isDel ? 'دليفري (توصيل)' : 'تيك أواي (استلام من المطعم)'}</div>
    <hr class="p-hr">
    <div class="p-row"><span>التاريخ:</span> <span>${dateStr}</span></div>
    <div class="p-row"><span>العميل:</span> <span class="p-bold">${esc(o.customer?.name || '—')}</span></div>
    <div class="p-row"><span>الموبايل:</span> <span dir="ltr">${esc(o.customer?.phone || '—')}</span></div>
    ${isDel ? `<div class="p-row"><span>العنوان:</span> <span>${esc(o.customer?.address || '—')}</span></div>` : ''}
    ${isDel && o.customer?.zoneName ? `<div class="p-row"><span>المنطقة:</span> <span>${esc(o.customer.zoneName)}</span></div>` : ''}
    ${o.customer?.branchName ? `<div class="p-row"><span>الفرع:</span> <span>${esc(o.customer.branchName)}</span></div>` : ''}
    ${o.note ? `<div class="p-row p-note"><span>ملاحظات:</span> <span>${esc(o.note)}</span></div>` : ''}
    <hr class="p-hr">
    <div class="p-bold" style="margin-bottom:4px">الأصناف:</div>
    ${itemsHtml}
    <hr class="p-hr">
    <div class="p-row"><span>المجموع:</span> <span>${o.subtotal} جنيه</span></div>
    ${isDel ? `<div class="p-row"><span>التوصيل:</span> <span>${o.deliveryFee > 0 ? o.deliveryFee + ' جنيه' : 'مجاني'}</span></div>` : ''}
    <div class="p-row p-bold p-large" style="margin-top:4px"><span>الإجمالي:</span> <span>${o.total} جنيه</span></div>
    <div class="p-row"><span>طريقة الدفع:</span> <span>${PAY_LABELS[o.payment] || o.payment}</span></div>
    <hr class="p-hr">
    <div class="p-center" style="font-size:11px">شكراً لتعاملكم معنا!</div>
  `;
  window.print();
}

/* ---------------- api ---------------- */
async function api(url, opt = {}) {
  const r = await fetch(url, { credentials: 'same-origin', ...opt, headers: { ...(opt.body && !(opt.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(opt.headers || {}) } });
  if (r.status === 401 && !url.includes('login')) { showLogin(); throw new Error('انتهت الجلسة، سجّل الدخول مرة أخرى'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'حدث خطأ');
  return j;
}
let tt;
function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.classList.toggle('bad', !!bad); t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2600); }
function setDirty(v) { dirty = v; $('#saveBtn').disabled = !v; $('#saveBtn').textContent = v ? 'حفظ التغييرات •' : 'تم الحفظ'; }
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------------- login ---------------- */
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#pw').value = ''; $('#pw').focus(); }
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) }); await start(); }
  catch (er) { $('#loginErr').textContent = er.message === 'Wrong password' ? 'كلمة المرور غير صحيحة' : er.message; }
};
$('#logoutBtn').onclick = async () => { if (dirty && !confirm('فيه تغييرات لم تُحفظ. تخرج؟')) return; dirty = false; await api('/api/admin/logout', { method: 'POST' }); showLogin(); };

async function start() {
  MENU = await api('/api/admin/menu');
  $('#login').hidden = true; $('#app').hidden = false; setDirty(false);
  loadOrders(true);
  if (!ordersPolling) {
    ordersPolling = setInterval(() => { if (!document.hidden) loadOrders(true); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadOrders(true); });
  }
  renderTabs(); render();
}
api('/api/admin/me').then(start).catch(() => showLogin());

/* ---------------- save ---------------- */
$('#saveBtn').onclick = async () => {
  const b = $('#saveBtn'); b.disabled = true; b.textContent = 'جاري الحفظ...';
  try { MENU = await api('/api/admin/menu', { method: 'PUT', body: JSON.stringify(MENU) }); setDirty(false); toast('تم حفظ المنيو ✓'); render(); }
  catch (e) { setDirty(true); toast(e.message, true); }
};
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (dirty) $('#saveBtn').click(); } });

/* ---------------- tabs ---------------- */
const TABS = [['orders', 'الطلبات'], ['pizzas', 'بيتزا'], ['pasta', 'باستا'], ['sides', 'جانبيات'], ['extras', 'إضافات'], ['drinks', 'مشروبات'], ['settings', 'إعدادات']];
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([k, n]) => {
    let countBadge = '';
    if (k === 'orders') {
      const nw = ORDERS_COUNTS.new || 0;
      countBadge = nw > 0 ? `<small class="badge-new">${nw}</small>` : (ORDERS_COUNTS.total != null ? `<small>${ORDERS_COUNTS.total}</small>` : '');
    } else if (k !== 'settings') {
      countBadge = `<small>${MENU?.[k]?.length || 0}</small>`;
    }
    return `<button class="tab" role="tab" data-tab="${k}" aria-selected="${TAB === k}">${n}${countBadge}</button>`;
  }).join('');
}
$('#tabs').onclick = e => {
  const t = e.target.closest('[data-tab]'); if (!t) return;
  TAB = t.dataset.tab;
  renderTabs();
  render();
  window.scrollTo({ top: 0 });
  if (TAB === 'orders') loadOrders(false);
};

/* ---------------- path helpers ---------------- */
const target = i => (TAB === 'settings' ? MENU.settings : MENU[TAB][i]);
const getP = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setP(o, p, v) { const ks = p.split('.'); const last = ks.pop(); let c = o; for (const k of ks) { if (c[k] == null) c[k] = {}; c = c[k]; } if (v === undefined) delete c[last]; else c[last] = v; }

/* ---------------- building blocks ---------------- */
const inp = (i, path, label, type = 'text', cls = '', attrs = '') => {
  const v = getP(MENU[TAB][i], path);
  return `<label class="f ${cls}">${label}<input data-i="${i}" data-f="${path}" data-t="${type}" type="${type}" ${type === 'number' ? 'min="0" step="any" inputmode="decimal"' : ''} value="${esc(v ?? '')}" ${attrs}></label>`;
};
const sel = (i, path, label, opts, rerender = false) => `<label class="f">${label}<select data-i="${i}" data-f="${path}" data-t="select" ${rerender ? 'data-re="1"' : ''}>${opts.map(([v, n]) => `<option value="${v}"${getP(MENU[TAB][i], path) === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
const chk = (i, path, label) => `<label class="chk"><input type="checkbox" data-i="${i}" data-f="${path}" data-t="check"${getP(MENU[TAB][i], path) ? ' checked' : ''}>${label}</label>`;

function quality(img) {
  if (!img) return '';
  if (img.legacy || !img.w) return `<span class="q lo">صورة قديمة منخفضة الجودة</span> استبدلها بصورة أكبر`;
  const q = img.w >= 1400 ? ['hi', 'جودة عالية'] : img.w >= 900 ? ['mid', 'جودة متوسطة'] : ['lo', 'جودة منخفضة'];
  return `<span class="q ${q[0]}">${q[1]}</span> <bdi dir="ltr">${img.w}×${img.h}px</bdi> · ${img.cutout ? 'بدون خلفية' : 'بخلفية'}`;
}
function imgBox(i, path, label = 'الصورة') {
  const img = getP(target(i), path);
  return `<div class="ib" data-i="${i}" data-slot="${path}">
    <div class="ib-label">${label}</div>
    <div class="ib-prev${img ? (TAB === 'settings' ? ' plain' : img.cutout ? ' cut' : ' photo') : ''}" tabindex="0" role="button" aria-label="رفع صورة">${img ? `<img src="${esc(img.th || img.src)}" alt="">` : 'اسحب الصورة هنا<br>أو اضغط للرفع'}</div>
    <div class="ib-info">${quality(img)}</div>
    <div class="ib-btns"><button type="button" class="btn sm" data-act="pick">${img ? 'استبدال' : 'رفع صورة'}</button>${img ? '<button type="button" class="btn sm danger" data-act="rmimg">حذف</button>' : ''}</div>
    <input type="file" accept="image/jpeg,image/png,image/webp">
  </div>`;
}
const foot = (i, extra = '') => `<div class="item-foot"><div style="display:flex;gap:14px;flex-wrap:wrap">${chk(i, 'hidden', 'إخفاء من المنيو')}${chk(i, 'soldOut', 'نفذت الكمية')}${extra}</div>
  <div class="mini"><button class="btn sm" data-act="up" data-i="${i}" title="لأعلى">▲</button><button class="btn sm" data-act="down" data-i="${i}" title="لأسفل">▼</button><button class="btn sm danger" data-act="del" data-i="${i}">حذف</button></div></div>`;
const wrap = (i, inner, it) => `<article class="card item${it.hidden ? ' is-hidden' : ''}" data-i="${i}">${inner}</article>`;

const TIP = `<div class="tip"><b>لأفضل جودة:</b> ارفع صورة <b>PNG بدون خلفية</b> (شفافة) بعرض <b>1500 بكسل أو أكثر</b> — هتظهر فوق الشريط البرتقالي زي تصميم المنيو. أي صورة JPG/PNG/WebP لحد 25MB مقبولة، والنظام بيحفظها بأعلى جودة ويجهز نسخ أصغر للموبايل تلقائيًا. الصورة اللي ليها خلفية بتظهر كصورة مستطيلة.</div>`;

/* ---------------- section renderers ---------------- */
const GROUPS = {
  pizzas: [['signature', 'بيتزا مميزة (بحشو جبنة)'], ['premium', 'بريميوم (سعر واحد)'], ['classic', 'بيتزا كلاسيك']],
  pasta: [['regular', 'باستا'], ['premium', 'بريميوم']],
  sides: [['L', 'العمود الأول'], ['R', 'العمود الثاني']]
};
const bucket = (t, it) => (t === 'sides' ? it.col : it.group);

function pizzaCard(it, i) {
  const prem = it.group === 'premium';
  const prices = prem
    ? `<div class="pbox"><h4>السعر</h4><div class="prices two">${inp(i, 'p.Regular', 'السعر', 'number')}</div></div>`
    : `<div class="prices two"><div class="pbox"><h4>الأسعار العادية</h4><div class="prices">${['M', 'L', 'F'].map(k => inp(i, 'p.' + k, k === 'M' ? 'وسط M' : k === 'L' ? 'كبير L' : 'عائلي F', 'number')).join('')}</div></div>
       <div class="pbox st"><h4>بحشو الجبنة (اتركها فارغة لو غير متاح)</h4><div class="prices">${['M', 'L', 'F'].map(k => inp(i, 's.' + k, k, 'number')).join('')}</div></div></div>`;
  return wrap(i, `${imgBox(i, 'image')}<div class="body"><div class="row">${inp(i, 'en', 'الاسم (English)')}${inp(i, 'ar', 'الاسم (عربي)')}${sel(i, 'group', 'القسم', GROUPS.pizzas, true)}</div>${prices}${foot(i)}</div>`, it);
}
function pastaCard(it, i) {
  const prem = it.group === 'premium';
  return wrap(i, `<div style="display:flex;gap:10px;flex-wrap:wrap">${imgBox(i, 'images.penne', 'صورة بنه')}${imgBox(i, 'images.fettuccine', 'صورة فوتوتشيني')}</div>
    <div class="body"><div class="row">${inp(i, 'en', 'الاسم (English)')}${inp(i, 'ar', 'الاسم (عربي)')}${sel(i, 'group', 'القسم', GROUPS.pasta, true)}</div>
    <div class="pbox"><h4>الأسعار (نفس السعر لبنه وفوتوتشيني)</h4><div class="prices">${prem ? inp(i, 'p.Regular', 'السعر', 'number') : inp(i, 'p.M', 'وسط M', 'number') + inp(i, 'p.L', 'كبير L', 'number')}
      <label class="f">لون الصوص (للرسمة المؤقتة)<input type="color" data-i="${i}" data-f="sauce" data-t="text" value="${esc(it.sauce || '#e0a21b')}"></label></div></div>
    <div class="tip" style="margin:0">لو رفعت صورة واحدة بس هتُستخدم للنوعين. من غير صور بتظهر رسمة مؤقتة.</div>${foot(i)}</div>`, it);
}
function sidesCard(it, i) {
  return wrap(i, `${imgBox(i, 'image')}<div class="body"><div class="row">${inp(i, 'en', 'الاسم (English)')}${inp(i, 'ar', 'الاسم (عربي)')}${inp(i, 'price', 'السعر', 'number', 'narrow')}${sel(i, 'col', 'العمود', GROUPS.sides, true)}</div>${foot(i, chk(i, 'hl', 'شريط برتقالي مميز'))}</div>`, it);
}
function extrasCard(it, i) {
  return `<article class="card compact${it.hidden ? ' is-hidden' : ''}" data-i="${i}">${inp(i, 'en', 'الاسم (English)')}${inp(i, 'ar', 'الاسم (عربي)')}${inp(i, 'price', 'السعر', 'number', 'narrow')}${sel(i, 'cat', 'النوع', [['toppings', 'إضافات'], ['cheese', 'جبنة'], ['sauces', 'صوصات']])}
    ${chk(i, 'hidden', 'إخفاء')}${chk(i, 'soldOut', 'نفذت')}<div class="mini"><button class="btn sm" data-act="up" data-i="${i}">▲</button><button class="btn sm" data-act="down" data-i="${i}">▼</button><button class="btn sm danger" data-act="del" data-i="${i}">حذف</button></div></article>`;
}
function drinksCard(it, i) {
  return wrap(i, `${imgBox(i, 'image')}<div class="body"><div class="row">${inp(i, 'en', 'الاسم (English)')}${inp(i, 'ar', 'الاسم (عربي)')}${inp(i, 'price', 'السعر', 'number', 'narrow')}</div>${foot(i)}</div>`, it);
}
const CARDS = { pizzas: pizzaCard, pasta: pastaCard, sides: sidesCard, extras: extrasCard, drinks: drinksCard };
const NEW = {
  pizzas: () => ({ id: uid('pizza'), en: '', ar: '', group: 'classic', p: { M: '', L: '', F: '' }, s: null, image: null }),
  pasta: () => ({ id: uid('pasta'), en: '', ar: '', group: 'regular', p: { M: '', L: '' }, sauce: '#e0a21b', images: {} }),
  sides: () => ({ id: uid('side'), en: '', ar: '', price: 0, col: 'R', hl: false, image: null }),
  extras: () => ({ id: uid('extra'), en: '', ar: '', price: 0, cat: 'toppings' }),
  drinks: () => ({ id: uid('drink'), en: '', ar: '', price: 0, image: null })
};
const LABEL = { pizzas: 'بيتزا', pasta: 'باستا', sides: 'صنف جانبي', extras: 'إضافة', drinks: 'مشروب' };

function renderOrderCard(o) {
  const isDel = o.type === 'delivery';
  const waNotify = customerNotifyUrl(o);

  const linesHtml = (o.lines || []).map(l => {
    const title = esc(l.ar || l.en || 'صنف');
    const det = esc(l.detailAr || l.detail || '');
    const extras = (l.extras || []).map(x => `<span class="ord-extra">+ ${esc(x.ar || x.en)} (${x.price} جنيه)</span>`).join(' ');
    const note = l.note ? `<div class="ord-line-note">ملاحظة: ${esc(l.note)}</div>` : '';
    const lineTotal = (l.unit * l.qty) + (l.extras || []).reduce((s, x) => s + (x.price * l.qty), 0);
    return `<div class="ord-line">
      <div class="ord-line-qty">${l.qty}×</div>
      <div class="ord-line-body">
        <div class="ord-line-name"><b>${title}</b>${det ? ` <span class="ord-line-det">(${det})</span>` : ''}</div>
        ${extras ? `<div class="ord-line-extras">${extras}</div>` : ''}
        ${note}
      </div>
      <div class="ord-line-price">${lineTotal} جنيه</div>
    </div>`;
  }).join('');

  let actionBtn = '';
  if (o.status === 'new') {
    actionBtn = `<button type="button" class="btn sm primary" data-act="ord-status" data-id="${o.id}" data-st="preparing">بدء التجهيز 👨‍🍳</button>`;
  } else if (o.status === 'preparing') {
    if (isDel) {
      actionBtn = `<button type="button" class="btn sm primary" data-act="ord-status" data-id="${o.id}" data-st="out_for_delivery">خرج للتوصيل 🛵</button>`;
    } else {
      actionBtn = `<button type="button" class="btn sm primary" data-act="ord-status" data-id="${o.id}" data-st="delivered">تم التسليم ✓</button>`;
    }
  } else if (o.status === 'out_for_delivery') {
    actionBtn = `<button type="button" class="btn sm primary" data-act="ord-status" data-id="${o.id}" data-st="delivered">تم التسليم ✓</button>`;
  }

  const cancelBtn = (o.status !== 'cancelled' && o.status !== 'delivered')
    ? `<button type="button" class="btn sm danger" data-act="ord-cancel" data-id="${o.id}">إلغاء الطلب</button>`
    : '';

  return `<article class="card order-card status-${o.status}" data-id="${o.id}">
    <div class="ord-head">
      <div class="ord-num-box">
        <span class="ord-num">#${o.number}</span>
        <span class="ord-time" title="${esc(o.createdAt)}">${fmtTime(o.createdAt)} (${relTime(o.createdAt)})</span>
      </div>
      <div class="ord-badges">
        <span class="badge ${STATUS_COLORS[o.status] || ''}">${STATUS_LABELS[o.status] || o.status}</span>
        <span class="badge ${isDel ? 'badge-del' : 'badge-take'}">${METHOD_LABELS[o.type] || o.type}</span>
        ${o.customer?.branchName ? `<span class="badge badge-branch">📍 ${esc(o.customer.branchName)}</span>` : ''}
      </div>
    </div>

    <div class="ord-cust">
      <div class="ord-cust-row">
        <b>العميل:</b> <span>${esc(o.customer?.name || '—')}</span>
        ${o.customer?.phone ? ` · <a href="tel:${esc(o.customer.phone)}" class="ord-link" dir="ltr">${esc(o.customer.phone)}</a>` : ''}
      </div>
      ${isDel ? `<div class="ord-cust-row"><b>العنوان:</b> <span>${esc(o.customer?.address || '—')}</span>${o.customer?.zoneName ? ` <span class="badge-zone">(${esc(o.customer.zoneName)})</span>` : ''}</div>` : ''}
      ${o.note ? `<div class="ord-cust-row ord-note"><b>ملاحظات:</b> <span>${esc(o.note)}</span></div>` : ''}
    </div>

    ${o.adjusted ? `<div class="ord-warn">⚠️ تنبيه: تم تصحيح بعض الأسعار تلقائيًا من السيرفر لمطابقة قائمة الأسعار الحالية.</div>` : ''}

    <div class="ord-lines">${linesHtml}</div>

    <div class="ord-total-box">
      <div class="ord-tot-row"><span>المجموع:</span> <b>${o.subtotal} جنيه</b></div>
      ${isDel ? `<div class="ord-tot-row"><span>رسوم التوصيل:</span> <b>${o.deliveryFee > 0 ? o.deliveryFee + ' جنيه' : 'مجاني'}</b></div>` : ''}
      <div class="ord-tot-row main"><span>الإجمالي:</span> <b>${o.total} جنيه</b></div>
      <div class="ord-pay-method">طريقة الدفع: <b>${PAY_LABELS[o.payment] || o.payment}</b></div>
    </div>

    <div class="ord-foot">
      <div class="ord-quick-actions">
        ${actionBtn}
        ${cancelBtn}
        <label class="ord-sel-wrap">
          <select data-act="ord-change-status" data-id="${o.id}">
            <option value="" disabled selected>تغيير الحالة...</option>
            <option value="new">جديد</option>
            <option value="preparing">قيد التجهيز</option>
            ${isDel ? '<option value="out_for_delivery">خرج للتوصيل</option>' : ''}
            <option value="delivered">تم التسليم</option>
            <option value="cancelled">ملغي</option>
          </select>
        </label>
      </div>
      <div class="ord-tool-actions">
        <a class="btn sm" href="${waNotify}" target="_blank" rel="noopener noreferrer">💬 أبلغ العميل</a>
        <button type="button" class="btn sm" data-act="ord-print" data-id="${o.id}">🖨️ طباعة</button>
        <button type="button" class="btn sm danger" data-act="ord-delete" data-id="${o.id}" title="حذف الطلب">🗑️</button>
      </div>
    </div>
  </article>`;
}

function renderOrders() {
  const c = $('#content');
  const nw = ORDERS_COUNTS.new || 0;
  const prep = ORDERS_COUNTS.preparing || 0;
  const out = ORDERS_COUNTS.out_for_delivery || 0;
  const deliv = ORDERS_COUNTS.delivered || 0;
  const canc = ORDERS_COUNTS.cancelled || 0;
  const tot = ORDERS_COUNTS.total || 0;
  const actCount = nw + prep + out;

  let displayOrders = ORDERS;
  if (ordersFilter === 'active') {
    displayOrders = ORDERS.filter(o => ['new', 'preparing', 'out_for_delivery'].includes(o.status));
  }

  const chips = [
    ['active', `النشطة <small>${actCount}</small>`],
    ['new', `جديد <small>${nw}</small>`, nw > 0 ? 'badge-new-chip' : ''],
    ['preparing', `قيد التجهيز <small>${prep}</small>`],
    ['out_for_delivery', `خرج للتوصيل <small>${out}</small>`],
    ['delivered', `تم التسليم <small>${deliv}</small>`],
    ['cancelled', `ملغي <small>${canc}</small>`],
    ['all', `الكل <small>${tot}</small>`],
  ];

  const dates = [
    ['today', 'اليوم'],
    ['7d', 'آخر 7 أيام'],
    ['all', 'كل الفترات']
  ];

  c.innerHTML = `
    <div class="orders-bar">
      <div class="orders-row">
        <div class="orders-filters" role="group" aria-label="تصفية حسب الحالة">
          ${chips.map(([val, label, extraCls]) => `<button type="button" class="chip-btn ${extraCls || ''} ${ordersFilter === val ? 'on' : ''}" data-act="chip-filter" data-v="${val}">${label}</button>`).join('')}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn sm" data-act="toggle-sound">${soundEnabled ? '🔊 التنبيه الصوتي: مفعل' : '🔇 التنبيه الصوتي: معطل'}</button>
          <button type="button" class="btn sm" data-act="ord-refresh" title="تحديث الطلبات">تحديث ↻</button>
        </div>
      </div>
      <div class="orders-row">
        <div class="orders-search-box">
          <input type="search" id="ordersSearchInp" placeholder="بحث برقم الطلب أو اسم أو هاتف العميل..." value="${esc(ordersSearch)}">
        </div>
        <div class="orders-filters" role="group" aria-label="تصفية حسب التاريخ">
          ${dates.map(([val, label]) => `<button type="button" class="chip-btn ${ordersDate === val ? 'on' : ''}" data-act="date-filter" data-v="${val}">${label}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="orders-list">
      ${displayOrders.length ? displayOrders.map(renderOrderCard).join('') : `<div class="tip" style="text-align:center;padding:30px 20px">لا توجد طلبات تطابق الفلتر والبحث المحددين.</div>`}
    </div>
  `;
}

function render() {
  const c = $('#content');
  if (TAB === 'orders') {
    $('#saveBtn').style.display = 'none';
    renderOrders();
    return;
  }
  $('#saveBtn').style.display = '';
  if (TAB === 'settings') {
    const S = MENU.settings;
    const si = (path, label, type = 'text', attrs = '', cls = '') => `<label class="f ${cls}">${label}<input data-s="${path}" type="${type}" ${type === 'number' ? 'min="0" step="any" inputmode="decimal"' : ''} ${attrs} value="${esc(getP(S, path) ?? '')}"></label>`;
    const sc = (path, label) => `<label class="chk"><input type="checkbox" data-s="${path}"${getP(S, path) ? ' checked' : ''}>${label}</label>`;
    c.innerHTML = `
    <div class="card set"><h2>الهوية</h2>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">${imgBox(0, 'logo', 'شعار المطعم (اللوجو)')}
        <div class="tip" style="flex:1;min-width:200px;margin:0">ارفع اللوجو كـ <b>PNG شفاف</b> بعرض <b>600px أو أكثر</b>. بيظهر أعلى المنيو في المنتصف، وكأيقونة للموقع في المتصفح. لو مفيش لوجو بيظهر اسم المطعم.</div></div>
      ${si('restaurant', 'اسم المطعم')}
      <label class="f">شكل المنيو للعملاء<select data-s="theme"><option value="auto"${(S.theme || 'auto') === 'auto' ? ' selected' : ''}>تلقائي (حسب جهاز العميل)</option><option value="light"${S.theme === 'light' ? ' selected' : ''}>فاتح دائمًا (زي المنيو المطبوع)</option><option value="dark"${S.theme === 'dark' ? ' selected' : ''}>داكن دائمًا</option></select></label>
      ${si('currency', 'العملة', 'text', 'maxlength="8"')}
    </div>

    <div class="card set"><h2>استقبال الطلبات على واتساب</h2>
      ${si('whatsapp', 'رقم واتساب المطعم', 'tel', 'inputmode="tel" placeholder="01001234567"')}
      <div class="tip" style="margin:0">اكتب الرقم زي ما تحب (01001234567 أو 201001234567) وهيتحول تلقائيًا. كل طلب بيوصلك على الرقم ده في رسالة واحدة منظمة فيها بيانات العميل والأصناف والإجمالي وطريقة الدفع.</div>
    </div>

    <div class="card set"><h2>الاستلام والتوصيل</h2>
      ${sc('delivery.enabled', 'دليفري (توصيل للعنوان)')}
      ${si('delivery.fee', 'رسوم التوصيل الافتراضية (تُستخدم فقط لو مفيش مناطق)', 'number')}
      ${sc('takeaway.enabled', 'تيك أواي (استلام من المطعم)')}
      <h3 class="grp-h" style="margin:16px 0 10px">مناطق التوصيل وأسعارها</h3>
      <div class="zones-wrap">
        ${(S.delivery?.zones || []).map((z, zi) => `
          <div class="zone-row card" data-zi="${zi}">
            <div class="zone-inputs">
              <label class="f"><span>اسم المنطقة (عربي) *</span><input type="text" data-zi="${zi}" data-zf="name" value="${esc(z.name || '')}" placeholder="مثال: المحلة الكبرى" maxlength="60"></label>
              <label class="f"><span>اسم المنطقة (English)</span><input type="text" data-zi="${zi}" data-zf="en" value="${esc(z.en || '')}" placeholder="Optional: El Mahalla" maxlength="60"></label>
              <label class="f narrow"><span>السعر</span><input type="number" min="0" step="any" inputmode="decimal" data-zi="${zi}" data-zf="fee" value="${esc(z.fee ?? 0)}"></label>
            </div>
            <div class="zone-actions">
              <label class="chk"><input type="checkbox" data-zi="${zi}" data-zf="enabled"${z.enabled !== false ? ' checked' : ''}>مفعّلة</label>
              <div class="mini">
                <button type="button" class="btn sm" data-act="zone-up" data-zi="${zi}" title="لأعلى" ${zi === 0 ? 'disabled' : ''}>▲</button>
                <button type="button" class="btn sm" data-act="zone-down" data-zi="${zi}" title="لأسفل" ${zi === (S.delivery.zones.length - 1) ? 'disabled' : ''}>▼</button>
                <button type="button" class="btn sm danger" data-act="zone-del" data-zi="${zi}">حذف</button>
              </div>
            </div>
          </div>
        `).join('') || '<p class="tip" style="margin:0 0 10px">لا توجد مناطق توصيل بعد. سيتم استخدام رسوم التوصيل الافتراضية.</p>'}
        <button type="button" class="btn primary sm" data-act="zone-add" style="align-self:flex-start">+ إضافة منطقة</button>
        <div class="pbox st" style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
          <label class="f" style="font-weight:800">إضافة سريعة (كل سطر: اسم المنطقة، السعر)
            <textarea id="zoneQuickText" rows="3" placeholder="المحلة الكبرى، 20&#10;Tanta, 25" style="width:100%;border:2px solid var(--line);border-radius:10px;padding:8px 10px;font:inherit;resize:vertical"></textarea>
          </label>
          <button type="button" class="btn sm" data-act="zone-quick" style="align-self:flex-start">إضافة</button>
        </div>
      </div>
    </div>

    <div class="card set"><h2>فروع المطعم</h2>
      <div class="tip" style="margin:0">حدد فروع المطعم ليختار العميل منها الفرع عند إتمام الطلب (في الدليفري والتيك أواي). لو كتبت رقم واتساب مخصص للفرع، طلبات الفرع ده هتوصل عليه مباشرة.</div>
      <div class="zones-wrap">
        ${(S.branches || []).map((b, bi) => `
          <div class="zone-row card" data-bi="${bi}">
            <div class="zone-inputs">
              <label class="f"><span>اسم الفرع (عربي) *</span><input type="text" data-bi="${bi}" data-bf="name" value="${esc(b.name || '')}" placeholder="مثال: فرع 1 كفرالدوار" maxlength="80"></label>
              <label class="f"><span>اسم الفرع (English)</span><input type="text" data-bi="${bi}" data-bf="en" value="${esc(b.en || '')}" placeholder="Optional: Branch 1" maxlength="80"></label>
              <label class="f"><span>واتساب الفرع (اختياري)</span><input type="tel" data-bi="${bi}" data-bf="whatsapp" value="${esc(b.whatsapp || '')}" placeholder="مثال: 01001234567" dir="ltr" inputmode="tel"></label>
            </div>
            <div class="zone-actions">
              <label class="chk"><input type="checkbox" data-bi="${bi}" data-bf="enabled"${b.enabled !== false ? ' checked' : ''}>مفعّل</label>
              <div class="mini">
                <button type="button" class="btn sm" data-act="branch-up" data-bi="${bi}" title="لأعلى" ${bi === 0 ? 'disabled' : ''}>▲</button>
                <button type="button" class="btn sm" data-act="branch-down" data-bi="${bi}" title="لأسفل" ${bi === (S.branches.length - 1) ? 'disabled' : ''}>▼</button>
                <button type="button" class="btn sm danger" data-act="branch-del" data-bi="${bi}">حذف</button>
              </div>
            </div>
          </div>
        `).join('') || '<p class="tip" style="margin:0 0 10px">لا توجد فروع بعد. اضغط "+ إضافة فرع".</p>'}
        <button type="button" class="btn primary sm" data-act="branch-add" style="align-self:flex-start">+ إضافة فرع</button>
      </div>
    </div>

    <div class="card set"><h2>طرق الدفع</h2>
      ${sc('payments.cod.enabled', 'كاش عند الاستلام (للمندوب أو من المطعم)')}
      <div class="pbox st" style="display:flex;flex-direction:column;gap:10px"><h4>انستا باي</h4>
        ${sc('payments.instapay.enabled', 'تفعيل الدفع بانستا باي')}
        ${si('payments.instapay.handle', 'عنوان انستا باي (مثال: name@instapay)', 'text', 'dir="ltr"')}
        ${si('payments.instapay.link', 'رابط التحويل المباشر (اختياري)', 'url', 'dir="ltr" placeholder="https://ipn.eg/..."')}
      </div>
      <div class="pbox st" style="display:flex;flex-direction:column;gap:10px"><h4>المحفظة الإلكترونية</h4>
        ${sc('payments.wallet.enabled', 'تفعيل الدفع بالمحفظة')}
        ${si('payments.wallet.label', 'اسم المحفظة (مثال: فودافون كاش)')}
        ${si('payments.wallet.number', 'رقم المحفظة', 'tel', 'dir="ltr" inputmode="tel"')}
        ${si('payments.wallet.holder', 'اسم صاحب المحفظة (اختياري)')}
        ${si('payments.wallet.link', 'رابط تحويل مباشر (اختياري)', 'url', 'dir="ltr" placeholder="https://..."')}
      </div>
      <div class="tip" style="margin:0">العميل بيشوف الرابط أو الرقم مع زر نسخ، بيحوّل، وبعدين بيبعت صورة التحويل على الواتساب مع الطلب. لازم رابط أو عنوان/رقم على الأقل لكل طريقة مفعّلة.</div>
    </div>`;
    return;
  }
  const list = MENU[TAB], groups = GROUPS[TAB];
  let html = `<div class="bar"><div>${TAB === 'extras' ? '' : ''}</div><button class="btn primary" data-act="add">+ إضافة ${LABEL[TAB]}</button></div>`;
  if (['pizzas', 'pasta', 'sides', 'drinks'].includes(TAB)) html += TIP;
  if (groups) {
    for (const [g, name] of groups) {
      const items = list.map((it, i) => [it, i]).filter(([it]) => bucket(TAB, it) === g);
      if (items.length) html += `<h3 class="grp-h">${name}</h3>` + items.map(([it, i]) => CARDS[TAB](it, i)).join('');
    }
  } else html += list.map((it, i) => CARDS[TAB](it, i)).join('');
  if (!list.length) html += `<p class="tip">لا توجد أصناف بعد. اضغط "إضافة".</p>`;
  c.innerHTML = html;
  renderTabs();
}

/* ---------------- editing ---------------- */
const content = $('#content');
content.addEventListener('input', e => {
  if (e.target.id === 'ordersSearchInp') {
    ordersSearch = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { loadOrders(); }, 350);
    return;
  }
  const bf = e.target.dataset.bf;
  if (bf && e.target.dataset.bi != null) {
    const bi = Number(e.target.dataset.bi);
    const b = MENU.settings?.branches?.[bi];
    if (b) {
      b[bf] = e.target.value;
      setDirty(true);
    }
    return;
  }
  const zf = e.target.dataset.zf;
  if (zf && e.target.dataset.zi != null) {
    const zi = Number(e.target.dataset.zi);
    const z = MENU.settings?.delivery?.zones?.[zi];
    if (z) {
      z[zf] = e.target.type === 'number' ? (e.target.value === '' ? 0 : Number(e.target.value)) : e.target.value;
      setDirty(true);
    }
    return;
  }
  const s = e.target.dataset.s;
  if (s) {
    if (e.target.type === 'checkbox') return;
    setP(MENU.settings, s, e.target.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value);
    setDirty(true); return;
  }
  const f = e.target.dataset.f; if (!f || e.target.dataset.t === 'check' || e.target.dataset.t === 'select') return;
  const it = MENU[TAB]?.[e.target.dataset.i]; if (!it) return; let v = e.target.value;
  if (e.target.dataset.t === 'number') v = v === '' ? undefined : Number(v);
  setP(it, f, v);
  if (f.startsWith('s.')) { const has = Object.values(it.s || {}).some(x => x !== undefined && x !== ''); if (!has) it.s = null; }
  setDirty(true);
});
content.addEventListener('change', e => {
  if (e.target.dataset.act === 'ord-change-status') {
    const sel = e.target;
    const stVal = sel.value;
    if (!stVal) return;
    if (stVal === 'cancelled') {
      const reason = prompt('سبب الإلغاء (اختياري، سيصل في الرسالة للعميل):', '') ?? null;
      if (reason !== null) changeOrderStatus(sel.dataset.id, 'cancelled', reason);
      else sel.value = '';
    } else {
      changeOrderStatus(sel.dataset.id, stVal);
    }
    return;
  }
  const bf = e.target.dataset.bf;
  if (bf === 'enabled' && e.target.dataset.bi != null) {
    const bi = Number(e.target.dataset.bi);
    const b = MENU.settings?.branches?.[bi];
    if (b) {
      b.enabled = e.target.checked;
      setDirty(true);
    }
    return;
  }
  const zf = e.target.dataset.zf;
  if (zf === 'enabled' && e.target.dataset.zi != null) {
    const zi = Number(e.target.dataset.zi);
    const z = MENU.settings?.delivery?.zones?.[zi];
    if (z) {
      z.enabled = e.target.checked;
      setDirty(true);
    }
    return;
  }
  const s = e.target.dataset.s; if (!s) return; if (e.target.type === 'checkbox') setP(MENU.settings, s, e.target.checked); else if (e.target.tagName === 'SELECT') setP(MENU.settings, s, e.target.value); else return; setDirty(true);
});
content.addEventListener('change', e => {
  const t = e.target; if (t.type === 'file') return upload(t);
  const f = t.dataset.f; if (!f) return;
  const it = MENU[TAB]?.[t.dataset.i]; if (!it) return;
  if (t.dataset.t === 'check') { setP(it, f, t.checked); setDirty(true); t.closest('.item,.compact')?.classList.toggle('is-hidden', f === 'hidden' ? t.checked : !!it.hidden); return; }
  if (t.dataset.t === 'select') {
    setP(it, f, t.value);
    if (f === 'group' && t.value === 'premium') { it.p = { Regular: it.p.Regular ?? it.p.L ?? '' }; it.s = null; }
    if (f === 'group' && t.value !== 'premium' && TAB === 'pizzas') it.p = { M: it.p.M ?? '', L: it.p.L ?? it.p.Regular ?? '', F: it.p.F ?? '' };
    if (f === 'group' && t.value !== 'premium' && TAB === 'pasta') it.p = { M: it.p.M ?? '', L: it.p.L ?? it.p.Regular ?? '' };
    setDirty(true); if (t.dataset.re) render();
  }
});
content.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a) { const pv = e.target.closest('.ib-prev'); if (pv) $('input[type=file]', pv.closest('.ib')).click(); return; }
  const act = a.dataset.act, list = MENU[TAB];
  if (act === 'chip-filter') {
    ordersFilter = a.dataset.v;
    loadOrders();
    return;
  }
  if (act === 'date-filter') {
    ordersDate = a.dataset.v;
    loadOrders();
    return;
  }
  if (act === 'toggle-sound') {
    soundEnabled = !soundEnabled;
    try { localStorage.setItem('admin_orders_sound', String(soundEnabled)); } catch {}
    renderOrders();
    return;
  }
  if (act === 'ord-refresh') {
    loadOrders();
    return;
  }
  if (act === 'ord-status') {
    changeOrderStatus(a.dataset.id, a.dataset.st);
    return;
  }
  if (act === 'ord-cancel') {
    const reason = prompt('سبب الإلغاء (اختياري، سيصل في الرسالة للعميل):', '') ?? null;
    if (reason !== null) {
      changeOrderStatus(a.dataset.id, 'cancelled', reason);
    }
    return;
  }
  if (act === 'ord-print') {
    const o = ORDERS.find(x => x.id === a.dataset.id);
    if (o) printOrderReceipt(o);
    return;
  }
  if (act === 'ord-delete') {
    const o = ORDERS.find(x => x.id === a.dataset.id);
    if (confirm(`حذف الطلب #${o?.number || ''} نهائيًا؟`)) {
      deleteOrder(a.dataset.id);
    }
    return;
  }
  if (act === 'branch-add') {
    MENU.settings.branches = MENU.settings.branches || [];
    MENU.settings.branches.push({ id: uid('branch'), name: '', en: '', whatsapp: '', enabled: true });
    setDirty(true); render();
    const inputs = $$('input[data-bf="name"]');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    return;
  }
  if (act === 'branch-del') {
    const bi = Number(a.dataset.bi);
    const b = MENU.settings?.branches?.[bi];
    if (confirm(`حذف فرع "${b?.name || b?.en || 'هذا الفرع'}"؟`)) {
      MENU.settings.branches.splice(bi, 1);
      setDirty(true); render();
    }
    return;
  }
  if (act === 'branch-up' || act === 'branch-down') {
    const bi = Number(a.dataset.bi);
    const bList = MENU.settings?.branches || [];
    const targetIdx = act === 'branch-up' ? bi - 1 : bi + 1;
    if (targetIdx >= 0 && targetIdx < bList.length) {
      [bList[bi], bList[targetIdx]] = [bList[targetIdx], bList[bi]];
      setDirty(true); render();
    }
    return;
  }
  if (act === 'zone-add') {
    MENU.settings.delivery = MENU.settings.delivery || { enabled: true, fee: 0, zones: [] };
    MENU.settings.delivery.zones = MENU.settings.delivery.zones || [];
    MENU.settings.delivery.zones.push({ id: uid('zone'), name: '', en: '', fee: 0, enabled: true });
    setDirty(true); render();
    const inputs = $$('input[data-zf="name"]');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    return;
  }
  if (act === 'zone-del') {
    const zi = Number(a.dataset.zi);
    const z = MENU.settings?.delivery?.zones?.[zi];
    if (confirm(`حذف منطقة "${z?.name || z?.en || 'هذه المنطقة'}"؟`)) {
      MENU.settings.delivery.zones.splice(zi, 1);
      setDirty(true); render();
    }
    return;
  }
  if (act === 'zone-up' || act === 'zone-down') {
    const zi = Number(a.dataset.zi);
    const zList = MENU.settings?.delivery?.zones || [];
    const targetIdx = act === 'zone-up' ? zi - 1 : zi + 1;
    if (targetIdx >= 0 && targetIdx < zList.length) {
      [zList[zi], zList[targetIdx]] = [zList[targetIdx], zList[zi]];
      setDirty(true); render();
    }
    return;
  }
  if (act === 'zone-quick') {
    const ta = $('#zoneQuickText');
    if (!ta) return;
    const lines = ta.value.split('\n');
    let added = 0;
    MENU.settings.delivery = MENU.settings.delivery || { enabled: true, fee: 0, zones: [] };
    MENU.settings.delivery.zones = MENU.settings.delivery.zones || [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split(/[,،]/);
      if (parts.length < 2) continue;
      const feeStr = parts.pop().trim();
      const name = parts.join(',').trim();
      const feeNum = Number(feeStr);
      if (!name || isNaN(feeNum) || feeNum < 0) continue;
      MENU.settings.delivery.zones.push({
        id: uid('zone'),
        name,
        en: '',
        fee: Math.round(feeNum * 100) / 100,
        enabled: true
      });
      added++;
    }
    if (added > 0) {
      setDirty(true); render();
      toast(`تمت إضافة ${added} مناطق بنجاح ✓`);
    } else {
      toast('لم يتم العثور على أسطر صالحة للإضافة', true);
    }
    return;
  }
  if (act === 'add') { list.push(NEW[TAB]()); setDirty(true); render(); const cards = $$('.item,.compact'); cards[cards.length - 1]?.scrollIntoView({ block: 'center' }); const first = $$('input[data-f="en"]').pop(); first?.focus(); return; }
  if (act === 'pick') return $('input[type=file]', a.closest('.ib')).click();
  if (act === 'rmimg') { const ib = a.closest('.ib'); setP(target(ib.dataset.i), ib.dataset.slot, null); setDirty(true); render(); return; }
  const i = Number(a.dataset.i);
  if (act === 'del') { if (confirm(`حذف "${list[i].en || 'هذا الصنف'}"؟`)) { list.splice(i, 1); setDirty(true); render(); } return; }
  if (act === 'up' || act === 'down') {
    const b = bucket(TAB, list[i]); let j = i + (act === 'up' ? -1 : 1);
    while (list[j] && GROUPS[TAB] && bucket(TAB, list[j]) !== b) j += act === 'up' ? -1 : 1;
    if (!list[j]) return; [list[i], list[j]] = [list[j], list[i]]; setDirty(true); render();
  }
});

/* ---------------- image upload (click or drag & drop) ---------------- */
async function upload(input) {
  const file = input.files[0]; if (!file) return;
  const ib = input.closest('.ib'), prev = $('.ib-prev', ib);
  if (file.size > 25 * 1024 * 1024) { toast('الملف أكبر من 25MB', true); input.value = ''; return; }
  prev.classList.add('busy');
  try {
    const fd = new FormData(); fd.append('file', file);
    const r = await api('/api/admin/upload', { method: 'POST', body: fd });
    setP(target(ib.dataset.i), ib.dataset.slot, { src: r.src, md: r.md, th: r.th, w: r.w, h: r.h, cutout: r.cutout });
    setDirty(true); render();
    toast(r.origW < 1000 ? `تم الرفع، لكن الصورة صغيرة (${r.origW}px). الأفضل 1500px أو أكثر` : 'تم رفع الصورة ✓ — لا تنسى الحفظ', r.origW < 1000);
  } catch (e) { toast(e.message, true); prev.classList.remove('busy'); }
  input.value = '';
}
['dragenter', 'dragover'].forEach(ev => content.addEventListener(ev, e => { const p = e.target.closest('.ib-prev'); if (p) { e.preventDefault(); p.classList.add('drag'); } }));
['dragleave', 'drop'].forEach(ev => content.addEventListener(ev, e => { const p = e.target.closest('.ib-prev'); if (p) p.classList.remove('drag'); }));
content.addEventListener('drop', e => {
  const p = e.target.closest('.ib-prev'); if (!p) return; e.preventDefault();
  const f = e.dataTransfer.files[0]; if (!f) return; const inpt = $('input[type=file]', p.closest('.ib'));
  const dt = new DataTransfer(); dt.items.add(f); inpt.files = dt.files; upload(inpt);
});
