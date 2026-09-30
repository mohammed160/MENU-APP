/* =====================================================================
   Customer menu – loads /api/menu (edited from the dashboard), cart, extras
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

const SIZE_LABEL = { M: { en: 'Medium', ar: 'وسط' }, L: { en: 'Large', ar: 'كبير' }, F: { en: 'Family', ar: 'عائلي' } };
const PASTA_TYPES = [{ id: 'penne', en: 'Penne', ar: 'بنه' }, { id: 'fettuccine', en: 'Fettuccine', ar: 'فوتوتشيني' }];
const CATS = [{ id: 'toppings', en: 'Toppings', ar: 'إضافات' }, { id: 'cheese', en: 'Cheese', ar: 'جبنة' }, { id: 'sauces', en: 'Sauces', ar: 'صوصات' }];
let MENU = null, CUR = 'EGP';
const visible = a => (a || []).filter(x => !x.hidden);
const im = (i, k = 'md') => (i ? i[k] || i.src : '');
const cur = n => `${money(n)} ${CUR}`;

/* ---------- toast ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

/* ---------- picture block ---------- */
function picHTML(image, alt) {
  if (!image) return `<div class="pic"><span class="stripe"></span><div class="noimg">${esc(alt)}</div></div>`;
  return `<div class="pic${image.cutout ? '' : ' photo'}"><span class="stripe"></span><img src="${esc(im(image))}" alt="${esc(alt)}" loading="lazy"></div>`;
}

/* ---------- pasta illustration (only when no photo was uploaded) ---------- */
function rng(seed) { let h = 2166136261; for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; }; }
function pastaSVG(it, type) {
  const r = rng(it.id + type), pc = '#eccb78', pd = '#c79a3d', sc = it.sauce || '#e0a21b';
  const dome = x => 54 * Math.sqrt(Math.max(0, 1 - ((x - 130) / 90) ** 2));
  let s = `<svg viewBox="0 0 260 190" role="img" aria-label="${esc(it.en)}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="130" cy="180" rx="84" ry="7" fill="rgba(0,0,0,.2)"/><path d="M22 116 Q30 174 130 178 Q230 174 238 116 Z" fill="#fff" stroke="#d8d8d8"/><ellipse cx="130" cy="116" rx="108" ry="32" fill="#f6f6f6" stroke="#d8d8d8"/><ellipse cx="130" cy="116" rx="94" ry="25" fill="${sc}" opacity=".92"/>`;
  if (type === 'penne') {
    const t = []; for (let i = 0; i < 80; i++) { const x = 130 + (r() * 2 - 1) * 84; t.push([x, 118 - r() * dome(x) * .95, r() * 180]); }
    t.sort((a, b) => a[1] - b[1]).forEach(([x, y, a]) => { s += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a.toFixed(0)})"><rect x="-10" y="-4.5" width="20" height="9" rx="4.5" fill="${pc}" stroke="${pd}"/><rect x="-10" y="-4.5" width="20" height="9" rx="4.5" fill="${sc}" opacity=".38"/><ellipse cx="-9" cy="0" rx="2" ry="3" fill="${pd}" opacity=".7"/></g>`; });
  } else {
    for (let i = 0; i < 26; i++) {
      const x0 = 130 + (r() * 2 - 1) * 70, x1 = 130 + (r() * 2 - 1) * 70, c1x = x0 + (r() * 2 - 1) * 45, c2x = x1 + (r() * 2 - 1) * 45;
      const d = `M${x0.toFixed(1)} ${(116 + r() * 4).toFixed(1)} C${c1x.toFixed(1)} ${(116 - dome(c1x) * (.6 + r() * .9)).toFixed(1)} ${c2x.toFixed(1)} ${(116 - dome(c2x) * (.6 + r() * .9)).toFixed(1)} ${x1.toFixed(1)} ${(116 + r() * 4).toFixed(1)}`;
      s += `<path d="${d}" fill="none" stroke="${pd}" stroke-width="8" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${pc}" stroke-width="6" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${sc}" stroke-width="3" stroke-linecap="round" opacity=".42"/>`;
    }
  }
  return s + '</svg>';
}

/* =====================================================================
   Customize sheet – photo, extras, note, quantity → adds a line to the cart
   ===================================================================== */
