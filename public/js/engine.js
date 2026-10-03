// YaanBook search & pricing engine. Pure functions, no DOM: builds the bookable fleet from the DGCA list
// plus partner updates, and prices a trip for each aircraft including every empty positioning leg.

const R = Math.PI / 180;
function km(a, b) {
  const x = Math.sin((b.lat - a.lat) * R / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lon - a.lon) * R / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}
const groupOf = cat => CATS[cat].group;
const dmy = v => { const [d, m, y] = String(v || '').split('.').map(Number); return y ? new Date(y, m - 1, d) : null; };

// One entry per bookable airframe.
function buildFleet(dgca, partners) {
  const today = new Date(), fleet = [], byReg = {};
  for (const o of dgca.operators) {
    const valid = dmy(o.valid);
    if (valid && valid < today) continue;                       // permit lapsed: not bookable
    for (const a of o.aircraft) {
      const m = a.model.toUpperCase(), seatTxt = String(a.seats || '').trim();
      if (a.kind === 'B' || EXCLUDE.test(m) || /^(cargo|aerial work)$/i.test(seatTxt)) continue;
      const heli = a.kind === 'RW';
      const spec = MODELS.find(s => (s[2] === 'heli') === heli && s[0].test(m))
        || (heli ? [null, a.model, 'heli', 6, 220, 550, 120000] : [null, a.model, 'tp', 7, 480, 2200, 110000]);
      const [, name, cat, seats0, speed, range, rate] = spec;
      const seats = parseInt(seatTxt.replace(/\s+/g, '')) || seats0;
      const ac = { reg: a.reg, model: name, dgcaModel: a.model, cat, seats, speed, range, rate,
        base: CITY_BASE[o.city] || 'DEL', at: null, baseConfirmed: false, verified: false,
        op: o.name, opCity: o.city || '', aop: o.aop, valid: o.valid };
      fleet.push(ac); if (a.reg) byReg[a.reg] = ac;
    }
  }
  // Partner updates: confirmed base, current location, real hourly rate, availability.
  for (const p of (partners && partners.aircraft) || []) {
    const ac = byReg[p.reg];
    if (!ac) continue;
    if (p.available === false) { fleet.splice(fleet.indexOf(ac), 1); continue; }
    if (AIRPORTS[p.base]) { ac.base = p.base; ac.baseConfirmed = true; }
    if (AIRPORTS[p.at]) ac.at = p.at;
    if (p.rate > 0) ac.rate = p.rate;
    if (p.seats > 0) ac.seats = p.seats;
    ac.verified = true;
  }
  return fleet;
}

// Hours for one leg; adds a fuel stop when the distance is beyond comfortable range. null if not flyable.
function legHours(ac, a, b) {
  const d = km(AIRPORTS[a], AIRPORTS[b]);
  if (d < CONFIG.sameAirportKm) return { km: 0, h: 0, stops: 0 };
  const stops = Math.max(0, Math.ceil(d / (ac.range * 0.85)) - 1);
  if (stops > 1) return null;
  const h = d / ac.speed + CONFIG.taxiHours[groupOf(ac.cat)] * (1 + stops) + stops * 0.6;
  return { km: d, h: Math.ceil(h * 10) / 10, stops };
}

const near = (a, b) => a === b || km(AIRPORTS[a], AIRPORTS[b]) < CONFIG.sameAirportKm;
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

// Price a list of legs [{from,to,live,day}] flown by one aircraft.
function priceLegs(ac, plan, nights) {
  const g = groupOf(ac.cat), legs = [], hoursByDay = {};
  let landings = 0;
  for (const l of plan) {
    if (near(l.from, l.to)) continue;
    const x = legHours(ac, l.from, l.to);
    if (!x) return null;
    legs.push({ ...l, km: x.km, h: x.h, stops: x.stops });
    hoursByDay[l.day] = (hoursByDay[l.day] || 0) + x.h;
    landings += x.stops + (near(l.to, ac.base) ? 0 : 1);
  }
  const flown = legs.reduce((s, l) => s + l.h, 0), live = legs.filter(l => l.live).reduce((s, l) => s + l.h, 0);
  // Minimum billing for each day the aircraft is committed to the client, including idle days away from base.
  const min = CONFIG.minHoursPerDay[g];
  let billable = 0;
  const days = Math.max(...plan.map(l => l.day)) + 1;
  for (let d = 0; d < days; d++) billable += Math.max(hoursByDay[d] || 0, nights || hoursByDay[d] ? min : 0);
  billable = Math.max(billable, min);
  const charter = billable * ac.rate, fees = landings * CONFIG.landing[g], halts = (nights || 0) * CONFIG.nightHalt[g];
  const sub = charter + fees + halts, gst = sub * CONFIG.gst;
  return { legs, flown, live, ferry: flown - live, billable, minTopUp: billable - flown, charter, fees, landings, halts, nights: nights || 0, gst, total: sub + gst };
}

