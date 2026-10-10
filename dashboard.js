/* Account area: guard, profile, live balance/trading ledger, wallet, transfers,
 * notifications, plans, currency, live charts, and Supabase sync.
 *
 * Local storage is the fast working copy. When Supabase is configured (sb-config.js),
 * every change is pushed automatically and the server is pulled on load and every ~10s.
 * NOTE: ledger rules run in the browser. Before handling real money, enforce them
 * server-side (Supabase Edge Functions / database functions).
 */
(function () {
  "use strict";

  var DB = window.DB || { enabled: false };
  var Site = DB.Site;
  var CONFIG = {
    TELEGRAM_URL: "https://t.me/yourbrand_support",
    AUTO_CONFIRM_MS: 0,
    MIN_DEPOSIT: 10,
    MIN_WITHDRAW: 10,
    MIN_TRANSFER: 1,
    UPGRADE_FEE_PCT: 0.12,
    PLANS: [],
    TV: { "BTC/USD": "BINANCE:BTCUSDT", "ETH/USD": "BINANCE:ETHUSDT", "SOL/USD": "BINANCE:SOLUSDT", "EUR/USD": "FX:EURUSD",
      "GBP/USD": "FX:GBPUSD", "USD/JPY": "FX:USDJPY", AAPL: "NASDAQ:AAPL", NVDA: "NASDAQ:NVDA", TSLA: "NASDAQ:TSLA" },
    // Put YOUR receiving wallet addresses here. These placeholders are NOT real addresses.
    METHODS: {
      BTC: { name: "Bitcoin", networks: {
        "Bitcoin": { address: "REPLACE_WITH_YOUR_BTC_ADDRESS", fee: 5, re: /^(bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/ } } },
      ETH: { name: "Ethereum", networks: {
        "Ethereum (ERC20)": { address: "REPLACE_WITH_YOUR_ETH_ADDRESS", fee: 3, re: /^0x[a-fA-F0-9]{40}$/ } } },
      USDT: { name: "Tether", networks: {
        "Tron (TRC20)": { address: "REPLACE_WITH_YOUR_USDT_TRC20_ADDRESS", fee: 1, re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ },
        "Ethereum (ERC20)": { address: "REPLACE_WITH_YOUR_USDT_ERC20_ADDRESS", fee: 4, re: /^0x[a-fA-F0-9]{40}$/ },
        "BNB Smart Chain (BEP20)": { address: "REPLACE_WITH_YOUR_USDT_BEP20_ADDRESS", fee: 0.5, re: /^0x[a-fA-F0-9]{40}$/ } } },
      SOL: { name: "Solana", networks: {
        "Solana": { address: "REPLACE_WITH_YOUR_SOL_ADDRESS", fee: 0.5, re: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ } } }
    }
  };

  var CURRENCIES = [
    ["USD", "US Dollar", 1], ["EUR", "Euro", 0.92], ["GBP", "British Pound", 0.79], ["JPY", "Japanese Yen", 150],
    ["CAD", "Canadian Dollar", 1.36], ["AUD", "Australian Dollar", 1.52], ["CHF", "Swiss Franc", 0.88],
    ["CNY", "Chinese Yuan", 7.2], ["INR", "Indian Rupee", 83], ["NGN", "Nigerian Naira", 1500],
    ["ZAR", "South African Rand", 18.5], ["GHS", "Ghanaian Cedi", 15], ["KES", "Kenyan Shilling", 130],
    ["AED", "UAE Dirham", 3.67], ["SAR", "Saudi Riyal", 3.75], ["TRY", "Turkish Lira", 33],
    ["BRL", "Brazilian Real", 5], ["MXN", "Mexican Peso", 17], ["SGD", "Singapore Dollar", 1.34],
    ["HKD", "Hong Kong Dollar", 7.8], ["KRW", "South Korean Won", 1350], ["SEK", "Swedish Krona", 10.5],
    ["NZD", "New Zealand Dollar", 1.65]
  ];

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function read(k, f) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? f : v; } catch (e) { return f; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  var Feed = window.Feed;
  var track = function (t, p) { if (DB.track) DB.track(t, p); };
  var brandName = function () { return DB.brand ? DB.brand() : "Your Brand"; };
  var norm = function (e) { return (e || "").trim().toLowerCase(); };
  function setHTML(el, html) { if (el && el._h !== html) { el._h = html; el.innerHTML = html; } }
  function warn(e) { if (window.console) console.warn("[sync]", e && e.message ? e.message : e); }

  /* ---------- site settings (plans + options managed by the admin) ---------- */
  var PL = [];
  function applySite() {
    if (!Site) return;
    var st = Site.settings();
    CONFIG.UPGRADE_FEE_PCT = (+st.feePct || 0) / 100;
    CONFIG.TELEGRAM_URL = st.telegram || CONFIG.TELEGRAM_URL;
    CONFIG.MIN_DEPOSIT = +st.minDeposit || 0;
    CONFIG.MIN_WITHDRAW = +st.minWithdraw || 0;
    CONFIG.AUTO_CONFIRM_MS = (+st.autoConfirmSec || 0) * 1000;
    PL = Site.plans();
    CONFIG.PLANS = PL;
    if ($("#telegram-link")) $("#telegram-link").href = CONFIG.TELEGRAM_URL;
  }
  applySite();

  /* ---------- user + guard ---------- */
  function currentUser() {
    try {
      var s = JSON.parse(localStorage.getItem("auth.session") || "null");
      var users = JSON.parse(localStorage.getItem("auth.users") || "{}");
      return s && users[s.email] ? users[s.email] : null;
    } catch (e) { return null; }
  }
  var user = currentUser();
  if (!user) { location.replace(document.getElementById("adm") ? "index.html" : "signin.html"); return; }
  function saveUser(patch) {
    var users = read("auth.users", {});
    users[user.email] = Object.assign({}, users[user.email], patch);
    write("auth.users", users);
    Object.assign(user, patch);
    if (DB.enabled) DB.pushProfile(patch).catch(warn);
  }

  /* ---------- currency ---------- */
  var rates = (read("fx.rates", null) || {}).rates || null;
  var cur = user.currency || "USD";
  function rate() {
    if (cur === "USD") return 1;
    if (rates && rates[cur]) return rates[cur];
    for (var i = 0; i < CURRENCIES.length; i++) if (CURRENCIES[i][0] === cur) return CURRENCIES[i][2];
    return 1;
  }
  var fmtCache = {};
  function fmt(code, v) {
    try {
      fmtCache[code] = fmtCache[code] || new Intl.NumberFormat(undefined, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" });
      return fmtCache[code].format(v);
    } catch (e) { return code + " " + v.toFixed(2); }
  }
  function money(n) { return fmt(cur, n * rate()); }
  function usd(n) { return fmt("USD", n); }
  function signed(n) { return (n >= 0 ? "+" : "") + money(n); }
  var toUsd = function (v) { return v / rate(); };
  var toDisp = function (u) { return Math.floor(u * rate() * 100) / 100; };
  function inputUsd(sel) { return toUsd(parseFloat($(sel).value) || 0); }
  function refreshRates() {
    var c = read("fx.rates", null);
    if (c && Date.now() - c.t < 6 * 3600 * 1000) return;
    fetch("https://open.er-api.com/v6/latest/USD").then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.rates) { rates = j.rates; write("fx.rates", { t: Date.now(), rates: j.rates }); scheduleRender(); }
    }).catch(function () {});
  }
  function paintCurrencyLabels() { $$(".cur-code").forEach(function (e) { e.textContent = cur; }); }

  /* ---------- formatting ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pfmt(sym, n) {
    var p = Feed.prices[sym];
    if (p && p.kind === "forex") return n < 10 ? n.toFixed(4) : n.toFixed(2);
    return money(n);
  }
  function pct(n) { return n == null ? "—" : (n >= 0 ? "+" : "") + n.toFixed(2) + "%"; }
  function cls(n) { return n == null || n >= 0 ? "up" : "down"; }
  function units(u) {
    var s = u >= 1000 ? u.toFixed(2) : u >= 1 ? u.toFixed(4) : u.toFixed(6);
    return String(parseFloat(s));
  }
  function when(ts) {
    try { return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return new Date(ts).toLocaleString(); }
  }
  function ago(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }
  function dur(ms) {
    var m = Math.floor(ms / 60000);
    if (m < 1) return "<1m";
    if (m < 60) return m + "m";
    var h = Math.floor(m / 60);
    return h < 48 ? h + "h " + (m % 60) + "m" : Math.floor(h / 24) + "d " + (h % 24) + "h";
  }
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var uid = function () { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3); };
  function coin(s) {
    var p = Feed.prices[s];
    return '<span class="coin">' + esc(p ? p.icon : s[0]) + "</span>";
  }
  function tick(s) {
    var p = Feed.prices[s];
    return p && p.dir && Date.now() - p.t < 1100 ? (p.dir > 0 ? " tick-up" : " tick-down") : "";
  }
  function say(sel, t, ok) {
    var e = $(sel);
    if (!e) return;
    e.textContent = t || "";
    e.classList.toggle("ok", !!ok && !!t);
  }
  function pill(status) {
    var good = status === "Completed", bad = /Rejected|Cancelled|Reversed/.test(status);
    return '<span class="pill ' + (good ? "ok" : bad ? "bad" : "") + '">' + status + "</span>";
  }
  function nameOf(email) {
    var u = read("auth.users", {})[norm(email)];
    if (u) return (u.first + " " + (u.last ? u.last[0] + "." : "")).trim();
    var n = read("names", {})[norm(email)];
    return n || email;
  }
  function rememberName(email, first, last) {
    var n = read("names", {});
    n[norm(email)] = (first + " " + (last ? last[0] + "." : "")).trim();
    write("names", n);
  }

  /* ---------- ledger (per user, cached) ---------- */
  function planIdOf(p) { return typeof p === "number" ? (PL[p] ? PL[p].id : "") : p || ""; }
  function normL(l) {
    l = l || {};
    return { cash: +l.cash || 0, positions: l.positions || [], orders: l.orders || [], history: l.history || [], tx: l.tx || [],
      notes: l.notes || [], welcomed: !!l.welcomed, plan: planIdOf(l.plan), rev: l.rev || 0, applied: l.applied || [], seen: l.seen || [] };
  }
  var lcache = {};
  function lkey(email) { return "ledger." + (email || user.email); }
  function rawGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function load(email) {
    var k = lkey(email), raw = rawGet(k), c = lcache[k];
    if (c && c.raw === raw) return c.obj;
    var obj;
    try { obj = normL(raw ? JSON.parse(raw) : {}); } catch (e) { obj = normL({}); }
    lcache[k] = { raw: raw, obj: obj };
    return obj;
  }
  function putLedger(email, l) {
    var k = lkey(email), raw = JSON.stringify(l);
    try { localStorage.setItem(k, raw); } catch (e) {}
    lcache[k] = { raw: raw, obj: l };
  }
  function mutate(fn, email) {
    var k = lkey(email), raw = rawGet(k), l;
    try { l = normL(raw ? JSON.parse(raw) : {}); } catch (e) { l = normL({}); }
    var out = fn(l);
    l.rev = (l.rev || 0) + 1;
    putLedger(email, l);
    if (DB.enabled && (!email || norm(email) === norm(user.email))) schedulePush();
    return out;
  }
  function pushNote(l, title, text, bid) {
    var n = { id: uid(), t: Date.now(), title: title, text: text, read: false };
    if (bid) n.bid = bid;
    l.notes.unshift(n);
    l.notes = l.notes.slice(0, 50);
  }

  function levOf(plan) { return plan ? plan.x * plan.x : 1; }
  function planIdx(l) { for (var i = 0; i < PL.length; i++) if (PL[i].id === l.plan) return i; return -1; }
  function planOf(l) { var i = planIdx(l); return i > -1 ? PL[i] : null; }
  function planName(id) { for (var i = 0; i < PL.length; i++) if (PL[i].id === id) return PL[i].name; return id || "No plan"; }

  // P/L always uses the leverage of the user's CURRENT plan (x factor squared)
  function posStats(p, l, px) {
    var c = px || Feed.prices[p.symbol].price, lv = levOf(planOf(l));
    var move = (p.side === "Long" ? c - p.entry : p.entry - c) / p.entry;
    var pnl = r2(Math.max(move * p.cost * lv, -p.cost)); // a loss can't exceed the margin
    return { cur: c, pnl: pnl, value: r2(p.cost + pnl), lev: lv };
  }
  function summary(l) {
    var s = { cash: l.cash, inPos: 0, pnl: 0, value: 0, equity: l.cash, kinds: { crypto: 0, forex: 0, stocks: 0 } };
    l.positions.forEach(function (p) {
      var st = posStats(p, l);
      s.inPos += p.cost; s.pnl += st.pnl; s.value += st.value;
      s.kinds[Feed.prices[p.symbol].kind] += st.value;
    });
    s.inPos = r2(s.inPos); s.pnl = r2(s.pnl); s.value = r2(s.value); s.equity = r2(l.cash + s.value);
    return s;
  }

  /* ---------- events: admin -> user changes (applied on the user's own ledger) ---------- */
  // act: "approve" (Pending->Completed), "reject" (Pending->Rejected), "reverse" (Completed->Reversed)
  function txAct(l, t, act) {
    var dep = t.type === "deposit", label = dep ? "Deposit" : "Withdrawal", amt = usd(t.usd);
    if (act === "approve" && t.status === "Pending") {
      t.status = "Completed"; t.settledAt = Date.now();
      if (dep) l.cash = r2(l.cash + t.usd);
      pushNote(l, label + " completed", dep ? amt + " was added to your balance." : amt + " withdrawal was approved and is on its way.");
      return { ok: true };
    }
    if (act === "reject" && t.status === "Pending") {
      t.status = "Rejected"; t.settledAt = Date.now();
      if (!dep) l.cash = r2(l.cash + t.usd);
      pushNote(l, label + " rejected", dep ? "Your " + amt + " deposit request was rejected." : "Your " + amt + " withdrawal was rejected and refunded.");
      return { ok: true };
    }
    if (act === "reverse" && t.status === "Completed") {
      if (dep) l.cash = r2(Math.max(0, l.cash - t.usd)); else l.cash = r2(l.cash + t.usd);
      t.status = "Reversed"; t.settledAt = Date.now();
      pushNote(l, label + " reversed", dep ? amt + " was removed from your balance." : amt + " was returned to your balance.");
      return { ok: true };
    }
    return { ok: false, msg: "Nothing to do." };
  }
  function applyEvent(l, ev) {
    switch (ev.type) {
      case "credit":
        l.cash = r2(l.cash + (+ev.usd || 0));
        if (!ev.silent) pushNote(l, ev.title || "Balance credited", ev.text || usd(+ev.usd || 0) + " was added to your balance.");
        break;
      case "debit":
        var d = Math.min(+ev.usd || 0, l.cash);
        l.cash = r2(l.cash - d);
        if (!ev.silent) pushNote(l, ev.title || "Balance adjusted", ev.text || usd(d) + " was removed from your balance.");
        break;
      case "note": pushNote(l, ev.title || "Message", ev.text || "", ev.bid); break;
      case "plan":
        l.plan = ev.plan || "";
        pushNote(l, ev.title || "Plan updated", ev.text || "Your plan was changed.");
        break;
      case "tx":
        var t = l.tx.filter(function (x) { return x.id === ev.id; })[0];
        if (t) txAct(l, t, ev.act);
        break;
      case "recall": l.notes = l.notes.filter(function (n) { return n.bid !== ev.bid; }); break;
      case "open": { // trade opened by an admin on the user's behalf (at the price the admin saw)
        var amt = r2(+ev.usd || 0), pr = +ev.price;
        if (!(amt > 0) || !(pr > 0)) break;
        if (amt > l.cash + 0.005) { pushNote(l, "Trade not placed", "Our team tried to open a " + ev.symbol + " trade but your available balance was too low."); break; }
        var lvl = levOf(planOf(l));
        l.cash = r2(l.cash - amt);
        l.positions.unshift({ id: ev.pid || uid(), symbol: ev.symbol, side: ev.side === "Buy" ? "Long" : "Short", entry: pr, cost: amt, openedAt: Date.now(), by: "admin" });
        l.orders.unshift({ id: uid(), t: Date.now(), symbol: ev.symbol, side: ev.side, kind: "Open", usd: amt, price: pr, lev: lvl, by: "admin" });
        if (!ev.silent) pushNote(l, "Trade opened by our team", (ev.side === "Buy" ? "Bought " : "Sold ") + usd(amt) + " of " + ev.symbol + " on your behalf.");
        break;
      }
      case "close": { // position closed by an admin
        var pi = l.positions.map(function (p) { return p.id; }).indexOf(ev.id);
        if (pi < 0) break;
        var pos = l.positions[pi], cp = +ev.price > 0 ? +ev.price : null, st = posStats(pos, l, cp);
        l.cash = r2(l.cash + st.value);
        l.positions.splice(pi, 1);
        l.orders.unshift({ id: uid(), t: Date.now(), symbol: pos.symbol, side: pos.side === "Long" ? "Sell" : "Buy", kind: "Close", usd: st.value, price: st.cur, lev: st.lev, by: "admin" });
        l.history.unshift({ id: pos.id, openedAt: pos.openedAt, closedAt: Date.now(), symbol: pos.symbol, side: pos.side, entry: pos.entry, exit: st.cur, cost: pos.cost, pnl: st.pnl, lev: st.lev, by: "admin" });
        if (!ev.silent) pushNote(l, "Trade closed by our team", pos.symbol + " position closed with " + (st.pnl >= 0 ? "a profit of " : "a loss of ") + usd(Math.abs(st.pnl)) + ".");
        break;
      }
    }
  }
  function applyInboxRows(rows) {
    var fresh = rows.filter(function (r) { return load().applied.indexOf(r.id) < 0; });
    if (fresh.length) mutate(function (l) {
      fresh.forEach(function (r) { applyEvent(l, r.payload || {}); l.applied.push(r.id); });
      l.applied = l.applied.slice(-300);
    });
    return rows.length ? DB.ackInbox(rows.map(function (r) { return r.id; })) : Promise.resolve();
  }
  // delivered admin messages -> notifications (scheduled ones appear once their time passes)
  function applyBroadcasts(list) {
    var me = norm(user.email), l = load(), have = {}, seen = {};
    l.notes.forEach(function (n) { if (n.bid) have[n.bid] = 1; });
    l.seen.forEach(function (id) { seen[id] = 1; });
    var add = [], rem = [];
    list.forEach(function (m) {
      var mine = m.sendAll || (m.recipients || []).map(norm).indexOf(me) > -1;
      if (!mine) return;
      if (m.status === "active" && Date.parse(m.deliverAt) <= Date.now() && !seen[m.id]) add.push(m);
      if ((m.status === "recalled" || m.status === "cancelled") && have[m.id]) rem.push(m.id);
    });
    if (!add.length && !rem.length) return;
    mutate(function (l2) {
      add.forEach(function (m) { pushNote(l2, m.title, m.body, m.id); l2.seen.push(m.id); });
      if (rem.length) l2.notes = l2.notes.filter(function (n) { return rem.indexOf(n.bid) < 0; });
      l2.seen = l2.seen.slice(-300);
    });
  }
  function settleOwn() {
    if (!CONFIG.AUTO_CONFIRM_MS) return;
    var l = load();
    var due = l.tx.some(function (t) { return t.status === "Pending" && Date.now() - t.createdAt >= CONFIG.AUTO_CONFIRM_MS; });
    if (!due) return;
    mutate(function (l2) {
      l2.tx.forEach(function (t) { if (t.status === "Pending" && Date.now() - t.createdAt >= CONFIG.AUTO_CONFIRM_MS) txAct(l2, t, "approve"); });
    });
  }

  /* ---------- transfers + plan requests (local cache, mirrored to Supabase) ---------- */
  var inflight = 0;
  function track(p) { inflight++; return p.catch(warn).then(function () { inflight--; }); }
  var getTransfers = function () { return read("transfers", []); };
  function saveTransfer(t) {
    var all = getTransfers(), i = -1;
    all.forEach(function (x, k) { if (x.id === t.id) i = k; });
    if (i > -1) all[i] = t; else all.unshift(t);
    write("transfers", all);
    return DB.enabled ? track(DB.upsertTransfer(t)) : Promise.resolve();
  }
  var getReqs = function () { return read("planReqs", []); };
  function saveReq(r) {
    var all = getReqs(), i = -1;
    all.forEach(function (x, k) { if (x.id === r.id) i = k; });
    if (i > -1) all[i] = r; else all.unshift(r);
    write("planReqs", all);
    return DB.enabled ? track(DB.upsertPlanReq(r)) : Promise.resolve();
  }
  var trFromRow = function (r) { return { id: r.id, from: norm(r.from_email), to: norm(r.to_email), usd: +r.usd, note: r.note || "", status: r.status, createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at) }; };
  var reqFromRow = function (r) { return { id: r.id, email: norm(r.email), plan: r.plan, name: r.plan_name || "", from: r.from_plan || "", fee: +r.fee, status: r.status, createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at) }; };

  function resolveUser(email) {
    email = norm(email);
    if (DB.enabled) return DB.lookup(email).then(function (d) { return d ? { first: d.first_name, last: d.last_name } : null; }).catch(function () { return null; });
    var u = read("auth.users", {})[email];
    return Promise.resolve(u && u.verified ? { first: u.first, last: u.last } : null);
  }
  function sendTransfer(toEmail, amt, note) {
    var to = norm(toEmail);
    return resolveUser(to).then(function (rcv) {
      if (!rcv) return { ok: false, msg: "No registered user found for that Gmail. Please enter the Gmail of a registered user." };
      if (to === norm(user.email)) return { ok: false, msg: "You can't send money to yourself." };
      if (!(amt >= CONFIG.MIN_TRANSFER)) return { ok: false, msg: "Minimum transfer is " + money(CONFIG.MIN_TRANSFER) + "." };
      rememberName(to, rcv.first, rcv.last);
      var r = mutate(function (l) {
        if (amt > l.cash + 0.005) return { ok: false, msg: "Not enough balance. You have " + money(l.cash) + " available." };
        amt = r2(amt);
        l.cash = r2(l.cash - amt);
        pushNote(l, "Transfer submitted", money(amt) + " to " + nameOf(to) + " is waiting for approval.");
        return { ok: true };
      });
      if (!r.ok) return r;
      saveTransfer({ id: uid(), from: norm(user.email), to: to, usd: amt, note: (note || "").slice(0, 80), status: "Pending", createdAt: Date.now(), updatedAt: Date.now() });
      if (!DB.enabled) mutate(function (l) { pushNote(l, "Incoming transfer", nameOf(user.email) + " sent you " + money(amt) + ". It will arrive once approved."); }, to);
      track("transfer_send");
      return { ok: true, msg: "Transfer submitted. It will reach " + nameOf(to) + " once approved." };
    });
  }

  /* ---------- trading ---------- */
  function tradeGate(l) {
    var p = planOf(l);
    if (!p) return { ok: false, needPlan: true, msg: "You need a plan to trade. Pick one on your dashboard (you can still browse markets and charts)." };
    var eq = summary(l).equity;
    if (eq + 0.005 < p.min) return { ok: false, msg: "Your balance is below the " + p.name + " plan minimum of " + money(p.min) + ". Deposit " + money(p.min - eq) + " to resume trading." };
    return { ok: true };
  }
  function openPosition(sym, side, amt) {
    var p = Feed.prices[sym];
    if (!p || !Feed.tradable(sym)) return { ok: false, msg: "No live price for " + sym + " right now." };
    if (!(amt >= CONFIG.MIN_TRANSFER)) return { ok: false, msg: "Minimum trade is " + money(CONFIG.MIN_TRANSFER) + "." };
    return mutate(function (l) {
      var g = tradeGate(l);
      if (!g.ok) return g;
      if (amt > l.cash + 0.005) return { ok: false, msg: "Not enough balance. You have " + money(l.cash) + " available." };
      var lv = levOf(planOf(l));
      amt = r2(amt);
      l.cash = r2(l.cash - amt);
      l.positions.unshift({ id: uid(), symbol: sym, side: side === "Buy" ? "Long" : "Short", entry: p.price, cost: amt, openedAt: Date.now() });
      l.orders.unshift({ id: uid(), t: Date.now(), symbol: sym, side: side, kind: "Open", usd: amt, price: p.price, lev: lv });
      track("trade_open", { symbol: sym, side: side });
      return { ok: true, msg: (side === "Buy" ? "Bought " : "Sold ") + money(amt) + " of " + sym + (lv > 1 ? " at ×" + lv + " leverage." : ".") };
    });
  }
  function closePosition(id) {
    return mutate(function (l) {
      var i = l.positions.map(function (p) { return p.id; }).indexOf(id);
      if (i < 0) return { ok: false };
      var p = l.positions[i];
      if (!Feed.tradable(p.symbol)) return { ok: false, msg: "No live price for " + p.symbol + " right now." };
      var st = posStats(p, l);
      l.cash = r2(l.cash + st.value);
      l.positions.splice(i, 1);
      l.orders.unshift({ id: uid(), t: Date.now(), symbol: p.symbol, side: p.side === "Long" ? "Sell" : "Buy", kind: "Close", usd: st.value, price: st.cur, lev: st.lev });
      track("trade_close", { symbol: p.symbol });
      l.history.unshift({ id: p.id, openedAt: p.openedAt, closedAt: Date.now(), symbol: p.symbol, side: p.side, entry: p.entry, exit: st.cur, cost: p.cost, pnl: st.pnl, lev: st.lev });
      return { ok: true };
    });
  }

  /* ---------- plans ---------- */
  function planFee(p) { return r2(p.min * CONFIG.UPGRADE_FEE_PCT); }
  function myPending() { var me = norm(user.email); return getReqs().filter(function (r) { return r.email === me && r.status === "Pending"; })[0]; }
  function requestPlan(id) {
    var idx = -1;
    PL.forEach(function (p, i) { if (p.id === id) idx = i; });
    if (idx < 0) return { ok: false, msg: "That plan is no longer available." };
    var p = PL[idx], fee = planFee(p);
    if (myPending()) return { ok: false, msg: "You already have an upgrade request waiting for approval." };
    var r = mutate(function (l) {
      if (idx <= planIdx(l)) return { ok: false, msg: "You can only upgrade to a higher plan." };
      var eq = summary(l).equity;
      if (l.cash + 0.005 < fee) return { ok: false, msg: "You need " + money(fee) + " available for the upgrade fee. Deposit funds first." };
      if (eq - fee + 0.005 < p.min) return { ok: false, msg: p.name + " needs a balance of at least " + money(p.min) + " after the " + money(fee) + " fee. Deposit " + money(p.min + fee - eq) + " more." };
      l.cash = r2(l.cash - fee);
      pushNote(l, "Upgrade requested", "Your " + p.name + " plan request is waiting for approval. The " + money(fee) + " fee is held until then.");
      return { ok: true, from: l.plan };
    });
    if (!r.ok) return r;
    track("plan_request", { plan: p.id });
    saveReq({ id: uid(), email: norm(user.email), plan: p.id, name: p.name, from: r.from, fee: fee, status: "Pending", createdAt: Date.now(), updatedAt: Date.now() });
    return { ok: true, msg: "Request sent. Our team will review it shortly." };
  }
  function planCardsHTML(l, compact) {
    var pend = myPending(), ci = planIdx(l);
    return '<div class="plan-list' + (compact ? " compact" : "") + '">' + PL.map(function (p, i) {
      var st = i === ci ? "current" : i < ci ? "done" : "locked", act;
      if (i === ci) act = '<span class="tier-pill now">Current plan</span>';
      else if (i < ci) act = '<span class="hint" style="margin:0">Below your plan</span>';
      else if (pend && pend.plan === p.id) act = '<span class="tier-pill">Awaiting approval</span>';
      else if (pend) act = '<button class="btn sm" disabled>Request pending</button>';
      else act = '<button class="btn sm plan-req" data-id="' + esc(p.id) + '">' + (ci < 0 ? "Choose" : "Upgrade") + " · fee " + money(planFee(p)) + "</button>";
      return '<div class="plan-card ' + st + '" style="--c:' + esc(p.color) + '"><span class="tier">' + (i + 1) + '</span><div class="plan-info"><div class="plan-name"><b>' + esc(p.name) + "</b>" +
        (p.tag ? '<span class="tier-pill">' + esc(p.tag) + "</span>" : "") + "</div><small>Min balance " + money(p.min) + " · x" + p.x + " factor · ×" + p.x * p.x + " leverage &amp; P/L</small>" +
        '<ul class="perks">' + (p.perks || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul></div><div class="plan-act">' + act + "</div></div>";
    }).join("") + "</div>";
  }
  function renderPlanUI(l, s) {
    var chip = $("#plan-chip"), p = planOf(l), pend = myPending(), feeTxt = Math.round(CONFIG.UPGRADE_FEE_PCT * 1000) / 10;
    if (chip) {
      chip.hidden = false;
      chip.style.setProperty("--c", p ? p.color : "var(--mute)");
      chip.textContent = p ? p.name + " plan · ×" + levOf(p) : "No plan · choose one";
      chip.setAttribute("href", p ? "settings.html#plan" : "#home-plans");
    }
    if ($("#home-plans-body")) {
      setHTML($("#home-plans-body"), planCardsHTML(l, true));
      $("#home-plan-note").textContent = !p
        ? "Choose a plan to start trading. You can explore markets, charts and your wallet without one."
        : "Upgrade fee is " + feeTxt + "% of the plan's minimum.";
    }
    if ($("#plan-body")) {
      setHTML($("#plan-body"), '<div class="plan-now"><span>Your balance</span><b>' + money(s.equity) + "</b></div>" +
        '<p class="hint" style="margin:0 0 14px">' + (!p ? "You don't have a plan yet. You can use the platform, but you need a plan to trade." :
          "You're on <b>" + esc(p.name) + "</b>: x" + p.x + " factor, ×" + levOf(p) + " leverage. Trading needs a balance of at least " + money(p.min) + ".") +
        " Upgrading costs " + feeTxt + "% of the new plan's minimum, is approved by our team, and is refunded if rejected. Plans can only be upgraded, not downgraded.</p>" +
        planCardsHTML(l, false));
      $("#sum-plan").textContent = p ? p.name + " plan · ×" + levOf(p) + (pend ? " · upgrade pending" : "") : pend ? "Request pending" : "No plan yet";
    }
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".plan-req");
    if (!b) return;
    var p = PL.filter(function (x) { return x.id === b.dataset.id; })[0];
    if (!p) return;
    if (!confirm("Request the " + p.name + " plan?\n\nA fee of " + money(planFee(p)) + " (" + Math.round(CONFIG.UPGRADE_FEE_PCT * 1000) / 10 + "% of the " + money(p.min) + " minimum) is taken from your balance now and refunded if the request is rejected.")) return;
    var r = requestPlan(p.id);
    $$(".plan-msg").forEach(function (m) { m.textContent = r.msg; m.classList.toggle("ok", !!r.ok); });
    renderLive();
  });

  /* ---------- live charts (TradingView) ---------- */
  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function loadChart(box, sym) {
    if (!box) return;
    box.innerHTML = "";
    var wrap = document.createElement("div"), w = document.createElement("div"), sc = document.createElement("script");
    wrap.className = "tradingview-widget-container";
    wrap.style.cssText = "height:100%;width:100%";
    w.className = "tradingview-widget-container__widget";
    w.style.cssText = "height:100%;width:100%";
    sc.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    sc.async = true;
    sc.text = JSON.stringify({ autosize: true, symbol: CONFIG.TV[sym] || sym, interval: "1", timezone: "Etc/UTC", theme: isDark() ? "dark" : "light", style: "1",
      locale: "en", allow_symbol_change: false, hide_side_toolbar: false, calendar: false, support_host: "https://www.tradingview.com" });
    wrap.appendChild(w); wrap.appendChild(sc); box.appendChild(wrap);
  }
  var chartOpen = null;
  function updateChartStats() {
    if (!chartOpen) return;
    var sym = chartOpen.sym, p = Feed.prices[sym], ok = Feed.tradable(sym), l = load();
    $("#cm-price").textContent = ok ? pfmt(sym, p.price) + "  " + pct(p.change) : Feed.note(sym) || "";
    var pos = chartOpen.pos && l.positions.filter(function (x) { return x.id === chartOpen.pos; })[0], html = "";
    if (pos) {
      var st = posStats(pos, l);
      html = [["Side", '<span class="' + (pos.side === "Long" ? "buy" : "sell") + '">' + pos.side + "</span>"], ["Leverage", "×" + st.lev], ["Margin", money(pos.cost)], ["Position size", money(pos.cost * st.lev)],
        ["Entry", pfmt(sym, pos.entry)], ["Now", pfmt(sym, st.cur)], ["P&amp;L", '<span class="' + cls(st.pnl) + '">' + signed(st.pnl) + "</span>"]]
        .map(function (c) { return "<div><span>" + c[0] + "</span><b>" + c[1] + "</b></div>"; }).join("");
    }
    setHTML($("#cm-stats"), html);
    $("#cm-stats").hidden = !html;
  }
  function openChart(sym, posId) {
    var m = $("#chart-modal");
    if (!m || !Feed.prices[sym]) return;
    chartOpen = { sym: sym, pos: posId || "" };
    $("#cm-sym").textContent = sym;
    m.hidden = false;
    loadChart($("#cm-chart"), sym);
    updateChartStats();
  }
  function closeChart() {
    var m = $("#chart-modal");
    if (!m) return;
    m.hidden = true; chartOpen = null;
    $("#cm-chart").innerHTML = "";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-chart]");
    if (b) { e.preventDefault(); openChart(b.dataset.chart, b.dataset.pos); return; }
    if (e.target.id === "chart-modal" || e.target.closest("#cm-close")) closeChart();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && chartOpen) closeChart(); });

  /* ---------- profile photo ---------- */
  function paintAvatar() {
    $$(".av").forEach(function (el) {
      var img = el.querySelector("img"), ph = el.querySelector("svg");
      if (!img) return;
      if (user.avatar) { if (img.getAttribute("src") !== user.avatar) img.src = user.avatar; img.hidden = false; if (ph) ph.style.display = "none"; }
      else { img.hidden = true; img.removeAttribute("src"); if (ph) ph.style.display = ""; }
    });
    if ($("#avatar-remove")) $("#avatar-remove").hidden = !user.avatar;
    if ($("#avatar-pick")) $("#avatar-pick").textContent = user.avatar ? "Change photo" : "Upload photo";
  }
  function toAvatar(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = reject;
      fr.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var S = 256, c = document.createElement("canvas"), m = Math.min(img.width, img.height);
          c.width = c.height = S;
          c.getContext("2d").drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
          resolve(c.toDataURL("image/jpeg", 0.85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function initAvatar() {
    var file = $("#avatar-file");
    if (!file) return;
    $("#avatar-pick").onclick = function () { file.click(); };
    file.onchange = function () {
      var f = file.files && file.files[0];
      file.value = "";
      if (!f) return;
      if (!/^image\//.test(f.type)) return say("#e-avatar", "Please choose an image file.");
      if (f.size > 10 * 1024 * 1024) return say("#e-avatar", "That image is too large (max 10 MB).");
      toAvatar(f).then(function (data) {
        saveUser({ avatar: data }); paintAvatar(); say("#e-avatar", "Photo updated.", true);
      }).catch(function () { say("#e-avatar", "Could not read that image. Try another one."); });
    };
    $("#avatar-remove").onclick = function () { saveUser({ avatar: "" }); paintAvatar(); say("#e-avatar", "Photo removed.", true); };
  }

  /* ---------- header / sidebar ---------- */
  function paintUser() {
    var full = ((user.first || "Trader") + " " + (user.last || "")).trim();
    if ($("#side-name")) $("#side-name").textContent = full;
    if ($("#side-email")) $("#side-email").textContent = user.email;
    if ($("#hello")) $("#hello").textContent = "Hello, " + (user.first || "Trader");
    paintAvatar();
  }
  function showAdminLinks(on) { $$("[data-admin]").forEach(function (e) { e.hidden = !on; }); }
  if (DB.enabled) { if (user.role === "admin") showAdminLinks(true); }
  else if (window.SDSS_IS_ADMIN && window.SDSS_IS_ADMIN(user.email)) showAdminLinks(true);
  paintUser();
  initAvatar();
  paintCurrencyLabels();

  function renderVerifyBanner() {
    var fresh = read("auth.users", {})[user.email];
    if (fresh && !DB.enabled) user.unverified = !!fresh.unverified;
    var b = $("#verify-banner"), main = $(".app-main");
    if (!main || $("#adm")) return;
    if (!user.unverified) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement("div");
      b.id = "verify-banner";
      b.className = "gate";
      b.style.marginBottom = "18px";
      main.insertBefore(b, main.firstChild);
    }
    setHTML(b, "<b>Your account needs your attention.</b> Contact the admin to verify your account. " +
      '<a class="link" href="' + esc(CONFIG.TELEGRAM_URL) + '" target="_blank" rel="noopener noreferrer">Contact support</a>');
  }
  function renderStatus() {
    var st = Feed.status(), el = $("#feed-status");
    if (!el) return;
    el.className = "live-pill " + (st === "live" ? "live" : st === "offline" ? "off" : "");
    el.textContent = st === "live" ? "Live prices" : st === "offline" ? "Prices offline" : "Connecting…";
  }

  /* ---------- notifications ---------- */
  var notesSig = "";
  function renderNotes(force) {
    var btn = $("#notif-btn");
    if (!btn) return;
    var notes = load().notes, unread = notes.filter(function (n) { return !n.read; }).length;
    var sig = notes.map(function (n) { return n.id + (n.read ? 1 : 0); }).join();
    var badge = $("#notif-badge");
    badge.hidden = !unread;
    badge.textContent = unread > 9 ? "9+" : unread;
    btn.setAttribute("aria-label", unread ? "Notifications, " + unread + " unread" : "Notifications");
    if (!force && sig === notesSig) return;
    notesSig = sig;
    $("#notif-list").innerHTML = notes.length ? notes.map(function (n) {
      return '<button class="np-item' + (n.read ? "" : " unread") + '" data-id="' + n.id + '"><i></i><span><b>' + esc(n.title) + "</b><small>" + esc(n.text) + "</small><em>" + ago(n.t) + "</em></span></button>";
    }).join("") : '<div class="empty-note">You\'re all caught up.</div>';
  }
  function setNotesRead(id) {
    mutate(function (l) { l.notes.forEach(function (n) { if (!id || n.id === id) n.read = true; }); });
    renderNotes(true);
  }
  function initNotes() {
    var btn = $("#notif-btn"), panel = $("#notif-panel");
    if (!btn) return;
    function toggle(open) {
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) renderNotes(true);
    }
    btn.onclick = function (e) { e.stopPropagation(); toggle(panel.hidden); };
    panel.addEventListener("click", function (e) {
      e.stopPropagation();
      var it = e.target.closest(".np-item");
      if (it) setNotesRead(it.dataset.id);
    });
    $("#notif-readall").onclick = function () { setNotesRead(); };
    document.addEventListener("click", function () { if (!panel.hidden) toggle(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) { toggle(false); btn.focus(); } });
    if (!DB.enabled) welcomeOnce(); // with Supabase this waits for the first sync so a new device never overwrites server data
  }
  function welcomeOnce() {
    if (load().welcomed) return;
    mutate(function (l) {
      l.welcomed = true;
      pushNote(l, "Welcome to " + brandName(), "Choose a plan on your dashboard and fund your wallet to start trading. Tap the Telegram link if you need help.");
    });
  }

  /* ---------- dashboard ---------- */
  function assetRow(s) {
    var p = Feed.prices[s], n = Feed.note(s), ok = Feed.tradable(s);
    return '<div class="row">' + coin(s) + '<div class="grow"><b>' + s + "</b><small>" + p.kind + (n ? " · " + n : "") + "</small></div>" +
      '<div class="end"><b class="px' + tick(s) + '">' + (ok ? pfmt(s, p.price) : "—") + '</b><small class="' + cls(p.change) + '">' + (ok ? pct(p.change) : "") + "</small></div></div>";
  }
  function renderDashboard(l, s) {
    if (!$("#total-balance")) return;
    $("#total-balance").textContent = money(s.equity);
    var pc = s.inPos ? (s.pnl / s.inPos) * 100 : 0, sub = $("#balance-sub"), lv = levOf(planOf(l));
    sub.className = s.inPos ? cls(s.pnl) : "";
    sub.style.fontWeight = "700";
    sub.textContent = s.inPos ? "Open P&L " + signed(s.pnl) + " (" + pct(pc) + ")" + (lv > 1 ? " · ×" + lv + " leverage" : "") : s.equity > 0 ? "No open trades" : "Deposit funds to start trading";
    $("#stat-avail").textContent = money(s.cash);
    $("#stat-inpos").textContent = money(s.inPos);
    $("#stat-pnl").textContent = signed(s.pnl);
    $("#stat-pnl").className = s.inPos ? cls(s.pnl) : "";
    setHTML($("#market-watch"), ["BTC/USD", "ETH/USD", "SOL/USD", "EUR/USD"].map(assetRow).join(""));
    setHTML($("#positions-preview"), l.positions.length
      ? l.positions.slice(0, 4).map(function (p) {
          var st = posStats(p, l);
          return '<button class="row row-btn" data-chart="' + esc(p.symbol) + '" data-pos="' + p.id + '" title="Open live chart">' + coin(p.symbol) + '<div class="grow"><b>' + esc(p.symbol) + "</b><small>" + p.side + " ×" + st.lev + " · " + money(p.cost) + "</small></div>" +
            '<b class="' + cls(st.pnl) + '">' + signed(st.pnl) + "</b></button>";
        }).join("")
      : '<div class="empty-note">No open positions yet. <a class="link" href="trade.html">Make a trade</a></div>');
  }

  /* ---------- portfolio ---------- */
  function renderPortfolio(l, s) {
    var box = $("#positions-full");
    if (!box) return;
    setHTML(box, l.positions.length
      ? l.positions.map(function (p) {
          var st = posStats(p, l);
          return '<tr><td><button class="asset asset-link" data-chart="' + esc(p.symbol) + '" data-pos="' + p.id + '" title="Open live chart">' + coin(p.symbol) + "<b>" + esc(p.symbol) + "</b></button></td>" +
            '<td class="' + (p.side === "Long" ? "buy" : "sell") + '">' + p.side + "<small>×" + st.lev + "</small></td><td>" + money(p.cost) + "</td><td>" + pfmt(p.symbol, p.entry) + "</td>" +
            '<td class="px' + tick(p.symbol) + '">' + pfmt(p.symbol, st.cur) + '</td><td class="' + cls(st.pnl) + '">' + signed(st.pnl) + "</td>" +
            '<td><button class="btn sm ghost close-position" data-id="' + p.id + '">Close</button></td></tr>';
        }).join("")
      : '<tr><td colspan="7" class="empty-note">No open positions.</td></tr>');
    var parts = [["Stocks", s.kinds.stocks, "#5878b9"], ["Forex", s.kinds.forex, "#4aa8a0"], ["Crypto", s.kinds.crypto, "var(--accent)"], ["Cash", s.cash, "var(--fieldline)"]];
    var tot = s.equity, acc = 0, stops = [];
    parts.forEach(function (p) {
      var w = tot > 0 ? (p[1] / tot) * 100 : 0;
      if (w > 0) stops.push(p[2] + " " + acc + "% " + (acc + w) + "%");
      acc += w;
    });
    $("#donut").style.background = stops.length ? "conic-gradient(" + stops.join(",") + ")" : "var(--field)";
    $("#donut-total").textContent = money(tot);
    setHTML($("#legend"), parts.map(function (p) {
      return '<span><i style="background:' + p[2] + '"></i>' + p[0] + "<b>" + (tot > 0 ? Math.round((p[1] / tot) * 100) : 0) + "%</b></span>";
    }).join(""));
  }
  if ($("#positions-full")) $("#positions-full").addEventListener("click", function (e) {
    var b = e.target.closest(".close-position");
    if (!b) return;
    var r = closePosition(b.dataset.id);
    if (r && r.ok === false && r.msg) alert(r.msg);
    renderLive();
  });

  /* ---------- markets ---------- */
  var mFilter = "all";
  function renderMarkets() {
    var box = $("#market-table");
    if (!box) return;
    setHTML(box, Object.keys(Feed.prices).filter(function (k) { return mFilter === "all" || Feed.prices[k].kind === mFilter; }).map(function (s) {
      var p = Feed.prices[s], n = Feed.note(s), ok = Feed.tradable(s);
      return '<tr><td><button class="asset asset-link" data-chart="' + s + '" title="Open live chart">' + coin(s) + "<div><b>" + s + "</b><small>" + p.kind + (n ? " · " + n : "") + "</small></div></button></td>" +
        '<td class="px' + tick(s) + '">' + (ok ? pfmt(s, p.price) : "—") + '</td><td class="' + cls(p.change) + '">' + (ok ? pct(p.change) : "—") + "</td>" +
        "<td>" + (ok ? '<a class="btn sm ghost" href="trade.html?asset=' + encodeURIComponent(s) + '">Trade</a>' : "") + "</td></tr>";
    }).join(""));
  }
  $$("[data-market-tab]").forEach(function (b) {
    b.onclick = function () {
      $$("[data-market-tab]").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      mFilter = b.dataset.marketTab;
      renderMarkets();
    };
  });

  /* ---------- orders / history ---------- */
  function renderOrders() {
    var box = $("#orders-table");
    if (!box) return;
    var arr = load().orders;
    setHTML(box, arr.length ? arr.map(function (o) {
      return "<tr><td>" + when(o.t) + "</td><td><b>" + esc(o.symbol) + '</b></td><td class="' + (o.side === "Buy" ? "buy" : "sell") + '">' + o.side + " · " + o.kind + (o.by === "admin" ? "<small>Placed by our team</small>" : "") + "</td><td>" + money(o.usd) + "</td><td>" + pfmt(o.symbol, o.price) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty-note">No orders yet.</td></tr>');
  }
  function renderHistory() {
    var box = $("#history-table");
    if (!box) return;
    var arr = load().history;
    setHTML(box, arr.length ? arr.map(function (h) {
      return "<tr><td>" + when(h.closedAt) + "</td><td><b>" + esc(h.symbol) + '</b></td><td class="' + (h.side === "Long" ? "buy" : "sell") + '">' + h.side + "</td><td>" + money(h.cost) + "</td><td>" + pfmt(h.symbol, h.entry) + "</td><td>" + pfmt(h.symbol, h.exit) + "</td><td>" + dur(h.closedAt - h.openedAt) + '</td><td class="' + cls(h.pnl) + '">' + signed(h.pnl) + "</td></tr>";
    }).join("") : '<tr><td colspan="8" class="empty-note">No closed trades yet.</td></tr>');
  }
  if ($("#export-history")) $("#export-history").onclick = function () {
    var rows = [["Closed", "Asset", "Side", "Amount USD", "Entry", "Exit", "Duration", "P&L USD"]].concat(load().history.map(function (h) {
      return [new Date(h.closedAt).toISOString(), h.symbol, h.side, h.cost, h.entry, h.exit, dur(h.closedAt - h.openedAt), h.pnl];
    }));
    var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "trade-history.csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };

  /* ---------- trade ---------- */
  var tradeSide = "Buy";
  function refreshTrade(l) {
    var sel = $("#order-asset");
    if (!sel) return;
    var s = sel.value, p = Feed.prices[s], ok = Feed.tradable(s);
    var amt = inputUsd("#order-amount"), plan = planOf(l), lv = levOf(plan), gate = tradeGate(l);
    $("#trade-symbol").textContent = s;
    $("#trade-price").textContent = ok ? pfmt(s, p.price) : "—";
    $("#trade-price").className = "price-big px" + tick(s);
    $("#trade-change").textContent = ok ? pct(p.change) + " (24h)" : Feed.note(s) || "No live price";
    $("#trade-change").className = ok ? cls(p.change) : "";
    $("#trade-avail").textContent = money(l.cash);
    $("#trade-lev").textContent = plan ? "×" + lv + " (" + plan.name + ")" : "—";
    $("#trade-bp").textContent = plan ? money(l.cash * lv) : "—";
    $("#trade-size").textContent = amt > 0 && plan ? money(amt * lv) : "—";
    $("#est-units").textContent = ok && amt > 0 ? units((amt * lv) / p.price) + " " + s.split("/")[0] : "—";
    var g = $("#trade-gate");
    g.hidden = gate.ok;
    if (!gate.ok) setHTML(g, esc(gate.msg) + (gate.needPlan ? ' <a class="link" href="account.html#home-plans">Choose a plan</a>' : ' <a class="link" href="wallet.html#deposit">Add funds</a>'));
    var btn = $("#place-order");
    btn.textContent = tradeSide + " " + s.split("/")[0];
    btn.disabled = !ok || !gate.ok;
    btn.style.background = tradeSide === "Sell" ? "var(--err)" : "";
    btn.style.color = tradeSide === "Sell" ? "#fff" : "";
    var arr = l.orders.slice(0, 4);
    setHTML($("#trade-activity"), arr.length ? arr.map(function (o) {
      return '<div class="row"><div class="grow"><b>' + o.side + " " + esc(o.symbol) + "</b><small>" + o.kind + " · " + when(o.t) + "</small></div><b>" + money(o.usd) + "</b></div>";
    }).join("") : '<div class="empty-note">No orders yet.</div>');
  }
  function initTrade() {
    var sel = $("#order-asset");
    if (!sel) return;
    sel.innerHTML = Object.keys(Feed.prices).map(function (s) { return "<option>" + s + "</option>"; }).join("");
    var asked = new URLSearchParams(location.search).get("asset");
    if (asked && Feed.prices[asked]) sel.value = asked;
    var chartSym = "";
    function chart() { if (chartSym !== sel.value) { chartSym = sel.value; $("#chart-sym").textContent = chartSym; loadChart($("#trade-chart"), chartSym); } }
    sel.onchange = function () { refreshTrade(load()); chart(); };
    $("#order-amount").oninput = function () { refreshTrade(load()); };
    chart();
    $$("[data-side]").forEach(function (b) {
      b.onclick = function () {
        tradeSide = b.dataset.side;
        $$("[data-side]").forEach(function (x) { x.classList.toggle("active", x === b); });
        refreshTrade(load());
      };
    });
    $("#max-btn").onclick = function () { $("#order-amount").value = toDisp(load().cash) || ""; refreshTrade(load()); };
    $("#place-order").onclick = function () {
      var r = openPosition(sel.value, tradeSide, inputUsd("#order-amount"));
      say("#trade-msg", r.msg, r.ok);
      if (r.ok) $("#order-amount").value = "";
      renderLive();
    };
  }

  /* ---------- wallet ---------- */
  function usdPerCoin(c) {
    if (c === "USDT") return 1;
    var p = Feed.prices[c + "/USD"];
    return p && Feed.tradable(c + "/USD") ? p.price : null;
  }
  function fillNetworks(coinSel, netSel) {
    netSel.innerHTML = Object.keys(CONFIG.METHODS[coinSel.value].networks).map(function (n) { return "<option>" + n + "</option>"; }).join("");
  }
  function txRows(l) {
    var me = norm(user.email), rows = [];
    l.tx.forEach(function (t) {
      rows.push({ t: t.createdAt, type: t.type === "deposit" ? "Deposit" : "Withdrawal", detail: esc(t.coin) + "<small>" + esc(t.network) + "</small>", sign: t.type === "deposit" ? "+" : "-", usd: t.usd, status: t.status });
    });
    getReqs().forEach(function (r) {
      if (r.email === me) rows.push({ t: r.createdAt, type: "Plan upgrade", detail: esc(r.name || planName(r.plan)) + " plan<small>Upgrade fee</small>", sign: "-", usd: r.fee, status: r.status });
    });
    getTransfers().forEach(function (t) {
      if (t.from === me) rows.push({ t: t.createdAt, type: "Sent", detail: "To " + esc(nameOf(t.to)) + (t.note ? "<small>" + esc(t.note) + "</small>" : ""), sign: "-", usd: t.usd, status: t.status });
      else if (t.to === me) rows.push({ t: t.createdAt, type: "Received", detail: "From " + esc(nameOf(t.from)) + (t.note ? "<small>" + esc(t.note) + "</small>" : ""), sign: "+", usd: t.usd, status: t.status });
    });
    return rows.sort(function (a, b) { return b.t - a.t; });
  }
  function renderTx(l) {
    var box = $("#tx-table");
    if (!box) return;
    var rows = txRows(l);
    setHTML(box, rows.length ? rows.map(function (r) {
      return "<tr><td>" + when(r.t) + "</td><td>" + r.type + "</td><td>" + r.detail + "</td><td>" + r.sign + money(r.usd) + "</td><td>" + pill(r.status) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty-note">No transactions yet.</td></tr>');
    var rx = $("#rx-table"), me = norm(user.email);
    if (rx) {
      var inc = getTransfers().filter(function (t) { return t.to === me; });
      setHTML(rx, inc.length ? inc.map(function (t) {
        return "<tr><td>" + when(t.createdAt) + "</td><td>" + esc(nameOf(t.from)) + "</td><td>+" + money(t.usd) + "</td><td>" + pill(t.status) + "</td></tr>";
      }).join("") : '<tr><td colspan="4" class="empty-note">No incoming transfers yet.</td></tr>');
    }
  }
  function refreshWallet(l) {
    if (!$("#w-avail")) return;
    $("#w-avail").textContent = money(l.cash);
    var dc = $("#d-coin").value, amt = inputUsd("#d-amt"), rt = usdPerCoin(dc);
    $("#d-est").textContent = amt > 0 ? (rt ? "≈ " + units(amt / rt) + " " + dc : "Live " + dc + " price unavailable") : "—";
    var wc = $("#w-coin").value, net = CONFIG.METHODS[wc].networks[$("#w-net").value] || {}, wamt = inputUsd("#w-amt");
    $("#w-fee").textContent = money(net.fee || 0);
    $("#w-recv").textContent = wamt > (net.fee || 0) ? money(wamt - net.fee) + (usdPerCoin(wc) ? " (≈ " + units((wamt - net.fee) / usdPerCoin(wc)) + " " + wc + ")" : "") : "—";
    var hint = $("#d-plan-hint");
    if (hint) {
      var eq = summary(l).equity, p = planOf(l), first = PL[0];
      hint.textContent = !p ? (first ? "Tip: you need a plan to trade. " + first.name + " needs a balance of " + money(first.min) + " plus a " + money(planFee(first)) + " upgrade fee." : "")
        : eq >= p.min ? "Your " + p.name + " plan is active (minimum balance " + money(p.min) + ")."
        : "Your " + p.name + " plan needs a balance of " + money(p.min) + " to trade. You have " + money(eq) + ".";
    }
    renderTx(l);
  }
  function showDepositAddress() {
    var m = CONFIG.METHODS[$("#d-coin").value].networks[$("#d-net").value];
    $("#d-addr").textContent = m.address;
    $("#d-warn").textContent = "Send only " + $("#d-coin").value + " on the " + $("#d-net").value + " network to this address. Other assets or networks can be lost.";
  }
  function copyText(text, btn) {
    var done = function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done); else done();
  }
  var lookupTimer, lookupSeq = 0;
  function lookupReceiver() {
    var box = $("#t-lookup"), v = norm($("#t-email").value), seq = ++lookupSeq;
    box.className = "lookup";
    if (!v) { box.textContent = ""; return Promise.resolve(false); }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { box.textContent = "Enter a valid Gmail address."; box.classList.add("bad"); return Promise.resolve(false); }
    if (v === norm(user.email)) { box.textContent = "You can't send money to yourself."; box.classList.add("bad"); return Promise.resolve(false); }
    box.textContent = "Checking…";
    return resolveUser(v).then(function (r) {
      if (seq !== lookupSeq) return false;
      if (!r) { box.textContent = "No registered user found for that Gmail. Please enter the Gmail of a registered user."; box.classList.add("bad"); return false; }
      rememberName(v, r.first, r.last);
      box.textContent = "✓ " + nameOf(v) + " — registered user";
      box.classList.add("good");
      return true;
    });
  }
  function initWallet() {
    if (!$("#w-avail")) return;
    var coins = Object.keys(CONFIG.METHODS).map(function (c) { return '<option value="' + c + '">' + c + " — " + CONFIG.METHODS[c].name + "</option>"; }).join("");
    $("#d-coin").innerHTML = coins;
    $("#w-coin").innerHTML = coins;
    fillNetworks($("#d-coin"), $("#d-net")); showDepositAddress();
    fillNetworks($("#w-coin"), $("#w-net"));
    $("#d-coin").onchange = function () { fillNetworks($("#d-coin"), $("#d-net")); showDepositAddress(); renderLive(); };
    $("#d-net").onchange = showDepositAddress;
    $("#w-coin").onchange = function () { fillNetworks($("#w-coin"), $("#w-net")); renderLive(); };
    $("#w-net").onchange = renderLive;
    $("#d-amt").oninput = renderLive;
    $("#w-amt").oninput = renderLive;
    $("#w-max").onclick = function () { $("#w-amt").value = toDisp(load().cash) || ""; renderLive(); };
    $("#t-max").onclick = function () { $("#t-amt").value = toDisp(load().cash) || ""; };
    $("#r-email").textContent = user.email;
    $("#r-copy").onclick = function () { copyText(user.email, $("#r-copy")); };

    function tab(name) {
      $$("[data-wtab]").forEach(function (b) { b.classList.toggle("active", b.dataset.wtab === name); });
      ["deposit", "withdraw", "send", "receive"].forEach(function (n) { $("#panel-" + n).hidden = n !== name; });
    }
    $$("[data-wtab]").forEach(function (b) { b.onclick = function () { tab(b.dataset.wtab); history.replaceState(null, "", "#" + b.dataset.wtab); }; });
    var h = location.hash.replace("#", "");
    tab(["withdraw", "send", "receive"].indexOf(h) > -1 ? h : "deposit");

    $("#d-copy").onclick = function () { copyText($("#d-addr").textContent, $("#d-copy")); };
    $("#d-done").onclick = function () {
      var coinK = $("#d-coin").value, netK = $("#d-net").value, amt = inputUsd("#d-amt");
      if (amt < CONFIG.MIN_DEPOSIT) return say("#e-dep", "Minimum deposit is " + money(CONFIG.MIN_DEPOSIT) + ".");
      mutate(function (l) {
        l.tx.unshift({ id: uid(), type: "deposit", coin: coinK, network: netK, usd: r2(amt), address: CONFIG.METHODS[coinK].networks[netK].address, status: "Pending", createdAt: Date.now() });
        pushNote(l, "Deposit requested", money(amt) + " in " + coinK + " is pending confirmation.");
      });
      track("deposit_request", { coin: coinK });
      $("#d-amt").value = "";
      say("#e-dep", CONFIG.AUTO_CONFIRM_MS ? "Deposit request received. It will be credited after confirmation." : "Deposit request received. It will be credited once an admin confirms it.", true);
      renderLive();
    };
    $("#w-submit").onclick = function () {
      var coinK = $("#w-coin").value, netK = $("#w-net").value, m = CONFIG.METHODS[coinK].networks[netK];
      var addr = $("#w-addr").value.trim(), amt = r2(inputUsd("#w-amt"));
      var min = Math.max(CONFIG.MIN_WITHDRAW, m.fee + 1);
      if (!m.re.test(addr)) return say("#e-wd", "That doesn't look like a valid " + netK + " address.");
      if (amt < min) return say("#e-wd", "Minimum withdrawal is " + money(min) + ".");
      if (!confirm("Withdraw " + money(amt) + " to\n" + addr + "\non " + netK + "?\nCrypto transfers can't be reversed.")) return;
      var r = mutate(function (l) {
        if (amt > l.cash + 0.005) return { ok: false, msg: "You can withdraw up to " + money(l.cash) + " (money in open trades isn't available)." };
        l.cash = r2(l.cash - amt);
        l.tx.unshift({ id: uid(), type: "withdrawal", coin: coinK, network: netK, usd: amt, fee: m.fee, address: addr, status: "Pending", createdAt: Date.now() });
        pushNote(l, "Withdrawal requested", money(amt) + " to " + coinK + " is pending approval.");
        track("withdrawal_request", { coin: coinK });
        return { ok: true, msg: "Withdrawal requested. You'll receive " + money(amt - m.fee) + " after approval." };
      });
      say("#e-wd", r.msg, r.ok);
      if (r.ok) { $("#w-amt").value = ""; $("#w-addr").value = ""; }
      renderLive();
    };
    $("#t-email").oninput = function () { clearTimeout(lookupTimer); lookupTimer = setTimeout(lookupReceiver, 300); };
    $("#t-email").onblur = lookupReceiver;
    $("#t-send").onclick = function () {
      var amt = inputUsd("#t-amt"), email = $("#t-email").value, note = $("#t-note").value.trim();
      lookupReceiver().then(function (okR) {
        if (!okR) return say("#e-send", $("#t-lookup").textContent || "Enter the receiver's Gmail.");
        if (!(amt > 0)) return say("#e-send", "Enter an amount.");
        if (!confirm("Send " + money(amt) + " to " + nameOf(email) + " (" + norm(email) + ")?")) return;
        return sendTransfer(email, amt, note).then(function (r) {
          say("#e-send", r.msg, r.ok);
          if (r.ok) { $("#t-amt").value = ""; $("#t-note").value = ""; $("#t-email").value = ""; $("#t-lookup").textContent = ""; }
          renderLive();
        });
      });
    };
  }

  /* ---------- settings ---------- */
  function hashPassword(pw, salt) {
    var data = salt + ":" + pw;
    if (window.crypto && crypto.subtle && window.TextEncoder)
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      });
    var h = 5381;
    for (var i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) | 0;
    return Promise.resolve("w" + (h >>> 0).toString(16));
  }
  function themeNow() { var t = null; try { t = localStorage.getItem("theme"); } catch (e) {} return t === "light" || t === "dark" ? t : "system"; }
  function paintThemeChoice() {
    var t = themeNow();
    $$("[data-theme-choice]").forEach(function (b) { b.classList.toggle("active", b.dataset.themeChoice === t); });
    if ($("#sum-appearance")) $("#sum-appearance").textContent = t === "system" ? "Match my device" : t === "dark" ? "Dark" : "Light";
  }
  function paintCurrencyHint() {
    var hint = $("#cur-hint");
    if (!hint) return;
    var name = (CURRENCIES.filter(function (c) { return c[0] === cur; })[0] || [])[1] || cur;
    $("#sum-currency").textContent = cur + " — " + name;
    hint.textContent = cur === "USD" ? "Amounts are shown in US Dollars." :
      "1 USD = " + rate().toLocaleString(undefined, { maximumFractionDigits: 4 }) + " " + cur + (rates ? " (daily rate)." : " (approximate until live rates load).") + " Trading and balances are held in USD.";
  }
  function newSalt() {
    return Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(16)), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function initSettings() {
    if (!$("#f-prof")) return;
    $("#a-fn").value = user.first || "";
    $("#a-ln").value = user.last || "";
    $("#a-ph").value = user.phone || "";
    $("#a-email").value = user.email;
    var secs = $$("details.acc");
    secs.forEach(function (d) {
      d.addEventListener("toggle", function () {
        if (d.open) secs.forEach(function (o) { if (o !== d) o.open = false; });
      });
    });
    var h = location.hash.replace("#", ""), target = h && $("#sec-" + h);
    if (target) { target.open = true; setTimeout(function () { target.scrollIntoView({ block: "start" }); }, 50); }

    $("#f-prof").addEventListener("submit", function (e) {
      e.preventDefault();
      var fn = $("#a-fn").value.trim(), ln = $("#a-ln").value.trim(), ph = $("#a-ph").value.trim();
      if (!fn || !ln) return say("#e-prof", "Enter your first and last name.");
      if (ph.replace(/\D/g, "").length < 7) return say("#e-prof", "Enter a valid phone number.");
      saveUser({ first: fn, last: ln, phone: ph });
      paintUser();
      say("#e-prof", "Changes saved.", true);
    });
    $("#f-pass").addEventListener("submit", function (e) {
      e.preventDefault();
      var c = $("#a-cur").value, n = $("#a-new").value;
      if (!c) return say("#e-pass", "Enter your current password.");
      if (n.length < 8) return say("#e-pass", "Use a new password with at least 8 characters.");
      if (n !== $("#a-new2").value) return say("#e-pass", "The new passwords do not match.");
      if (DB.enabled) {
        return DB.signIn(user.email, c).then(function () { return DB.updatePassword(n); }).then(function () {
          $("#f-pass").reset(); say("#e-pass", "Password updated.", true);
        }).catch(function (err) { say("#e-pass", /invalid login/i.test(err && err.message) ? "Current password is incorrect." : (err && err.message) || "Could not update the password."); });
      }
      hashPassword(c, user.salt).then(function (old) {
        if (old !== user.hash) return say("#e-pass", "Current password is incorrect.");
        var salt = newSalt();
        return hashPassword(n, salt).then(function (hash) {
          saveUser({ salt: salt, hash: hash });
          $("#f-pass").reset();
          say("#e-pass", "Password updated.", true);
        });
      });
    });
    $("#a-del").addEventListener("click", function () {
      if (!confirm("Delete your account? This cannot be undone.")) return;
      var finish = function () {
        var users = read("auth.users", {});
        delete users[user.email];
        write("auth.users", users);
        ["auth.session", "ledger." + user.email].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        location.href = "signin.html";
      };
      if (DB.enabled) DB.deleteMe().then(function () { return DB.signOut(); }).then(finish, function () { say("#e-pass", "Could not delete the account right now."); });
      else finish();
    });
    $$("[data-theme-choice]").forEach(function (b) {
      b.onclick = function () {
        var v = b.dataset.themeChoice, root = document.documentElement;
        try {
          if (v === "system") { localStorage.removeItem("theme"); root.removeAttribute("data-theme"); }
          else { localStorage.setItem("theme", v); root.setAttribute("data-theme", v); }
        } catch (e) { if (v !== "system") root.setAttribute("data-theme", v); else root.removeAttribute("data-theme"); }
        paintThemeChoice();
      };
    });
    paintThemeChoice();
    var sel = $("#cur-select");
    sel.innerHTML = CURRENCIES.map(function (c) { return '<option value="' + c[0] + '">' + c[0] + " — " + c[1] + "</option>"; }).join("");
    sel.value = cur;
    sel.onchange = function () {
      cur = sel.value;
      saveUser({ currency: cur });
      paintCurrencyLabels(); paintCurrencyHint(); renderLive();
    };
    paintCurrencyHint();
    $("#settings-logout").onclick = function () { $("#signout").click(); };
  }

  /* ---------- rendering (coalesced so ticks never pile up) ---------- */
  var renderT = 0, lastRender = 0;
  function renderLive() {
    lastRender = Date.now();
    settleOwn();
    renderStatus();
    renderVerifyBanner();
    var l = load(), s = summary(l);
    renderPlanUI(l, s);
    renderDashboard(l, s);
    renderPortfolio(l, s);
    renderMarkets();
    refreshTrade(l);
    refreshWallet(l);
    renderNotes(false);
    updateChartStats();
    if ($("#cur-hint")) paintCurrencyHint();
  }
  function scheduleRender() {
    if (renderT) return;
    var wait = Math.max(0, 300 - (Date.now() - lastRender));
    renderT = setTimeout(function () { renderT = 0; if (!document.hidden) renderLive(); }, wait);
  }
  function renderLists() { renderOrders(); renderHistory(); }

  /* ---------- Supabase sync ---------- */
  var pushT = 0, syncing = false, syncedOnce = false, lastTouch = 0;
  // true when this browser has no copy of the ledger yet: the first sync must adopt the server's copy
  var firstSyncPending = DB.enabled && rawGet(lkey()) === null;
  function schedulePush() {
    clearTimeout(pushT);
    pushT = setTimeout(pushNow, 800);
  }
  function pushNow() {
    if (!DB.enabled || !DB.uid || firstSyncPending) return Promise.resolve(); // never overwrite the server copy before it has been read
    var l = load();
    return DB.pushLedger(l, l.rev).catch(warn);
  }
  function localSignOut() {
    try { localStorage.removeItem("auth.session"); } catch (e) {}
    location.replace("signin.html");
  }
  function syncAll() {
    if (!DB.enabled || syncing) return Promise.resolve();
    syncing = true;
    return DB.session().then(function (s) {
      if (!s) { localSignOut(); return; }
      return Promise.all([
        DB.profile(), DB.pullLedger(), DB.pullInbox(), DB.pullMessages(), DB.pullTransfers(), DB.pullPlanReqs(), Site.refresh()
      ]).then(function (r) {
        var prof = r[0], remote = r[1], inbox = r[2] || [], msgs = r[3] || [], trs = r[4] || [], reqs = r[5] || [];
        if (prof) {
          var lu = DB.mirror(prof);
          if (lu.role === "admin") showAdminLinks(true);
          Object.assign(user, lu);
          cur = user.currency || "USD";
          paintUser(); paintCurrencyLabels();
        }
        applySite();
        // ledger: take the server copy only if it is newer than ours
        var local = load();
        if (remote && remote.data && (firstSyncPending || (remote.rev || 0) > (local.rev || 0))) {
          var rl = normL(remote.data); rl.rev = remote.rev;
          putLedger(null, rl);
        }
        firstSyncPending = false;
        if (inbox.length) return applyInboxRows(inbox).then(function () { return null; });
      }).then(function () {
        return Promise.all([DB.pullMessages(), DB.pullTransfers(), DB.pullPlanReqs()]);
      }).then(function (r2) {
        applyBroadcasts((r2[0] || []).map(function (m) { return { id: m.id, title: m.title, body: m.body, sendAll: m.send_to_all, recipients: m.recipients || [], deliverAt: m.deliver_at, status: m.status }; }));
        if (!inflight) {
          write("transfers", (r2[1] || []).map(trFromRow));
          write("planReqs", (r2[2] || []).map(reqFromRow));
        }
        var l = load();
        return DB.pullLedger().then(function (rem) { if (!rem || (rem.rev || 0) < l.rev) return pushNow(); });
      }).then(function () {
        if (Date.now() - lastTouch > 120000) { lastTouch = Date.now(); DB.touch().catch(warn); }
      });
    }).catch(warn).then(function () {
      syncing = false; syncedOnce = true;
      if (!firstSyncPending) welcomeOnce();
      finishLoading();
      renderLists(); renderLive();
    });
  }
  var loadingDone = false;
  function finishLoading() {
    if (loadingDone) return;
    if ($("#adm") && !window.__admReady) return; // admin.js clears the skeleton once it has checked access and loaded data
    loadingDone = true;
    document.body.classList.remove("is-loading");
  }

  /* ---------- start ---------- */
  initNotes();
  initTrade();
  initWallet();
  initSettings();
  refreshRates();
  Feed.on(scheduleRender);
  renderLists();
  renderLive();
  if (DB.enabled) {
    syncAll();
    setTimeout(finishLoading, 3500); // never leave the skeleton up if the network is slow
    setInterval(function () { if (!document.hidden) syncAll(); }, 10000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) syncAll(); });
  } else finishLoading();
  setInterval(function () {
    if (document.hidden) return;
    if (!DB.enabled) applyBroadcasts(read("broadcasts", []));
    renderLive();
  }, 1000);
  setInterval(function () { if (!document.hidden) renderLists(); }, 3000);
  window.addEventListener("storage", function () { renderLists(); scheduleRender(); });
  window.addEventListener("beforeunload", function () { if (DB.enabled && pushT) { clearTimeout(pushT); pushNow(); } });
  if (!DB.enabled) applyBroadcasts(read("broadcasts", []));

  window.SDSS_CORE = {
    user: user, DB: DB, CONFIG: CONFIG, read: read, write: write, load: load, mutate: mutate, normL: normL, summary: summary,
    applyEvent: applyEvent, txAct: txAct, getTransfers: getTransfers, saveTransfer: saveTransfer, getReqs: getReqs, saveReq: saveReq,
    trFromRow: trFromRow, reqFromRow: reqFromRow, planName: planName, planIdx: planIdx, levOf: levOf, plans: function () { return PL; },
    usd: usd, money: money, esc: esc, when: when, ago: ago, pill: pill, r2: r2, uid: uid, norm: norm, Feed: Feed, setHTML: setHTML, posStats: posStats, planOf: planOf,
    pushNote: pushNote, applySite: applySite, track: track, brand: brandName, finishLoading: finishLoading, warn: warn, rememberName: rememberName
  };
})();