const sheet = $('#sheet'), drawer = $('#drawer');
[sheet, drawer].forEach(d => {
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => { if (!sheet.open && !drawer.open) document.body.style.overflow = ''; });
});
const lockBody = () => { document.body.style.overflow = 'hidden'; };

function openSheet(o) {
  const extras = visible(MENU.extras);
  const chosen = new Set(); let qty = 1;
  const photo = o.image
    ? `<div class="sh-photo${o.image.cutout ? '' : ' cover'}"><span class="stripe"></span><img src="${esc(im(o.image, 'src'))}" alt="${esc(o.en)}"></div>`
    : (o.svg ? `<div class="sh-photo"><span class="stripe"></span>${o.svg}</div>` : '');
  const groups = CATS.map(c => ({ ...c, items: extras.filter(x => x.cat === c.id) })).filter(g => g.items.length);
  sheet.innerHTML = `
    <div class="sh-head"><h3>${esc(o.en)} <span class="ar">${esc(o.ar)}</span></h3><button type="button" class="x" aria-label="Close" data-close>×</button></div>
    <div class="sh-scroll">
      ${photo}
      <div class="sh-detail"><span>${esc(o.detail || 'Regular')}</span><b>${cur(o.unit)}</b></div>
      ${groups.length ? `<p class="sh-title">Add extras <span class="ar">أضف إضافات</span></p>` : ''}
      ${groups.map(g => `<fieldset class="xg"><legend>${g.en} <span class="ar">${g.ar}</span></legend>
        ${g.items.map(x => `<label class="xr${x.soldOut ? ' so' : ''}"><input type="checkbox" value="${esc(x.id)}"${x.soldOut ? ' disabled' : ''}><span class="bx" aria-hidden="true"></span><span class="xn">${esc(x.en)}${x.soldOut ? ' (sold out)' : ''}</span><b>+${money(x.price)}</b></label>`).join('')}
      </fieldset>`).join('')}
      <label class="note"><span>Notes <span class="ar">ملاحظات</span></span><textarea maxlength="140" rows="2" placeholder="e.g. no olives"></textarea></label>
    </div>
    <div class="sh-foot">
      <div class="qty" role="group" aria-label="Quantity"><button type="button" data-q="-1" aria-label="Less">−</button><b id="shQty">1</b><button type="button" data-q="1" aria-label="More">+</button></div>
      <button type="button" class="add-btn big" id="shAdd"></button>
    </div>`;
  const calc = () => { const ex = extras.filter(x => chosen.has(x.id)); return { ex, unit: o.unit + ex.reduce((s, x) => s + x.price, 0) }; };
  const paint = () => { $('#shQty', sheet).textContent = qty; $('#shAdd', sheet).innerHTML = `Add to order · <b>${cur(calc().unit * qty)}</b>`; };
  sheet.onclick = e => {
    if (e.target === sheet || e.target.closest('[data-close]')) return sheet.close();
    const q = e.target.closest('[data-q]'); if (q) { qty = Math.max(1, Math.min(99, qty + Number(q.dataset.q))); paint(); }
  };
  $$('.xr input', sheet).forEach(cb => cb.onchange = () => { cb.checked ? chosen.add(cb.value) : chosen.delete(cb.value); paint(); });
  $('#shAdd', sheet).onclick = () => {
    const { ex, unit } = calc(), note = $('textarea', sheet).value.trim();
    Cart.add({ key: [o.key, ex.map(x => x.id).sort().join('+'), note].join('|'), en: o.en, ar: o.ar, detail: o.detail || '', detailMsg: o.detailMsg ?? '', detailAr: o.detailAr || '', unit, qty, note,
      extras: ex.map(x => ({ id: x.id, en: x.en, ar: x.ar || '', price: x.price })), image: o.image ? im(o.image, 'th') : '' });
    sheet.close(); toast(`Added: ${o.en}`);
  };
  paint(); lockBody(); sheet.showModal(); $('.sh-scroll', sheet).scrollTop = 0;
}

/* =====================================================================
   Pizza card (same layout as the printed menu)
   ===================================================================== */
