/* Cart: kept in this browser (localStorage). Lines merge when everything about them is identical. */
const Cart = (() => {
  const KEY = 'menu.cart.v1';
  let lines = [];
  try { lines = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(lines)) lines = []; } catch { lines = []; }
  const emit = () => { try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch {} document.dispatchEvent(new CustomEvent('cart')); };
  return {
    get lines() { return lines; },
    add(l) { const ex = lines.find(x => x.key === l.key); if (ex) ex.qty += l.qty; else lines.push(l); emit(); },
    setQty(key, q) { const l = lines.find(x => x.key === key); if (!l) return; if (q <= 0) lines = lines.filter(x => x !== l); else l.qty = Math.min(q, 99); emit(); },
    qtyOf(key) { return (lines.find(x => x.key === key) || {}).qty || 0; },
    clear() { lines = []; emit(); },
    count() { return lines.reduce((n, l) => n + l.qty, 0); },
    lineTotal(l) { return l.unit * l.qty; },
    total() { return lines.reduce((s, l) => s + l.unit * l.qty, 0); }
  };
})();
