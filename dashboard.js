/* Account area: guard, profile photo, and the demo trading data. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const read = (k, f) => {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v ?? f;
    } catch (e) {
      return f;
    }
  };
  const write = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  };

  /* ---------- demo data ---------- */
  const prices = {
    "BTC/USD": { price: 109430.12, change: 4.21, kind: "crypto", icon: "₿" },
    "ETH/USD": { price: 3482.67, change: 3.12, kind: "crypto", icon: "Ξ" },
    "SOL/USD": { price: 162.34, change: 2.76, kind: "crypto", icon: "S" },
    "EUR/USD": { price: 1.1754, change: 0.32, kind: "forex", icon: "€" },
    "GBP/USD": { price: 1.3682, change: 0.21, kind: "forex", icon: "£" },
    "USD/JPY": { price: 157.32, change: -0.18, kind: "forex", icon: "¥" },
    AAPL: { price: 195.42, change: 1.34, kind: "stocks", icon: "A" },
    NVDA: { price: 182.63, change: 2.61, kind: "stocks", icon: "N" },
    TSLA: { price: 338.42, change: -1.24, kind: "stocks", icon: "T" }
  };
  const defPositions = [
    { symbol: "BTC/USD", side: "Long", size: 0.02, entry: 108200, current: 109430.12, pnl: 56.2 },
    { symbol: "ETH/USD", side: "Long", size: 0.5, entry: 3320.4, current: 3482.67, pnl: 81.14 },
    { symbol: "EUR/USD", side: "Long", size: 1, entry: 1.172, current: 1.1754, pnl: 54.6 },
    { symbol: "AAPL", side: "Long", size: 5, entry: 188.3, current: 195.42, pnl: 35.6 }
  ];
  const defOrders = [
    { date: "24 Jun, 10:32", symbol: "BTC/USD", type: "Limit", side: "Buy", amount: 0.01, price: 108000, status: "Open" },
    { date: "24 Jun, 09:15", symbol: "ETH/USD", type: "Stop", side: "Sell", amount: 0.5, price: 3600, status: "Open" },
    { date: "23 Jun, 16:42", symbol: "AAPL", type: "Limit", side: "Buy", amount: 5, price: 190, status: "Filled" },
    { date: "22 Jun, 14:20", symbol: "EUR/USD", type: "Stop", side: "Sell", amount: 1, price: 1.17, status: "Cancelled" }
  ];
  const defHistory = [
    { date: "24 Jun, 10:12", symbol: "BTC/USD", side: "Long", size: 0.02, entry: 108200, exit: 109430, pnl: 24.6, duration: "2h 14m" },
    { date: "23 Jun, 22:41", symbol: "ETH/USD", side: "Long", size: 0.5, entry: 3320, exit: 3482, pnl: 81.14, duration: "1h 32m" },
    { date: "22 Jun, 11:03", symbol: "EUR/USD", side: "Long", size: 1, entry: 1.17, exit: 1.175, pnl: 53.6, duration: "4h 12m" },
    { date: "21 Jun, 17:27", symbol: "TSLA", side: "Short", size: 0.1, entry: 345, exit: 338, pnl: 118.6, duration: "2h 6m" },
    { date: "20 Jun, 14:11", symbol: "AAPL", side: "Long", size: 5, entry: 182, exit: 188, pnl: 30, duration: "6h 20m" }
  ];
  const getPositions = () => read("trade.positions", defPositions);
  const getOrders = () => read("trade.orders", defOrders);
  const getHistory = () => read("trade.history", defHistory);

  /* ---------- formatting ---------- */
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) =>
    (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (n) => (n >= 0 ? "+" : "") + money(n);
  const price = (n) => (n < 10 ? "$" + n.toFixed(4) : money(n));
  const pct = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
  const cls = (n) => (n >= 0 ? "up" : "down");
  const coin = (s) => `<span class="coin">${esc((prices[s] && prices[s].icon) || s[0])}</span>`;

  /* ---------- user + guard ---------- */
  function currentUser() {
    try {
      const s = JSON.parse(localStorage.getItem("auth.session") || "null");
      const users = JSON.parse(localStorage.getItem("auth.users") || "{}");
      return s && users[s.email] ? users[s.email] : null;
    } catch (e) {
      return null;
    }
  }
  const user = currentUser();
  if (!user) {
    location.replace("signin.html");
    return;
  }
  function saveUser(patch) {
    const users = read("auth.users", {});
    users[user.email] = Object.assign({}, users[user.email], patch);
    write("auth.users", users);
    Object.assign(user, patch);
  }

  /* ---------- profile photo ---------- */
  function paintAvatar() {
    $$(".av").forEach((el) => {
      const img = el.querySelector("img"),
        ph = el.querySelector("svg");
      if (!img) return;
      if (user.avatar) {
        img.src = user.avatar;
        img.hidden = false;
        if (ph) ph.style.display = "none";
      } else {
        img.hidden = true;
        img.removeAttribute("src");
        if (ph) ph.style.display = "";
      }
    });
    if ($("#avatar-remove")) $("#avatar-remove").hidden = !user.avatar;
    if ($("#avatar-pick")) $("#avatar-pick").textContent = user.avatar ? "Change photo" : "Upload photo";
  }
  // centre-crop to a 256px square so it stays small in storage
  function toAvatar(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const S = 256,
            c = document.createElement("canvas"),
            m = Math.min(img.width, img.height);
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
    const file = $("#avatar-file"),
      msg = (t, ok) => {
        const e = $("#e-avatar");
        if (!e) return;
        e.textContent = t || "";
        e.classList.toggle("ok", !!ok && !!t);
      };
    if (!file) return;
    $("#avatar-pick").onclick = () => file.click();
    file.onchange = () => {
      const f = file.files && file.files[0];
      file.value = "";
      if (!f) return;
      if (!/^image\//.test(f.type)) return msg("Please choose an image file.");
      if (f.size > 10 * 1024 * 1024) return msg("That image is too large (max 10 MB).");
      toAvatar(f)
        .then((data) => {
          saveUser({ avatar: data });
          paintAvatar();
          msg("Photo updated.", true);
        })
        .catch(() => msg("Could not read that image. Try another one."));
    };
    $("#avatar-remove").onclick = () => {
      saveUser({ avatar: "" });
      paintAvatar();
      msg("Photo removed.", true);
    };
  }

  /* ---------- header / sidebar ---------- */
  const fullName = ((user.first || "Trader") + " " + (user.last || "")).trim();
  if ($("#side-name")) $("#side-name").textContent = fullName;
  if ($("#side-email")) $("#side-email").textContent = user.email;
  if ($("#hello")) $("#hello").textContent = "Hello, " + (user.first || "Trader");
  if (window.SDSS_IS_ADMIN && window.SDSS_IS_ADMIN(user.email))
    $$("[data-admin]").forEach((e) => (e.hidden = false));
  paintAvatar();
  initAvatar();

  /* ---------- dashboard ---------- */
  function assetRow(s) {
    const p = prices[s];
    return `<div class="row">${coin(s)}<div class="grow"><b>${s}</b><small>${p.kind}</small></div>
      <div class="end"><b>${price(p.price)}</b><small class="${cls(p.change)}">${pct(p.change)}</small></div></div>`;
  }
  function renderDashboard() {
    if ($("#market-watch"))
      $("#market-watch").innerHTML = ["BTC/USD", "ETH/USD", "EUR/USD", "AAPL"].map(assetRow).join("");
    const ps = getPositions();
    if ($("#positions-preview"))
      $("#positions-preview").innerHTML = ps.length
        ? ps
            .slice(0, 4)
            .map(
              (p) => `<div class="row">${coin(p.symbol)}<div class="grow"><b>${esc(p.symbol)}</b><small>${p.side} · ${p.size}</small></div>
          <b class="${cls(p.pnl)}">${signed(p.pnl)}</b></div>`
            )
            .join("")
        : '<div class="empty-note">No open positions.</div>';
    const total = ps.reduce((a, p) => a + p.pnl, 0);
    if ($("#open-pnl")) {
      $("#open-pnl").textContent = signed(total);
      $("#open-pnl").className = cls(total);
    }
    if ($("#pos-count")) $("#pos-count").textContent = ps.length;
  }

  /* ---------- portfolio ---------- */
  function renderPositions() {
    const box = $("#positions-full");
    if (!box) return;
    const ps = getPositions();
    box.innerHTML = ps.length
      ? ps
          .map(
            (p) => `<tr><td><div class="asset">${coin(p.symbol)}<b>${esc(p.symbol)}</b></div></td>
        <td class="${p.side === "Long" ? "buy" : "sell"}">${p.side}</td><td>${p.size}</td><td>${price(p.entry)}</td>
        <td>${price(p.current)}</td><td class="${cls(p.pnl)}">${signed(p.pnl)}</td>
        <td><button class="btn sm ghost close-position" data-symbol="${esc(p.symbol)}" data-i="${ps.indexOf(p)}">Close</button></td></tr>`
          )
          .join("")
      : '<tr><td colspan="7" class="empty-note">No open positions.</td></tr>';
    $$(".close-position").forEach(
      (b) =>
        (b.onclick = () => {
          const arr = getPositions();
          arr.splice(Number(b.dataset.i), 1);
          write("trade.positions", arr);
          renderPositions();
        })
    );
  }

  /* ---------- markets ---------- */
  function renderMarkets(filter) {
    const box = $("#market-table");
    if (!box) return;
    box.innerHTML = Object.keys(prices)
      .filter((k) => filter === "all" || prices[k].kind === filter)
      .map((s) => {
        const p = prices[s];
        return `<tr><td><div class="asset">${coin(s)}<div><b>${s}</b><small>${p.kind}</small></div></div></td>
          <td>${price(p.price)}</td><td class="${cls(p.change)}">${pct(p.change)}</td>
          <td><a class="btn sm ghost" href="trade.html?asset=${encodeURIComponent(s)}">Trade</a></td></tr>`;
      })
      .join("");
  }
  function initMarketTabs() {
    $$("[data-market-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          $$("[data-market-tab]").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          renderMarkets(b.dataset.marketTab);
        })
    );
  }

  /* ---------- orders / history ---------- */
  function renderOrders(tab) {
    const box = $("#orders-table");
    if (!box) return;
    const map = { open: "Open", filled: "Filled", cancelled: "Cancelled" };
    const all = getOrders();
    const arr = all.filter((o) => o.status === map[tab]);
    box.innerHTML = arr.length
      ? arr
          .map(
            (o) => `<tr><td>${esc(o.date)}</td><td><b>${esc(o.symbol)}</b></td><td>${o.type}</td>
        <td class="${o.side === "Buy" ? "buy" : "sell"}">${o.side}</td><td>${o.amount}</td><td>${price(o.price)}</td>
        <td><span class="pill ${o.status === "Filled" ? "ok" : ""}">${o.status}</span></td>
        <td>${o.status === "Open" ? `<button class="btn sm ghost cancel-order" data-i="${all.indexOf(o)}">Cancel</button>` : ""}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="8" class="empty-note">No ${tab} orders.</td></tr>`;
    $$(".cancel-order").forEach(
      (b) =>
        (b.onclick = () => {
          const a = getOrders();
          a[Number(b.dataset.i)].status = "Cancelled";
          write("trade.orders", a);
          renderOrders(tab);
        })
    );
  }
  function initOrderTabs() {
    $$("[data-order-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          $$("[data-order-tab]").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          renderOrders(b.dataset.orderTab);
        })
    );
  }
  function renderHistory() {
    const box = $("#history-table");
    if (!box) return;
    box.innerHTML = getHistory()
      .map(
        (h) => `<tr><td>${esc(h.date)}</td><td><b>${esc(h.symbol)}</b></td>
      <td class="${h.side === "Long" ? "buy" : "sell"}">${h.side}</td><td>${h.size}</td><td>${price(h.entry)}</td>
      <td>${price(h.exit)}</td><td>${esc(h.duration)}</td><td class="${cls(h.pnl)}">${signed(h.pnl)}</td></tr>`
      )
      .join("");
  }
  function initExport() {
    const b = $("#export-history");
    if (!b) return;
    b.onclick = () => {
      const rows = [["Date", "Asset", "Side", "Size", "Entry", "Exit", "Duration", "P&L"]].concat(
        getHistory().map((h) => [h.date, h.symbol, h.side, h.size, h.entry, h.exit, h.duration, h.pnl])
      );
      const csv = rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = "trade-history.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  }

  /* ---------- trade ---------- */
  function initTrade() {
    const sel = $("#order-asset");
    if (!sel) return;
    sel.innerHTML = Object.keys(prices).map((s) => `<option>${s}</option>`).join("");
    const asked = new URLSearchParams(location.search).get("asset");
    if (asked && prices[asked]) sel.value = asked;
    let side = "Buy";
    const msg = $("#trade-msg");

    function refresh() {
      const s = sel.value,
        p = prices[s],
        amt = Number($("#order-amount").value) || 0;
      $("#trade-symbol").textContent = s;
      $("#trade-price").textContent = price(p.price);
      $("#trade-change").textContent = pct(p.change) + " today";
      $("#trade-change").className = cls(p.change);
      $("#est-cost").textContent = money(amt * p.price);
      $("#place-order").textContent = side + " " + s.split("/")[0];
    }
    function renderActivity() {
      const arr = getOrders().filter((o) => o.status === "Filled").slice(0, 4);
      $("#trade-activity").innerHTML = arr.length
        ? arr
            .map(
              (o) => `<div class="row"><div class="grow"><b>${o.side} ${esc(o.symbol)}</b><small>${esc(o.date)}</small></div>
          <b>${money(o.amount * o.price)}</b></div>`
            )
            .join("")
        : '<div class="empty-note">No orders yet.</div>';
    }
    sel.onchange = refresh;
    $("#order-amount").oninput = refresh;
    $$("[data-side]").forEach(
      (b) =>
        (b.onclick = () => {
          side = b.dataset.side;
          $$("[data-side]").forEach((x) => x.classList.toggle("active", x === b));
          refresh();
        })
    );
    $("#place-order").onclick = () => {
      const s = sel.value,
        amount = Number($("#order-amount").value) || 0;
      msg.classList.remove("ok");
      if (amount <= 0) {
        msg.textContent = "Enter a valid amount.";
        return;
      }
      const date = new Date().toLocaleString(),
        px = prices[s].price,
        pos = side === "Buy" ? "Long" : "Short";
      const orders = getOrders();
      orders.unshift({ date, symbol: s, type: "Market", side, amount, price: px, status: "Filled" });
      write("trade.orders", orders);
      const hist = getHistory();
      hist.unshift({ date, symbol: s, side: pos, size: amount, entry: px, exit: px, pnl: 0, duration: "Just now" });
      write("trade.history", hist);
      const ps = getPositions();
      ps.unshift({ symbol: s, side: pos, size: amount, entry: px, current: px, pnl: 0 });
      write("trade.positions", ps);
      $("#order-amount").value = "";
      msg.textContent = "Order placed.";
      msg.classList.add("ok");
      refresh();
      renderActivity();
    };
    refresh();
    renderActivity();
  }

  /* ---------- settings ---------- */
  function hashPassword(pw, salt) {
    const data = salt + ":" + pw;
    if (window.crypto && crypto.subtle && window.TextEncoder)
      return crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(data))
        .then((buf) => Array.from(new Uint8Array(buf), (b) => ("0" + b.toString(16)).slice(-2)).join(""));
    let h = 5381;
    for (let i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) | 0;
    return Promise.resolve("w" + (h >>> 0).toString(16));
  }
  const say = (id, t, ok) => {
    const e = $(id);
    if (!e) return;
    e.textContent = t || "";
    e.classList.toggle("ok", !!ok && !!t);
  };
  function initSettings() {
    if (!$("#f-prof")) return;
    $("#a-fn").value = user.first || "";
    $("#a-ln").value = user.last || "";
    $("#a-ph").value = user.phone || "";
    $("#a-email").value = user.email;
    $("#f-prof").addEventListener("submit", (e) => {
      e.preventDefault();
      const fn = $("#a-fn").value.trim(),
        ln = $("#a-ln").value.trim(),
        ph = $("#a-ph").value.trim();
      if (!fn || !ln) return say("#e-prof", "Enter your first and last name.");
      if (ph.replace(/\D/g, "").length < 7) return say("#e-prof", "Enter a valid phone number.");
      saveUser({ first: fn, last: ln, phone: ph });
      $("#side-name").textContent = (fn + " " + ln).trim();
      say("#e-prof", "Changes saved.", true);
    });
    $("#f-pass").addEventListener("submit", (e) => {
      e.preventDefault();
      const cur = $("#a-cur").value,
        n = $("#a-new").value;
      if (!cur) return say("#e-pass", "Enter your current password.");
      if (n.length < 8) return say("#e-pass", "Use a new password with at least 8 characters.");
      if (n !== $("#a-new2").value) return say("#e-pass", "The new passwords do not match.");
      hashPassword(cur, user.salt).then((old) => {
        if (old !== user.hash) return say("#e-pass", "Current password is incorrect.");
        const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => ("0" + b.toString(16)).slice(-2)).join("");
        return hashPassword(n, salt).then((hash) => {
          saveUser({ salt, hash });
          $("#f-pass").reset();
          say("#e-pass", "Password updated.", true);
        });
      });
    });
    $("#a-del").addEventListener("click", () => {
      if (!confirm("Delete your account? This cannot be undone.")) return;
      const users = read("auth.users", {});
      delete users[user.email];
      write("auth.users", users);
      ["auth.session", "trade.positions", "trade.orders", "trade.history"].forEach((k) => localStorage.removeItem(k));
      location.href = "signin.html";
    });
  }

  renderDashboard();
  renderPositions();
  renderMarkets("all");
  initMarketTabs();
  renderOrders("open");
  initOrderTabs();
  renderHistory();
  initExport();
  initTrade();
  initSettings();
})();