function buildCard(it, premium = false) {
  const has = k => k in it.p;
  const cols = ['M', 'L', 'F'].filter(k => has(k) || (has('M') && has('L') && k === 'F'));
  const state = { size: has('L') ? 'L' : Object.keys(it.p)[0], stuffed: false };
  const root = el(`<article class="pz${premium ? ' prem' : ''}">${picHTML(it.image, it.en)}<h3>${esc(it.en)}</h3><p class="ar">${esc(it.ar)}</p><div class="pp"></div></article>`);
  const pp = $('.pp', root);
  const btn = (tbl, k, stuffed) => {
    if (!(k in tbl)) return `<span class="sp off"><small>${k}</small><b>-</b></span>`;
    const on = state.size === k && state.stuffed === stuffed;
    return `<button type="button" class="sp" data-k="${k}" data-s="${stuffed ? 1 : 0}" aria-pressed="${on}" aria-label="${SIZE_LABEL[k].en}${stuffed ? ', cheese stuffed' : ''} ${tbl[k]}"><small>${k}</small><b>${money(tbl[k])}</b></button>`;
  };
  function paint() {
    const tbl = state.stuffed && it.s ? it.s : it.p, unit = premium ? it.p.Regular : tbl[state.size];
    let h = '';
    if (premium) h += `<div class="price">${money(unit)}</div>`;
    else {
      const one = cols.length === 1 ? ' one' : '';
      h += `<div class="szrow${one}">${cols.map(k => btn(it.p, k, false)).join('')}</div>`;
      if (it.s) h += `<div class="stband"><div class="szrow${one}">${cols.map(k => btn(it.s, k, true)).join('')}</div><div class="stlbl">CHEESE STUFFED <span class="ar">حشو جبنة</span></div></div>`;
      h += `<div class="pick" aria-live="polite">${SIZE_LABEL[state.size].en}${state.stuffed ? ' · Stuffed' : ''} — <b>${money(unit)}</b></div>`;
    }
    h += it.soldOut ? `<div class="sold">Sold out <span class="ar">نفذت الكمية</span></div>` : `<button type="button" class="add-btn"><span class="l">Add to order</span><span class="s">Add</span><span class="ar">أضف للطلب</span></button>`;
    pp.innerHTML = h;
    $$('button.sp', pp).forEach(b => b.onclick = () => { state.size = b.dataset.k; state.stuffed = b.dataset.s === '1'; paint(); });
    const add = $('.add-btn', pp);
    if (add) add.onclick = () => openSheet({
      key: `pizza:${it.id}:${premium ? 'R' : state.size}:${state.stuffed ? 1 : 0}`, en: it.en, ar: it.ar, image: it.image, unit,
      detail: premium ? 'Regular' : `${SIZE_LABEL[state.size].en} · ${SIZE_LABEL[state.size].ar}${state.stuffed ? ' · Cheese stuffed' : ''}`,
      detailMsg: premium ? '' : `${SIZE_LABEL[state.size].en}${state.stuffed ? ' · Cheese stuffed' : ''}`,
      detailAr: premium ? '' : `${SIZE_LABEL[state.size].ar}${state.stuffed ? ' · حشو جبنة' : ''}`
    });
  }
  paint(); return root;
}

/* =====================================================================
   Pasta accordion – photo opens underneath with size + pasta type
   ===================================================================== */
let openItem = null;
function closeItem(it) { it.classList.remove('open'); $('.it-head', it).setAttribute('aria-expanded', 'false'); $('.it-panel', it).inert = true; }
function toggleItem(it) {
  const willOpen = !it.classList.contains('open');
  if (openItem && openItem !== it) closeItem(openItem);
  if (willOpen) { it.classList.add('open'); $('.it-head', it).setAttribute('aria-expanded', 'true'); $('.it-panel', it).inert = false; openItem = it; setTimeout(() => it.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 320); }
  else { closeItem(it); openItem = null; }
}
const pill = (main, sub, pressed) => `<button type="button" class="pl" aria-pressed="${pressed}"><b>${esc(main)}</b><small>${esc(sub)}</small></button>`;
const pastaImg = (it, type) => (it.images && (it.images[type] || it.images.penne || it.images.fettuccine)) || null;

