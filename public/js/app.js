// YaanBook page logic: search form, results, map, booking, empty legs and the operator directory.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Money: amounts are stored in rupees and shown in the visitor's chosen currency.
let CUR = 'INR', RATES = { ...CURRENCIES.fallback };
try { const c = new URLSearchParams(location.search).get('cur') || localStorage.getItem('yb-cur'); if (c && CURRENCIES.list[c.toUpperCase()]) CUR = c.toUpperCase(); } catch { }
const conv = n => n * (RATES[CUR] || CURRENCIES.fallback[CUR] || 1);
const fmtCache = {};
const nf = (cur, opts) => fmtCache[cur + JSON.stringify(opts)] ||= new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0, ...opts });
const inrRaw = n => nf('INR').format(Math.round(n));
const inr = n => nf(CUR).format(Math.round(conv(n)));
const lakh = n => {
  if (CUR !== 'INR') return nf(CUR, { notation: 'compact', maximumFractionDigits: 1 }).format(conv(n));
  return n >= 1e7 ? '₹' + (+(n / 1e7).toFixed(2)) + ' Cr' : n >= 1e5 ? '₹' + (+(n / 1e5).toFixed(1)) + ' L' : inr(n);
};
const inrMsg = n => inrRaw(n) + (CUR === 'INR' ? '' : ` (about ${inr(n)})`);
const hrs = h => { const m = Math.round(h * 60); return (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60 ? m % 60 + 'm' : '').trim() || '0m'; };
const kmf = d => Math.round(d).toLocaleString('en-IN') + ' km';
const place = c => AIRPORTS[c] ? `${AIRPORTS[c].city} (${c})` : c;
const city = c => AIRPORTS[c]?.city || c;
const fmtDate = s => s ? new Date(s + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const isoDay = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const icon = cat => `<svg viewBox="0 0 24 24" aria-hidden="true"${cat === 'heli' ? '' : ' style="transform:rotate(45deg)"'}><use href="#${cat === 'heli' ? 'heli' : 'jet'}"/></svg>`;

let FLEET = [], PARTNERS = { aircraft: [], emptyLegs: [] }, DGCA = null, SERVER = false;
let trip = null, results = [], sortBy = 'price', shown = 15, selKey = null;
const filt = { cats: new Set(), max: Infinity, near: false, ver: false };

/* ---------- search form ---------- */
$('places').innerHTML = PLACES.map(([c, n, ci, , , k]) => `<option value="${esc(ci)} (${c})">${esc(n)}${k === 'H' ? ' · helicopters only' : ''}</option>`).join('');
function parsePlace(v) {
  v = v.trim(); if (!v) return null;
  const m = v.match(/\(([A-Z]{3})\)\s*$/); if (m && AIRPORTS[m[1]]) return m[1];
  const u = v.toUpperCase(); if (AIRPORTS[u]) return u;
  const l = v.toLowerCase();
  const hit = PLACES.find(p => p[2].toLowerCase() === l) || PLACES.find(p => p[2].toLowerCase().startsWith(l) || p[1].toLowerCase().includes(l));
  return hit ? hit[0] : null;
}
const today = new Date(), tmr = new Date(Date.now() + 864e5);
$('sDate').min = $('sRet').min = isoDay(today); $('sDate').value = isoDay(tmr);
document.querySelectorAll('input[name=trip]').forEach(r => r.onchange = () => {
  const round = document.querySelector('input[name=trip]:checked').value === 'round';
  $('sRet').disabled = !round; if (round && !$('sRet').value) $('sRet').value = $('sDate').value;
});
$('sDate').onchange = () => { $('sRet').min = $('sDate').value; if ($('sRet').value && $('sRet').value < $('sDate').value) $('sRet').value = $('sDate').value; };
$('swap').onclick = () => { const a = $('sFrom').value; $('sFrom').value = $('sTo').value; $('sTo').value = a; };
const POPULAR = [['DEL', 'BOM'], ['DEL', 'BLR'], ['BOM', 'GOI'], ['DEL', 'JAI'], ['DED', 'KDH'], ['BLR', 'COK'], ['HYD', 'TIR'], ['MAA', 'BLR']];
document.querySelector('.popular').insertAdjacentHTML('beforeend', POPULAR.map(([a, b]) => `<button type="button" data-a="${a}" data-b="${b}">${esc(city(a))} → ${esc(city(b))}</button>`).join(''));
document.querySelectorAll('.popular button').forEach(b => b.onclick = () => { $('sFrom').value = place(b.dataset.a); $('sTo').value = place(b.dataset.b); $('sf').requestSubmit(); });

$('sf').onsubmit = e => {
  e.preventDefault();
  const from = parsePlace($('sFrom').value), to = parsePlace($('sTo').value), err = $('sErr');
  const round = document.querySelector('input[name=trip]:checked').value === 'round';
  err.textContent = '';
  if (!from) return err.textContent = 'Choose where you are flying from from the list.';
  if (!to) return err.textContent = 'Choose where you are flying to from the list.';
  if (from === to || km(AIRPORTS[from], AIRPORTS[to]) < CONFIG.sameAirportKm) return err.textContent = 'Pick two different places.';
  if (!$('sDate').value) return err.textContent = 'Choose a departure date.';
  if (round && !$('sRet').value) return err.textContent = 'Choose a return date.';
  $('sFrom').value = place(from); $('sTo').value = place(to);
  trip = { from, to, date: $('sDate').value, ret: round ? $('sRet').value : '', pax: Math.max(1, +$('sPax').value || 1), type: $('sType').value };
  const q = new URLSearchParams({ from, to, date: trip.date, pax: trip.pax }); if (trip.ret) q.set('ret', trip.ret); if (trip.type !== 'any') q.set('type', trip.type);
  history.replaceState(null, '', '?' + q + '#results');
  runSearch(true);
};

function runSearch(scroll) {
  if (!FLEET.length) return;
  results = search(FLEET, trip).filter(r => trip.type === 'any' || (trip.type === 'jet' ? groupOf(r.ac.cat) === 'jet' : r.ac.cat === trip.type));
  results.forEach(r => r.liveAir = isAir(r.ac.live));
  filt.cats = new Set(); filt.max = Infinity; filt.near = filt.ver = false; shown = 15; selKey = null;
  $('results').hidden = false;
  drawFilters(); drawResults();
  if ($('mapcard').hidden === false || matchMedia('(min-width:981px)').matches) showMap(true);
  if (scroll) $('results').scrollIntoView();
}

/* ---------- results ---------- */
const sorters = {
  price: (a, b) => a.q.total - b.q.total,
  near: (a, b) => a.q.ferry - b.q.ferry || a.q.total - b.q.total,
  fast: (a, b) => a.q.live - b.q.live || a.q.total - b.q.total,
  seats: (a, b) => b.ac.seats - a.ac.seats || a.q.total - b.q.total,
};
const visible = () => results.filter(r => (!filt.cats.size || filt.cats.has(r.ac.cat)) && r.q.total <= filt.max
  && (!filt.near || r.q.posKm === 0) && (!filt.ver || r.ac.verified)).sort(sorters[sortBy]);

function drawFilters() {
  const n = {}; results.forEach(r => n[r.ac.cat] = (n[r.ac.cat] || 0) + r.count);
  $('fCats').innerHTML = Object.keys(CATS).filter(c => n[c]).map(c => `<label class="ck"><input type="checkbox" value="${c}"> ${CATS[c].label} <small>${n[c]}</small></label>`).join('') || '<p class="hint">None</p>';
  $('fCats').querySelectorAll('input').forEach(i => i.onchange = () => { i.checked ? filt.cats.add(i.value) : filt.cats.delete(i.value); shown = 15; drawResults(); });
  const tot = results.map(r => r.q.total), lo = Math.min(...tot), hi = Math.max(...tot);
  const r = $('fMax'); r.min = Math.floor(lo); r.max = Math.ceil(hi); r.step = Math.max(1000, Math.round((hi - lo) / 100)); r.value = r.max;
  $('fMaxV').textContent = results.length ? 'Up to ' + lakh(hi) : '';
  r.oninput = () => { filt.max = +r.value >= +r.max ? Infinity : +r.value; $('fMaxV').textContent = 'Up to ' + lakh(+r.value); shown = 15; drawResults(); };
  $('fNear').checked = $('fVer').checked = false;
}
$('fNear').onchange = e => { filt.near = e.target.checked; shown = 15; drawResults(); };
$('fVer').onchange = e => { filt.ver = e.target.checked; shown = 15; drawResults(); };
$('fReset').onclick = () => { drawFilters(); filt.cats.clear(); filt.max = Infinity; filt.near = filt.ver = false; shown = 15; drawResults(); };
document.querySelectorAll('.sorts .chip').forEach(c => c.onclick = () => {
  sortBy = c.dataset.s; document.querySelectorAll('.sorts .chip').forEach(x => x.setAttribute('aria-pressed', x === c)); drawResults();
});
$('rmore').onclick = () => { shown += 20; drawResults(); };

function posLine(r) {
  const { ac, q } = r, at = ac.at || ac.base, t = trip;
  const where = ac.atLive ? `Seen at ${esc(city(at))} ${ago(Date.now() - ac.atLive)} <span class="hint">(live ADS-B)</span>`
    : `${ac.at ? 'Now at' : 'Based at'} ${esc(city(at))}${ac.at || ac.baseConfirmed ? '' : ' <span class="hint" title="Taken from the operator\'s registered city on the DGCA list">(registered city)</span>'}`;
  if (q.posKm === 0) return `<div class="pos"><span class="dot"></span><span>${where} · <b>at your pickup, no positioning flight</b></span></div>`;
  const endsHome = AIRPORTS[t.ret ? t.from : t.to] && km(AIRPORTS[t.ret ? t.from : t.to], AIRPORTS[ac.base]) < CONFIG.sameAirportKm;
  return `<div class="pos far"><span class="dot"></span><span>${where} · flies ${kmf(q.posKm)} empty to reach you${endsHome ? ', finishes at home base' : ''} · ${hrs(q.ferry)} empty flying in total</span></div>`;
}

function breakdown(r) {
  const { ac, q } = r, t = trip;
  const legRows = q.legs.map(l => `<tr class="${l.live ? '' : 'ferry'}"><td><span class="lg"></span>${l.live ? 'Your flight' : 'Empty positioning'}: ${esc(city(l.from))} → ${esc(city(l.to))}${t.ret && l.day ? ` <span class="hint">(${fmtDate(t.ret)})</span>` : ''}${l.stops ? ' · 1 fuel stop' : ''}</td><td>${kmf(l.km)} · ${hrs(l.h)}</td></tr>`).join('');
  return `<table class="bd">${legRows}
    ${q.minTopUp > 0.05 ? `<tr class="sub"><td>Minimum billing top-up (${CONFIG.minHoursPerDay[groupOf(ac.cat)]} hr per day)</td><td>+ ${hrs(q.minTopUp)}</td></tr>` : ''}
    <tr><td>Charter: ${hrs(q.billable)} × ${inr(ac.rate)}/hr${ac.verified ? '' : ' <span class="hint">(typical rate for this model)</span>'}</td><td>${inr(q.charter)}</td></tr>
    ${q.fees ? `<tr><td>Landing, parking &amp; handling (${q.landings} stop${q.landings > 1 ? 's' : ''})</td><td>${inr(q.fees)}</td></tr>` : ''}
    ${q.halts ? `<tr><td>Crew &amp; aircraft night halt (${q.nights} night${q.nights > 1 ? 's' : ''})</td><td>${inr(q.halts)}</td></tr>` : ''}
    <tr><td>GST ${Math.round(CONFIG.gst * 100)}%</td><td>${inr(q.gst)}</td></tr>
    <tr class="tot"><td>Estimated total</td><td>${inr(q.total)}</td></tr></table>
    <p class="hint">${esc(q.plan)} Operator: ${esc(ac.op)}, DGCA permit ${esc(ac.aop)}${r.count > 1 ? `, ${r.count} identical aircraft available` : ''}. Your written quote confirms the final fare.</p>`;
}

function drawResults() {
  const t = trip, l = visible(), all = results;
  const rt = `${esc(city(t.from))} ${t.ret ? '⇄' : '→'} ${esc(city(t.to))}`;
  if (!all.length) {
    $('summary').innerHTML = `<div class="eyebrow">Results</div><h2>${rt}</h2><p>No aircraft can fly this trip for ${t.pax} passenger${t.pax > 1 ? 's' : ''}. ${AIRPORTS[t.to].kind === 'H' || AIRPORTS[t.from].kind === 'H' ? 'Helipads can only be reached by helicopter; try fewer passengers. ' : ''}Try fewer passengers or another aircraft type, or <a href="https://wa.me/${CONFIG.whatsapp}" target="_blank" rel="noopener">ask a concierge on WhatsApp</a>.</p>`;
    $('rlist').innerHTML = ''; $('deal').innerHTML = ''; $('rmore').hidden = true; drawMap(); return;
  }
  const cheapest = [...all].sort(sorters.price)[0], n = all.reduce((s, r) => s + r.count, 0);
  // Saving: the same model flown from a farther base, or failing that the same category.
  const same = all.filter(r => r.ac.model === cheapest.ac.model), pool = same.length > 1 ? same : all.filter(r => r.ac.cat === cheapest.ac.cat);
  const worst = pool.reduce((m, r) => r.q.total > m.q.total ? r : m, cheapest), save = worst.q.total - cheapest.q.total;
  $('summary').innerHTML = `<div class="eyebrow">${n} aircraft · ${new Set(all.map(r => r.ac.op)).size} operators</div>
    <h2>${rt} · ${fmtDate(t.date)}${t.ret ? ' – ' + fmtDate(t.ret) : ''} · ${t.pax} passenger${t.pax > 1 ? 's' : ''}</h2>
    <p>${kmf(km(AIRPORTS[t.from], AIRPORTS[t.to]))} each way. Every fare below includes the empty flights to reach you and to go home, minimum billing, fees and GST.</p>
    ${save > 1000 ? `<div class="save">The cheapest ${esc(cheapest.ac.model)} (${esc(city(cheapest.ac.at || cheapest.ac.base))}) costs ${lakh(save)} less than the same ${same.length > 1 ? 'model' : 'class of aircraft'} flying in from ${esc(city(worst.ac.at || worst.ac.base))}.</div>` : ''}`;

  const deals = (PARTNERS.emptyLegs || []).filter(d => d.date >= isoDay(today) && d.seats >= t.pax && km(AIRPORTS[d.from], AIRPORTS[t.from]) < 80 && km(AIRPORTS[d.to], AIRPORTS[t.to]) < 80);
  $('deal').innerHTML = deals.map(d => `<div class="dealbox"><span><b>Empty-leg deal on your route:</b> ${esc(d.model)} on ${fmtDate(d.date)} at ${esc(d.time || '')} for ${inr(d.price)}${d.sample ? ' <span class="hint">(example listing)</span>' : ''}</span><button class="btn small" data-deal="${esc(d.id)}">Request this seat</button></div>`).join('');
  $('deal').querySelectorAll('[data-deal]').forEach(b => b.onclick = () => openDeal(b.dataset.deal));

  $('rlist').innerHTML = l.slice(0, shown).map(r => {
    const { ac, q } = r, best = r === cheapest;
    return `<article class="card res ${r.key === selKey ? 'on' : ''}" data-k="${esc(r.key)}">
      <div><div class="nm">${icon(ac.cat)}${esc(ac.model)}${best ? ' <span class="tag best">Lowest fare</span>' : ''}${ac.verified ? ' <span class="tag ok">Verified rate</span>' : ' <span class="tag guess">Estimated rate</span>'}${r.liveAir ? ' <span class="tag live">Airborne now</span>' : ''}</div>
      <div class="op">${esc(ac.op)} · ${CATS[ac.cat].label}${r.count > 1 ? ` · ${r.count} available` : ''}</div></div>
      <div class="price"><b>${inr(q.total)}</b><small>${inr(q.perSeat)} per passenger · incl. GST</small><button class="btn small" data-book="${esc(r.key)}">Request</button></div>
      <div class="facts"><span><b>${hrs(q.blockH)}</b> flight</span><span><b>${ac.seats}</b> seats</span><span><b>${inr(ac.rate)}</b>/hr</span><span><b>${hrs(q.flown)}</b> billed flying</span></div>
      ${posLine(r)}
      <details><summary>Fare breakdown</summary>${breakdown(r)}</details></article>`;
  }).join('') || '<p class="empty card">No aircraft match these filters. <button class="btn ghost small" onclick="$(\'fReset\').click()">Reset filters</button></p>';
  $('rmore').hidden = l.length <= shown; $('rmore').textContent = `Show more (${l.length - shown} left)`;
  $('rlist').querySelectorAll('.res').forEach(el => el.onclick = e => { if (e.target.closest('button,summary,a')) return; selKey = el.dataset.k; markSel(); drawMap(); });
  $('rlist').querySelectorAll('details').forEach(d => d.ontoggle = () => { if (d.open) { selKey = d.closest('.res').dataset.k; markSel(); drawMap(); } });
  $('rlist').querySelectorAll('[data-book]').forEach(b => b.onclick = () => openBooking(results.find(r => r.key === b.dataset.book)));
  if (!selKey && l[0]) selKey = l[0].key;
  markSel(); drawMap();
}
const markSel = () => $('rlist').querySelectorAll('.res').forEach(e => e.classList.toggle('on', e.dataset.k === selKey));

/* ---------- map ---------- */
let map = null, layer = null;
function showMap(on) {
  $('mapcard').hidden = !on; $('mapToggle').setAttribute('aria-pressed', on); $('mapToggle').textContent = on ? 'Hide map' : 'Show map';
  if (on && !map && window.L) {
    map = L.map('map', { scrollWheelZoom: false }).fitBounds([[8, 68.5], [31, 90]]);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 12, attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors' }).addTo(map);
    map.on('click', () => map.scrollWheelZoom.enable());
    layer = L.layerGroup().addTo(map);
  }
  if (on && !window.L) $('map').innerHTML = '<p class="empty">The map could not load. The results list still shows every aircraft.</p>';
  if (on && map) { map.invalidateSize(); drawMap(); }
}
$('mapToggle').onclick = () => showMap($('mapcard').hidden);
function drawMap() {
  if (!map || $('mapcard').hidden || !trip) return;
  layer.clearLayers();
  const ll = c => [AIRPORTS[c].lat, AIRPORTS[c].lon], bases = {};
  visible().forEach(r => { const b = r.ac.at || r.ac.base; bases[b] = (bases[b] || 0) + r.count; });
  for (const b in bases) L.circleMarker(ll(b), { radius: 5 + Math.min(12, Math.sqrt(bases[b]) * 2), color: '#3B82F6', weight: 1, fillOpacity: .3 })
    .bindTooltip(`${esc(city(b))}: ${bases[b]} aircraft`).addTo(layer);
  const sel = results.find(r => r.key === selKey), pts = [ll(trip.from), ll(trip.to)];
  if (sel) sel.q.legs.forEach(l => { pts.push(ll(l.from));
    L.polyline([ll(l.from), ll(l.to)], l.live ? { color: '#D4AF37', weight: 3 } : { color: '#FF8A8A', weight: 2, dashArray: '5 8' }).addTo(layer); });
  [[trip.from, 'A'], [trip.to, 'B']].forEach(([c, t]) => L.marker(ll(c), { icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="pin">${t}</div>` }) })
    .bindTooltip(esc(place(c)), { direction: 'top', offset: [0, -14] }).addTo(layer));
  map.fitBounds(L.latLngBounds(pts).pad(.15), { maxZoom: 8 });
}

/* ---------- booking ---------- */
const newRef = () => 'YB-' + Date.now().toString(36).toUpperCase();
function sendOptions(text, subject) {
  return [['Send on WhatsApp', `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(text)}`],
    ['Send by email', `mailto:${CONFIG.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`]];
}
async function submitRequest(payload, text, subject) {
  if (SERVER) {
    const r = await fetch('api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j.ref;
  }
  if (CONFIG.formEndpoint) {
    const r = await fetch(CONFIG.formEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ...payload, _subject: subject, message: text }) });
    if (!r.ok) throw new Error('form failed'); return payload.ref;
  }
  return null;
}
function dialogShell(title, sub) {
  return `<button type="button" class="x" aria-label="Close" onclick="this.closest('dialog').close()">✕</button><h3 id="bkTitle">${title}</h3><p class="hint">${sub}</p>`;
}
function contactFields() {
  return `<div class="two"><div><label for="bName">Full name</label><input id="bName" autocomplete="name" required></div>
    <div><label for="bPhone">Phone / WhatsApp</label><input id="bPhone" type="tel" autocomplete="tel" required></div></div>`;
}
function wireSend(form, build) {
  form.querySelector('.go').onclick = async ev => {
    ev.preventDefault();
    const name = $('bName').value.trim(), phone = $('bPhone').value.trim(), box = form.querySelector('.out');
    if (!name || phone.replace(/\D/g, '').length < 10) { box.innerHTML = '<div class="msg err">Add your name and a 10-digit phone number so your concierge can reach you.</div>'; return; }
    const { payload, text, subject } = build(name, phone), btn = form.querySelector('.go');
    btn.disabled = true; box.innerHTML = '<div class="msg">Sending your request…</div>';
    let ref = null; try { ref = await submitRequest(payload, text, subject); } catch { }
    btn.disabled = false;
    const links = sendOptions(text, subject).map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join('');
    box.innerHTML = ref
      ? `<div class="msg">Request <b>${esc(ref)}</b> received. A concierge will call ${esc(name)} within 30 minutes with a written quote.${SERVER ? '' : ' To reach us faster:'}<br>${SERVER ? '' : links}</div>`
      : `<div class="msg">Last step: send your request to the YaanBook concierge. It's ready to go, just press send.<br>${links}</div>`;
  };
}
function openBooking(r) {
  const { ac, q } = r, t = trip, ref = newRef(), f = $('bkForm');
  f.innerHTML = `${dialogShell(`Request the ${esc(ac.model)}`, `${esc(ac.op)} · ${esc(place(t.from))} ${t.ret ? '⇄' : '→'} ${esc(place(t.to))} · ${fmtDate(t.date)}${t.ret ? ' – ' + fmtDate(t.ret) : ''} · ${t.pax} passenger${t.pax > 1 ? 's' : ''}. No payment now.`)}
    <div class="est"><div class="l"><span>Estimated total incl. GST</span><b>${inr(q.total)}</b></div><p class="hint" style="margin:4px 0 0">${hrs(q.billable)} billed at ${inr(ac.rate)}/hr, ${hrs(q.ferry)} of it empty positioning.</p></div>
    ${contactFields()}
    <label for="bVip">Service level</label><select id="bVip"><option>Standard</option><option>VIP: private lounge and discreet ground handling</option><option>VIP: security coordination and protocol</option><option>State / diplomatic: full protocol support</option></select>
    <label for="bNotes">Special requests</label><textarea id="bNotes" rows="2" placeholder="Catering, flexible timing, pets, extra luggage"></textarea>
    <button class="btn go">Send request</button><div class="out" aria-live="polite"></div>`;
  wireSend(f, (name, phone) => {
    const vip = $('bVip').value, notes = $('bNotes').value.trim();
    const text = `Booking request ${ref}\n${ac.model} (${ac.reg || 'any available'}), ${ac.op}\n${place(t.from)} → ${place(t.to)}${t.ret ? ' and back' : ''}\nDate: ${t.date}${t.ret ? ', return ' + t.ret : ''}\nPassengers: ${t.pax}\nEstimate: ${inrMsg(q.total)} incl. GST (${q.billable.toFixed(1)} hr at ${inrMsg(ac.rate)}/hr)\nService: ${vip}\nClient: ${name}, ${phone}\nNotes: ${notes || 'none'}`;
    return { subject: `Booking request ${ref}: ${ac.model}`, text,
      payload: { ref, aircraft: `${ac.model} · ${ac.op}${ac.reg ? ' · ' + ac.reg : ''}`, from: place(t.from), to: place(t.to), hours: +q.billable.toFixed(1), estimate: inrMsg(q.total),
        name, phone, date: t.date, pax: t.pax, vip, notes: [t.ret ? 'Return ' + t.ret : '', notes].filter(Boolean).join(' · ') } };
  });
  $('bk').showModal();
}
function openDeal(id) {
  const d = PARTNERS.emptyLegs.find(x => x.id === id); if (!d) return;
  const ref = newRef(), f = $('bkForm');
  f.innerHTML = `${dialogShell(`Empty leg: ${esc(city(d.from))} → ${esc(city(d.to))}`, `${esc(d.model)} · ${fmtDate(d.date)} ${esc(d.time || '')} · up to ${d.seats} passengers · whole aircraft.`)}
    <div class="est"><div class="l"><span>Empty-leg price incl. GST</span><b>${inr(d.price * (1 + CONFIG.gst))}</b></div></div>
    ${contactFields()}<label for="bPax">Passengers</label><input id="bPax" type="number" min="1" max="${d.seats}" value="${Math.min(d.seats, trip?.pax || 2)}">
    <button class="btn go">Request this empty leg</button><div class="out" aria-live="polite"></div>`;
  wireSend(f, (name, phone) => {
    const pax = +$('bPax').value || 1, text = `Empty-leg request ${ref}\n${d.model}: ${place(d.from)} → ${place(d.to)} on ${d.date} ${d.time || ''}\nPrice: ${inrMsg(d.price)} + GST\nPassengers: ${pax}\nClient: ${name}, ${phone}`;
    return { subject: `Empty-leg request ${ref}`, text, payload: { ref, aircraft: `Empty leg ${d.id}: ${d.model}`, from: place(d.from), to: place(d.to), hours: 0, estimate: inrMsg(d.price), name, phone, date: d.date, pax, vip: 'Standard', notes: 'Empty leg' } };
  });
  $('bk').showModal();
}

/* ---------- empty legs ---------- */
function drawDeals() {
  const l = (PARTNERS.emptyLegs || []).filter(d => d.date >= isoDay(today) && AIRPORTS[d.from] && AIRPORTS[d.to]).sort((a, b) => a.date.localeCompare(b.date));
  $('dgrid').innerHTML = l.map(d => `<div class="card deal"><div class="eyebrow">${fmtDate(d.date)} · ${esc(d.time || '')}${d.sample ? ' · example' : ''}</div>
    <div class="rt">${esc(city(d.from))} → ${esc(city(d.to))}</div><div class="meta">${esc(d.model)} · ${d.seats} seats · ${kmf(km(AIRPORTS[d.from], AIRPORTS[d.to]))}</div>
    <div class="pr"><b>${inr(d.price)}</b>${d.was ? `<s>${inr(d.was)}</s><span class="tag off">${Math.round((1 - d.price / d.was) * 100)}% off</span>` : ''}</div>
    <div class="meta">Whole aircraft, plus GST</div><button class="btn small" data-deal="${esc(d.id)}">Request</button></div>`).join('')
    || '<p class="hint">No empty legs listed right now. Set an alert and we will message you when one comes up.</p>';
  $('dgrid').querySelectorAll('[data-deal]').forEach(b => b.onclick = () => openDeal(b.dataset.deal));
}
$('alertBtn').onclick = () => {
  const f = $('alForm');
  f.innerHTML = `${dialogShell('Empty-leg alert', 'Tell us the route you fly often. We message you when an aircraft is repositioning that way.')}
    <div class="two"><div><label for="aFrom">From</label><input id="aFrom" list="places" value="${esc(trip ? place(trip.from) : '')}"></div><div><label for="aTo">To</label><input id="aTo" list="places" value="${esc(trip ? place(trip.to) : '')}"></div></div>
    ${contactFields()}<button class="btn go">Set alert</button><div class="out" aria-live="polite"></div>`;
  wireSend(f, (name, phone) => {
    const a = $('aFrom').value || 'anywhere', b = $('aTo').value || 'anywhere', text = `Empty-leg alert\nRoute: ${a} → ${b}\nClient: ${name}, ${phone}`;
    return { subject: 'Empty-leg alert', text, payload: { ref: newRef(), aircraft: 'Empty-leg alert', from: a, to: b, hours: 0, estimate: '', name, phone, date: '', pax: 1, vip: 'Standard', notes: 'Alert request' } };
  });
  $('al').showModal();
};

/* ---------- how pricing works example ---------- */
function drawExample() {
  const spec = MODELS.find(m => m[1] === 'Cessna Citation XLS'), [, model, cat, seats, speed, range, rate] = spec;
  const mk = base => ({ model, cat, seats, speed, range, rate, base, at: null });
  const t = { from: 'DEL', to: 'JAI', date: isoDay(tmr), pax: 4 }, a = quote(mk('DEL'), t), b = quote(mk('BOM'), t);
  const bar = q => `<div class="bar"><i style="width:${q.live / b.billable * 100}%;background:var(--gold)"></i><i style="width:${(q.billable - q.live) / b.billable * 100}%;background:var(--muted)"></i></div>`;
  $('example').innerHTML = `<div class="eyebrow">Example</div><h3>Delhi → Jaipur, Citation XLS</h3><p class="hint">Same aircraft model and hourly rate. The only difference is where it is parked.</p>
    <div class="cmp"><div class="win"><small>Based in Delhi</small><b>${lakh(a.total)}</b><small>${hrs(a.billable)} billed · ${hrs(a.ferry)} empty</small>${bar(a)}</div>
    <div><small>Based in Mumbai</small><b>${lakh(b.total)}</b><small>${hrs(b.billable)} billed · ${hrs(b.ferry)} empty</small>${bar(b)}</div></div>
    <p class="hint">Gold is your flight, grey is flying you pay for but don't sit in. YaanBook would show you the Delhi aircraft first and save you ${lakh(b.total - a.total)}.</p>`;
}

/* ---------- operator directory ---------- */
let OPS = [], opKind = 'all', opShown = 12;
const fmtD = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
function drawOps() {
  const q = $('opq').value.trim().toLowerCase(), c = $('opcity').value, verified = new Set(PARTNERS.operators || []);
  const l = OPS.filter(o => (opKind === 'all' || o.aircraft.some(a => a.kind === opKind)) && (!c || o.city === c) && (o.name + ' ' + o.aircraft.map(a => a.model).join(' ')).toLowerCase().includes(q));
  $('opcount').textContent = OPS.length ? `${l.length} of ${OPS.length} operators` : '';
  $('opgrid').innerHTML = l.slice(0, opShown).map(o => {
    const v = dmy(o.valid), days = v ? (v - Date.now()) / 864e5 : 0,
      badge = !v ? '' : days < 0 ? `<span class="badge exp">Permit expired ${fmtD(v)}</span>` : days < 180 ? `<span class="badge soon">Permit valid until ${fmtD(v)}</span>` : `<span class="badge ok">Permit valid until ${fmtD(v)}</span>`;
    const g = {}; o.aircraft.forEach(a => { const k = a.model.replace(/\s+/g, ' '); g[k] = g[k] || { n: 0, seats: a.seats }; g[k].n++; });
    const rows = Object.entries(g).sort((a, b) => b[1].n - a[1].n), fw = o.aircraft.filter(a => a.kind === 'FW').length, rw = o.aircraft.filter(a => a.kind === 'RW').length, bl = o.aircraft.length - fw - rw;
    const mix = [fw && `${fw} plane${fw > 1 ? 's' : ''}`, rw && `${rw} helicopter${rw > 1 ? 's' : ''}`, bl && `${bl} balloon${bl > 1 ? 's' : ''}`].filter(Boolean).join(', ');
    return `<div class="opc"><h3>${esc(o.name)}</h3><div class="meta">${esc(o.city || 'India')} · Permit ${esc(o.aop)} · ${mix}</div>${badge}${verified.has(o.name) ? ' <span class="badge ok">YaanBook partner</span>' : ''}
      <ul>${rows.slice(0, 4).map(([m, x]) => `<li><span>${x.n > 1 ? x.n + ' × ' : ''}${esc(m)}</span><span>${/^\d+$/.test(x.seats) ? x.seats + ' seats' : esc(x.seats)}</span></li>`).join('')}${rows.length > 4 ? `<li><span>+ ${rows.length - 4} more model${rows.length - 4 > 1 ? 's' : ''}</span><span></span></li>` : ''}</ul></div>`;
  }).join('') || `<p class="hint">${OPS.length ? 'No operators match.' : 'The operator list could not load.'}</p>`;
  $('opmore').hidden = l.length <= opShown; $('opmore').textContent = `Show all ${l.length} operators`;
}
document.querySelectorAll('.opbar .chip').forEach(c => c.onclick = () => { opKind = c.dataset.k; document.querySelectorAll('.opbar .chip').forEach(x => x.setAttribute('aria-pressed', x === c)); opShown = 12; drawOps(); });
$('opq').oninput = $('opcity').onchange = () => { opShown = 12; drawOps(); };
$('opmore').onclick = () => { opShown = 1e4; drawOps(); };

/* ---------- request status (only with the YaanBook server) ---------- */
$('stgo').onclick = async () => {
  const m = $('stmsg'), say = (t, err) => { m.innerHTML = ''; const e = document.createElement('div'); e.className = 'msg' + (err ? ' err' : ''); e.textContent = t; m.appendChild(e); };
  if (!$('sr').value.trim() || !$('sp').value.trim()) return say('Enter both your reference and phone number.', 1);
  try {
    const r = await fetch('api/status/' + encodeURIComponent($('sr').value.trim()) + '?phone=' + encodeURIComponent($('sp').value.trim())), j = await r.json();
    if (!r.ok) return say(j.error, 1);
    say(j.status === 'confirmed' ? 'Confirmed. Your concierge will contact you to finalise the details.' : j.status === 'declined' ? 'This request was declined.' + (j.reason ? ' Reason: ' + j.reason : '') + ' Please send a new request for another aircraft.' : 'Received. An operator is reviewing your request.');
  } catch { say('Status checks are not available right now. Message us on WhatsApp instead.', 1); }
};

/* ---------- live flight status ---------- */
let LIVE = null, lFilter = 'now', lmap = null, lLayer = null, lMarks = {};
const LIVE_FRESH = 20 * 6e4, AT_MAX = 72 * 36e5;
const ago = ms => ms < 6e4 ? 'just now' : ms < 36e5 ? Math.round(ms / 6e4) + ' min ago' : ms < 864e5 ? Math.round(ms / 36e5) + ' h ago' : Math.round(ms / 864e5) + ' d ago';
const isFresh = p => !!p && Date.now() - p.seen < LIVE_FRESH;
const isAir = p => isFresh(p) && !p.gnd;
// An aircraft last seen parked at an airport (and not seen flying since) is treated as being there for pricing.
function applyLive(fleet, live) {
  const a = live && live.aircraft; if (!a) return;
  for (const ac of fleet) {
    const p = a[ac.reg]; if (!p) continue;
    ac.live = p;
    const lg = p.lastGround;
    if (lg && AIRPORTS[lg.code] && Date.now() - lg.ts < AT_MAX && p.seen - lg.ts < 30 * 6e4 && !isAir(p)) { ac.at = lg.code; ac.atLive = lg.ts; }
  }
}
function liveStatus(p) {
  if (!p) return { k: 'none', txt: 'No signal in the last 14 days' };
  const fresh = isFresh(p), where = p.nearKm <= 15 ? `at ${city(p.near)}` : `${kmf(p.nearKm)} from ${city(p.near)}`;
  if (p.gnd) return { k: fresh ? 'gnd' : 'old', txt: `${fresh ? 'On the ground' : 'Last seen on the ground'} ${where}` };
  return { k: fresh ? 'air' : 'old', txt: `${fresh ? 'Airborne' : 'Last seen airborne'} · ${(Math.round(p.alt / 100) * 100).toLocaleString('en-IN')} ft · ${p.gs} kt · ${where}` };
}
const lRank = ac => { const s = liveStatus(ac.live).k; return { air: 0, gnd: 1, old: 2, none: 3 }[s]; };
function lVisible() {
  const q = $('lq').value.trim().toLowerCase();
  return FLEET.filter(ac => {
    const p = ac.live;
    if (lFilter === 'air' && !isAir(p)) return false;
    if (lFilter === 'now' && !isFresh(p)) return false;
    if (lFilter === 'recent' && !p) return false;
    return !q || `${ac.reg} ${ac.model} ${ac.dgcaModel} ${ac.op}`.toLowerCase().includes(q);
  }).sort((a, b) => lRank(a) - lRank(b) || (b.live?.seen || 0) - (a.live?.seen || 0) || a.op.localeCompare(b.op));
}
function drawLive() {
  const withPos = FLEET.filter(a => a.live), air = withPos.filter(a => isAir(a.live)).length, gnd = withPos.filter(a => isFresh(a.live) && a.live.gnd).length;
  $('lstats').innerHTML = `<div class="air"><b>${air}</b><span>Airborne now</span></div><div class="gnd"><b>${gnd}</b><span>On the ground, transmitting</span></div>
    <div class="rec"><b>${withPos.length}</b><span>Seen in the last 14 days</span></div><div><b>${FLEET.length}</b><span>Aircraft tracked</span></div>`;
  $('lsrc').textContent = LIVE ? `Live transponder (ADS-B) positions for all ${FLEET.length} aircraft on YaanBook, refreshed about every 10 minutes. Last update ${ago(Date.now() - LIVE.updated)}. Parked aircraft usually switch their transponders off, so most show their last known position.`
    : 'Live positions are not available right now.';
  const l = lVisible(), max = 150;
  $('llist').innerHTML = l.slice(0, max).map(ac => {
    const s = liveStatus(ac.live);
    return `<button class="lrow" data-reg="${esc(ac.reg)}"><span class="rg"><span class="sdot ${s.k === 'none' ? '' : s.k}"></span>${esc(ac.reg)}</span><span>${esc(ac.model)}</span><span class="ag">${ac.live ? ago(Date.now() - ac.live.seen) : ''}</span>
      <span class="md">${esc(ac.op)}</span><span class="st">${esc(s.txt)}${ac.live?.flight && ac.live.flight !== ac.reg.replace('-', '') ? ' · flight ' + esc(ac.live.flight) : ''}</span></button>`;
  }).join('') + (l.length > max ? `<p class="empty">Showing ${max} of ${l.length}. Search to narrow down.</p>` : '')
    || `<p class="empty">${lFilter === 'all' ? 'No aircraft match.' : 'No aircraft match right now. Try "Seen in last 14 days" or "All aircraft".'}</p>`;
  $('llist').querySelectorAll('.lrow').forEach(b => b.onclick = () => { const m = lMarks[b.dataset.reg]; if (m && lmap) { lmap.setView(m.getLatLng(), 8); m.openTooltip(); } });
  drawLiveMap();
}
function drawLiveMap() {
  if (!lmap) return;
  lLayer.clearLayers(); lMarks = {};
  for (const ac of lVisible()) {
    const p = ac.live; if (!p) continue;
    const s = liveStatus(p).k, heli = ac.cat === 'heli';
    const m = L.marker([p.lat, p.lon], { title: ac.reg, icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      html: `<div class="lmk ${s}"><svg viewBox="0 0 24 24"${heli ? '' : ` style="transform:rotate(${p.trk || 0}deg)"`}><use href="#${heli ? 'heli' : 'jet'}"/></svg></div>` }) })
      .bindTooltip(`<b>${esc(ac.reg)}</b> · ${esc(ac.model)}<br>${esc(ac.op)}<br>${esc(liveStatus(p).txt)}<br>${ago(Date.now() - p.seen)}`, { direction: 'top', offset: [0, -14] }).addTo(lLayer);
    lMarks[ac.reg] = m;
  }
}
document.querySelectorAll('.lbar .chip').forEach(c => c.onclick = () => { lFilter = c.dataset.l; document.querySelectorAll('.lbar .chip').forEach(x => x.setAttribute('aria-pressed', x === c)); drawLive(); });
$('lq').oninput = () => drawLive();
// Build the live map only when the section scrolls into view.
new IntersectionObserver((e, o) => {
  if (!e[0].isIntersecting || !window.L) return; o.disconnect();
  lmap = L.map('lmap', { scrollWheelZoom: false }).fitBounds([[7, 68.5], [33, 92]]);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 12, attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap · Positions: adsb.lol (ODbL)' }).addTo(lmap);
  lmap.on('click', () => lmap.scrollWheelZoom.enable());
  lLayer = L.layerGroup().addTo(lmap); drawLiveMap();
}, { rootMargin: '200px' }).observe($('lmap'));
// Refresh live data every 5 minutes while the page is open.
setInterval(() => fetch('data/live.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => {
  if (!j || (LIVE && j.updated === LIVE.updated)) return;
  LIVE = j; FLEET.forEach(a => { delete a.live; }); applyLive(FLEET, j); drawLive();
}).catch(() => { }), 5 * 6e4);

