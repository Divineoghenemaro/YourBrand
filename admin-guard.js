/* Admin gatekeeper. The admin interface is NOT in admin.html: it is only downloaded
 * and shown after the server confirms the signed-in account has the admin role.
 * Everyone else is sent away without seeing anything.
 * (The real protection for the data is Supabase row-level security; this keeps the
 * panel's code and layout away from visitors who guess the URL.) */
(function () {
  "use strict";
  var root = document.getElementById("adm");
  if (!root) return;
  var DB = window.DB || { enabled: false }, C = window.SDSS_CORE;

  function deny() {
    try { document.body.innerHTML = ""; } catch (e) {}
    // signed-in members go back to their own area; everyone else to the home page
    location.replace(C ? "account.html" : "index.html");
  }
  if (!C) return deny(); // dashboard.js already turned away anyone without an account

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.body.appendChild(s);
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

  var check = DB.enabled
    ? DB.isAdmin() // asked of the server, never trusted from local storage
    : Promise.resolve(!!(window.SDSS_IS_ADMIN && window.SDSS_IS_ADMIN(C.user.email)));

  check.then(function (ok) {
    if (!ok) return deny();
    return loadScript("admin-ui.js").then(function () {
      root.innerHTML = window.SDSS_ADMIN_HTML;
      document.body.classList.remove("admin-lock");
      idleLogout();
      return loadScript("admin-app.js");
    });
  }).catch(deny);
  setTimeout(function () { window.__admReady = true; C.finishLoading(); }, 9000); // never leave the skeleton up
})();
