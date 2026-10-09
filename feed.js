/* Live market prices (window.Feed).
 *  - Crypto + EUR/USD + GBP/USD: Binance public WebSocket (falls back to Binance REST,
 *    then CoinGecko for crypto). No key needed.
 *  - USD/JPY (and EUR/GBP if Binance is blocked): open.er-api.com daily rates.
 *  - US stocks: Finnhub quotes. Browsers can't read free stock prices without a key,
 *    so paste a free key from https://finnhub.io below. Without it, stocks stay
 *    "no live feed" and can't be traded (we never trade on made-up prices).
 */
(function () {
  "use strict";
  var CONFIG = { FINNHUB_KEY: "" };

  var DEFS = {
    "BTC/USD": { kind: "crypto", icon: "₿", ref: 109430.12, bn: "BTCUSDT", cg: "bitcoin" },
    "ETH/USD": { kind: "crypto", icon: "Ξ", ref: 3482.67, bn: "ETHUSDT", cg: "ethereum" },
    "SOL/USD": { kind: "crypto", icon: "S", ref: 162.34, bn: "SOLUSDT", cg: "solana" },
    "EUR/USD": { kind: "forex", icon: "€", ref: 1.1754, bn: "EURUSDT", fx: "EUR" },
    "GBP/USD": { kind: "forex", icon: "£", ref: 1.3682, bn: "GBPUSDT", fx: "GBP" },
    "USD/JPY": { kind: "forex", icon: "¥", ref: 157.32, fx: "JPY" },
    AAPL: { kind: "stocks", icon: "A", ref: 195.42, fh: "AAPL" },
    NVDA: { kind: "stocks", icon: "N", ref: 182.63, fh: "NVDA" },
    TSLA: { kind: "stocks", icon: "T", ref: 338.42, fh: "TSLA" }
  };
  // src: "live" | "daily" (once-a-day rate) | "ref" (no live price yet; not tradable)
  var P = {};
  Object.keys(DEFS).forEach(function (s) {
    P[s] = { symbol: s, kind: DEFS[s].kind, icon: DEFS[s].icon, price: DEFS[s].ref, change: null, src: "ref", t: 0, dir: 0 };
  });

  var ratesLive = false;
  // Display-currency rates (units per 1 USD). Fallbacks are approximate until live rates load.
  var RATES = { USD: 1, EUR: 0.92, GBP: 0.78, JPY: 150, CNY: 7.2, INR: 83, CAD: 1.36, AUD: 1.52, CHF: 0.88, NGN: 1500, ZAR: 18.5,
    BRL: 5, MXN: 17, AED: 3.67, SAR: 3.75, SGD: 1.34, HKD: 7.8, KRW: 1350, TRY: 32, SEK: 10.5, NOK: 10.7, PLN: 4, THB: 36,
    IDR: 15800, PHP: 56, EGP: 48, KES: 130, GHS: 15, NZD: 1.65, PKR: 278 };
  try {
    var cached = JSON.parse(localStorage.getItem("fx.rates") || "null");
    if (cached && cached.r) Object.keys(cached.r).forEach(function (k) { RATES[k] = cached.r[k]; });
  } catch (e) {}

  var subs = [],
    timer = null,
    started = Date.now(),
    lastCrypto = 0;

  function notify() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      subs.forEach(function (f) {
        try { f(); } catch (e) {}
      });
    }, 400);
  }
  function set(sym, price, change, src) {
    var p = P[sym];
    if (!p || !(price > 0)) return;
    if (p.src !== "ref" && price !== p.price) p.dir = price > p.price ? 1 : -1;
    p.price = price;
    if (change != null && isFinite(change)) p.change = change;
    p.src = src;
    p.t = Date.now();
    if (DEFS[sym].kind === "crypto" && src === "live") lastCrypto = p.t;
    notify();
  }
  function bySymbol(bn) {
    return Object.keys(DEFS).filter(function (s) { return DEFS[s].bn === bn; })[0];
  }
  var bnList = Object.keys(DEFS).filter(function (s) { return DEFS[s].bn; }).map(function (s) { return DEFS[s].bn; });

  /* ---- Binance WebSocket ---- */
  var ws = null, wsOpen = false, wsFails = 0;
  // Several public market-data hosts, tried in turn (some regions/networks block the main one)
  var WS_HOSTS = ["wss://stream.binance.com:9443", "wss://data-stream.binance.vision", "wss://stream.binance.us:9443"];
  var REST_HOSTS = ["https://api.binance.com", "https://data-api.binance.vision", "https://api.binance.us"];
  function openWS() {
    if (!window.WebSocket) return;
    try {
      var streams = bnList.map(function (s) { return s.toLowerCase() + "@miniTicker"; }).join("/");
      ws = new WebSocket(WS_HOSTS[wsFails % WS_HOSTS.length] + "/stream?streams=" + streams);
    } catch (e) { return retryWS(); }
    ws.onopen = function () { wsOpen = true; wsFails = 0; };
    ws.onmessage = function (e) {
      try {
        var d = JSON.parse(e.data).data,
          sym = bySymbol(d.s),
          c = parseFloat(d.c),
          o = parseFloat(d.o);
        if (sym) set(sym, c, o ? ((c - o) / o) * 100 : null, "live");
      } catch (err) {}
    };
    ws.onclose = ws.onerror = function () { wsOpen = false; retryWS(); };
  }
  var retrying = false;
  function retryWS() {
    if (retrying) return;
    retrying = true;
    wsFails++;
    setTimeout(function () { retrying = false; openWS(); }, Math.min(30000, 2000 * wsFails));
  }

  /* ---- fallbacks: Binance REST, then CoinGecko ---- */
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }
  function tryRest(i) {
    if (i >= REST_HOSTS.length) return Promise.reject(new Error("no Binance host reachable"));
    return getJSON(REST_HOSTS[i] + "/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(bnList)))
      .catch(function () { return tryRest(i + 1); });
  }
  function pollFallback() {
    if (wsOpen && Date.now() - lastCrypto < 15000) return;
    tryRest(0)
      .then(function (arr) {
        arr.forEach(function (d) {
          var sym = bySymbol(d.symbol);
          if (sym) set(sym, parseFloat(d.lastPrice), parseFloat(d.priceChangePercent), "live");
        });
      })
      .catch(function () {
        var ids = Object.keys(DEFS).filter(function (s) { return DEFS[s].cg; }).map(function (s) { return DEFS[s].cg; });
        return getJSON("https://api.coingecko.com/api/v3/simple/price?ids=" + ids.join(",") + "&vs_currencies=usd&include_24hr_change=true")
          .then(function (j) {
            Object.keys(DEFS).forEach(function (s) {
              var d = DEFS[s].cg && j[DEFS[s].cg];
              if (d) set(s, d.usd, d.usd_24h_change, "live");
            });
          })
          .catch(function () {});
      });
  }

  /* ---- daily forex rates ---- */
  function pollFx() {
    getJSON("https://open.er-api.com/v6/latest/USD")
      .then(function (j) {
        var r = j && j.rates;
        if (!r) return;
        Object.keys(RATES).forEach(function (k) { if (r[k] > 0) RATES[k] = r[k]; });
        ratesLive = true;
        try { localStorage.setItem("fx.rates", JSON.stringify({ r: RATES })); } catch (e) {}
        notify();
        Object.keys(DEFS).forEach(function (s) {
          var d = DEFS[s];
          if (!d.fx || !r[d.fx]) return;
          if (d.bn && P[s].src === "live" && Date.now() - P[s].t < 60000) return; // Binance is fresher
          set(s, s === "USD/JPY" ? r.JPY : 1 / r[d.fx], null, "daily");
        });
      })
      .catch(function () {});
  }

  /* ---- stocks (Finnhub) ---- */
  function pollStocks() {
    if (!CONFIG.FINNHUB_KEY) return;
    Object.keys(DEFS).forEach(function (s) {
      if (!DEFS[s].fh) return;
      getJSON("https://finnhub.io/api/v1/quote?symbol=" + DEFS[s].fh + "&token=" + CONFIG.FINNHUB_KEY)
        .then(function (q) { if (q && q.c > 0) set(s, q.c, q.dp, "live"); })
        .catch(function () {});
    });
  }

  openWS();
  setInterval(pollFallback, 6000);
  pollFallback();
  pollFx();
  setInterval(pollFx, 10 * 60 * 1000);
  pollStocks();
  setInterval(pollStocks, 15000);

  window.Feed = {
    prices: P,
    rates: RATES,
    ratesLive: function () { return ratesLive; },
    config: CONFIG,
    on: function (f) { subs.push(f); },
    rate: function (c) { return RATES[c] > 0 ? RATES[c] : 1; },
    tradable: function (s) { return !!P[s] && P[s].src !== "ref"; },
    note: function (s) {
      var p = P[s];
      if (!p) return "";
      if (p.src === "daily") return "daily rate";
      if (p.src === "ref") return p.kind === "stocks" && !CONFIG.FINNHUB_KEY ? "needs API key" : "no live price";
      return "";
    },
    status: function () {
      var age = Date.now() - lastCrypto;
      if (lastCrypto && age < 60000) return "live";
      return Date.now() - started < 8000 ? "connecting" : "offline";
    }
  };
})();