// Full quote for an aircraft and a trip {from, to, date, ret, pax}. Returns null if the aircraft can't do it.
function quote(ac, t) {
  if (ac.seats < t.pax) return null;
  const heliOnly = AIRPORTS[t.from].kind === 'H' || AIRPORTS[t.to].kind === 'H';
  if (heliOnly && ac.cat !== 'heli') return null;
  const start = ac.at || ac.base, home = ac.base;
  let q;
  if (!t.ret) {
    q = priceLegs(ac, [{ from: start, to: t.from, day: 0 }, { from: t.from, to: t.to, live: true, day: 0 }, { from: t.to, to: home, day: 0 }]);
    if (q) q.plan = near(t.to, home) ? 'Ends at the aircraft\'s base.' : 'Aircraft flies back to base empty after dropping you.';
  } else {
    const days = Math.max(0, dayDiff(t.date, t.ret));
    if (days === 0) {
      q = priceLegs(ac, [{ from: start, to: t.from, day: 0 }, { from: t.from, to: t.to, live: true, day: 0 },
        { from: t.to, to: t.from, live: true, day: 0 }, { from: t.from, to: home, day: 0 }]);
      if (q) q.plan = 'Aircraft waits for you and returns the same day.';
    } else {
      const stay = priceLegs(ac, [{ from: start, to: t.from, day: 0 }, { from: t.from, to: t.to, live: true, day: 0 },
        { from: t.to, to: t.from, live: true, day: days }, { from: t.from, to: home, day: days }], near(t.to, home) ? 0 : days);
      const ferry = priceLegs(ac, [{ from: start, to: t.from, day: 0 }, { from: t.from, to: t.to, live: true, day: 0 }, { from: t.to, to: home, day: 0 },
        { from: home, to: t.to, day: days }, { from: t.to, to: t.from, live: true, day: days }, { from: t.from, to: home, day: days }]);
      // ferry option: the aircraft is free between flights, so only the two flying days carry minimum billing
      if (ferry) { const min = CONFIG.minHoursPerDay[groupOf(ac.cat)], d0 = ferry.legs.filter(l => l.day === 0).reduce((s, l) => s + l.h, 0),
        d1 = ferry.legs.filter(l => l.day === days).reduce((s, l) => s + l.h, 0);
        ferry.billable = Math.max(d0, min) + Math.max(d1, min); ferry.minTopUp = ferry.billable - ferry.flown;
        ferry.charter = ferry.billable * ac.rate; ferry.gst = (ferry.charter + ferry.fees) * CONFIG.gst; ferry.total = ferry.charter + ferry.fees + ferry.gst; }
      if (stay && (!ferry || stay.total <= ferry.total)) { q = stay; q.plan = `Aircraft and crew stay with you for ${days} night${days > 1 ? 's' : ''}; cheaper than flying back to base in between.`; }
      else if (ferry) { q = ferry; q.plan = 'Aircraft returns to base between your flights; cheaper than keeping it with you.'; }
    }
  }
  if (!q) return null;
  q.posKm = near(start, t.from) ? 0 : km(AIRPORTS[start], AIRPORTS[t.from]);
  q.tripKm = km(AIRPORTS[t.from], AIRPORTS[t.to]);
  q.blockH = q.legs.find(l => l.live)?.h || 0;
  q.perSeat = q.total / Math.max(1, t.pax);
  return q;
}

// Search: price every aircraft, then group identical offers (same operator, model, base) into one result.
function search(fleet, t) {
  const groups = new Map();
  for (const ac of fleet) {
    const q = quote(ac, t);
    if (!q) continue;
    const k = [ac.op, ac.model, ac.at || ac.base, ac.rate, ac.seats].join('|');
    const g = groups.get(k);
    if (g) g.count++; else groups.set(k, { ac, q, count: 1, key: k });
  }
  return [...groups.values()];
}

if (typeof module !== 'undefined') module.exports = { km, buildFleet, quote, search, legHours };
