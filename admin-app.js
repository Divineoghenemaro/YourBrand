/* Admin panel app (loaded by admin-guard.js only after the server confirms an admin).
 * Users (full details + balance + notifications), transactions,
 * scheduled messages, and site features (plans + options).
 * Only accounts with role = 'admin' in Supabase (or ADMIN_EMAILS in local mode) get in. */
(function () {
  "use strict";
  var C = window.SDSS_CORE;
  if (!C || !document.getElementById("adm")) return;
  var DB = C.DB, esc = C.esc, usd = C.usd, norm = C.norm, uid = C.uid, when = C.when, pill = C.pill, setHTML = C.setHTML, r2 = C.r2;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var S = { users: [], ledgers: {}, inbox: [], transfers: [], reqs: [], messages: [] };
  var busyAct = false, openEmail = null;

  /* ---------- helpers ---------- */
  function toast(msg, good) {
    var t = document.createElement("div");
    t.className = "toast" + (good === false ? " bad" : "");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 2600);
    setTimeout(function () { t.remove(); }, 3100);
  }
  function fail(e) { toast((e && e.message) || String(e) || "Something went wrong.", false); C.warn(e); }
  function ledgerOf(email) { return S.ledgers[email] || C.normL({}); }
  function userOf(email) { return S.users.filter(function (u) { return u.email === email; })[0]; }
  function fullName(u) { return ((u.first || "") + " " + (u.last || "")).trim() || u.email; }
  function planObj(l) { var i = C.planIdx(l); return i > -1 ? C.plans()[i] : null; }
  function queuedFor(u) { return S.inbox.filter(function (r) { return r.user_id === u.id; }); }
  function queuedTx(id) { return S.inbox.some(function (r) { return r.payload && r.payload.type === "tx" && r.payload.id === id; }); }

  // send an instruction to a user: applied immediately in local mode, queued via Supabase otherwise
  function deliver(email, ev) {
    email = norm(email);
    if (!DB.enabled || email === norm(C.user.email)) { C.mutate(function (l) { C.applyEvent(l, ev); }, email); return Promise.resolve(); }
    var u = userOf(email);
    if (!u) return Promise.reject(new Error("User not found"));
    return DB.admin.sendInbox(u.id, ev);
  }

  /* ---------- data ---------- */
  function mapMsg(m) { return { id: m.id, title: m.title, body: m.body, sendAll: m.send_to_all, recipients: m.recipients || [], deliverAt: m.deliver_at, status: m.status, createdAt: m.created_at }; }
  function loadAll() {
    if (DB.enabled) {
      return Promise.all([DB.admin.users(), DB.admin.ledgers(), DB.admin.inbox(), DB.pullTransfers(), DB.pullPlanReqs(), DB.admin.messages()]).then(function (r) {
        S.users = (r[0] || []).map(function (p) { var u = DB.toLocalUser(p); u.raw = p; return u; });
        var byId = {};
        S.users.forEach(function (u) { byId[u.id] = u; });
        S.ledgers = {};
        (r[1] || []).forEach(function (row) {
          var u = byId[row.user_id];
          if (u) { var l = C.normL(row.data); l.rev = row.rev; l.updatedAt = row.updated_at; S.ledgers[u.email] = l; }
        });
        S.inbox = r[2] || [];
        S.transfers = (r[3] || []).map(C.trFromRow);
        S.reqs = (r[4] || []).map(C.reqFromRow);
        S.messages = (r[5] || []).map(mapMsg);
        (r[3] || []).forEach(function () {});
        S.users.forEach(function (u) { C.rememberName(u.email, u.first, u.last); });
      });
    }
    var users = C.read("auth.users", {});
    S.users = Object.keys(users).map(function (k) { return users[k]; }).sort(function (a, b) { return b.created - a.created; });
    S.ledgers = {};
    S.users.forEach(function (u) { S.ledgers[u.email] = C.load(u.email); });
    S.inbox = [];
    S.transfers = C.getTransfers();
    S.reqs = C.getReqs();
    S.messages = C.read("broadcasts", []).slice().sort(function (a, b) { return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0); });
    return Promise.resolve();
  }

  /* ---------- users ---------- */
  function renderUsers() {
    var q = ($("#q").value || "").trim().toLowerCase(), week = Date.now() - 7 * 864e5;
    var list = S.users, tot = 0, withPlan = 0;
    list.forEach(function (u) { var l = ledgerOf(u.email); tot += C.summary(l).equity; if (planObj(l)) withPlan++; });
    $("#s-total").textContent = list.length;
    $("#s-new").textContent = list.filter(function (u) { return u.created > week; }).length;
    $("#s-plan").textContent = withPlan;
    $("#s-bal").textContent = usd(tot);
    var rows = list.filter(function (u) {
      return !q || (fullName(u) + " " + u.email + " " + u.phone).toLowerCase().indexOf(q) > -1;
    });
    setHTML($("#rows"), rows.length ? rows.map(function (u) {
      var l = ledgerOf(u.email), p = planObj(l), s = C.summary(l);
      return '<tr><td><button class="name-link" data-user="' + esc(u.email) + '">' + esc(u.first || "—") + "</button> " + esc(u.last || "") +
        (u.role === "admin" ? ' <span class="pill ok">admin</span>' : "") + (u.unverified ? ' <span class="pill bad">unverified</span>' : "") + "</td><td>" + esc(u.email) + "</td><td>" +
        (p ? '<span class="tier-pill" style="--c:' + esc(p.color) + '">' + esc(p.name) + "</span>" : '<span class="hint" style="margin:0">None</span>') +
        "</td><td>" + usd(s.equity) + "</td><td>" + new Date(u.created).toLocaleDateString() + '</td><td><button class="btn sm ghost" data-manage="' + esc(u.email) + '" type="button">Manage trades</button></td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty-note">' + (list.length ? "No users match your search." : "No users have registered yet.") + "</td></tr>");
  }

  function kv(label, val) { return "<div><span>" + label + "</span><b>" + val + "</b></div>"; }
  function table(head, rows, empty) {
    return '<div class="tbl-wrap"><table><thead><tr>' + head.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>" +
      (rows.length ? rows.join("") : '<tr><td colspan="' + head.length + '" class="empty-note">' + empty + "</td></tr>") + "</tbody></table></div>";
  }
  function infoHTML(u) {
    var l = ledgerOf(u.email), s = C.summary(l), p = planObj(l), q = queuedFor(u), me = u.email;
    var raw = JSON.stringify({ profile: u.raw || u, ledger: l }, null, 2);
    var tx = [];
    l.tx.forEach(function (t) { tx.push({ t: t.createdAt, type: t.type === "deposit" ? "Deposit" : "Withdrawal", d: esc(t.coin) + " · " + esc(t.network), a: (t.type === "deposit" ? "+" : "-") + usd(t.usd), s: t.status }); });
    S.transfers.forEach(function (t) {
      if (t.from === me) tx.push({ t: t.createdAt, type: "Sent", d: "To " + esc(t.to), a: "-" + usd(t.usd), s: t.status });
      if (t.to === me) tx.push({ t: t.createdAt, type: "Received", d: "From " + esc(t.from), a: "+" + usd(t.usd), s: t.status });
    });
    S.reqs.forEach(function (r) { if (r.email === me) tx.push({ t: r.createdAt, type: "Plan upgrade", d: esc(r.name || C.planName(r.plan)), a: "-" + usd(r.fee), s: r.status }); });
    tx.sort(function (a, b) { return b.t - a.t; });
    return '<h3 class="ud-h">Account</h3><div class="ud-grid">' +
      kv("User ID", esc(u.id || "local")) + kv("Email", esc(u.email)) + kv("First name", esc(u.first || "—")) + kv("Last name", esc(u.last || "—")) +
      kv("Phone", esc(u.phone || "—")) + kv("Currency", esc(u.currency || "USD")) + kv("Role", esc(u.role || (window.SDSS_IS_ADMIN && window.SDSS_IS_ADMIN(u.email) ? "admin" : "user"))) +
      kv("Joined", when(u.created)) + kv("Last seen", u.lastSeen ? when(u.lastSeen) : "—") +
      kv("Verification", u.unverified ? '<span class="pill bad">Unverified</span>' : '<span class="pill ok">Verified</span>') + kv("Plan", p ? esc(p.name) + " (x" + p.x + ", ×" + p.x * p.x + ")" : "None") + kv("Ledger revision", l.rev || 0) + kv("Last synced", l.updatedAt ? when(l.updatedAt) : "—") + "</div>" +
      '<h3 class="ud-h">Wallet</h3><div class="ud-grid">' + kv("Total balance", usd(s.equity)) + kv("Available cash", usd(s.cash)) + kv("In trades (margin)", usd(s.inPos)) +
      kv("Open P&amp;L", '<span class="' + (s.pnl >= 0 ? "up" : "down") + '">' + (s.pnl >= 0 ? "+" : "") + usd(s.pnl) + "</span>") +
      kv("Open positions", l.positions.length) + kv("Orders", l.orders.length) + kv("Closed trades", l.history.length) + kv("Notifications", l.notes.length + " (" + l.notes.filter(function (n) { return !n.read; }).length + " unread)") + "</div>" +
      (q.length ? '<h3 class="ud-h">Queued for delivery</h3><p class="hint" style="margin:0 0 8px">These are waiting to be applied when the user\'s app next syncs.</p>' +
        table(["Queued", "Type", "Details"], q.map(function (r) { var e = r.payload || {}; return "<tr><td>" + when(r.created_at) + "</td><td>" + esc(r.kind) + "</td><td>" + esc(e.title || "") + (e.usd ? " " + usd(e.usd) : "") + "</td></tr>"; }), "") : "") +
      '<h3 class="ud-h">Open positions</h3>' + table(["Asset", "Side", "Margin", "Entry", "P&amp;L"], l.positions.map(function (x) {
        var st = null; try { st = { pnl: (function () { var c = C.Feed.prices[x.symbol].price, lv = C.levOf(p), mv = (x.side === "Long" ? c - x.entry : x.entry - c) / x.entry; return Math.max(r2(mv * x.cost * lv), -x.cost); })() }; } catch (e) { st = { pnl: 0 }; }
        return "<tr><td>" + esc(x.symbol) + "</td><td>" + x.side + "</td><td>" + usd(x.cost) + "</td><td>" + x.entry + '</td><td class="' + (st.pnl >= 0 ? "up" : "down") + '">' + (st.pnl >= 0 ? "+" : "") + usd(st.pnl) + "</td></tr>";
      }), "None.") +
      '<h3 class="ud-h">Transactions</h3>' + table(["Date", "Type", "Details", "Amount", "Status"], tx.slice(0, 25).map(function (r) {
        return "<tr><td>" + when(r.t) + "</td><td>" + r.type + "</td><td>" + r.d + "</td><td>" + r.a + "</td><td>" + pill(r.s) + "</td></tr>";
      }), "None.") +
      '<h3 class="ud-h">Orders</h3>' + table(["Date", "Asset", "Action", "Amount"], l.orders.slice(0, 15).map(function (o) {
        return "<tr><td>" + when(o.t) + "</td><td>" + esc(o.symbol) + "</td><td>" + o.side + " · " + o.kind + "</td><td>" + usd(o.usd) + "</td></tr>";
      }), "None.") +
      '<h3 class="ud-h">Trade history</h3>' + table(["Closed", "Asset", "Side", "Margin", "P&amp;L"], l.history.slice(0, 15).map(function (h) {
        return "<tr><td>" + when(h.closedAt) + "</td><td>" + esc(h.symbol) + "</td><td>" + h.side + "</td><td>" + usd(h.cost) + '</td><td class="' + (h.pnl >= 0 ? "up" : "down") + '">' + (h.pnl >= 0 ? "+" : "") + usd(h.pnl) + "</td></tr>";
      }), "None.") +
      '<h3 class="ud-h">Notifications</h3>' + table(["When", "Title", "Message", "Read"], l.notes.slice(0, 15).map(function (n) {
        return "<tr><td>" + when(n.t) + "</td><td>" + esc(n.title) + "</td><td>" + esc(n.text) + "</td><td>" + (n.read ? "Yes" : "No") + "</td></tr>";
      }), "None.") +
      '<details class="raw"><summary>Raw data</summary><pre>' + esc(raw.length > 24000 ? raw.slice(0, 24000) + "\n… (truncated)" : raw) + "</pre></details>";
  }
  function openUser(email, toTrading) {
    var u = userOf(email);
    if (!u) return;
    openEmail = email;
    var d = $("#user-drawer");
    $("#ud-title").textContent = fullName(u);
    $("#ud-sub").textContent = u.email;
    $("#ud-amt").value = ""; $("#ud-reason").value = ""; $("#ud-ntitle").value = ""; $("#ud-ntext").value = "";
    $("#ud-msg").textContent = "";
    $("#ud-del").hidden = u.email === norm(C.user.email);
    $("#ud-send-note").checked = true;
    d.hidden = false;
    document.body.classList.add("no-scroll");
    $("#ud-t-amt").value = ""; $("#ud-t-msg").textContent = "";
    fillAssets();
    renderDrawer();
    if (toTrading) setTimeout(function () { $("#ud-trading").scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
  }
  function renderDrawer() {
    if (!openEmail) return;
    var u = userOf(openEmail);
    if (!u) return closeUser();
    setHTML($("#ud-info"), infoHTML(u));
    renderBehalf();
    $("#ud-unverify").textContent = u.unverified ? "Verify user" : "Unverify user";
  }
  function closeUser() {
    openEmail = null;
    $("#user-drawer").hidden = true;
    document.body.classList.remove("no-scroll");
  }
  function drawerMsg(t, ok) { var e = $("#ud-msg"); e.textContent = t || ""; e.classList.toggle("ok", !!ok && !!t); }

  function adjust(kind) {
    var u = userOf(openEmail);
    if (!u || busyAct) return;
    var amt = r2(parseFloat($("#ud-amt").value) || 0), reason = $("#ud-reason").value.trim();
    if (!(amt > 0)) return drawerMsg("Enter an amount greater than 0.");
    var l = ledgerOf(u.email);
    if (kind === "debit" && amt > l.cash + 0.005) return drawerMsg("This user only has " + usd(l.cash) + " available cash, so you can remove up to that amount.");
    if (!confirm((kind === "credit" ? "Add " : "Remove ") + usd(amt) + (kind === "credit" ? " to " : " from ") + fullName(u) + "'s balance?")) return;
    busyAct = true;
    var quiet = !$("#ud-send-note").checked;
    var ev = kind === "credit"
      ? { type: "credit", usd: amt, title: "Balance top-up", text: usd(amt) + " was added to your balance by our team." + (reason ? " Note: " + reason : "") }
      : { type: "debit", usd: amt, title: "Balance adjustment", text: usd(amt) + " was removed from your balance by our team." + (reason ? " Note: " + reason : "") };
    if (quiet) ev.silent = true;
    deliver(u.email, ev).then(function () {
      drawerMsg(DB.enabled && norm(u.email) !== norm(C.user.email) ? "Done. It will be applied as soon as the user's app syncs (usually within seconds)." : "Done. The balance was updated.", true);
      $("#ud-amt").value = ""; $("#ud-reason").value = "";
      return refresh();
    }).catch(function (e) { drawerMsg((e && e.message) || "Could not send that."); }).then(function () { busyAct = false; });
  }
  function notifyUser() {
    var u = userOf(openEmail);
    if (!u || busyAct) return;
    var title = $("#ud-ntitle").value.trim(), text = $("#ud-ntext").value.trim();
    if (!title || !text) return drawerMsg("Enter a title and a message.");
    busyAct = true;
    deliver(u.email, { type: "note", title: title, text: text }).then(function () {
      drawerMsg("Notification sent to " + fullName(u) + ".", true);
      $("#ud-ntitle").value = ""; $("#ud-ntext").value = "";
      return refresh();
    }).catch(function (e) { drawerMsg((e && e.message) || "Could not send that."); }).then(function () { busyAct = false; });
  }
  /* ----- trade on behalf of a user ----- */
  function fillAssets() {
    var sel = $("#ud-t-asset");
    if (sel.options.length) return;
    sel.innerHTML = Object.keys(C.Feed.prices).map(function (k) { return "<option>" + k + "</option>"; }).join("");
  }
  function queuedFor2(u, type, id) {
    return S.inbox.some(function (r) { return r.user_id === u.id && r.payload && r.payload.type === type && (!id || r.payload.id === id || r.payload.pid === id); });
  }
  function renderBehalf() {
    var u = userOf(openEmail);
    if (!u) return;
    var l = ledgerOf(u.email), sym = $("#ud-t-asset").value, p = C.Feed.prices[sym], ok = C.Feed.tradable(sym), plan = planObj(l), lv = C.levOf(plan);
    $("#ud-t-cash").textContent = usd(l.cash);
    $("#ud-t-price").textContent = ok ? (p.kind === "forex" ? p.price.toFixed(4) : usd(p.price)) : "No live price";
    $("#ud-t-lev").textContent = plan ? "×" + lv + " (" + plan.name + ")" : "×1 (no plan)";
    $("#ud-t-open").disabled = !ok;
    setHTML($("#ud-t-pos"), l.positions.length ? '<div class="tbl-wrap"><table><thead><tr><th>Asset</th><th>Side</th><th>Margin</th><th>Entry</th><th>Now</th><th>P&amp;L</th><th></th></tr></thead><tbody>' + l.positions.map(function (x) {
      var st = C.Feed.tradable(x.symbol) ? C.posStats(x, l) : null, queued = queuedFor2(u, "close", x.id);
      return "<tr><td>" + esc(x.symbol) + (x.by === "admin" ? "<small>by admin</small>" : "") + "</td><td>" + x.side + "</td><td>" + usd(x.cost) + "</td><td>" + x.entry + "</td><td>" + (st ? st.cur : "—") + '</td><td class="' + (st && st.pnl < 0 ? "down" : "up") + '">' + (st ? (st.pnl >= 0 ? "+" : "") + usd(st.pnl) : "—") + "</td><td>" +
        (queued ? '<span class="hint" style="margin:0">Queued…</span>' : '<button class="btn sm ghost ud-close-pos" data-id="' + esc(x.id) + '" type="button"' + (st ? "" : " disabled") + ">Close</button>") + "</td></tr>";
    }).join("") + "</tbody></table></div>" : '<div class="empty-note">No open positions.</div>');
  }
  function tradeMsg(t, ok) { var e = $("#ud-t-msg"); e.textContent = t || ""; e.classList.toggle("ok", !!ok && !!t); }
  function behalfOpen() {
    var u = userOf(openEmail);
    if (!u || busyAct) return;
    var sym = $("#ud-t-asset").value, side = $("#ud-t-side").value, amt = r2(parseFloat($("#ud-t-amt").value) || 0), l = ledgerOf(u.email);
    if (!C.Feed.tradable(sym)) return tradeMsg("There is no live price for " + sym + " right now.");
    if (!(amt >= 1)) return tradeMsg("Enter a margin amount of at least $1.");
    if (amt > l.cash + 0.005) return tradeMsg("This user only has " + usd(l.cash) + " available.");
    var price = C.Feed.prices[sym].price;
    if (!confirm((side === "Buy" ? "Buy " : "Sell ") + usd(amt) + " of " + sym + " for " + fullName(u) + " at " + price + "?")) return;
    busyAct = true;
    deliver(u.email, { type: "open", symbol: sym, side: side, usd: amt, price: price, pid: uid(), silent: !$("#ud-t-note").checked }).then(function () {
      tradeMsg(DB.enabled && norm(u.email) !== norm(C.user.email) ? "Trade sent. It is placed as soon as the user's app syncs (usually within seconds)." : "Trade opened.", true);
      $("#ud-t-amt").value = "";
      return refresh();
    }).catch(function (e) { tradeMsg((e && e.message) || "Could not place the trade."); }).then(function () { busyAct = false; });
  }
  function behalfClose(id) {
    var u = userOf(openEmail), l = u && ledgerOf(u.email), pos = l && l.positions.filter(function (x) { return x.id === id; })[0];
    if (!pos || busyAct) return;
    var price = C.Feed.prices[pos.symbol].price;
    if (!confirm("Close the " + pos.symbol + " position for " + fullName(u) + " at " + price + "?")) return;
    busyAct = true;
    deliver(u.email, { type: "close", id: id, price: price, silent: !$("#ud-t-note").checked }).then(function () {
      tradeMsg(DB.enabled && norm(u.email) !== norm(C.user.email) ? "Close request sent. It applies as soon as the user's app syncs." : "Position closed.", true);
      return refresh();
    }).catch(function (e) { tradeMsg((e && e.message) || "Could not close the position."); }).then(function () { busyAct = false; });
  }
  function toggleVerify() {
    var u = userOf(openEmail);
    if (!u || busyAct) return;
    var flag = !u.unverified;
    if (!confirm((flag ? "Unverify " : "Verify ") + fullName(u) + "? They will be notified.")) return;
    busyAct = true;
    var p;
    if (DB.enabled) p = DB.admin.setUnverified(u.id, flag);
    else {
      var users = C.read("auth.users", {});
      if (users[u.email]) users[u.email].unverified = flag;
      C.write("auth.users", users);
      p = Promise.resolve();
    }
    p.then(function () {
      return deliver(u.email, { type: "note", title: flag ? "Account needs attention" : "Account verified",
        text: flag ? "Your account needs your attention. Contact the admin to verify your account." : "Your account has been verified. Thank you." });
    }).then(function () {
      drawerMsg(flag ? "User unverified and notified." : "User verified and notified.", true);
      return refresh();
    }).catch(function (e) { drawerMsg((e && e.message) || "Could not update the user."); }).then(function () { busyAct = false; });
  }
  function deleteUser() {
    var u = userOf(openEmail);
    if (!u) return;
    if (!confirm("Delete " + u.email + " and all of their data? This cannot be undone.")) return;
    var p;
    if (DB.enabled) p = DB.admin.deleteUser(u.id);
    else {
      var users = C.read("auth.users", {}); delete users[u.email]; C.write("auth.users", users);
      try { localStorage.removeItem("ledger." + u.email); } catch (e) {}
      p = Promise.resolve();
    }
    p.then(function () { closeUser(); toast("User deleted."); return refresh(); }).catch(fail);
  }

  /* ---------- transactions ---------- */
  function txRowsAdmin() {
    var rows = [];
    S.users.forEach(function (u) {
      ledgerOf(u.email).tx.forEach(function (t) {
        rows.push({ kind: "tx", id: t.id, e: u.email, t: t.createdAt, type: t.type === "deposit" ? "Deposit" : "Withdrawal", who: u.email,
          detail: esc(t.coin) + " · " + esc(t.network) + '<small style="word-break:break-all">' + esc(t.address) + "</small>", usd: t.usd, status: t.status });
      });
    });
    S.reqs.forEach(function (r) {
      rows.push({ kind: "plan", id: r.id, t: r.createdAt, type: "Plan upgrade", who: r.email, detail: esc(r.from ? C.planName(r.from) : "No plan") + " → " + esc(r.name || C.planName(r.plan)) + "<small>Upgrade fee</small>", usd: r.fee, status: r.status });
    });
    S.transfers.forEach(function (t) {
      rows.push({ kind: "transfer", id: t.id, t: t.createdAt, type: "Transfer", who: t.from, detail: "To " + esc(t.to) + (t.note ? "<small>" + esc(t.note) + "</small>" : ""), usd: t.usd, status: t.status });
    });
    return rows.sort(function (a, b) { return b.t - a.t; });
  }
  function renderTx() {
    var only = $("#tx-flt").value === "pending";
    var rows = txRowsAdmin().filter(function (r) { return !only || r.status === "Pending"; }).slice(0, 100);
    setHTML($("#tx-rows"), rows.length ? rows.map(function (r) {
      var attrs = ' data-kind="' + r.kind + '" data-id="' + esc(r.id) + '" data-e="' + esc(r.e || "") + '"', btns = "", queued = r.kind === "tx" && queuedTx(r.id);
      if (queued) btns = '<span class="hint" style="margin:0">Queued…</span>';
      else if (r.status === "Pending")
        btns = '<button class="btn sm tx-act" data-act="approve"' + attrs + ">Approve</button> " + '<button class="btn sm ghost tx-act" data-act="' + (r.kind === "transfer" ? "cancel" : "reject") + '"' + attrs + ">" + (r.kind === "transfer" ? "Cancel" : "Reject") + "</button>";
      else if (r.status === "Completed") btns = '<button class="btn sm danger tx-act" data-act="reverse"' + attrs + ">Reverse</button>";
      return "<tr><td>" + when(r.t) + "</td><td>" + r.type + "</td><td>" + esc(r.who) + "</td><td>" + r.detail + "</td><td>" + usd(r.usd) + "</td><td>" + pill(r.status) + "</td><td>" + btns + "</td></tr>";
    }).join("") : '<tr><td colspan="7" class="empty-note">Nothing here.</td></tr>');
  }
  function txAction(kind, id, email, act) {
    if (kind === "tx") {
      var l = ledgerOf(email), t = l.tx.filter(function (x) { return x.id === id; })[0];
      if (!t) return Promise.reject(new Error("Transaction not found."));
      if (act === "reverse" && t.type === "deposit" && l.cash + 0.005 < t.usd) return Promise.reject(new Error("User only has " + usd(l.cash) + " available, so this deposit can't be reversed."));
      return deliver(email, { type: "tx", id: id, act: act });
    }
    if (kind === "transfer") {
      var tr = S.transfers.filter(function (x) { return x.id === id; })[0];
      if (!tr) return Promise.reject(new Error("Transfer not found."));
      var amt = usd(tr.usd), from = C.rememberName, nm = function (e) { var u = userOf(e); return u ? fullName(u) : e; }, jobs;
      if (act === "approve" && tr.status === "Pending") {
        jobs = [deliver(tr.to, { type: "credit", usd: tr.usd, title: "Money received", text: amt + " from " + nm(tr.from) + " was added to your balance." }),
          deliver(tr.from, { type: "note", title: "Transfer completed", text: amt + " to " + nm(tr.to) + " was approved." })];
        tr.status = "Completed";
      } else if (act === "cancel" && tr.status === "Pending") {
        jobs = [deliver(tr.from, { type: "credit", usd: tr.usd, title: "Transfer cancelled", text: amt + " to " + nm(tr.to) + " was cancelled and refunded." }),
          deliver(tr.to, { type: "note", title: "Transfer cancelled", text: "The " + amt + " transfer from " + nm(tr.from) + " was cancelled." })];
        tr.status = "Cancelled";
      } else if (act === "reverse" && tr.status === "Completed") {
        var rc = ledgerOf(tr.to).cash;
        if (rc + 0.005 < tr.usd) return Promise.reject(new Error(nm(tr.to) + " only has " + usd(rc) + " available, so this can't be reversed."));
        jobs = [deliver(tr.to, { type: "debit", usd: tr.usd, title: "Transfer reversed", text: amt + " from " + nm(tr.from) + " was taken back." }),
          deliver(tr.from, { type: "credit", usd: tr.usd, title: "Transfer reversed", text: amt + " to " + nm(tr.to) + " was returned to you." })];
        tr.status = "Reversed";
      } else return Promise.reject(new Error("Nothing to do."));
      tr.updatedAt = Date.now();
      return Promise.all(jobs).then(function () { return C.saveTransfer(tr); });
    }
    if (kind === "plan") {
      var rq = S.reqs.filter(function (x) { return x.id === id; })[0];
      if (!rq) return Promise.reject(new Error("Request not found."));
      var nmP = rq.name || C.planName(rq.plan), f = usd(rq.fee), jb;
      if (act === "approve" && rq.status === "Pending") {
        var cp = C.plans(), curIdx = C.planIdx(ledgerOf(rq.email)), newIdx = -1;
        cp.forEach(function (p, i) { if (p.id === rq.plan) newIdx = i; });
        if (newIdx < 0) return Promise.reject(new Error("That plan no longer exists. Reject the request to refund the fee."));
        if (curIdx >= newIdx) return Promise.reject(new Error("User already has this plan or a higher one."));
        jb = deliver(rq.email, { type: "plan", plan: rq.plan, title: nmP + " plan activated", text: "Your upgrade was approved. Leverage is now ×" + C.levOf(cp[newIdx]) + "." });
        rq.status = "Completed";
      } else if (act === "reject" && rq.status === "Pending") {
        jb = deliver(rq.email, { type: "credit", usd: rq.fee, title: "Upgrade rejected", text: "Your " + nmP + " request was rejected and the " + f + " fee was refunded." });
        rq.status = "Rejected";
      } else if (act === "reverse" && rq.status === "Completed") {
        var back = rq.from, ledPlan = ledgerOf(rq.email).plan;
        jb = deliver(rq.email, { type: "plan", plan: ledPlan === rq.plan ? back : ledPlan, title: "Upgrade reversed", text: "Your " + nmP + " plan was reversed." })
          .then(function () { return deliver(rq.email, { type: "credit", usd: rq.fee, title: "Upgrade fee refunded", text: "The " + f + " fee for " + nmP + " was refunded." }); });
        rq.status = "Reversed";
      } else return Promise.reject(new Error("Nothing to do."));
      rq.updatedAt = Date.now();
      return Promise.resolve(jb).then(function () { return C.saveReq(rq); });
    }
  }

  /* ---------- messages ---------- */
  function msgStatus(m) {
    if (m.status === "cancelled") return "Cancelled";
    if (m.status === "recalled") return "Recalled";
    return Date.parse(m.deliverAt) > Date.now() ? "Scheduled" : "Delivered";
  }
  function recipientLabel(m) {
    if (m.sendAll) return "All users";
    var names = (m.recipients || []).map(function (e) { var u = userOf(norm(e)); return u ? fullName(u) : e; });
    return names.length + " user" + (names.length === 1 ? "" : "s") + '<small>' + esc(names.slice(0, 4).join(", ")) + (names.length > 4 ? "…" : "") + "</small>";
  }
  function renderMessages() {
    setHTML($("#m-rows"), S.messages.length ? S.messages.map(function (m) {
      var st = msgStatus(m), btns = "";
      if (st === "Scheduled") btns = '<button class="btn sm ghost msg-act" data-act="cancelled" data-id="' + esc(m.id) + '">Cancel</button>';
      else if (st === "Delivered") btns = '<button class="btn sm danger msg-act" data-act="recalled" data-id="' + esc(m.id) + '">Recall</button>';
      else if (st === "Cancelled") btns = '<button class="btn sm ghost msg-act" data-act="delete" data-id="' + esc(m.id) + '">Delete</button>';
      return "<tr><td><b>" + esc(m.title) + "</b><small>" + esc((m.body || "").slice(0, 90)) + "</small></td><td>" + recipientLabel(m) + "</td><td>" + when(m.deliverAt) +
        '</td><td><span class="pill ' + (st === "Delivered" ? "ok" : st === "Scheduled" ? "" : "bad") + '">' + st + "</span></td><td>" + btns + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty-note">No messages yet.</td></tr>');
  }
  var pickerSig = "";
  function renderPicker() {
    var q = ($("#m-search").value || "").trim().toLowerCase();
    var checked = {};
    $$("#m-picker input:checked").forEach(function (c) { checked[c.value] = 1; });
    var html = S.users.filter(function (u) { return !q || (fullName(u) + " " + u.email).toLowerCase().indexOf(q) > -1; }).map(function (u) {
      return '<label class="pick"><input type="checkbox" value="' + esc(u.email) + '"' + (checked[u.email] || pickSel[u.email] ? " checked" : "") + '><span><b>' + esc(fullName(u)) + "</b><small>" + esc(u.email) + "</small></span></label>";
    }).join("") || '<div class="empty-note">No users.</div>';
    var sig = html + q;
    if (sig !== pickerSig) { pickerSig = sig; $("#m-picker").innerHTML = html; }
  }
  var pickSel = {};
  function sendMessage() {
    var title = $("#m-title").value.trim(), body = $("#m-body").value.trim(), all = $("#m-aud-all").checked, later = $("#m-when-later").checked;
    var say = function (t, ok) { var e = $("#m-msg"); e.textContent = t || ""; e.classList.toggle("ok", !!ok && !!t); };
    if (!title || !body) return say("Enter a title and a message.");
    var rec = Object.keys(pickSel).filter(function (k) { return pickSel[k]; });
    if (!all && !rec.length) return say("Choose at least one recipient.");
    var at = new Date();
    if (later) {
      var v = $("#m-at").value;
      if (!v) return say("Pick a delivery date and time.");
      at = new Date(v);
      if (isNaN(at) || at.getTime() < Date.now() + 20000) return say("Pick a delivery time in the future.");
    }
    var row = { title: title, body: body, send_to_all: all, recipients: all ? [] : rec, deliver_at: at.toISOString(), status: "active" };
    var btn = $("#m-send"); btn.disabled = true;
    var p;
    if (DB.enabled) { row.created_by = C.user.id; p = DB.admin.addMessage(row).then(function (r) { S.messages.unshift(mapMsg(r)); }); }
    else {
      var list = C.read("broadcasts", []);
      list.unshift({ id: uid(), title: title, body: body, sendAll: all, recipients: row.recipients, deliverAt: row.deliver_at, status: "active", createdAt: new Date().toISOString() });
      C.write("broadcasts", list);
      p = Promise.resolve();
    }
    p.then(function () {
      say(later ? "Scheduled for " + when(at) + "." : "Sent. Users receive it as a notification within moments.", true);
      $("#m-title").value = ""; $("#m-body").value = ""; pickSel = {}; pickerSig = "";
      return refresh();
    }).catch(function (e) { say((e && e.message) || "Could not send the message."); }).then(function () { btn.disabled = false; });
  }
  function messageAction(id, act) {
    var m = S.messages.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!m) return;
    if (act === "recalled" && !confirm("Recall this message? It will disappear from users' notifications.")) return;
    if (act === "delete" && !confirm("Delete this cancelled message?")) return;
    var p;
    if (DB.enabled) p = act === "delete" ? DB.admin.deleteMessage(m.id) : DB.admin.updateMessage(m.id, { status: act });
    else {
      var list = C.read("broadcasts", []);
      if (act === "delete") list = list.filter(function (x) { return x.id !== m.id; });
      else list.forEach(function (x) { if (x.id === m.id) x.status = act; });
      C.write("broadcasts", list);
      p = Promise.resolve();
    }
    p.then(function () { toast(act === "delete" ? "Deleted." : act === "cancelled" ? "Delivery cancelled." : "Message recalled."); return refresh(); }).catch(fail);
  }

  /* ---------- site features ---------- */
  var editPlans = [], editLogo = "";
  var DEFAULT_MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="#04231a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l5-6 4 3 7-9"/></svg>';
  function paintLogoPrev() {
    var p = $("#st-logo-prev");
    p.innerHTML = editLogo ? '<img alt="">' : DEFAULT_MARK;
    if (editLogo) p.firstChild.src = editLogo;
    p.classList.toggle("has-logo", !!editLogo);
    $("#st-logo-del").hidden = !editLogo;
  }
  function logoFromFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = reject;
      fr.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var S = 160, c = document.createElement("canvas"), m = Math.min(img.width, img.height);
          c.width = c.height = S;
          c.getContext("2d").drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
          resolve(c.toDataURL("image/png"));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function slug(s) { return (s || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan"; }
  function planEditorHTML() {
    return editPlans.map(function (p, i) {
      return '<div class="pe" data-i="' + i + '" data-id="' + esc(p.id) + '"><div class="pe-head"><span class="tier" style="background:' + esc(p.color) + '">' + (i + 1) + '</span><b>' + esc(p.name || "New plan") +
        '</b><button class="btn sm danger pe-del" type="button" data-i="' + i + '">Remove</button></div><div class="form-grid">' +
        '<div><label>Name</label><input class="pe-name" value="' + esc(p.name) + '"></div><div><label>Minimum balance (USD)</label><input class="pe-min" type="number" min="1" step="any" value="' + esc(p.min) + '"></div>' +
        '<div><label>x factor (leverage = x²)</label><input class="pe-x" type="number" min="1" step="any" value="' + esc(p.x) + '"></div><div><label>Colour</label><input class="pe-color" type="color" value="' + esc(p.color || "#888888") + '"></div>' +
        '<div><label>Tag (optional)</label><input class="pe-tag" value="' + esc(p.tag || "") + '" placeholder="e.g. Recommended"></div></div>' +
        '<label>Benefits (one per line)</label><textarea class="pe-perks" rows="3">' + esc((p.perks || []).join("\n")) + "</textarea></div>";
    }).join("") || '<div class="empty-note">No plans yet. Add one below.</div>';
  }
  function collectPlans() {
    return $$("#pe-list .pe").map(function (el) {
      var name = el.querySelector(".pe-name").value.trim();
      return { id: el.dataset.id || slug(name) + "-" + uid().slice(0, 4), name: name, min: parseFloat(el.querySelector(".pe-min").value) || 0, x: parseFloat(el.querySelector(".pe-x").value) || 0,
        color: el.querySelector(".pe-color").value, tag: el.querySelector(".pe-tag").value.trim(),
        perks: el.querySelector(".pe-perks").value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean) };
    });
  }
  function renderSite(force) {
    if (!force && $("#pe-list").children.length) return;
    editPlans = C.plans().map(function (p) { return Object.assign({}, p); });
    $("#pe-list").innerHTML = planEditorHTML();
    var st = DB.Site.settings();
    $("#st-brand").value = st.brand || "Your Brand";
    editLogo = st.logo || "";
    paintLogoPrev();
    $("#st-fee").value = st.feePct; $("#st-mind").value = st.minDeposit; $("#st-minw").value = st.minWithdraw;
    $("#st-auto").value = st.autoConfirmSec; $("#st-tg").value = st.telegram;
  }
  function saveSite() {
    var say = function (t, ok) { var e = $("#st-msg"); e.textContent = t || ""; e.classList.toggle("ok", !!ok && !!t); };
    var plans = collectPlans();
    if (!plans.length) return say("Keep at least one plan.");
    for (var i = 0; i < plans.length; i++) {
      if (!plans[i].name) return say("Every plan needs a name.");
      if (!(plans[i].min > 0)) return say(plans[i].name + ": enter a minimum balance above 0.");
      if (!(plans[i].x > 0)) return say(plans[i].name + ": enter an x factor above 0.");
    }
    var names = plans.map(function (p) { return p.name.toLowerCase(); });
    if (names.some(function (n, k) { return names.indexOf(n) !== k; })) return say("Plan names must be unique.");
    var brand = $("#st-brand").value.trim();
    if (!brand) return say("Enter a brand name.");
    if (brand.length > 40) return say("Keep the brand name under 40 characters.");
    var st = { brand: brand, logo: editLogo, feePct: parseFloat($("#st-fee").value) || 0, minDeposit: parseFloat($("#st-mind").value) || 0, minWithdraw: parseFloat($("#st-minw").value) || 0,
      autoConfirmSec: parseFloat($("#st-auto").value) || 0, telegram: $("#st-tg").value.trim() };
    var btn = $("#st-save"); btn.disabled = true;
    DB.Site.save(plans, st).then(function () {
      C.applySite();
      DB.applyBrand();
      say("Saved. The brand name, plans and options update across the site right away.", true);
      renderSite(true);
    }).catch(function (e) { say((e && e.message) || "Could not save."); }).then(function () { btn.disabled = false; });
  }

  /* ---------- wiring ---------- */
  function renderAll() { renderUsers(); renderTx(); renderMessages(); renderPicker(); renderSite(false); renderDrawer(); }
  function refresh() { return loadAll().then(renderAll).catch(fail); }

  function tab(name) {
    $$("[data-atab]").forEach(function (b) { b.classList.toggle("active", b.dataset.atab === name); });
    ["users", "tx", "msgs", "analytics", "site"].forEach(function (n) { $("#atab-" + n).hidden = n !== name; });
    if (name === "analytics" && AN) loadAnalytics(); // AN is set up further down on first run
  }
  $$("[data-atab]").forEach(function (b) { b.onclick = function () { tab(b.dataset.atab); history.replaceState(null, "", "#" + b.dataset.atab); }; });
  var h0 = location.hash.replace("#", "");
  tab(["tx", "msgs", "analytics", "site"].indexOf(h0) > -1 ? h0 : "users");
  window.addEventListener("hashchange", function () { var h = location.hash.replace("#", ""); if (["users", "tx", "msgs", "analytics", "site"].indexOf(h) > -1) tab(h); });

  $("#q").oninput = renderUsers;
  $("#tx-flt").onchange = renderTx;
  $("#rows").addEventListener("click", function (e) {
    var m = e.target.closest("[data-manage]");
    if (m) return openUser(m.dataset.manage, true);
    var b = e.target.closest("[data-user]");
    if (b) openUser(b.dataset.user);
  });
  $("#ud-close").onclick = closeUser;
  $("#user-drawer").addEventListener("click", function (e) { if (e.target.id === "user-drawer") closeUser(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && openEmail) closeUser(); });
  $("#ud-credit").onclick = function () { adjust("credit"); };
  $("#ud-debit").onclick = function () { adjust("debit"); };
  $("#ud-notify").onclick = notifyUser;
  $("#ud-del").onclick = deleteUser;
  $("#ud-unverify").onclick = toggleVerify;
  $("#ud-t-open").onclick = behalfOpen;
  $("#ud-t-asset").onchange = renderBehalf;
  $("#ud-t-pos").addEventListener("click", function (e) { var b = e.target.closest(".ud-close-pos"); if (b) behalfClose(b.dataset.id); });
  C.Feed.on(function () { if (openEmail) renderBehalf(); });
  setInterval(function () { if (openEmail && !document.hidden) renderBehalf(); }, 1000);

  $("#tx-rows").addEventListener("click", function (e) {
    var b = e.target.closest(".tx-act");
    if (!b || busyAct) return;
    var act = b.dataset.act;
    if (act === "reverse" && !confirm("Reverse this transaction? Balances will be adjusted.")) return;
    busyAct = true;
    txAction(b.dataset.kind, b.dataset.id, b.dataset.e, act).then(function () { toast("Done."); return refresh(); }).catch(fail).then(function () { busyAct = false; });
  });

  $("#m-picker").addEventListener("change", function (e) { if (e.target.matches("input")) pickSel[e.target.value] = e.target.checked; });
  $("#m-search").oninput = renderPicker;
  $("#m-pick-all").onclick = function () { $$("#m-picker input").forEach(function (c) { c.checked = true; pickSel[c.value] = true; }); };
  $("#m-pick-none").onclick = function () { pickSel = {}; $$("#m-picker input").forEach(function (c) { c.checked = false; }); };
  function audience() { var all = $("#m-aud-all").checked; $("#m-pick-box").hidden = all; }
  function timing() { $("#m-at").hidden = !$("#m-when-later").checked; }
  $$("input[name=m-aud]").forEach(function (r) { r.onchange = audience; });
  $$("input[name=m-when]").forEach(function (r) { r.onchange = timing; });
  audience(); timing();
  $("#m-send").onclick = sendMessage;
  $("#m-rows").addEventListener("click", function (e) { var b = e.target.closest(".msg-act"); if (b) messageAction(b.dataset.id, b.dataset.act); });

  $("#pe-add").onclick = function () {
    editPlans = collectPlans();
    var last = editPlans[editPlans.length - 1];
    editPlans.push({ id: "plan-" + uid().slice(0, 5), name: "", min: last ? last.min * 2 : 100, x: last ? last.x + 5 : 5, color: "#6aa0e0", tag: "", perks: ["Managed trades", "Live trade feed"] });
    $("#pe-list").innerHTML = planEditorHTML();
  };
  $("#pe-list").addEventListener("click", function (e) {
    var b = e.target.closest(".pe-del");
    if (!b) return;
    if (!confirm("Remove this plan? Users currently on it will lose trading access until they upgrade to an existing plan.")) return;
    editPlans = collectPlans();
    editPlans.splice(Number(b.dataset.i), 1);
    $("#pe-list").innerHTML = planEditorHTML();
  });
  $("#st-save").onclick = saveSite;
  $("#st-logo-pick").onclick = function () { $("#st-logo-file").click(); };
  $("#st-logo-del").onclick = function () { editLogo = ""; paintLogoPrev(); $("#st-msg").textContent = "Logo removed. Click Save site features to apply."; };
  $("#st-logo-file").onchange = function () {
    var f = this.files && this.files[0], say = function (t, ok) { var e = $("#st-msg"); e.textContent = t || ""; e.classList.toggle("ok", !!ok && !!t); };
    this.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type)) return say("Please choose an image file (PNG, JPG, SVG or WebP).");
    if (f.size > 8 * 1024 * 1024) return say("That image is too large (max 8 MB).");
    logoFromFile(f).then(function (d) { editLogo = d; paintLogoPrev(); say("Logo ready. Click Save site features to publish it.", true); })
      .catch(function () { say("Could not read that image. Try another one."); });
  };

  /* ---------- analytics ---------- */
  var AN = { metric: "views", data: null, seq: 0 };
  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function rangeBounds() {
    var r = $("#an-range").value, now = new Date(), from, to = now;
    if (r === "today") from = dayStart(now);
    else if (r === "yesterday") { from = dayStart(new Date(now - 864e5)); to = new Date(dayStart(now) - 1); }
    else if (r === "custom") {
      from = $("#an-from").value ? new Date($("#an-from").value + "T00:00:00") : dayStart(new Date(now - 6 * 864e5));
      to = $("#an-to").value ? new Date($("#an-to").value + "T23:59:59") : now;
    } else from = dayStart(new Date(now - (parseInt(r, 10) - 1) * 864e5));
    return { from: from, to: to };
  }
  function loadEvents(from, to) {
    if (DB.enabled) return DB.admin.events(from.toISOString(), to.toISOString()).then(function (rows) {
      return rows.map(function (r) { return { t: Date.parse(r.created_at), type: r.type, path: r.path, vid: r.visitor_id, sid: r.session_id, dev: r.device, ref: r.referrer, u: r.user_key, p: r.props }; });
    });
    return Promise.resolve(DB.localEvents().filter(function (e) { return e.t >= +from && e.t <= +to; }));
  }
  function summarize(ev, from, to) {
    var pv = ev.filter(function (e) { return e.type === "pageview"; }), vis = {}, ses = {}, users = {}, pages = {}, dev = {}, refs = {}, types = {};
    pv.forEach(function (e) {
      vis[e.vid] = 1; ses[e.sid] = (ses[e.sid] || 0) + 1; if (e.u) users[e.u] = 1;
      var pg = pages[e.path] || (pages[e.path] = { v: 0, vis: {} }); pg.v++; pg.vis[e.vid] = 1;
      dev[e.dev || "desktop"] = (dev[e.dev || "desktop"] || 0) + 1;
      var rf = e.ref || "Direct"; refs[rf] = (refs[rf] || 0) + 1;
    });
    ev.forEach(function (e) { if (e.type !== "pageview") types[e.type] = (types[e.type] || 0) + 1; });
    var sess = Object.keys(ses), bounces = sess.filter(function (k) { return ses[k] === 1; }).length;
    var newUsers = S.users.filter(function (u) { return u.created >= +from && u.created <= +to; }).length;
    return { views: pv.length, visitors: Object.keys(vis).length, sessions: sess.length, active: Object.keys(users).length,
      bounce: sess.length ? Math.round((bounces / sess.length) * 100) : 0, avg: sess.length ? pv.length / sess.length : 0,
      pages: pages, dev: dev, refs: refs, types: types, newUsers: newUsers, trades: types.trade_open || 0, deposits: types.deposit_request || 0 };
  }
  function delta(cur, prev) {
    if (!prev) return cur ? '<span class="delta up">new</span>' : '<span class="delta">—</span>';
    var d = Math.round(((cur - prev) / prev) * 100);
    return '<span class="delta ' + (d >= 0 ? "up" : "down") + '">' + (d >= 0 ? "▲ " : "▼ ") + Math.abs(d) + "%</span>";
  }
  function series(ev, from, to, metric) {
    var span = +to - +from, hourly = span <= 48 * 36e5, step = hourly ? 36e5 : 864e5, n = Math.max(1, Math.ceil(span / step)), sets = [], i;
    for (i = 0; i < n; i++) sets.push({});
    var counts = new Array(n).fill(0);
    ev.forEach(function (e) {
      var k = Math.floor((e.t - +from) / step); if (k < 0 || k >= n) return;
      if (metric === "views" && e.type === "pageview") counts[k]++;
      else if (metric === "visitors" && e.type === "pageview") sets[k][e.vid] = 1;
      else if (metric === "sessions" && e.type === "pageview") sets[k][e.sid] = 1;
      else if (metric === "signups" && e.type === "signup") counts[k]++;
      else if (metric === "trades" && e.type === "trade_open") counts[k]++;
    });
    var vals = counts.map(function (c, k) { return metric === "visitors" || metric === "sessions" ? Object.keys(sets[k]).length : c; });
    var labels = vals.map(function (_, k) { var d = new Date(+from + k * step); return hourly ? d.getHours() + ":00" : d.toLocaleDateString([], { month: "short", day: "numeric" }); });
    return { vals: vals, labels: labels };
  }
  function chartSVG(sr) {
    var W = 800, H = 240, L = 36, B = 30, T = 12, n = sr.vals.length, max = Math.max.apply(null, sr.vals.concat([1]));
    var nice = Math.ceil(max / 4) * 4 || 4, bw = (W - L - 8) / n, out = '<svg viewBox="0 0 ' + W + " " + H + '" class="an-svg" role="img" aria-label="Chart">';
    for (var g = 0; g <= 4; g++) {
      var y = T + (H - T - B) * (1 - g / 4);
      out += '<line class="an-grid" x1="' + L + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/><text class="an-lbl" x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round((nice * g) / 4) + "</text>";
    }
    var every = Math.ceil(n / 10);
    sr.vals.forEach(function (v, i) {
      var h = (H - T - B) * (v / nice), x = L + i * bw + bw * 0.15;
      out += '<rect class="an-bar" x="' + x.toFixed(1) + '" y="' + (H - B - h).toFixed(1) + '" width="' + Math.max(1, bw * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"><title>' + esc(sr.labels[i]) + ": " + v + "</title></rect>";
      if (i % every === 0) out += '<text class="an-lbl" x="' + (L + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(sr.labels[i]) + "</text>";
    });
    return out + "</svg>";
  }
  function barList(map, total, fmtKey) {
    var keys = Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).slice(0, 8);
    if (!keys.length) return '<div class="empty-note">No data in this period.</div>';
    return keys.map(function (k) {
      var pc = total ? Math.round((map[k] / total) * 100) : 0;
      return '<div class="an-row"><span>' + esc(fmtKey ? fmtKey(k) : k) + '</span><div class="an-meter"><i style="width:' + pc + '%"></i></div><b>' + map[k] + "</b></div>";
    }).join("");
  }
  var EVN = { signup: "Sign-ups", signin: "Sign-ins", trade_open: "Trades opened", trade_close: "Trades closed", deposit_request: "Deposit requests", withdrawal_request: "Withdrawal requests", transfer_send: "Transfers sent", plan_request: "Plan requests" };
  function paintAnalytics() {
    if (!AN.data) return;
    var d = AN.data, cur = d.cur, prev = d.prev;
    var cards = [["Page views", cur.views, prev.views], ["Visitors", cur.visitors, prev.visitors], ["Sessions", cur.sessions, prev.sessions], ["Signed-in users", cur.active, prev.active],
      ["New accounts", cur.newUsers, prev.newUsers], ["Trades opened", cur.trades, prev.trades], ["Deposit requests", cur.deposits, prev.deposits]];
    var html = cards.map(function (c) { return '<div class="stat-card"><span>' + c[0] + "</span><b>" + c[1].toLocaleString() + "</b>" + delta(c[1], c[2]) + "</div>"; }).join("");
    html += '<div class="stat-card"><span>Bounce rate</span><b>' + cur.bounce + "%</b><span class=\"delta\">" + prev.bounce + '% before</span></div>';
    setHTML($("#an-cards"), html);
    $$("[data-am]").forEach(function (b) { b.classList.toggle("active", b.dataset.am === AN.metric); });
    setHTML($("#an-chart"), chartSVG(series(d.curEv, d.from, d.to, AN.metric)));
    var pg = {}; Object.keys(cur.pages).forEach(function (k) { pg[k] = cur.pages[k].v; });
    setHTML($("#an-pages"), barList(pg, cur.views, function (k) { return k.replace(".html", ""); }));
    setHTML($("#an-dev"), "<h3 class=\"ud-h\" style=\"margin-top:0\">Devices</h3>" + barList(cur.dev, cur.views) + "<h3 class=\"ud-h\">Traffic sources</h3>" + barList(cur.refs, cur.views));
    var ev = Object.keys(cur.types).length ? Object.keys(EVN).filter(function (k) { return cur.types[k]; }).map(function (k) { return '<div class="an-row"><span>' + EVN[k] + "</span><div class=\"an-meter\"><i style=\"width:" + Math.min(100, (cur.types[k] / Math.max(1, Math.max.apply(null, Object.keys(cur.types).map(function (x) { return cur.types[x]; })))) * 100) + '%"></i></div><b>' + cur.types[k] + "</b></div>"; }).join("") : "";
    setHTML($("#an-events"), ev || '<div class="empty-note">No activity recorded in this period.</div>');
  }
  function loadAnalytics() {
    var b = rangeBounds(), span = +b.to - +b.from, prevFrom = new Date(+b.from - span - 1), seq = ++AN.seq;
    $("#an-from").hidden = $("#an-to").hidden = $("#an-range").value !== "custom";
    $("#an-note").textContent = DB.enabled ? "Showing all visitors recorded in Supabase." : "Local mode: only visits and actions from this browser are counted. Connect Supabase to track every visitor.";
    loadEvents(prevFrom, b.to).then(function (all) {
      if (seq !== AN.seq) return;
      var curEv = all.filter(function (e) { return e.t >= +b.from; }), prevEv = all.filter(function (e) { return e.t < +b.from; });
      AN.data = { from: b.from, to: b.to, curEv: curEv, cur: summarize(curEv, b.from, b.to), prev: summarize(prevEv, prevFrom, new Date(+b.from - 1)) };
      paintAnalytics();
    }).catch(fail);
  }
  $("#an-range").onchange = loadAnalytics;
  $("#an-from").onchange = loadAnalytics;
  $("#an-to").onchange = loadAnalytics;
  $("#an-refresh").onclick = loadAnalytics;
  $$("[data-am]").forEach(function (b) { b.onclick = function () { AN.metric = b.dataset.am; paintAnalytics(); }; });
  setInterval(function () { if (!document.hidden && !$("#atab-analytics").hidden) loadAnalytics(); }, 60000);
  if (!$("#atab-analytics").hidden) loadAnalytics();

  /* ---------- start ---------- */
  function ready() { window.__admReady = true; C.finishLoading(); }
  $("#adm-who").textContent = C.user.email;
  $("#adm-demo").hidden = DB.enabled;
  loadAll().then(function () { renderAll(); ready(); }).catch(function (e) { fail(e); ready(); });
  setInterval(function () {
    if (document.hidden || busyAct || !window.__admReady) return;
    loadAll().then(function () { renderUsers(); renderTx(); renderMessages(); renderPicker(); renderDrawer(); }).catch(C.warn);
  }, 12000);
})();
