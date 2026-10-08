/* Live crypto converter (home page). Uses the same live price feed as the account
 * dashboard (feed.js: Binance live prices) and daily currency rates. */
(function () {
  "use strict";
  var box = document.getElementById("live-conv");
  if (!box || !window.Feed) return;
  var Feed = window.Feed;
  var $ = function (id) { return document.getElementById(id); };
  var COINS = ["BTC", "ETH", "SOL", "USDT"];
  var CUR = [["USD", "US Dollar", 1], ["EUR", "Euro", 0.92], ["GBP", "British Pound", 0.79], ["JPY", "Japanese Yen", 150],
    ["CAD", "Canadian Dollar", 1.36], ["AUD", "Australian Dollar", 1.52], ["CHF", "Swiss Franc", 0.88], ["CNY", "Chinese Yuan", 7.2],
    ["INR", "Indian Rupee", 83], ["NGN", "Nigerian Naira", 1500], ["ZAR", "South African Rand", 18.5], ["GHS", "Ghanaian Cedi", 15],
    ["KES", "Kenyan Shilling", 130], ["AED", "UAE Dirham", 3.67], ["SAR", "Saudi Riyal", 3.75], ["TRY", "Turkish Lira", 33],
    ["BRL", "Brazilian Real", 5], ["MXN", "Mexican Peso", 17], ["SGD", "Singapore Dollar", 1.34], ["HKD", "Hong Kong Dollar", 7.8],
    ["KRW", "South Korean Won", 1350], ["SEK", "Swedish Krona", 10.5], ["NZD", "New Zealand Dollar", 1.65]];
  var rates = null, last = "coin";
  try { var c = JSON.parse(localStorage.getItem("fx.rates")); if (c && c.rates) rates = c.rates; } catch (e) {}
  (function fetchRates() {
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem("fx.rates")); } catch (e) {}
    if (cached && Date.now() - cached.t < 6 * 3600 * 1000) return;
    fetch("https://open.er-api.com/v6/latest/USD").then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.rates) { rates = j.rates; try { localStorage.setItem("fx.rates", JSON.stringify({ t: Date.now(), rates: j.rates })); } catch (e) {} update(); }
    }).catch(function () {});
  })();

  $("lc-coin").innerHTML = COINS.map(function (c) { return '<option value="' + c + '">' + c + "</option>"; }).join("");
  $("lc-fiat").innerHTML = CUR.map(function (c) { return '<option value="' + c[0] + '">' + c[0] + " — " + c[1] + "</option>"; }).join("");
  $("lc-fiat").value = "USD";

  function usdPrice(coin) {
    if (coin === "USDT") return 1;
    var p = Feed.prices[coin + "/USD"];
    return p && Feed.tradable(coin + "/USD") ? p.price : null;
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
    var coin = $("lc-coin").value, code = $("lc-fiat").value, price = usdPrice(coin), r = fx(code), st = Feed.status();
    var pill = $("lc-status");
    pill.className = "live-pill " + (st === "live" ? "live" : st === "offline" ? "off" : "");
    pill.textContent = st === "live" ? "Live prices" : st === "offline" ? "Prices offline" : "Connecting…";
    if (!price) { $("lc-rate").textContent = "Waiting for a live price…"; $("lc-chg").textContent = ""; return; }
    var perCoin = price * r;
    $("lc-rate").textContent = "1 " + coin + " = " + money(code, perCoin);
    var p = Feed.prices[coin + "/USD"];
    var ch = $("lc-chg");
    if (p && p.change != null) { ch.textContent = (p.change >= 0 ? "+" : "") + p.change.toFixed(2) + "% in 24h"; ch.className = "lc-chg " + (p.change >= 0 ? "up" : "down"); }
    else { ch.textContent = ""; ch.className = "lc-chg"; }
    if (last === "coin") {
      var a = parseFloat($("lc-coin-amt").value);
      if (isFinite(a)) $("lc-fiat-amt").value = trim(a * perCoin, 2);
      else $("lc-fiat-amt").value = "";
    } else {
      var f = parseFloat($("lc-fiat-amt").value);
      if (isFinite(f) && perCoin > 0) $("lc-coin-amt").value = trim(f / perCoin, 8);
      else $("lc-coin-amt").value = "";
    }
  }
  $("lc-coin-amt").addEventListener("input", function () { last = "coin"; update(); });
  $("lc-fiat-amt").addEventListener("input", function () { last = "fiat"; update(); });
  $("lc-coin").addEventListener("change", update);
  $("lc-fiat").addEventListener("change", update);
  Feed.on(update);
  setInterval(update, 1000);
  update();
})();