function buildPasta(it) {
  const sizes = Object.keys(it.p), types = PASTA_TYPES;
  const state = { size: sizes.includes('L') ? 'L' : sizes[0], type: 'penne' };
  const min = Math.min(...Object.values(it.p));
  const root = el(`<div class="it">
    <button type="button" class="it-head" aria-expanded="false" aria-controls="pn-${esc(it.id)}">
      <span class="nm"><b>${esc(it.en)}</b><span class="ar">${esc(it.ar)}</span></span>
      <span class="from">${sizes.length > 1 ? 'from ' : ''}<b>${money(min)}</b></span><span class="chev" aria-hidden="true"></span>
    </button>
    <div class="it-panel" id="pn-${esc(it.id)}" role="region" aria-label="${esc(it.en)}" inert><div class="it-clip"><div class="it-body">
      <div class="pic"><span class="stripe"></span><div class="ph"></div></div><div class="opts"></div></div></div></div>`);
  const ph = $('.ph', root), opts = $('.opts', root), pic = $('.pic', root);
  function photo() { const i = pastaImg(it, state.type); pic.classList.toggle('photo', !!i && !i.cutout); ph.innerHTML = i ? `<img src="${esc(im(i, 'md'))}" alt="${esc(it.en)}" loading="lazy">` : pastaSVG(it, state.type); }
  function paint() {
    const unit = it.p[state.size], sl = SIZE_LABEL[state.size], tp = types.find(t => t.id === state.type);
    let h = `<div class="grp"><div class="lbl">Pasta type <span class="ar">نوع المكرونة</span></div><div class="pills" data-g="type">${types.map(t => pill(t.en, t.ar, state.type === t.id)).join('')}</div></div>`;
    if (sizes.some(k => k in SIZE_LABEL)) h += `<div class="grp"><div class="lbl">Size <span class="ar">المقاس</span></div><div class="pills" data-g="size">${sizes.map(k => pill(money(it.p[k]), SIZE_LABEL[k].en, state.size === k)).join('')}</div></div>`;
    h += `<div class="sum" aria-live="polite"><span>${sl ? `${sl.en} · ${sl.ar} · ` : ''}${tp.en}</span><b>${money(unit)}</b></div>`;
    h += it.soldOut ? `<div class="sold">Sold out <span class="ar">نفذت الكمية</span></div>` : `<button type="button" class="add-btn"><span class="l">Add to order</span><span class="s">Add</span><span class="ar">أضف للطلب</span></button>`;
    opts.innerHTML = h;
    $$('[data-g="size"] .pl', opts).forEach((b, i) => b.onclick = () => { state.size = sizes[i]; paint(); });
    $$('[data-g="type"] .pl', opts).forEach((b, i) => b.onclick = () => { state.type = types[i].id; paint(); photo(); });
    const add = $('.add-btn', opts);
    if (add) add.onclick = () => openSheet({ key: `pasta:${it.id}:${state.type}:${state.size}`, en: it.en, ar: it.ar, image: pastaImg(it, state.type), svg: pastaImg(it, state.type) ? '' : pastaSVG(it, state.type), unit,
      detail: `${tp.en} · ${tp.ar}${sl ? ` · ${sl.en} · ${sl.ar}` : ''}`, detailMsg: `${tp.en}${sl ? ` · ${sl.en}` : ''}`,
      detailAr: `${tp.ar}${sl ? ` · ${sl.ar}` : ''}` });
  }
  $('.it-head', root).onclick = () => toggleItem(root);
  photo(); paint(); return root;
}

/* =====================================================================
   Direct add (+ / − stepper) for sides, extras and drinks
   ===================================================================== */
