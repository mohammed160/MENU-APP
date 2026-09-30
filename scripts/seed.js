/* Builds data/menu.json from the original menu (scripts/legacy-data.js).
   Run:  npm run seed   (only needed once – it will NOT overwrite an existing menu.json unless you pass --force) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const out = path.join(__dirname, '..', 'data', 'menu.json');
if (fs.existsSync(out) && !process.argv.includes('--force')) { console.log('data/menu.json already exists – use --force to overwrite'); process.exit(0); }

const src = fs.readFileSync(path.join(__dirname, 'legacy-data.js'), 'utf8');
const D = vm.runInNewContext(src + '\n;({PIZZAS,PREMIUM_PIZZAS,PASTA,PREMIUM_PASTA,SIDES_L,SIDES_HL,SIDES_R,EXTRAS,DRINKS})');

const pimg = id => { const u = `/images/pizza/${id}.png`; return { src: u, md: u, th: u, cutout: true, legacy: true }; };
const eximg = n => { const u = `/images/extras/${n}.png`; return { src: u, md: u, th: u, cutout: true, legacy: true }; };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const pizzas = [
  ...D.PIZZAS.slice(0, 6).map(p => ({ ...p, group: 'signature', image: pimg(p.id) })),
  ...D.PREMIUM_PIZZAS.map(p => ({ ...p, group: 'premium', image: pimg(p.id) })),
  ...D.PIZZAS.slice(6).map(p => ({ ...p, group: 'classic', image: pimg(p.id) }))
].map(p => ({ id: p.id, en: p.en, ar: p.ar, group: p.group, p: p.p, s: p.s || null, image: p.image }));

const pasta = [
  ...D.PASTA.map(p => ({ id: p.id, en: p.en, ar: p.ar, group: 'regular', p: p.p, sauce: p.sauce, images: {} })),
  ...D.PREMIUM_PASTA.map(p => ({ id: p.id, en: p.en, ar: p.ar, group: 'premium', p: p.p, sauce: p.sauce, images: {} }))
];

const sides = [
  ...D.SIDES_L.map(([en, price]) => ({ en, price, col: 'L', hl: false })),
  ...D.SIDES_HL.map(([en, price]) => ({ en, price, col: 'L', hl: true })),
  ...D.SIDES_R.map(([en, price]) => ({ en, price, col: 'R', hl: false }))
].map(s => ({ id: 'side-' + slug(s.en), en: s.en, ar: '', price: s.price, col: s.col, hl: s.hl, image: s.en === 'Frise' ? eximg('fries') : null }));

const cheese = ['Cheese', 'Mix Cheese', 'Parmesan', 'Roquefort'], sauces = ['Ranch', 'BBQ', 'Sweet Chili', 'Texas', 'Cheddar Sauce'];
const extras = D.EXTRAS.map(([en, price]) => ({ id: 'extra-' + slug(en), en, ar: '', price, cat: cheese.includes(en) ? 'cheese' : sauces.includes(en) ? 'sauces' : 'toppings' }));

const drinks = D.DRINKS.map(([en, price]) => ({ id: 'drink-' + slug(en), en, ar: '', price, image: en === 'Soft Drink' ? eximg('bottle') : null }));

const menu = { version: Date.now(), settings: { currency: 'EGP', whatsapp: '', restaurant: '' }, pizzas, pasta, sides, extras, drinks };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(menu, null, 2));
console.log('menu.json created:', pizzas.length, 'pizzas,', pasta.length, 'pasta,', sides.length, 'sides,', extras.length, 'extras,', drinks.length, 'drinks');
