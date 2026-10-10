/* Data layer (window.DB): Supabase auth + sync, site settings, public plans.
 * Local storage is the fast working copy; every change is pushed to Supabase
 * automatically, and Supabase is pulled on load and every few seconds.
 * With no Supabase project configured, everything keeps working locally. */
(function () {
  "use strict";
  var CFG = window.SDSS_SUPABASE || {};
  var enabled = !!(CFG.URL && CFG.ANON_KEY && window.supabase && window.supabase.createClient);
  var recovery = /type=recovery/.test(location.hash); // password-reset link
  var libMissing = !!(CFG.URL && CFG.ANON_KEY && !(window.supabase && window.supabase.createClient));
  if (libMissing) {
    if (window.console) console.error("[Supabase] The client library did not load (blocked network, ad blocker or offline). Running in local-only mode. Open status.html to diagnose.");
    var showLibWarning = function () {
      if (/status\.html$/.test(location.pathname) || !document.body) return;
      var d = document.createElement("div");
      d.setAttribute("role", "alert");
      d.style.cssText = "position:fixed;z-index:9999;left:12px;right:12px;bottom:12px;max-width:560px;margin:auto;background:#b3261e;color:#fff;padding:12px 16px;border-radius:12px;font:600 14px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)";
      d.innerHTML = 'Can\'t reach the Supabase library, so your data is not syncing. Check your connection or ad blocker. <a href="status.html" style="color:#fff;text-decoration:underline">Run diagnostics</a>';
      document.body.appendChild(d);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showLibWarning); else showLibWarning();
  }
  var sb = enabled ? window.supabase.createClient(CFG.URL, CFG.ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

  function lsGet(k, f) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? f : v; } catch (e) { return f; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ok(r) { if (r && r.error) throw r.error; return r ? r.data : null; }
  var norm = function (e) { return (e || "").trim().toLowerCase(); };

  /* ---------- site settings (plans + options), editable from the admin panel ---------- */
  var DEFAULT_PLANS = [
    { id: "starter", name: "Starter", min: 100, x: 5, color: "#cd7f32", tag: "", perks: ["Managed trades", "Live trade feed", "Inbox notifications"] },
    { id: "growth", name: "Growth", min: 1000, x: 10, color: "#9fb0c2", tag: "Recommended", perks: ["Managed trades", "Live trade feed", "Priority support"] },
    { id: "premium", name: "Premium", min: 10000, x: 15, color: "#e2b53f", tag: "", perks: ["Managed trades", "Live trade feed", "Dedicated contact"] }
  ];
  var DEFAULT_SETTINGS = { brand: "Your Brand", logo: "", feePct: 12, telegram: "https://t.me/yourbrand_support", minDeposit: 10, minWithdraw: 10, autoConfirmSec: enabled ? 0 : 15 };
  var Site = {
    plans: function () {
      var p = lsGet("site.plans", null);
      p = p && p.length ? p : DEFAULT_PLANS;
      return p.slice().sort(function (a, b) { return a.min - b.min; });
    },
    settings: function () { return Object.assign({}, DEFAULT_SETTINGS, lsGet("site.settings", {})); },
    refresh: function () {
      if (!enabled) return Promise.resolve(false);
      return sb.from("site_config").select("key,value").then(function (r) {
        if (r.error || !r.data) return false;
        r.data.forEach(function (row) {
          if (row.key === "plans") lsSet("site.plans", row.value);
          if (row.key === "settings") lsSet("site.settings", row.value);
        });
        return true;
      }).catch(function () { return false; });
    },
    save: function (plans, settings) {
      lsSet("site.plans", plans); lsSet("site.settings", settings);
      if (!enabled) return Promise.resolve();
      return sb.from("site_config").upsert([{ key: "plans", value: plans }, { key: "settings", value: settings }]).then(ok);
    }
  };

  /* ---------- the DB object ---------- */
  var DB = { enabled: enabled, libMissing: libMissing, client: sb, recovery: recovery, Site: Site, norm: norm, uid: null, email: null };
  window.DB = DB;

  DB.session = function () {
    if (!enabled) return Promise.resolve(null);
    return sb.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (s) { DB.uid = s.user.id; DB.email = norm(s.user.email); }
      return s || null;
    });
  };
  DB.signUp = function (o) {
    var base = location.href.replace(/[^/]*([?#].*)?$/, "");
    return sb.auth.signUp({ email: o.email, password: o.password,
      options: { data: { first_name: o.first, last_name: o.last, phone: o.phone }, emailRedirectTo: base + "signin.html" } })
      .then(function (r) { if (r.error) throw r.error; return { session: r.data.session, user: r.data.user }; });
  };
  DB.signIn = function (email, pw) {
    return sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
      if (r.error) throw r.error;
      DB.uid = r.data.user.id; DB.email = norm(r.data.user.email);
      return r.data;
    });
  };
  DB.signOut = function () { return enabled ? sb.auth.signOut().catch(function () {}) : Promise.resolve(); };
  DB.resetPassword = function (email) {
    var base = location.href.replace(/[^/]*([?#].*)?$/, "");
    return sb.auth.resetPasswordForEmail(email, { redirectTo: base + "reset.html" }).then(function (r) { if (r.error) throw r.error; });
  };
  DB.updatePassword = function (pw) { return sb.auth.updateUser({ password: pw }).then(function (r) { if (r.error) throw r.error; }); };
  DB.profile = function () {
    return DB.session().then(function (s) {
      if (!s) return null;
      return sb.from("profiles").select("*").eq("id", s.user.id).maybeSingle().then(ok);
    });
  };
  // resolves true/false; REJECTS on network/server errors so callers can tell "not an admin" from "couldn't check"
  DB.isAdmin = function () { return DB.profile().then(function (p) { return !!p && p.role === "admin"; }); };
  DB.deleteMe = function () { return sb.rpc("delete_my_account").then(ok); };

  // profile row -> the local user record the pages read
  DB.toLocalUser = function (p) {
    return { id: p.id, first: p.first_name || "", last: p.last_name || "", email: norm(p.email), phone: p.phone || "", verified: true,
      created: Date.parse(p.created_at) || Date.now(), currency: p.currency || "USD", avatar: p.avatar || "", role: p.role || "user", lastSeen: p.last_seen || null, unverified: !!p.unverified };
  };
  DB.mirror = function (p) {
    var u = DB.toLocalUser(p), users = lsGet("auth.users", {});
    users[u.email] = Object.assign({}, users[u.email], u);
    lsSet("auth.users", users);
    lsSet("auth.session", { email: u.email, name: u.first, at: Date.now() });
    return u;
  };
  DB.pushProfile = function (patch) {
    var m = {};
    if ("first" in patch) m.first_name = patch.first;
    if ("last" in patch) m.last_name = patch.last;
    if ("phone" in patch) m.phone = patch.phone;
    if ("currency" in patch) m.currency = patch.currency;
    if ("avatar" in patch) m.avatar = patch.avatar;
    if (!Object.keys(m).length) return Promise.resolve();
    return DB.session().then(function (s) { return s && sb.from("profiles").update(m).eq("id", s.user.id).then(ok); });
  };
  DB.touch = function () { return DB.uid ? sb.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", DB.uid).then(function () {}) : Promise.resolve(); };

  /* ----- user data ----- */
  DB.pullLedger = function () { return sb.from("ledgers").select("data,rev,updated_at").eq("user_id", DB.uid).maybeSingle().then(ok); };
  DB.pushLedger = function (data, rev) {
    return sb.from("ledgers").upsert({ user_id: DB.uid, data: data, rev: rev, updated_at: new Date().toISOString() }).then(ok);
  };
  DB.pullInbox = function () { return sb.from("inbox").select("*").eq("user_id", DB.uid).is("applied_at", null).order("created_at", { ascending: true }).then(ok); };
  DB.ackInbox = function (ids) { return ids.length ? sb.from("inbox").update({ applied_at: new Date().toISOString() }).in("id", ids).then(ok) : Promise.resolve(); };
  DB.pullMessages = function () {
    return sb.from("admin_messages").select("*").lte("deliver_at", new Date().toISOString()).in("status", ["active", "recalled"]).then(ok);
  };
  DB.pullTransfers = function () { return sb.from("transfers").select("*").order("created_at", { ascending: false }).then(ok); };
  DB.pullPlanReqs = function () { return sb.from("plan_requests").select("*").order("created_at", { ascending: false }).then(ok); };
  DB.upsertTransfer = function (t) {
    return sb.from("transfers").upsert({ id: t.id, from_email: t.from, to_email: t.to, usd: t.usd, note: t.note || "", status: t.status,
      created_at: new Date(t.createdAt).toISOString(), updated_at: new Date(t.updatedAt || t.createdAt).toISOString() }).then(ok);
  };
  DB.upsertPlanReq = function (r) {
    return sb.from("plan_requests").upsert({ id: r.id, email: r.email, plan: r.plan, plan_name: r.name || "", from_plan: r.from || "", fee: r.fee, status: r.status,
      created_at: new Date(r.createdAt).toISOString(), updated_at: new Date(r.updatedAt || r.createdAt).toISOString() }).then(ok);
  };
  DB.lookup = function (email) {
    return sb.rpc("lookup_user", { p_email: email }).then(ok).then(function (d) { d = Array.isArray(d) ? d[0] : d; return d || null; });
  };

  /* ----- admin ----- */
  DB.admin = {
    users: function () { return sb.from("profiles").select("*").order("created_at", { ascending: false }).then(ok); },
    ledgers: function () { return sb.from("ledgers").select("user_id,data,rev,updated_at").then(ok); },
    inbox: function () { return sb.from("inbox").select("*").is("applied_at", null).then(ok); },
    allInbox: function (userId) { return sb.from("inbox").select("*").eq("user_id", userId).order("created_at", { ascending: false }).then(ok); },
    sendInbox: function (userId, ev) { return sb.from("inbox").insert({ user_id: userId, kind: ev.type, payload: ev }).then(ok); },
    messages: function () { return sb.from("admin_messages").select("*").order("created_at", { ascending: false }).then(ok); },
    addMessage: function (m) { return sb.from("admin_messages").insert(m).select().single().then(ok); },
    updateMessage: function (id, patch) { return sb.from("admin_messages").update(patch).eq("id", id).then(ok); },
    deleteMessage: function (id) { return sb.from("admin_messages").delete().eq("id", id).then(ok); },
    deleteUser: function (id) { return sb.rpc("admin_delete_user", { p_id: id }).then(ok); },
    setUnverified: function (id, flag) { return sb.from("profiles").update({ unverified: !!flag }).eq("id", id).then(ok); },
    events: function (fromIso, toIso) {
      var out = [], page = 0, size = 1000;
      function next() {
        return sb.from("site_events").select("*").gte("created_at", fromIso).lte("created_at", toIso).order("created_at", { ascending: true }).range(page * size, page * size + size - 1).then(ok).then(function (rows) {
          rows = rows || [];
          out = out.concat(rows);
          page++;
          return rows.length === size && page < 30 ? next() : out;
        });
      }
      return next();
    }
  };

  /* ---------- brand name (managed from the admin panel) ---------- */
  var BRAND_TOKEN = "Your Brand", brandItems = null;
  DB.brand = function () { return (Site.settings().brand || BRAND_TOKEN).toString().trim() || BRAND_TOKEN; };
  function collectBrand() {
    brandItems = [];
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) {
      var tag = n.parentNode && n.parentNode.nodeName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") continue;
      if (n.nodeValue.indexOf(BRAND_TOKEN) > -1) brandItems.push({ n: n, o: n.nodeValue });
    }
    var els = document.querySelectorAll("[alt],[aria-label],[title],[placeholder]");
    Array.prototype.forEach.call(els, function (el) {
      ["alt", "aria-label", "title", "placeholder"].forEach(function (a) {
        var v = el.getAttribute(a);
        if (v && v.indexOf(BRAND_TOKEN) > -1) brandItems.push({ el: el, a: a, o: v });
      });
    });
    if (document.title.indexOf(BRAND_TOKEN) > -1) brandItems.push({ t: true, o: document.title });
  }
  // the square logo goes into every ".brand .mark" (header, footer, sign-in pages) and the browser-tab icon
  var markEls = null, favLink = null, favOrig = null;
  function applyLogo() {
    var logo = (Site.settings().logo || "").toString();
    if (!markEls) {
      markEls = Array.prototype.slice.call(document.querySelectorAll(".brand .mark")).map(function (el) { return { el: el, orig: el.innerHTML }; });
    }
    markEls.forEach(function (m) {
      if (logo) { m.el.innerHTML = '<img alt="" decoding="async">'; m.el.firstChild.src = logo; m.el.classList.add("has-logo"); }
      else { m.el.innerHTML = m.orig; m.el.classList.remove("has-logo"); }
    });
    if (!favLink) {
      favLink = document.querySelector('link[rel~="icon"]');
      if (!favLink) { favLink = document.createElement("link"); favLink.rel = "icon"; document.head.appendChild(favLink); }
      favOrig = { href: favLink.getAttribute("href"), type: favLink.getAttribute("type") };
    }
    if (logo) { favLink.removeAttribute("type"); favLink.href = logo; }
    else if (favOrig && favOrig.href) { favLink.setAttribute("href", favOrig.href); if (favOrig.type) favLink.setAttribute("type", favOrig.type); }
  }
  DB.applyBrand = function () {
    if (!document.body) return;
    applyLogo();
    if (!brandItems) collectBrand();
    var b = DB.brand();
    brandItems.forEach(function (it) {
      var v = it.o.split(BRAND_TOKEN).join(b);
      if (it.n) it.n.nodeValue = v; else if (it.t) document.title = v; else it.el.setAttribute(it.a, v);
    });
  };
  DB.applyBrand();
  if (enabled) Site.refresh().then(function (changed) { if (changed) DB.applyBrand(); });

  /* ---------- site analytics (page views + key events) ---------- */
  function rnd() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  var visitorId = lsGet("an.vid", null);
  if (!visitorId) { visitorId = rnd(); lsSet("an.vid", visitorId); }
  var sessionId = null;
  try { sessionId = sessionStorage.getItem("an.sid"); if (!sessionId) { sessionId = rnd(); sessionStorage.setItem("an.sid", sessionId); } } catch (e) { sessionId = rnd(); }
  var pageName = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  var SKIP = { "admin.html": 1, "admin-login.html": 1 };
  function deviceClass() {
    var ua = navigator.userAgent || "";
    return /ipad|tablet/i.test(ua) ? "tablet" : /mobi|android|iphone/i.test(ua) ? "mobile" : "desktop";
  }
  function refHost() { try { var h = new URL(document.referrer).host; return h === location.host ? "" : h; } catch (e) { return ""; } }
  function userKey() {
    if (DB.uid) return DB.uid;
    try { var s = JSON.parse(localStorage.getItem("auth.session")); return (s && s.email) || ""; } catch (e) { return ""; }
  }
  DB.track = function (type, props) {
    if (SKIP[pageName]) return;
    try {
      var e = { t: Date.now(), type: type, path: pageName, vid: visitorId, sid: sessionId, dev: deviceClass(), ref: type === "pageview" ? refHost() : "", u: userKey(), p: props || null };
      if (enabled) {
        sb.from("site_events").insert({ created_at: new Date(e.t).toISOString(), type: e.type, path: e.path, visitor_id: e.vid, session_id: e.sid, device: e.dev, referrer: e.ref, user_key: e.u, props: e.p }).then(function () {}, function () {});
      } else {
        var a = lsGet("an.events", []);
        a.push(e);
        if (a.length > 6000) a = a.slice(-6000);
        lsSet("an.events", a);
      }
    } catch (x) {}
  };
  DB.localEvents = function () { return lsGet("an.events", []); };
  DB.track("pageview");

  /* ---------- public plans on the home page ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function renderHomePlans() {
    var grid = document.getElementById("plan-grid");
    if (!grid) return;
    var plans = Site.plans();
    grid.innerHTML = plans.map(function (p) {
      var hi = /recommend/i.test(p.tag || "");
      return '<div class="plan' + (hi ? " hi" : "") + '" style="--c:' + esc(p.color || "#888") + '"><h3>' + esc(p.name) + (p.tag ? ' <small class="plan-tag">' + esc(p.tag) + "</small>" : "") + "</h3>" +
        '<div class="v">Minimum deposit: $' + Number(p.min).toLocaleString() + "</div>" +
        '<div class="v">x' + esc(p.x) + " factor · ×" + Number(p.x) * Number(p.x) + " leverage</div>" +
        "<ul>" + (p.perks || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
        '<a class="btn' + (hi ? "" : " ghost") + '" href="signin.html">Choose plan</a></div>';
    }).join("");
  }
  if (document.getElementById("plan-grid")) {
    renderHomePlans();
    Site.refresh().then(function (changed) { if (changed) renderHomePlans(); });
  }

  /* ---------- admin sign-in page ---------- */
  var af = document.getElementById("f-admin-login");
  if (af) {
    var say = function (m, good) { var e = document.getElementById("e-admin"); e.textContent = m || ""; e.classList.toggle("ok", !!good && !!m); };
    var LOCK = "adm.lock";
    var lockLeft = function () { var l = lsGet(LOCK, null); return l && l.until > Date.now() ? Math.ceil((l.until - Date.now()) / 60000) : 0; };
    var GENERIC = "Sign-in failed. Check your details and try again.";
    if (!enabled) say("Supabase isn't configured yet. Add your project URL and key to sb-config.js, then sign in here with an admin account.");
    af.onsubmit = function (e) {
      e.preventDefault();
      if (!enabled) return;
      var wait = lockLeft();
      if (wait) return say("Too many failed attempts. Try again in " + wait + " minute" + (wait === 1 ? "" : "s") + ".");
      var email = norm(document.getElementById("aem").value), pw = document.getElementById("apw").value, btn = af.querySelector("button[type=submit]");
      if (!email || !pw) return say("Enter your admin email and password.");
      btn.disabled = true; say("");
      DB.signIn(email, pw).then(function () { return DB.profile(); }).then(function (p) {
        if (!p || p.role !== "admin") return DB.signOut().then(function () { throw new Error("DENY"); });
        lsSet(LOCK, { n: 0, until: 0 });
        DB.mirror(p);
        say("Signed in. Opening the admin panel…", true);
        location.href = "admin.html";
      }).catch(function () {
        // same message for a wrong password and for a non-admin account, so nothing is revealed
        var l = lsGet(LOCK, { n: 0, until: 0 });
        l.n = (l.n || 0) + 1;
        if (l.n >= 5) { l.n = 0; l.until = Date.now() + 15 * 60000; }
        lsSet(LOCK, l);
        setTimeout(function () {
          btn.disabled = false;
          var w2 = lockLeft();
          say(w2 ? "Too many failed attempts. Try again in " + w2 + " minutes." : GENERIC);
        }, 700);
      });
    };
  }
})();
