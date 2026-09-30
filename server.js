/* Dynamic menu server: public menu + admin dashboard + high-quality image uploads */
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('menu-secret:' + ADMIN_PASSWORD).digest('hex');
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'menu.json');
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(PUBLIC, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
if (!fs.existsSync(DATA_FILE)) require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'seed.js')], { stdio: 'inherit' });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

/* ---------- tiny cookie session (HMAC-signed, httpOnly) ---------- */
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const makeToken = () => { const exp = String(Date.now() + 12 * 3600 * 1000); return exp + '.' + sign(exp); };
function validToken(t) {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(s => s.trim().split('=')).find(([k]) => k === name)?.[1];
const requireAuth = (req, res, next) => validToken(cookie(req, 'adm')) ? next() : res.status(401).json({ error: 'Not signed in' });

const attempts = new Map();               // ip -> {n, t}
function limited(ip) { const now = Date.now(), a = attempts.get(ip); if (!a || now - a.t > 15 * 60e3) { attempts.set(ip, { n: 0, t: now }); return false; } return a.n >= 10; }

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  if (limited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const given = Buffer.from(String((req.body || {}).password || '')), real = Buffer.from(ADMIN_PASSWORD);
  const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
  if (!ok) { attempts.get(ip).n++; return res.status(401).json({ error: 'Wrong password' }); }
  attempts.delete(ip);
  res.setHeader('Set-Cookie', `adm=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { res.setHeader('Set-Cookie', 'adm=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/admin/me', requireAuth, (req, res) => res.json({ ok: true }));

/* ---------- menu storage ---------- */
const readMenu = () => { const m = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); m.settings = cleanSettings(m.settings, false); return m; };
function writeMenu(menu) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(menu, null, 2));
  fs.renameSync(tmp, DATA_FILE);                         // atomic swap
}
const str = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : undefined; };
const prices = o => { const r = {}; for (const k of ['M', 'L', 'F', 'Regular']) { const n = num(o?.[k]); if (o && o[k] !== '' && o[k] != null && n !== undefined) r[k] = n; } return r; };
const IMG = /^\/(uploads|images)\/[\w./-]+$/;
function image(i) {
  if (!i || !IMG.test(i.src || '')) return null;
  const ok = u => (IMG.test(u || '') ? u : i.src);
  return { src: i.src, md: ok(i.md), th: ok(i.th), w: num(i.w), h: num(i.h), cutout: !!i.cutout, legacy: !!i.legacy };
}
const id = (v, fallback) => (str(v, 60).toLowerCase().replace(/[^a-z0-9-]/g, '') || fallback);
const list = (a, f) => (Array.isArray(a) ? a.slice(0, 300).map(f) : []);

const httpUrl = v => { try { const u = new URL(String(v || '').trim()); return /^https?:$/.test(u.protocol) ? u.href.slice(0, 300) : ''; } catch { return ''; } };
const waNumber = v => { let d = String(v || '').replace(/[^\d]/g, ''); if (d.startsWith('00')) d = d.slice(2); if (/^01[0125]\d{8}$/.test(d)) d = '20' + d.slice(1); return d.slice(0, 15); };
const bad = msg => { const e = new Error(msg); e.status = 400; return e; };

/* strict = true on save (throws a readable error); false on read (just fills defaults) */
function cleanSettings(S = {}, strict = false) {
  const P = S.payments || {};
  const D = S.delivery || {};
  const rawZones = Array.isArray(D.zones) ? D.zones.slice(0, 200) : [];
  const seenIds = new Set();
  const zones = [];
  for (let i = 0; i < rawZones.length; i++) {
    const z = rawZones[i] || {};
    const name = str(z.name, 60);
    const en = str(z.en, 60);
    if (strict && !name) throw bad('اكتب اسم لكل منطقة توصيل');
    let zid = str(z.id, 60).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!zid || seenIds.has(zid)) {
      zid = 'zone-' + crypto.randomBytes(3).toString('hex');
      while (seenIds.has(zid)) zid = 'zone-' + crypto.randomBytes(3).toString('hex');
    }
    seenIds.add(zid);
    zones.push({
      id: zid,
      name,
      en,
      fee: num(z.fee) ?? 0,
      enabled: z.enabled !== false
    });
  }

  const DEFAULT_BRANCHES = [
    { id: 'branch-kafr-eldawar', name: 'فرع 1 كفرالدوار', en: 'Branch 1 Kafr El-Dawar', whatsapp: '', enabled: true },
    { id: 'branch-alex-smouha', name: 'فرع 2 الاسكندرية سموحة', en: 'Branch 2 Alexandria Smouha', whatsapp: '', enabled: true }
  ];
  const rawBranches = Array.isArray(S.branches) ? S.branches.slice(0, 50) : (S.branches === undefined ? DEFAULT_BRANCHES : []);
  const seenBIds = new Set();
  const branches = [];
  for (let i = 0; i < rawBranches.length; i++) {
    const b = rawBranches[i] || {};
    const name = str(b.name, 80);
    const en = str(b.en, 80);
    if (strict && !name) throw bad('اكتب اسم لكل فرع');
    let bid = str(b.id, 60).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!bid || seenBIds.has(bid)) {
      bid = 'branch-' + crypto.randomBytes(3).toString('hex');
      while (seenBIds.has(bid)) bid = 'branch-' + crypto.randomBytes(3).toString('hex');
    }
    seenBIds.add(bid);
    branches.push({
      id: bid,
      name,
      en,
      whatsapp: waNumber(b.whatsapp),
      enabled: b.enabled !== false
    });
  }

  const out = {
    currency: str(S.currency, 8) || 'EGP',
    restaurant: str(S.restaurant),
    whatsapp: waNumber(S.whatsapp),
    logo: image(S.logo),
    theme: ['auto', 'light', 'dark'].includes(S.theme) ? S.theme : 'auto',
    branches,
    delivery: { enabled: D.enabled !== false, fee: num(D.fee) ?? 0, zones },
    takeaway: { enabled: S.takeaway?.enabled !== false },
    payments: {
      cod: { enabled: P.cod?.enabled !== false },
      instapay: { enabled: !!P.instapay?.enabled, handle: str(P.instapay?.handle, 80), link: httpUrl(P.instapay?.link) },
      wallet: { enabled: !!P.wallet?.enabled, label: str(P.wallet?.label, 40) || 'Mobile wallet', number: str(P.wallet?.number, 20).replace(/[^\d+]/g, ''), holder: str(P.wallet?.holder, 60), link: httpUrl(P.wallet?.link) }
    }
  };
  if (!out.delivery.enabled && !out.takeaway.enabled) out.delivery.enabled = true;
  if (strict && out.delivery.enabled && zones.length > 0 && !zones.some(z => z.enabled)) {
    throw bad('فعّل منطقة توصيل واحدة على الأقل');
  }
  if (strict && branches.length > 0 && !branches.some(b => b.enabled)) {
    throw bad('فعّل فرعاً واحداً على الأقل');
  }
  const p = out.payments;
  if (p.instapay.enabled && !p.instapay.handle && !p.instapay.link) { if (strict) throw bad('انستا باي: اكتب عنوان انستا باي أو رابط التحويل'); p.instapay.enabled = false; }
  if (p.wallet.enabled && !p.wallet.number && !p.wallet.link) { if (strict) throw bad('المحفظة: اكتب رقم المحفظة أو رابط التحويل'); p.wallet.enabled = false; }
  if (!p.cod.enabled && !p.instapay.enabled && !p.wallet.enabled) { if (strict) throw bad('لازم تفعّل طريقة دفع واحدة على الأقل'); p.cod.enabled = true; }
  if (strict && S.whatsapp && out.whatsapp.length < 10) throw bad('رقم الواتساب غير صحيح');
  return out;
}

function clean(m) {
  const cats = ['toppings', 'cheese', 'sauces'];
  return {
    version: Date.now(),
    settings: cleanSettings(m.settings, true),
    pizzas: list(m.pizzas, (x, i) => ({
      id: id(x.id, 'pizza-' + i), en: str(x.en), ar: str(x.ar), group: ['signature', 'classic', 'premium'].includes(x.group) ? x.group : 'classic',
      p: prices(x.p), s: x.s && Object.keys(prices(x.s)).length ? prices(x.s) : null, image: image(x.image), hidden: !!x.hidden, soldOut: !!x.soldOut
    })),
    pasta: list(m.pasta, (x, i) => ({
      id: id(x.id, 'pasta-' + i), en: str(x.en), ar: str(x.ar), group: x.group === 'premium' ? 'premium' : 'regular', p: prices(x.p),
      sauce: /^#[0-9a-f]{6}$/i.test(x.sauce || '') ? x.sauce : '#e0a21b',
      images: { penne: image(x.images?.penne), fettuccine: image(x.images?.fettuccine) }, hidden: !!x.hidden, soldOut: !!x.soldOut
    })),
    sides: list(m.sides, (x, i) => ({ id: id(x.id, 'side-' + i), en: str(x.en), ar: str(x.ar), price: num(x.price) ?? 0, col: x.col === 'R' ? 'R' : 'L', hl: !!x.hl, image: image(x.image), hidden: !!x.hidden, soldOut: !!x.soldOut })),
    extras: list(m.extras, (x, i) => ({ id: id(x.id, 'extra-' + i), en: str(x.en), ar: str(x.ar), price: num(x.price) ?? 0, cat: cats.includes(x.cat) ? x.cat : 'toppings', hidden: !!x.hidden, soldOut: !!x.soldOut })),
    drinks: list(m.drinks, (x, i) => ({ id: id(x.id, 'drink-' + i), en: str(x.en), ar: str(x.ar), price: num(x.price) ?? 0, image: image(x.image), hidden: !!x.hidden, soldOut: !!x.soldOut }))
  };
}

app.get('/api/menu', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(readMenu()); });
app.get('/api/admin/menu', requireAuth, (req, res) => res.json(readMenu()));
app.put('/api/admin/menu', requireAuth, (req, res) => {
  try {
    const m = clean(req.body || {});
    if (m.pizzas.some(x => !x.en) || m.pasta.some(x => !x.en) || m.sides.some(x => !x.en) || m.extras.some(x => !x.en) || m.drinks.some(x => !x.en))
      return res.status(400).json({ error: 'Every item needs an English name.' });
    writeMenu(m); collectGarbage(m);
    res.json(m);
  } catch (e) { if (e.status === 400) return res.status(400).json({ error: e.message }); console.error(e); res.status(500).json({ error: 'Could not save' }); }
});

/* ---------- high-quality image pipeline ----------
   Any JPG/PNG/WebP up to 25 MB → 3 WebP sizes (2000 / 900 / 400 px wide).
   Transparent PNGs keep their transparency (cut-out look on the orange stripe). */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/^image\/(jpeg|png|webp)$/.test(file.mimetype) ? cb(null, true) : cb(new Error('Use a JPG, PNG or WebP image'))) });

app.post('/api/admin/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 25 MB' : err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    try {
      const base = sharp(req.file.buffer, { failOn: 'none' }).rotate();          // respects phone orientation
      const meta = await sharp(req.file.buffer).metadata();
      if (!meta.width || !meta.height) throw new Error('Not a valid image');
      let cutout = false;
      if (meta.hasAlpha) { const st = await sharp(req.file.buffer).stats(); cutout = !!(st.channels[3] && st.channels[3].min < 250); }
      const name = crypto.randomBytes(8).toString('hex');
      const sizes = { src: [2000, 92], md: [900, 88], th: [400, 82] };
      const out = {};
      for (const [k, [w, q]] of Object.entries(sizes)) {
        const file = `${name}-${k}.webp`;
        const info = await base.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: q, alphaQuality: 100, effort: 5 }).toFile(path.join(UPLOADS, file));
        out[k] = '/uploads/' + file;
        if (k === 'src') { out.w = info.width; out.h = info.height; out.bytes = info.size; }
      }
      res.json({ ...out, cutout, origW: meta.width, origH: meta.height });
    } catch (e) { console.error(e); res.status(400).json({ error: 'Could not read this image. Try a JPG or PNG.' }); }
  });
});

/* remove uploaded files no longer used by the menu (only files older than 1 hour, so a fresh upload is never lost) */
function collectGarbage(menu) {
  const used = new Set(); const walk = o => { if (o && typeof o === 'object') Object.values(o).forEach(v => typeof v === 'string' && v.startsWith('/uploads/') ? used.add(path.basename(v)) : walk(v)); };
  walk(menu);
  for (const f of fs.readdirSync(UPLOADS)) { const p = path.join(UPLOADS, f); if (!used.has(f) && Date.now() - fs.statSync(p).mtimeMs > 3600e3) fs.unlink(p, () => {}); }
}

/* ---------- orders backend ---------- */
const ORDERS_FILE = path.join(ROOT, 'data', 'orders.json');
let ORDERS_DATA = { nextNumber: 1001, orders: [] };
try {
  if (fs.existsSync(ORDERS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    if (raw && typeof raw === 'object') {
      ORDERS_DATA = {
        nextNumber: Number(raw.nextNumber) || 1001,
        orders: Array.isArray(raw.orders) ? raw.orders : []
      };
    }
  }
} catch (e) {
  console.error('Could not load orders.json:', e);
}

let ordersSaveTimer = null;
function saveOrders() {
  clearTimeout(ordersSaveTimer);
  ordersSaveTimer = setTimeout(() => {
    try {
      const tmp = ORDERS_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(ORDERS_DATA, null, 2));
      fs.renameSync(tmp, ORDERS_FILE);
    } catch (e) {
      console.error('Error saving orders.json:', e);
    }
  }, 100);
}
function saveOrdersSync() {
  clearTimeout(ordersSaveTimer);
  try {
    const tmp = ORDERS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(ORDERS_DATA, null, 2));
    fs.renameSync(tmp, ORDERS_FILE);
  } catch (e) {
    console.error('Error saving orders.json:', e);
  }
}

const orderAttempts = new Map(); // ip -> { n, t }
function orderLimited(ip) {
  const now = Date.now(), a = orderAttempts.get(ip);
  if (!a || now - a.t > 10 * 60e3) {
    orderAttempts.set(ip, { n: 1, t: now });
    return false;
  }
  if (a.n >= 8) return true;
  a.n++;
  return false;
}

app.post('/api/orders', (req, res) => {
  const ip = req.ip;
  if (orderLimited(ip)) {
    return res.status(429).json({ error: 'Too many orders. Please try again later. · طلبات كثيرة جداً، يرجى المحاولة لاحقاً.' });
  }
  if (JSON.stringify(req.body || {}).length > 100 * 1024) {
    return res.status(400).json({ error: 'Order data too large · حجم بيانات الطلب كبير جداً' });
  }

  const b = req.body || {};
  const type = b.type === 'takeaway' ? 'takeaway' : 'delivery';
  const cust = b.customer || {};
  const name = str(cust.name, 60);
  const phone = waNumber(cust.phone);
  const address = str(cust.address, 240);
  const note = str(b.note, 300);
  const payment = ['cod', 'instapay', 'wallet'].includes(b.payment) ? b.payment : 'cod';

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name · اكتب اسمك' });
  if (phone.length < 9 || phone.length > 15) return res.status(400).json({ error: 'Enter a valid mobile number · اكتب رقم موبايل صحيح' });

  const menu = readMenu();
  const S = menu.settings;

  if (type === 'delivery' && !S.delivery?.enabled) {
    return res.status(400).json({ error: 'Delivery is not available · التوصيل غير متاح حالياً' });
  }
  if (type === 'takeaway' && !S.takeaway?.enabled) {
    return res.status(400).json({ error: 'Takeaway is not available · الاستلام من المطعم غير متاح حالياً' });
  }
  if (!S.payments?.[payment]?.enabled) {
    return res.status(400).json({ error: 'Selected payment method is not available · طريقة الدفع غير متاحة' });
  }

  let zone = null;
  if (type === 'delivery') {
    if (address.length < 8) return res.status(400).json({ error: 'Please write your full address · اكتب العنوان بالتفصيل' });
    const zones = (S.delivery?.zones || []).filter(z => z.enabled !== false);
    if (zones.length > 0) {
      zone = zones.find(z => z.id === cust.zoneId);
      if (!zone) return res.status(400).json({ error: 'Please choose your area · اختر منطقتك' });
    }
  }

  let branch = null;
  const branches = (S.branches || []).filter(br => br.enabled !== false);
  if (branches.length > 0) {
    branch = branches.find(br => br.id === cust.branchId);
    if (!branch) return res.status(400).json({ error: 'Please choose a branch · اختر فرع المطعم' });
  }

  const rawLines = Array.isArray(b.lines) ? b.lines.slice(0, 60) : [];
  if (!rawLines.length) return res.status(400).json({ error: 'Your cart is empty · السلة فارغة' });

  let adjusted = false;
  const orderLines = [];

  for (const rawLine of rawLines) {
    const qty = Math.max(1, Math.min(99, Number(rawLine.qty) || 1));
    const key = str(rawLine.key, 200);
    const keyParts = key.split('|')[0].split(':');
    let basePrice = 0;
    let itemEn = '', itemAr = '';

    if (keyParts[0] === 'pizza') {
      const pizza = menu.pizzas.find(p => p.id === keyParts[1]);
      if (!pizza || pizza.hidden || pizza.soldOut) {
        return res.status(400).json({ error: `Item unavailable: ${rawLine.en || keyParts[1]} · هذا الصنف غير متاح` });
      }
      itemEn = pizza.en; itemAr = pizza.ar;
      if (pizza.group === 'premium' || keyParts[2] === 'R') {
        basePrice = pizza.p.Regular;
      } else {
        const sz = keyParts[2];
        const isStuffed = keyParts[3] === '1';
        if (isStuffed && pizza.s && pizza.s[sz] !== undefined) basePrice = pizza.s[sz];
        else basePrice = pizza.p[sz];
      }
      if (basePrice === undefined || isNaN(basePrice)) {
        return res.status(400).json({ error: `Invalid size for ${pizza.en} · المقاس غير متاح` });
      }
    } else if (keyParts[0] === 'pasta') {
      const pasta = menu.pasta.find(p => p.id === keyParts[1]);
      if (!pasta || pasta.hidden || pasta.soldOut) {
        return res.status(400).json({ error: `Item unavailable: ${rawLine.en || keyParts[1]} · هذا الصنف غير متاح` });
      }
      itemEn = pasta.en; itemAr = pasta.ar;
      const sz = keyParts[3];
      basePrice = pasta.p[sz];
      if (basePrice === undefined || isNaN(basePrice)) {
        return res.status(400).json({ error: `Invalid size for ${pasta.en} · المقاس غير متاح` });
      }
    } else if (keyParts[0] === 'd') {
      const sec = keyParts[1];
      const sectionList = menu[sec];
      if (!Array.isArray(sectionList)) {
        return res.status(400).json({ error: 'Unknown category · قسم غير معروف' });
      }
      const item = sectionList.find(x => x.id === keyParts[2]);
      if (!item || item.hidden || item.soldOut) {
        return res.status(400).json({ error: `Item unavailable: ${rawLine.en || keyParts[2]} · هذا الصنف غير متاح` });
      }
      itemEn = item.en; itemAr = item.ar;
      basePrice = item.price;
    } else {
      return res.status(400).json({ error: 'Unknown item in cart · صنف غير معروف في السلة' });
    }

    const rawExtras = Array.isArray(rawLine.extras) ? rawLine.extras.slice(0, 30) : [];
    let extrasTotal = 0;
    const extrasList = [];

    for (const ex of rawExtras) {
      const extraItem = menu.extras.find(x => x.id === ex.id);
      if (!extraItem || extraItem.hidden || extraItem.soldOut) {
        return res.status(400).json({ error: `Extra unavailable: ${ex.en || ex.id} · هذه الإضافة غير متاحة` });
      }
      extrasTotal += extraItem.price;
      extrasList.push({ id: extraItem.id, en: extraItem.en, ar: extraItem.ar || '', price: extraItem.price });
    }

    const serverUnit = Math.round((basePrice + extrasTotal) * 100) / 100;
    if (num(rawLine.unit) !== serverUnit) {
      adjusted = true;
    }

    orderLines.push({
      en: str(itemEn || rawLine.en, 80),
      ar: str(itemAr || rawLine.ar, 80),
      detailAr: str(rawLine.detailAr, 120),
      detailMsg: str(rawLine.detailMsg, 120),
      qty,
      unit: serverUnit,
      note: str(rawLine.note, 140),
      extras: extrasList
    });
  }

  const subtotal = Math.round(orderLines.reduce((s, l) => s + l.unit * l.qty, 0) * 100) / 100;
  let deliveryFee = 0;
  if (type === 'delivery') {
    if (zone) deliveryFee = zone.fee;
    else deliveryFee = S.delivery?.fee || 0;
  }
  const total = Math.round((subtotal + deliveryFee) * 100) / 100;

  const orderNumber = ORDERS_DATA.nextNumber++;
  const orderId = crypto.randomBytes(5).toString('hex');
  const now = new Date().toISOString();

  let paymentLabel = 'كاش عند الاستلام';
  if (payment === 'instapay') paymentLabel = 'انستا باي';
  else if (payment === 'wallet') paymentLabel = S.payments?.wallet?.label || 'محفظة إلكترونية';

  const order = {
    id: orderId,
    number: orderNumber,
    createdAt: now,
    updatedAt: now,
    status: 'new',
    history: [{ status: 'new', at: now }],
    type,
    customer: {
      name,
      phone,
      address: type === 'delivery' ? address : '',
      ...(zone ? { zoneId: zone.id, zoneName: zone.name } : {}),
      ...(branch ? { branchId: branch.id, branchName: branch.name, branchWhatsapp: branch.whatsapp } : {})
    },
    lines: orderLines,
    subtotal,
    deliveryFee,
    total,
    currency: S.currency || 'EGP',
    payment,
    paymentLabel,
    note,
    adjusted
  };

  ORDERS_DATA.orders.unshift(order);
  saveOrdersSync();
  res.json(order);
});

app.get('/api/admin/orders', requireAuth, (req, res) => {
  const { status, q, from, to } = req.query;
  const counts = { new: 0, preparing: 0, out_for_delivery: 0, delivered: 0, cancelled: 0, active: 0 };
  for (const o of ORDERS_DATA.orders) {
    if (counts[o.status] !== undefined) counts[o.status]++;
    if (['new', 'preparing', 'out_for_delivery'].includes(o.status)) counts.active++;
  }
  let list = ORDERS_DATA.orders;
  if (q) {
    const ql = String(q).trim().toLowerCase();
    list = list.filter(o =>
      String(o.number).includes(ql) ||
      (o.customer?.name || '').toLowerCase().includes(ql) ||
      (o.customer?.phone || '').includes(ql)
    );
  }
  if (status === 'active') {
    list = list.filter(o => ['new', 'preparing', 'out_for_delivery'].includes(o.status));
  } else if (status && status !== 'all') {
    list = list.filter(o => o.status === status);
  }
  if (from) {
    const fromT = new Date(from).getTime();
    if (!isNaN(fromT)) list = list.filter(o => new Date(o.createdAt).getTime() >= fromT);
  }
  if (to) {
    const toT = new Date(to).getTime();
    if (!isNaN(toT)) list = list.filter(o => new Date(o.createdAt).getTime() <= toT);
  }
  const limitNum = Math.min(300, Math.max(1, Number(req.query.limit) || 100));
  res.json({
    orders: list.slice(0, limitNum),
    counts,
    serverTime: new Date().toISOString()
  });
});

app.patch('/api/admin/orders/:id', requireAuth, (req, res) => {
  const order = ORDERS_DATA.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found · الطلب غير موجود' });
  const { status, cancelReason } = req.body || {};
  const valid = ['new', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status · حالة غير صحيحة' });
  if (order.type === 'takeaway' && status === 'out_for_delivery') {
    return res.status(400).json({ error: 'Takeaway orders cannot be out for delivery · طلبات التيك أواي لا تخرج مع المندوب' });
  }
  order.status = status;
  order.updatedAt = new Date().toISOString();
  if (cancelReason !== undefined) order.cancelReason = str(cancelReason, 200);
  order.history = order.history || [];
  order.history.push({ status, at: order.updatedAt, ...(order.cancelReason ? { reason: order.cancelReason } : {}) });
  saveOrders();
  res.json(order);
});

app.delete('/api/admin/orders/:id', requireAuth, (req, res) => {
  const idx = ORDERS_DATA.orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found · الطلب غير موجود' });
  ORDERS_DATA.orders.splice(idx, 1);
  saveOrders();
  res.json({ ok: true });
});

/* ---------- static ---------- */
app.use('/uploads', express.static(UPLOADS, { maxAge: '365d', immutable: true }));
app.use('/admin', (req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex'); next(); });
app.use(express.static(PUBLIC, { extensions: ['html'], setHeaders: (res, p) => { if (/\.(html|js|css)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  Menu:       http://localhost:${PORT}\n  Dashboard:  http://localhost:${PORT}/admin`);
  if (!process.env.ADMIN_PASSWORD) console.log('\n  ⚠  Using the default password "admin123". Set your own:  ADMIN_PASSWORD=yourpassword npm start\n');
});