const DIRECT = {};
function adder(section, it) {
  const key = `d:${section}:${it.id}`;
  if (it.soldOut) return `<span class="sold-tag">Sold out</span>`;
  DIRECT[key] = { key, en: it.en, ar: it.ar || '', unit: it.price, image: it.image ? im(it.image, 'th') : '' };
  return `<span class="adder" data-key="${esc(key)}"></span>`;
}
function paintAdders() {
  $$('.adder').forEach(a => {
    const q = Cart.qtyOf(a.dataset.key), n = DIRECT[a.dataset.key]?.en || '';
    a.innerHTML = q ? `<button type="button" class="ad-minus" aria-label="Remove one ${esc(n)}">−</button><b>${q}</b><button type="button" class="ad-plus" aria-label="Add one ${esc(n)}">+</button>` : `<button type="button" class="ad-plus" aria-label="Add ${esc(n)}">+</button>`;
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('.adder button'); if (!b) return;
  const key = b.closest('.adder').dataset.key, d = DIRECT[key]; if (!d) return;
  if (b.classList.contains('ad-plus')) { Cart.add({ key, en: d.en, ar: d.ar, detail: '', detailMsg: '', detailAr: '', unit: d.unit, qty: 1, note: '', extras: [], image: d.image }); if (!Cart.qtyOf(key) || Cart.qtyOf(key) === 1) toast(`Added: ${d.en}`); }
  else Cart.setQty(key, Cart.qtyOf(key) - 1);
});

const rowHTML = (section, it, cls = '') => `<div class="li ${cls}">${it.image ? `<img class="th" src="${esc(im(it.image, 'th'))}" alt="" loading="lazy">` : ''}<span class="lt">${esc(it.en)}${it.ar ? ` <span class="ar">${esc(it.ar)}</span>` : ''}</span><b>${money(it.price)}</b>${adder(section, it)}</div>`;

/* =====================================================================
   Cart bar + drawer
   ===================================================================== */
function paintBar() {
  const n = Cart.count(), bar = $('#cartBar');
  bar.hidden = n === 0; $('#cbCount').textContent = n; $('#cbTotal').textContent = cur(Cart.total());
  document.body.classList.toggle('has-cart', n > 0);
}
function paintDrawer() {
  if (Checkout.view !== 'cart') return Checkout.paint();
  const L = Cart.lines;
  drawer.innerHTML = `
    <div class="sh-head"><h3>Your order <span class="ar">طلبك</span></h3><button type="button" class="x" aria-label="Close" data-close>×</button></div>
    <div class="sh-scroll">${L.length ? L.map(l => `
      <div class="cl" data-key="${esc(l.key)}">
        ${l.image ? `<img src="${esc(l.image)}" alt="">` : '<span class="ph0"></span>'}
        <div class="cl-main"><b>${esc(l.en)}</b> ${l.ar ? `<span class="ar">${esc(l.ar)}</span>` : ''}
          ${l.detail ? `<div class="cl-d">${esc(l.detail)}</div>` : ''}
          ${l.extras.map(x => `<div class="cl-x">+ ${esc(x.en)} <i>${money(x.price)}</i></div>`).join('')}
          ${l.note ? `<div class="cl-n">“${esc(l.note)}”</div>` : ''}
          <div class="qty sm"><button type="button" data-d="-1" aria-label="Less">−</button><b>${l.qty}</b><button type="button" data-d="1" aria-label="More">+</button></div>
        </div>
        <div class="cl-p">${money(Cart.lineTotal(l))}</div>
      </div>`).join('') : `<p class="empty">Your order is empty.<br><span class="ar">طلبك فاضي، اختار من المنيو</span></p>`}</div>
    ${L.length ? `<div class="dr-foot">
      <div class="dr-total"><span>Total <span class="ar">الإجمالي</span></span><b>${cur(Cart.total())}</b></div>
      <button type="button" class="send go" data-co="checkout">Checkout <span class="ar">إتمام الطلب</span></button>
      <p class="soon"><button type="button" class="link" data-clear>Clear order <span class="ar">مسح الطلب</span></button></p>
    </div>` : ''}`;
}
drawer.addEventListener('click', e => {
  if (e.target === drawer || e.target.closest('[data-close]')) return drawer.close();
  if (e.target.closest('[data-clear]')) { Cart.clear(); return; }
  const d = e.target.closest('[data-d]'); if (!d) return;
  const key = d.closest('.cl').dataset.key; Cart.setQty(key, Cart.qtyOf(key) + Number(d.dataset.d));
});
$('#cartBar').onclick = () => { Checkout.reset(); paintDrawer(); lockBody(); drawer.showModal(); };
drawer.addEventListener('close', () => Checkout.reset());
document.addEventListener('cart', () => { paintBar(); paintAdders(); if (drawer.open) paintDrawer(); });

/* =====================================================================
   Render everything from the menu
   ===================================================================== */
function render() {
  const pz = visible(MENU.pizzas), by = g => pz.filter(x => x.group === g);
  const fillGrid = (id, list, prem) => { const b = $(id); b.innerHTML = ''; list.forEach(p => b.appendChild(buildCard(p, prem))); };
  fillGrid('#pizzaGridA', by('signature')); fillGrid('#premGrid', by('premium'), true); fillGrid('#pizzaGridB', by('classic'));
  $('#premSection').hidden = !by('premium').length; $('#pizzaGridB').closest('section').hidden = !by('classic').length;

  const pa = visible(MENU.pasta);
  const pl = $('#pastaList'); pl.innerHTML = ''; pa.filter(x => x.group !== 'premium').forEach(p => pl.appendChild(buildPasta(p)));
  const pp = $('#pastaPremList'); pp.innerHTML = ''; pa.filter(x => x.group === 'premium').forEach(p => pp.appendChild(buildPasta(p)));
  $('#pastaBand').hidden = !pa.some(x => x.group === 'premium');

  const sides = visible(MENU.sides);
  const col = c => { const a = sides.filter(x => x.col === c); const n = a.filter(x => !x.hl), h = a.filter(x => x.hl);
    return n.map(x => rowHTML('sides', x)).join('') + (n.length && h.length ? '<div style="height:10px"></div>' : '') + h.map((x, i) => rowHTML('sides', x, 'hl' + (i === 0 ? ' first' : '') + (i === h.length - 1 ? ' last' : ''))).join(''); };
  $('#sidesCols').innerHTML = `<div>${col('L')}</div><div>${col('R')}</div>`;
  $('#extraGrid').innerHTML = visible(MENU.extras).map(x => rowHTML('extras', x)).join('');
  $('#drinkList').innerHTML = visible(MENU.drinks).map(x => `<li>${x.image ? `<img class="th" src="${esc(im(x.image, 'th'))}" alt="">` : ''}<span>${esc(x.en)}${x.ar ? ` <span class="ar">${esc(x.ar)}</span>` : ''}</span><span class="dp">${money(x.price)}</span>${adder('drinks', x)}</li>`).join('');
  renderBrand();
  paintAdders(); paintBar();
}

/* ---------- restaurant logo / name ---------- */
function renderBrand() {
  const st = MENU.settings || {}, b = $('#brand');
  if (st.theme === 'light' || st.theme === 'dark') document.documentElement.dataset.theme = st.theme; else delete document.documentElement.dataset.theme;
  if (st.restaurant) document.title = `${st.restaurant} | Menu`;
  if (st.logo) { const f = $('#favicon'); f.href = im(st.logo, 'th'); f.type = 'image/webp'; }
  if (st.logo) b.innerHTML = `<a href="#" aria-label="${esc(st.restaurant || 'Home')}"><img src="${esc(im(st.logo, 'src'))}" alt="${esc(st.restaurant || 'Logo')}" width="${st.logo.w || ''}" height="${st.logo.h || ''}"></a>`;
  else if (st.restaurant) b.innerHTML = `<span class="wm">${esc(st.restaurant)}</span>`;
  b.hidden = !(st.logo || st.restaurant);
}

/* nav highlight */
const links = $$('.nav a'), navEl = $('.nav');
const targets = links.map(a => $(a.getAttribute('href')));
let spyRaf = 0;
let forced = null;                 // a nav tap wins until the visitor scrolls by hand
const navWrap = $('.nav-in');
function centerLink(l) {          // scroll only the nav strip sideways (never the page)
  if (navWrap.scrollWidth <= navWrap.clientWidth + 2) return;
  navWrap.scrollTo({ left: l.offsetLeft - (navWrap.clientWidth - l.offsetWidth) / 2, behavior: 'smooth' });
}
function spy() {
  spyRaf = 0;
  const line = navEl.offsetHeight + innerHeight * 0.3; let cur = 0;
  targets.forEach((t, i) => { if (t && t.getBoundingClientRect().top <= line) cur = i; });
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = targets.length - 1;
  if (forced !== null) cur = forced;
  links.forEach((l, i) => { const on = i === cur; if (on !== l.classList.contains('on')) { l.classList.toggle('on', on); if (on) centerLink(l); } });
}
addEventListener('scroll', () => { if (!spyRaf) spyRaf = requestAnimationFrame(spy); }, { passive: true });
addEventListener('resize', spy);
links.forEach((l, i) => l.addEventListener('click', () => { forced = i; spy(); }));
['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(ev => addEventListener(ev, e => { if (forced !== null && !(e.target.closest && e.target.closest('.nav a'))) { forced = null; } }, { passive: true }));

fetch('/api/menu', { cache: 'no-store' }).then(r => r.json()).then(m => { MENU = m; CUR = m.settings?.currency || 'EGP'; render(); spy(); })
  .catch(() => { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:40px;text-align:center;font-weight:700">Could not load the menu. Please refresh.</p>'); });
