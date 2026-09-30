/* =====================================================================
   Checkout – customer details, delivery / takeaway, payment, notes
   → ONE organised WhatsApp message to the restaurant.
   Uses globals from app.js: MENU, Cart, drawer, esc, money, cur, toast, $, $$
   ===================================================================== */
const Checkout = (() => {
  const KEY = 'menu.customer.v1';
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
  const st = { method: saved.method || 'delivery', pay: saved.pay || 'cod', name: saved.name || '', phone: saved.phone || '', address: saved.address || '', zone: saved.zone || '', branch: saved.branch || '', note: '', errors: {}, shake: false };
  let view = 'cart', code = '', waUrl = '', msgText = '';

  const S = () => MENU.settings;
  const latin = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const cleanPhone = s => latin(s).replace(/[\s\-().]/g, '');
  const methods = () => [S().delivery.enabled && 'delivery', S().takeaway.enabled && 'takeaway'].filter(Boolean);
  const isDel = () => st.method === 'delivery';
  const getZones = () => (S().delivery?.zones || []).filter(z => z.enabled !== false);
  const hasZones = () => getZones().length > 0;
  const curZone = () => getZones().find(z => z.id === st.zone);
  const getBranches = () => (S().branches || []).filter(b => b.enabled !== false);
  const hasBranches = () => getBranches().length > 0;
  const curBranch = () => getBranches().find(b => b.id === st.branch);
  const fee = () => {
    if (!isDel()) return 0;
    if (hasZones()) {
      const z = curZone();
      return z ? (Number(z.fee) || 0) : 0;
    }
    return Number(S().delivery?.fee) || 0;
  };
  const total = () => Cart.total() + fee();

  function payList() {
    const P = S().payments, out = [];
    if (P.cod.enabled) out.push({ id: 'cod', en: isDel() ? 'Cash on delivery' : 'Pay at pickup', ar: isDel() ? 'الدفع عند الاستلام (للمندوب)' : 'الدفع عند الاستلام من المطعم' });
    if (P.instapay.enabled) out.push({ id: 'instapay', en: 'InstaPay', ar: 'انستا باي' });
    if (P.wallet.enabled) out.push({ id: 'wallet', en: P.wallet.label, ar: 'محفظة إلكترونية' });
    return out;
  }
  function fix() {
    const ms = methods(); if (!ms.includes(st.method)) st.method = ms[0];
    const ps = payList(); if (!ps.some(p => p.id === st.pay)) st.pay = ps[0].id;
    if (st.zone && !getZones().some(z => z.id === st.zone)) st.zone = '';
    if (st.branch && !getBranches().some(b => b.id === st.branch)) st.branch = '';
    if (!st.branch && getBranches().length === 1) st.branch = getBranches()[0].id;
  }

  /* ---------- clipboard ---------- */
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch {} t.remove(); }
    toast('Copied · تم النسخ');
  }

  /* ---------- validation ---------- */
  function validate() {
    const e = {};
    if (st.name.trim().length < 2) e.name = 'Please enter your name · اكتب اسمك';
    if (!/^\+?\d{9,15}$/.test(cleanPhone(st.phone))) e.phone = 'Enter a valid mobile number · اكتب رقم موبايل صحيح';
    if (isDel() && hasZones() && (!st.zone || !curZone())) e.zone = 'Please choose your area · اختر منطقتك';
    if (isDel() && st.address.trim().length < 8) e.address = 'Please write your full address · اكتب العنوان بالتفصيل';
    if (hasBranches() && (!st.branch || !curBranch())) e.branch = 'Please choose a branch · اختر فرع المطعم';
    return e;
  }

  /* ---------- the WhatsApp message ---------- */
  const RLM = '\u200F', LRM = '\u200E';
  const ln = s => RLM + s;
  const hasLatin = s => /[a-zA-Z]/.test(String(s || ''));
  const hasArabic = s => /[\u0600-\u06FF]/.test(String(s || ''));
  const ltr = s => (hasLatin(s) && !hasArabic(s)) ? (LRM + s + LRM) : String(s || '');

  function formatOrderDate(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'م' : 'ص';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${day}/${month}/${year} - ${hours}:${minutes} ${ampm}`;
  }

  function buildMessageFromOrder(o) {
    const isDel = o.type === 'delivery';
    const C = o.currency || (typeof S === 'function' ? S()?.currency : null) || 'EGP';
    const curMsg = amt => `${money(amt)} ${C === 'EGP' ? 'جنيه' : C}`;
    const cust = o.customer || {};
    const sep = '──────────────';
    const L = [];

    // Header: RLM outside asterisks
    L.push(ln(`*طلب جديد #${o.number}*`));

    // Restaurant and branch
    const bName = cust.branchName || (typeof curBranch === 'function' ? curBranch()?.name : '') || '';
    const rName = (typeof S === 'function' ? S()?.restaurant : '') || '';
    const headerParts = [rName, bName].filter(Boolean);
    if (headerParts.length) {
      L.push(ln(headerParts.map(ltr).join(' - ')));
    }

    // Date
    L.push(ln(formatOrderDate(o.createdAt)));
    L.push(ln(sep));

    // Customer Info
    L.push(ln('*بيانات العميل*'));
    L.push(ln(`الاسم: ${ltr(cust.name || '')}`));
    L.push(ln(`الموبايل: ${ltr(cust.phone || '')}`));
    L.push(ln(`الاستلام: ${isDel ? 'دليفري' : 'تيك أواي (استلام من المطعم)'}`));
    const zName = cust.zoneName || (typeof curZone === 'function' ? curZone()?.name : '') || '';
    if (isDel && zName) {
      L.push(ln(`المنطقة: ${ltr(zName)}`));
    }
    if (isDel && cust.address) {
      L.push(ln(`العنوان: ${ltr(cust.address.replace(/\s*\n\s*/g, ' - '))}`));
    }
    L.push(ln(sep));

    // Order items
    const lines = o.lines || [];
    L.push(ln(`*الطلب - ${lines.length} أصناف*`));
    lines.forEach((l, i) => {
      const itemName = l.ar ? l.ar : ltr(l.en || '');
      L.push(ln(`${i + 1}- ${itemName} × ${l.qty}`));
      const detailStr = l.detailAr || (l.detailMsg ? ltr(l.detailMsg) : '');
      if (detailStr) L.push(ln(`   ${detailStr}`));
      (l.extras || []).forEach(x => {
        const exName = x.ar ? x.ar : ltr(x.en || '');
        L.push(ln(`   + ${exName} (+${money(x.price)})`));
      });
      if (l.note) L.push(ln(`   ملاحظة: ${l.note}`));
      L.push(ln(`   السعر: ${curMsg(l.unit * l.qty)}`));
    });
    L.push(ln(sep));

    // Totals
    L.push(ln(`المجموع: ${curMsg(o.subtotal)}`));
    if (isDel) {
      if (zName) {
        L.push(ln(o.deliveryFee > 0 ? `التوصيل (${ltr(zName)}): ${curMsg(o.deliveryFee)}` : `التوصيل (${ltr(zName)}): مجاني`));
      } else {
        L.push(ln(o.deliveryFee > 0 ? `رسوم التوصيل: ${curMsg(o.deliveryFee)}` : 'التوصيل: مجاني'));
      }
    }
    L.push(ln(`*الإجمالي: ${curMsg(o.total)}*`));
    L.push(ln(sep));

    // Payment
    let payText = '';
    if (o.payment === 'cod') {
      payText = isDel ? 'كاش عند التسليم للمندوب' : 'كاش عند الاستلام من المطعم';
    } else if (o.payment === 'instapay') {
      payText = `انستا باي - تحويل ${curMsg(o.total)}`;
    } else {
      const wLabel = (typeof S === 'function' ? S()?.payments?.wallet?.label : null) || 'المحفظة';
      payText = `${wLabel} - تحويل ${curMsg(o.total)}`;
    }
    L.push(ln(`*الدفع:* ${payText}`));
    if (o.payment !== 'cod') {
      L.push(ln('صورة التحويل هتتبعت في المحادثة'));
    }

    // Notes
    if (o.note && String(o.note).trim()) {
      L.push(ln('*ملاحظات على الطلب:*'));
      L.push(ln(String(o.note).trim()));
    }

    return L.join('\n');
  }

  function openWhatsApp(url) {
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function saveCustomer() { try { localStorage.setItem(KEY, JSON.stringify({ name: st.name.trim(), phone: st.phone.trim(), address: st.address.trim(), method: st.method, pay: st.pay, zone: st.zone, branch: st.branch })); } catch {} }

  async function send() {
    const branchWa = curBranch()?.whatsapp;
    const targetWa = branchWa || S().whatsapp;
    if (!Cart.lines.length || !targetWa) return;
    st.errors = validate();
    st.serverError = '';
    if (Object.keys(st.errors).length) {
      paint();
      const id = st.errors.name ? 'coName' : st.errors.phone ? 'coPhone' : st.errors.zone ? 'coZone' : st.errors.address ? 'coAddr' : 'coBranch';
      const el = $('#' + id, drawer);
      el && (el.scrollIntoView({ block: 'center', behavior: 'smooth' }), el.focus({ preventScroll: true }));
      return;
    }

    let win = null;
    try { win = window.open('about:blank', '_blank'); } catch {}

    const payload = {
      type: st.method,
      customer: {
        name: st.name.trim(),
        phone: cleanPhone(st.phone),
        address: isDel() ? st.address.trim() : '',
        zoneId: isDel() ? st.zone : '',
        branchId: st.branch || ''
      },
      lines: Cart.lines.map(l => ({
        key: l.key,
        en: l.en,
        ar: l.ar || '',
        detail: l.detail || '',
        detailMsg: l.detailMsg || '',
        detailAr: l.detailAr || '',
        qty: l.qty,
        unit: l.unit,
        note: l.note || '',
        extras: (l.extras || []).map(x => ({ id: x.id, en: x.en, ar: x.ar || '', price: x.price }))
      })),
      payment: st.pay,
      note: st.note.trim()
    };

    saveCustomer();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    let canonicalOrder = null;

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 400 || res.status === 429) {
          if (win) win.close();
          st.serverError = data.error || 'Could not place order · تعذر إرسال الطلب';
          paint();
          return;
        }
        throw new Error(data.error || 'Server error');
      }
      canonicalOrder = data;
    } catch (err) {
      clearTimeout(timeoutId);
      const localCode = 'L-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const z = curZone();
      const b = curBranch();
      canonicalOrder = {
        number: localCode,
        createdAt: new Date().toISOString(),
        type: st.method,
        customer: {
          name: st.name.trim(),
          phone: cleanPhone(st.phone),
          address: isDel() ? st.address.trim() : '',
          zoneName: z?.name || '',
          branchName: b?.name || '',
          branchWhatsapp: b?.whatsapp || ''
        },
        lines: payload.lines,
        subtotal: Cart.total(),
        deliveryFee: fee(),
        total: total(),
        currency: S().currency || 'EGP',
        payment: st.pay,
        note: st.note.trim()
      };
    }

    code = '#' + canonicalOrder.number;
    msgText = buildMessageFromOrder(canonicalOrder);
    const destWa = canonicalOrder.customer?.branchWhatsapp || targetWa;
    waUrl = `https://wa.me/${destWa}?text=${encodeURIComponent(msgText)}`;

    if (win && !win.closed) {
      win.location.href = waUrl;
    } else {
      location.href = waUrl;
    }

    Cart.clear();
    view = 'done';
    paint();
  }

  /* ---------- views ---------- */
  const fld = (id, key, label, ar, control, err) => `<label class="fld${err ? ' bad' : ''}" for="${id}"><span>${label} <span class="ar">${ar}</span></span>${control}${err ? `<small class="err" role="alert">${esc(err)}</small>` : ''}</label>`;

  function payBox() {
    const P = S().payments, amt = cur(total());
    const row = (label, val) => `<div class="pb-row"><span class="pb-l">${esc(label)}</span><b dir="ltr">${esc(val)}</b><button type="button" class="chip" data-co="copy" data-v="${esc(val)}">Copy <span class="ar">نسخ</span></button></div>`;
    const link = (url, t, ar) => `<a class="chip primary lnk" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${t} <span class="ar">${ar}</span></a>`;
    const after = `<p class="pb-n">After you transfer, send the screenshot in the WhatsApp chat. <span class="ar" dir="rtl">بعد التحويل ابعت صورة التحويل في محادثة الواتساب.</span></p>`;
    if (st.pay === 'instapay') { const p = P.instapay; return `<div class="paybox"><p class="pb-t">Transfer <b>${amt}</b> with InstaPay <span class="ar" dir="rtl">حوّل <bdi>${amt}</bdi> عن طريق انستا باي</span></p>${p.handle ? row('InstaPay', p.handle) : ''}${p.link ? link(p.link, 'Open transfer link', 'افتح لينك التحويل') : ''}${after}</div>`; }
    if (st.pay === 'wallet') { const p = P.wallet; return `<div class="paybox"><p class="pb-t">Transfer <b>${amt}</b> to the wallet <span class="ar" dir="rtl">حوّل <bdi>${amt}</bdi> على المحفظة</span></p>${p.number ? row(p.label, p.number) : ''}${p.holder ? `<div class="pb-holder">${esc(p.holder)}</div>` : ''}${p.link ? link(p.link, 'Open transfer link', 'افتح لينك التحويل') : ''}${after}</div>`; }
    return `<div class="paybox soft"><p class="pb-n">${isDel() ? 'You pay the delivery man when your order arrives.' : 'You pay at the restaurant when you pick up your order.'} <span class="ar" dir="rtl">${isDel() ? 'هتدفع للمندوب لما الطلب يوصلك.' : 'هتدفع في المطعم وقت الاستلام.'}</span></p></div>`;
  }

  function paintForm() {
    const ms = methods(), ps = payList(), del = isDel(), f = fee(), e = st.errors, ok = !!(curBranch()?.whatsapp || S().whatsapp);
    const seg = ms.length > 1
      ? `<div class="seg" role="radiogroup" aria-label="Order type">${ms.map(m => `<button type="button" role="radio" aria-checked="${st.method === m}" class="${st.method === m ? 'on' : ''}" data-co="method" data-v="${m}">${m === 'delivery' ? 'Delivery <span class="ar">دليفري</span>' : 'Takeaway <span class="ar">تيك أواي</span>'}</button>`).join('')}</div>`
      : `<p class="only">${ms[0] === 'delivery' ? 'Delivery only · دليفري فقط' : 'Takeaway only · تيك أواي فقط'}</p>`;
    const pay = ps.map(p => `<label class="pay${st.pay === p.id ? ' on' : ''}"><input type="radio" name="pay" value="${p.id}" data-co="pay"${st.pay === p.id ? ' checked' : ''}><span class="dot" aria-hidden="true"></span><span class="pt"><b>${esc(p.en)}</b><span class="ar">${esc(p.ar)}</span></span></label>`).join('');
    const zoneSelect = (del && hasZones()) ? fld(
      'coZone',
      'zone',
      'Delivery area',
      'منطقة التوصيل',
      `<select id="coZone" data-f="zone" aria-invalid="${!!e.zone}">
        <option value="" disabled ${!st.zone ? 'selected' : ''}>Choose your area · اختر منطقتك</option>
        ${getZones().map(z => {
          const feeTxt = z.fee > 0 ? `${money(z.fee)} ${S().currency || 'EGP'}` : 'Free · مجاني';
          const nameTxt = z.name + (z.en ? ` (${z.en})` : '');
          return `<option value="${esc(z.id)}"${st.zone === z.id ? ' selected' : ''}>${esc(nameTxt)} — ${feeTxt}</option>`;
        }).join('')}
      </select>`,
      e.zone
    ) : '';

    const branchSelect = hasBranches() ? fld(
      'coBranch',
      'branch',
      'Branch',
      'فرع المطعم',
      `<select id="coBranch" data-f="branch" aria-invalid="${!!e.branch}">
        <option value="" disabled ${!st.branch ? 'selected' : ''}>Choose branch · اختر فرع المطعم</option>
        ${getBranches().map(b => {
          const nameTxt = b.name + (b.en ? ` (${b.en})` : '');
          return `<option value="${esc(b.id)}"${st.branch === b.id ? ' selected' : ''}>${esc(nameTxt)}</option>`;
        }).join('')}
      </select>`,
      e.branch
    ) : '';

    drawer.innerHTML = `
      <div class="sh-head"><button type="button" class="x" data-co="back" aria-label="Back to order">‹</button><h3>Checkout <span class="ar">إتمام الطلب</span></h3><button type="button" class="x" aria-label="Close" data-close>×</button></div>
      <div class="sh-scroll co">
        ${seg}
        <div class="fields">
          ${fld('coName', 'name', 'Name', 'الاسم', `<input id="coName" data-f="name" autocomplete="name" maxlength="60" value="${esc(st.name)}" aria-invalid="${!!e.name}">`, e.name)}
          ${fld('coPhone', 'phone', 'Mobile number', 'رقم الموبايل', `<input id="coPhone" data-f="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="01xxxxxxxxx" maxlength="20" value="${esc(st.phone)}" aria-invalid="${!!e.phone}">`, e.phone)}
          ${zoneSelect}
          ${del ? fld('coAddr', 'address', 'Delivery address', 'العنوان بالتفصيل', `<textarea id="coAddr" data-f="address" rows="3" maxlength="240" autocomplete="street-address" placeholder="المنطقة، الشارع، رقم العمارة، الدور، الشقة، علامة مميزة" aria-invalid="${!!e.address}">${esc(st.address)}</textarea>`, e.address) : ''}
          ${branchSelect}
          ${fld('coNote', 'note', 'Order notes (optional)', 'ملاحظات على الطلب', `<textarea id="coNote" data-f="note" rows="2" maxlength="300" placeholder="مثال: من غير بصل، رن عليا لما توصل">${esc(st.note)}</textarea>`)}
        </div>
        <p class="sh-title">Payment <span class="ar">طريقة الدفع</span></p>
        <div class="pays" role="radiogroup" aria-label="Payment method">${pay}</div>
        ${payBox()}
        <div class="sumbox">
          <div><span>Subtotal <span class="ar">المجموع</span></span><b>${cur(Cart.total())}</b></div>
          ${del ? (hasZones()
            ? (curZone()
              ? `<div><span>Delivery · التوصيل (${esc(curZone().name)})</span><b>${f > 0 ? cur(f) : 'Free · مجاني'}</b></div>`
              : `<div class="sum-hint" style="font-size:12.5px;color:var(--muted);text-align:center;padding:4px 0">Choose your area to see the delivery fee · اختر المنطقة لتظهر رسوم التوصيل</div>`)
            : `<div><span>Delivery <span class="ar">التوصيل</span></span><b>${f > 0 ? cur(f) : 'Free · مجاني'}</b></div>`
          ) : ''}
          <div class="tot"><span>Total <span class="ar">الإجمالي</span></span><b>${(del && hasZones() && !curZone()) ? '—' : cur(total())}</b></div>
        </div>
      </div>
      <div class="dr-foot">
        ${st.serverError ? `<p class="formerr" role="alert">${esc(st.serverError)}</p>` : ''}
        ${Object.keys(e).length ? `<p class="formerr" role="alert">Please complete the highlighted fields · أكمل الحقول المميزة</p>` : ''}
        ${ok ? '' : `<p class="formerr">Ordering is not available right now. · الطلب غير متاح حاليًا</p>`}
        <button type="button" class="send wa" data-co="send"${ok ? '' : ' disabled'}>Send on WhatsApp <span class="ar">إرسال على واتساب</span></button>
      </div>`;
  }

  function paintDone() {
    const pay = st.pay !== 'cod';
    drawer.innerHTML = `
      <div class="sh-head"><h3>Order ready <span class="ar">الطلب جاهز</span></h3><button type="button" class="x" aria-label="Close" data-close>×</button></div>
      <div class="sh-scroll done">
        <div class="tick" aria-hidden="true"></div>
        <h4>Your order is ready in WhatsApp</h4>
        <p>Press <b>Send</b> in WhatsApp to confirm it.<br><span class="ar">طلبك جاهز في الواتساب، اضغط <b>إرسال</b> هناك لتأكيده.</span></p>
        ${pay ? `<p class="paynote">Then send your transfer screenshot in the same chat.<br><span class="ar">وبعدها ابعت صورة التحويل في نفس المحادثة.</span></p>` : ''}
        <p class="code">Order ${esc(code)}</p>
      </div>
      <div class="dr-foot done-foot">
        <a class="send wa" href="${esc(waUrl)}" target="_blank" rel="noopener noreferrer">Open WhatsApp again <span class="ar">افتح الواتساب</span></a>
        <div class="two"><button type="button" class="send ghost" data-co="copymsg">Copy order text <span class="ar">نسخ الطلب</span></button>
        <button type="button" class="send ghost" data-co="finish">Finish · done <span class="ar">تم</span></button></div>
      </div>`;
  }

  function paint() {
    fix();
    const y = $('.sh-scroll', drawer)?.scrollTop || 0;
    if (view === 'done') paintDone(); else paintForm();
    const s = $('.sh-scroll', drawer); if (s) s.scrollTop = y;
  }

  /* ---------- events (delegated on the drawer) ---------- */
  drawer.addEventListener('click', e => {
    const b = e.target.closest('[data-co]'); if (!b) return;
    const act = b.dataset.co;
    if (act === 'checkout') { if (!Cart.lines.length) return; view = 'form'; st.errors = {}; paint(); $('.sh-scroll', drawer).scrollTop = 0; }
    else if (act === 'back') { view = 'cart'; paintDrawer(); }
    else if (act === 'method') { st.method = b.dataset.v; st.errors = {}; paint(); }
    else if (act === 'copy') copy(b.dataset.v);
    else if (act === 'copymsg') copy(msgText);
    else if (act === 'send') send();
    else if (act === 'finish') { Cart.clear(); drawer.close(); }
  });
  drawer.addEventListener('change', e => {
    if (st.serverError) { st.serverError = ''; }
    if (e.target.dataset.co === 'pay') { st.pay = e.target.value; paint(); }
    if (e.target.dataset.f === 'zone') {
      st.zone = e.target.value;
      delete st.errors.zone;
      saveCustomer();
      paint();
    }
    if (e.target.dataset.f === 'branch') {
      st.branch = e.target.value;
      delete st.errors.branch;
      saveCustomer();
      paint();
    }
  });
  drawer.addEventListener('input', e => {
    if (st.serverError) { st.serverError = ''; }
    const f = e.target.dataset.f; if (!f) return;
    if (f === 'zone' || f === 'branch') {
      st[f] = e.target.value;
      delete st.errors[f];
      saveCustomer();
      paint();
      return;
    }
    st[f] = e.target.value;
    if (st.errors[f]) { delete st.errors[f]; const l = e.target.closest('.fld'); l?.classList.remove('bad'); l?.querySelector('.err')?.remove(); e.target.setAttribute('aria-invalid', 'false'); }
  });

  return { get view() { return view; }, reset() { view = 'cart'; st.errors = {}; }, paint };
})();
