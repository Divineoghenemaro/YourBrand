/* Admin gatekeeper. The admin interface is NOT in admin.html: it is only downloaded
 * and shown after the server confirms the signed-in account has the admin role.
 * Everyone else is sent away without seeing anything. While it works you see a
 * "Checking access" screen, and if something is slow or broken it tells you what.
 * (The real protection for the data is Supabase row-level security.) */
(function () {
  "use strict";
  var root = document.getElementById("adm");
  if (!root) return;
  var gate = document.getElementById("adm-gate");
  var DB = window.DB || { enabled: false };
  var ver = "";
  try { ver = (document.currentScript && document.currentScript.src.split("?")[1]) || ""; } catch (e) {}
  var suffix = ver ? "?" + ver : "";

  function hasSession() { try { return !!localStorage.getItem("auth.session"); } catch (e) { return false; } }
  function show(msg, detail) {
    if (!gate) return;
    gate.innerHTML = "";
    var p = document.createElement("p"); p.style.cssText = "font-weight:800;font-size:1.2rem;margin:0"; p.textContent = msg; gate.appendChild(p);
    if (detail) { var d = document.createElement("p"); d.style.cssText = "margin:0;color:var(--mute);max-width:420px"; d.textContent = detail; gate.appendChild(d); }
    var row = document.createElement("div"); row.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;justify-content:center";
    [["Try again", function () { location.reload(); }], ["Connection check", function () { location.href = "status.html"; }], ["Admin sign-in", function () { location.href = "admin-login.html"; }]].forEach(function (b) {
      var x = document.createElement("button"); x.className = "btn ghost"; x.type = "button"; x.textContent = b[0]; x.onclick = b[1]; row.appendChild(x);
    });
    gate.appendChild(row);
  }
  function deny() {
    try { document.body.innerHTML = ""; } catch (e) {}
    location.replace(hasSession() ? "account.html" : "index.html"); // visitors and non-admins learn nothing
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src + suffix; s.onload = resolve; s.onerror = function () { reject(new Error("Could not load " + src)); };
      document.body.appendChild(s);
    });
  }
  function withTimeout(ms, p) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function waitForCore(ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() { if (window.SDSS_CORE) return resolve(window.SDSS_CORE); if (Date.now() - t0 > ms) return resolve(null); setTimeout(poll, 100); })();
    });
  }
  function idleLogout() {
    var last = Date.now();
    ["mousemove", "keydown", "click", "touchstart", "scroll"].forEach(function (ev) {
      window.addEventListener(ev, function () { last = Date.now(); }, { passive: true });
    });
    setInterval(function () {
      if (Date.now() - last < 30 * 60000) return; // 30 minutes without activity
      try { localStorage.removeItem("auth.session"); } catch (e) {}
      Promise.resolve(DB.enabled ? DB.signOut() : null).then(function () { location.replace("admin-login.html"); });
    }, 30000);
  }

  waitForCore(8000).then(function (C) {
    if (!C) { // dashboard.js either redirected a visitor away or failed to start
      if (!hasSession()) return deny();
      return show("The admin app couldn't start", "A required file didn't load. Open the connection check to see which one, then refresh.");
    }
    var check = DB.enabled
      ? withTimeout(12000, DB.isAdmin()) // asked of the server, never trusted from local storage
      : Promise.resolve(!!(window.SDSS_IS_ADMIN && window.SDSS_IS_ADMIN(C.user.email)));
    return check.then(function (ok) {
      if (!ok) return deny();
      return loadScript("admin-ui.js").then(function () {
        root.innerHTML = window.SDSS_ADMIN_HTML;
        document.body.classList.remove("admin-lock");
        if (gate) gate.remove();
        idleLogout();
        return loadScript("admin-app.js");
      });
    }, function (e) {
      show(e && e.message === "timeout" ? "Checking your access is taking too long" : "Couldn't verify your access",
        "This is usually a slow or blocked connection to Supabase (or a paused project), not a problem with your account.");
    });
  }).catch(function (e) { show("The admin panel failed to load", (e && e.message) || ""); });
  setTimeout(function () { window.__admReady = true; if (window.SDSS_CORE) window.SDSS_CORE.finishLoading(); }, 9000);
})();