/* ---------- currency ---------- */
$('cur').innerHTML = Object.entries(CURRENCIES.list).map(([c, n]) => `<option value="${c}" title="${esc(n)}">${c}</option>`).join('');
$('cur').value = CUR;
function rerenderMoney() {
  if (trip && results.length) { drawResults(); const r = $('fMax'); if (r.max) $('fMaxV').textContent = 'Up to ' + lakh(+r.value); }
  drawDeals(); drawExample(); if ($('bk').open) $('bk').close();
}
$('cur').onchange = () => { CUR = $('cur').value; try { localStorage.setItem('yb-cur', CUR); } catch { } rerenderMoney(); };
fetch(CURRENCIES.ratesUrl).then(r => r.ok ? r.json() : null).then(j => {
  if (!j || !j.rates) return;
  for (const c in CURRENCIES.list) if (j.rates[c]) RATES[c] = j.rates[c];
  $('cur').title = 'Exchange rates updated ' + (j.time_last_update_utc || '').replace(/ \+0000$/, ' UTC');
  if (CUR !== 'INR') rerenderMoney();
}).catch(() => { });

/* ---------- start ---------- */
fetch('api/health').then(r => r.ok ? r.json() : null).then(j => { SERVER = !!(j && j.ok); $('status').hidden = !SERVER; }).catch(() => { });
Promise.all([fetch('data/operators.json').then(r => r.json()), fetch('data/partners.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
  fetch('data/live.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)]).then(([d, p, live]) => {
  DGCA = d; PARTNERS = { aircraft: [], emptyLegs: [], ...p };
  FLEET = buildFleet(d, PARTNERS);
  LIVE = live; applyLive(FLEET, live); drawLive();
  $('hAc').textContent = FLEET.length; $('hOps').textContent = new Set(FLEET.map(a => a.op)).size;
  OPS = d.operators.slice().sort((a, b) => b.aircraft.length - a.aircraft.length);
  [...new Set(OPS.map(o => o.city).filter(Boolean))].sort().forEach(c => $('opcity').add(new Option(c, c)));
  $('opsrc').innerHTML = `Every holder of a DGCA Non-Scheduled Operator Permit, from the <a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">official DGCA list</a> dated ${esc(d.updated)}. Operators marked as partners have confirmed their bases and rates with YaanBook.`;
  drawOps(); drawDeals(); drawExample();
  const u = new URLSearchParams(location.search);
  if (u.get('from') && u.get('to')) {
    $('sFrom').value = place(u.get('from')); $('sTo').value = place(u.get('to'));
    if (u.get('date') >= isoDay(today)) $('sDate').value = u.get('date');
    if (u.get('pax')) $('sPax').value = u.get('pax');
    if (u.get('type') && [...$('sType').options].some(o => o.value === u.get('type'))) $('sType').value = u.get('type');
    if (u.get('ret')) { document.querySelector('input[name=trip][value=round]').checked = true; $('sRet').disabled = false; $('sRet').value = u.get('ret'); }
    $('sf').requestSubmit();
  }
}).catch(() => { $('sErr').textContent = 'The aircraft list could not load. Refresh the page, or message us on WhatsApp.'; drawOps(); });
