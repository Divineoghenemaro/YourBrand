/* Live crypto converter (home page).
 * Prices come from the shared live feed (feed.js) and, if that isn't available,
 * from this file's own fallback polling, so the converter works on its own. */
(function () {
  "use strict";
  var box = document.getElementById("live-conv");
  if (!box) return;
  window.__lcReady = true;
  var $ = function (id) { return document.getElementById(id); };
  var pill = $("lc-status");
  function status(state, text) { if (pill) { pill.className = "live-pill " + state; pill.textContent = text; } }

  var COINS = ["BTC", "ETH", "SOL", "USDT"];
  var IDS = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana" };
  var CUR = [["USD", "US Dollar", 1], ["EUR", "Euro", 0.92], ["GBP", "British Pound", 0.79], ["JPY", "Japanese Yen", 150],
    ["CAD", "Canadian Dollar", 1.36], ["AUD", "Australian Dollar", 1.52], ["CHF", "Swiss Franc", 0.88], ["CNY", "Chinese Yuan", 7.2],
    ["INR", "Indian Rupee", 83], ["NGN", "Nigerian Naira", 1500], ["ZAR", "South African Rand", 18.5], ["GHS", "Ghanaian Cedi", 15],
    ["KES", "Kenyan Shilling", 130], ["AED", "UAE Dirham", 3.67], ["SAR", "Saudi Riyal", 3.75], ["TRY", "Turkish Lira", 33],
    ["BRL", "Brazilian Real", 5], ["MXN", "Mexican Peso", 17], ["SGD", "Singapore Dollar", 1.34], ["HKD", "Hong Kong Dollar", 7.8],
    ["KRW", "South Korean Won", 1350], ["SEK", "Swedish Krona", 10.5], ["NZD", "New Zealand Dollar", 1.65]];

  // 1) dropdowns first: they never depend on the network
  $("lc-coin").innerHTML = COINS.map(function (c) { return '<option value="' + c + '">' + c + "</option>"; }).join("");
  $("lc-fiat").innerHTML = CUR.map(function (c) { return '<option value="' + c[0] + '">' + c[0] + " — " + c[1] + "</option>"; }).join("");
  $("lc-fiat").value = "USD";
  if (!$("lc-fiat-amt").value) $("lc-fiat-amt").value = "";

  var started = Date.now(), last = "coin", rates = null, own = {}, lastOwn = 0;
  try { var cr = JSON.parse(localStorage.getItem("fx.rates")); if (cr && cr.rates) rates = cr.rates; } catch (e) {}

  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function fetchRates() {
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem("fx.rates")); } catch (e) {}
    if (cached && Date.now() - cached.t < 6 * 3600 * 1000) return;
    getJSON("https://open.er-api.com/v6/latest/USD").then(function (j) {
      if (j && j.rates) { rates = j.rates; try { localStorage.setItem("fx.rates", JSON.stringify({ t: Date.now(), rates: j.rates })); } catch (e) {} update(); }
    }).catch(function () {});
  }
  // own price source (used when the shared feed has nothing yet)
  var HOSTS = ["https://api.binance.com", "https://data-api.binance.vision", "https://api.binance.us"];
  function viaBinance(i) {
    if (i >= HOSTS.length) return Promise.reject(new Error("blocked"));
    return getJSON(HOSTS[i] + "/api/v3/ticker/24hr?symbols=" + encodeURIComponent('["BTCUSDT","ETHUSDT","SOLUSDT"]')).catch(function () { return viaBinance(i + 1); });
  }
  function fetchOwn() {
    if (window.Feed && Feed.status() === "live") return;
    viaBinance(0).then(function (arr) {
      arr.forEach(function (d) { own[d.symbol.replace("USDT", "")] = { price: parseFloat(d.lastPrice), change: parseFloat(d.priceChangePercent), t: Date.now() }; });
      lastOwn = Date.now(); update();
    }).catch(function () {
      return getJSON("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true").then(function (j) {
        Object.keys(IDS).forEach(function (k) { var d = j[IDS[k]]; if (d) own[k] = { price: d.usd, change: d.usd_24h_change, t: Date.now() }; });
        lastOwn = Date.now(); update();
      });
    }).catch(function () {});
  }

  function quote(coin) {
    if (coin === "USDT") return { price: 1, change: 0 };
    var f = window.Feed && Feed.prices && Feed.prices[coin + "/USD"];
    if (f && Feed.tradable(coin + "/USD")) return { price: f.price, change: f.change };
    var o = own[coin];
    return o && Date.now() - o.t < 120000 ? o : null;
  }
  function fx(code) {
    if (code === "USD") return 1;
    if (rates && rates[code]) return rates[code];
    for (var i = 0; i < CUR.length; i++) if (CUR[i][0] === code) return CUR[i][2];
    return 1;
  }
  function money(code, v) {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: code, currencyDisplay: "narrowSymbol", maximumFractionDigits: v < 1 ? 6 : 2 }).format(v); }
    catch (e) { return code + " " + v.toFixed(2); }
  }
  function trim(n, d) { return String(parseFloat(n.toFixed(d))); }

  function update() {
    try {
      var coin = $("lc-coin").value, code = $("lc-fiat").value, q = quote(coin), r = fx(code);
      var live = (window.Feed && Feed.status() === "live") || Date.now() - lastOwn < 60000;
      if (q) status(live ? "live" : "", live ? "Live prices" : "Updating…");
      else if (Date.now() - started > 9000) status("off", "Prices offline");
      else status("", "Connecting…");
      if (!q) { $("lc-rate").textContent = Date.now() - started > 9000 ? "Couldn't reach a price source. Check your connection or ad blocker." : "Waiting for a live price…"; $("lc-chg").textContent = ""; return; }
      var perCoin = q.price * r;
      $("lc-rate").textContent = "1 " + coin + " = " + money(code, perCoin);
      var ch = $("lc-chg");
      if (q.change != null && isFinite(q.change)) { ch.textContent = (q.change >= 0 ? "+" : "") + q.change.toFixed(2) + "% in 24h"; ch.className = "lc-chg " + (q.change >= 0 ? "up" : "down"); }
      else { ch.textContent = ""; ch.className = "lc-chg"; }
      if (last === "coin") {
        var a = parseFloat($("lc-coin-amt").value);
        $("lc-fiat-amt").value = isFinite(a) ? trim(a * perCoin, 2) : "";
      } else {
        var f = parseFloat($("lc-fiat-amt").value);
        $("lc-coin-amt").value = isFinite(f) && perCoin > 0 ? trim(f / perCoin, 8) : "";
      }
    } catch (e) { status("off", "Unavailable"); if (window.console) console.error("[converter]", e); }
  }
  $("lc-coin-amt").addEventListener("input", function () { last = "coin"; update(); });
  $("lc-fiat-amt").addEventListener("input", function () { last = "fiat"; update(); });
  $("lc-coin").addEventListener("change", update);
  $("lc-fiat").addEventListener("change", update);
  if (window.Feed && Feed.on) Feed.on(update);
  fetchRates();
  fetchOwn();
  setInterval(fetchOwn, 20000);
  setInterval(update, 1000);
  update();
})();


  var PL = [];
  function applySite() {
    if (!Site) return;
    var st = Site.settings();
    CONFIG.UPGRADE_FEE_PCT = (+st.feePct || 0) / 100;
    CONFIG.TELEGRAM_URL = st.telegram || CONFIG.TELEGRAM_URL;
    PL = Site.plans();
    CONFIG.PLANS = PL;
    if ($("#telegram-link")) $("#telegram-link").href = CONFIG.TELEGRAM_URL;
  }
  applySite();