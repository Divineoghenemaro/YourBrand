(function () {
  "use strict";

  /* =========================================================
     CONFIG
     ========================================================= */
  var CONFIG = {
    // true  = no email service is connected, so the 6-digit code is shown
    //         on screen so you can test the full flow.
    // false = hides the on-screen code. Set this once sendCode() below
    //         really delivers the code by email/SMS.
    DEMO_MODE: true,
    CODE_TTL_MIN: 10, // code expires after N minutes
    MAX_TRIES: 5, // wrong attempts before the code is voided
    RESEND_SECONDS: 45, // wait time before "Resend code" appears
    AFTER_LOGIN_URL: "", // optional override; default: account.html (admin.html for admins)
    // Emails that get access to admin.html. Sign up and verify with one of
    // these to become an admin. In production, enforce roles on the server.
    ADMIN_EMAILS: ["admin@yourbrand.com"]
  };

  var root = document.documentElement,
    $ = function (id) {
      return document.getElementById(id);
    };

  /* =========================================================
     STORAGE (falls back to memory if the browser blocks it)
     ========================================================= */
  var mem = {};
  function sGet(store, k) {
    try {
      var v = window[store].getItem(k);
      return v === null ? mem[store + k] || null : v;
    } catch (e) {
      return mem[store + k] || null;
    }
  }
  function sSet(store, k, v) {
    mem[store + k] = v;
    try {
      window[store].setItem(k, v);
    } catch (e) {}
  }
  function sDel(store, k) {
    delete mem[store + k];
    try {
      window[store].removeItem(k);
    } catch (e) {}
  }
  function getUsers() {
    try {
      return JSON.parse(sGet("localStorage", "auth.users") || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function saveUsers(u) {
    sSet("localStorage", "auth.users", JSON.stringify(u));
  }

  /* =========================================================
     THEME
     ========================================================= */
  var saved = sGet("localStorage", "theme");
  if (saved) root.setAttribute("data-theme", saved);

  if ($("theme"))
    $("theme").onclick = function () {
      var cur =
        root.getAttribute("data-theme") ||
        (matchMedia("(prefers-color-scheme:light)").matches ? "light" : "dark");
      var nx = cur === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", nx);
      sSet("localStorage", "theme", nx);
    };

  /* =========================================================
     NAV MENU
     ========================================================= */
  function closeMenu() {
    var n = $("nav"),
      b = $("burger");
    if (n) n.classList.remove("open");
    if (b) {
      b.setAttribute("aria-expanded", "false");
      b.setAttribute("aria-label", "Open menu");
    }
  }

  if ($("burger"))
    $("burger").onclick = function () {
      var o = $("nav").classList.toggle("open");
      this.setAttribute("aria-expanded", o ? "true" : "false");
      this.setAttribute("aria-label", o ? "Close menu" : "Open menu");
    };

  if ($("nav"))
    $("nav").addEventListener("click", function (e) {
      if (e.target.closest("a")) closeMenu();
    });

  document.addEventListener("click", function (e) {
    if (!e.target.closest(".bar")) closeMenu();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenu();
  });

  // Close the menu if the window is resized up to desktop width
  addEventListener("resize", function () {
    if (innerWidth > 900) closeMenu();
  });

  /* =========================================================
     HELPERS
     ========================================================= */
  var mailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function isAdmin(email) {
    return CONFIG.ADMIN_EMAILS.indexOf(norm(email)) > -1;
  }
  function norm(email) {
    return (email || "").trim().toLowerCase();
  }
  function say(id, msg, ok) {
    var el = $(id);
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("ok", !!ok && !!msg);
  }
  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    btn.style.opacity = on ? "0.7" : "";
  }
  function randHex(bytes) {
    var a = new Uint8Array(bytes);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (var i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map
      .call(a, function (b) {
        return ("0" + b.toString(16)).slice(-2);
      })
      .join("");
  }
  function newCode() {
    var n;
    if (window.crypto && crypto.getRandomValues)
      n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
    else n = Math.floor(Math.random() * 1000000);
    return ("00000" + n).slice(-6);
  }
  // Password hash (SHA-256 + per-user salt). Browsers only expose
  // crypto.subtle on https/localhost/file, so there is a weak fallback.
  function hashPw(pw, salt) {
    var data = salt + ":" + pw;
    if (window.crypto && crypto.subtle && window.TextEncoder)
      return crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(data))
        .then(function (buf) {
          return Array.prototype.map
            .call(new Uint8Array(buf), function (b) {
              return ("0" + b.toString(16)).slice(-2);
            })
            .join("");
        });
    var h = 5381;
    for (var i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) | 0;
    return Promise.resolve("w" + (h >>> 0).toString(16));
  }

  /* =========================================================
     VERIFICATION CODE
     Replace the body of sendCode() with a real call, e.g.
       return fetch("/api/send-code", {method:"POST", ...});
     ========================================================= */
  function sendCode(user, code) {
    return Promise.resolve(); // demo: nothing is actually sent
  }

  function issueCode(email) {
    var users = getUsers(),
      u = users[email];
    if (!u) return Promise.reject(new Error("no user"));
    var code = newCode();
    u.code = code;
    u.codeExp = Date.now() + CONFIG.CODE_TTL_MIN * 60000;
    u.tries = 0;
    saveUsers(users);
    sSet("sessionStorage", "auth.pending", email);
    return sendCode(u, code).then(function () {
      return code;
    });
  }

  /* =========================================================
     VIEWS (signin / signup / verify)
     ========================================================= */
  var views = ["signin", "signup", "verify"],
    boxes = [],
    timer,
    demoEl = null;

  function hasViews() {
    return views.some(function (v) {
      return !!$("v-" + v);
    });
  }
  function defaultView() {
    return $("v-signup") ? "signup" : "signin";
  }

  function go(v) {
    if (location.hash === "#" + v) route();
    else location.hash = "#" + v;
  }

  function show(v) {
    if (v === "verify") {
      var p = sGet("sessionStorage", "auth.pending"),
        u = p && getUsers()[p];
      if (!u || u.verified) {
        sDel("sessionStorage", "auth.pending");
        return show(defaultView());
      }
      $("sentTo").textContent = p;
      renderDemo(u.code);
    }
    views.forEach(function (x) {
      var el = $("v-" + x);
      if (el) el.classList.toggle("on", x === v);
    });
    closeMenu();
    if (v === "verify") {
      clearCodes();
      startCd();
      if (boxes[0]) boxes[0].focus();
    } else {
      clearInterval(timer);
    }
  }

  function route() {
    if (!hasViews()) return;
    var h = (location.hash || "").slice(1);
    if (!$("v-" + h)) h = defaultView();
    show(h);
  }
  addEventListener("hashchange", route);

  /* =========================================================
     CODE BOXES
     ========================================================= */
  var codes = $("codes");
  function codeValue() {
    return boxes
      .map(function (b) {
        return b.value;
      })
      .join("");
  }
  function clearCodes() {
    boxes.forEach(function (b) {
      b.value = "";
    });
  }

  if (codes) {
    for (var i = 0; i < 6; i++) {
      (function (i) {
        var b = document.createElement("input");
        b.type = "text";
        b.inputMode = "numeric";
        b.maxLength = 1;
        b.setAttribute("aria-label", "Digit " + (i + 1));
        b.autocomplete = i ? "off" : "one-time-code";
        b.oninput = function () {
          b.value = b.value.replace(/\D/g, "");
          if (b.value && boxes[i + 1]) boxes[i + 1].focus();
        };
        b.onkeydown = function (e) {
          if (e.key === "Backspace" && !b.value && boxes[i - 1])
            boxes[i - 1].focus();
          else if (e.key === "ArrowLeft" && boxes[i - 1]) boxes[i - 1].focus();
          else if (e.key === "ArrowRight" && boxes[i + 1]) boxes[i + 1].focus();
          else if (e.key === "Enter") activate();
        };
        b.onfocus = function () {
          b.select();
        };
        b.onpaste = function (e) {
          var t = (
            (e.clipboardData && e.clipboardData.getData("text")) ||
            ""
          )
            .replace(/\D/g, "")
            .slice(0, 6);
          if (!t) return;
          e.preventDefault();
          t.split("").forEach(function (c, k) {
            boxes[k].value = c;
          });
          (boxes[t.length] || boxes[5]).focus();
        };
        codes.appendChild(b);
        boxes.push(b);
      })(i);
    }
    // on-screen code (demo mode only)
    demoEl = document.createElement("div");
    demoEl.className = "demo";
    demoEl.hidden = true;
    codes.parentNode.insertBefore(demoEl, codes.nextSibling);
  }

  function renderDemo(code) {
    if (!demoEl) return;
    if (!CONFIG.DEMO_MODE || !code) {
      demoEl.hidden = true;
      return;
    }
    demoEl.innerHTML =
      "<span>Demo mode: no email service is connected, so your code is</span>" +
      "<b></b>";
    demoEl.lastChild.textContent = code;
    demoEl.hidden = false;
  }

  /* =========================================================
     RESEND COUNTDOWN
     ========================================================= */
  function startCd() {
    if (!$("cd")) return;
    clearInterval(timer);
    var end = Date.now() + CONFIG.RESEND_SECONDS * 1000;
    $("resendTxt").hidden = false;
    $("resend").hidden = true;
    function tick() {
      var left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      $("cd").textContent = left;
      if (left <= 0) {
        clearInterval(timer);
        $("resendTxt").hidden = true;
        $("resend").hidden = false;
      }
    }
    tick();
    timer = setInterval(tick, 500);
  }

  if ($("resend"))
    $("resend").onclick = function () {
      var p = sGet("sessionStorage", "auth.pending");
      if (!p) return go("signup");
      issueCode(p).then(function (code) {
        clearCodes();
        renderDemo(code);
        startCd();
        say("e-verify", "A new code has been sent.", true);
        if (boxes[0]) boxes[0].focus();
      });
    };

  /* =========================================================
     ACTIVATE (verify the code)
     ========================================================= */
  function activate() {
    var email = sGet("sessionStorage", "auth.pending"),
      users = getUsers(),
      u = email && users[email],
      c = codeValue();

    if (!u) return go("signup");
    if (c.length < 6) return say("e-verify", "Enter all 6 digits of the code.");
    if (!u.code)
      return say("e-verify", "No active code. Tap “Resend code”.");
    if (Date.now() > u.codeExp)
      return say("e-verify", "This code has expired. Request a new one.");
    if (u.tries >= CONFIG.MAX_TRIES)
      return say("e-verify", "Too many attempts. Request a new code.");

    if (c !== u.code) {
      u.tries = (u.tries || 0) + 1;
      saveUsers(users);
      var left = CONFIG.MAX_TRIES - u.tries;
      say(
        "e-verify",
        left > 0
          ? "Incorrect code. " + left + (left === 1 ? " attempt" : " attempts") + " left."
          : "Too many attempts. Request a new code."
      );
      clearCodes();
      if (boxes[0]) boxes[0].focus();
      return;
    }

    u.verified = true;
    delete u.code;
    delete u.codeExp;
    delete u.tries;
    saveUsers(users);
    sDel("sessionStorage", "auth.pending");
    sSet("sessionStorage", "auth.lastEmail", email);
    clearInterval(timer);
    busy($("activate"), true);
    say("e-verify", "Account activated. Redirecting to sign in…", true);
    setTimeout(function () {
      location.href = "signin.html#activated";
    }, 900);
  }
  if ($("activate")) $("activate").onclick = activate;

  /* =========================================================
     SIGN UP
     ========================================================= */
  if ($("f-signup"))
    $("f-signup").onsubmit = function (e) {
      e.preventDefault();
      var btn = this.querySelector("button[type=submit]"),
        email = norm($("em").value),
        cc = $("cc") ? $("cc").value.trim() : "",
        m;

      if (!$("fn").value.trim() || !$("ln").value.trim())
        m = "Enter your first and last name.";
      else if (!mailRe.test(email)) m = "Enter a valid email address.";
      else if (!/^\+?\d{1,4}$/.test(cc)) m = "Enter a valid country code, e.g. +1.";
      else if ($("ph").value.replace(/\D/g, "").length < 7)
        m = "Enter a valid phone number.";
      else if ($("pw").value.length < 8)
        m = "Use a password with at least 8 characters.";
      else if ($("pw").value !== $("pw2").value)
        m = "The passwords do not match.";

      say("e-signup", m);
      if (m) return;

      var users = getUsers();
      if (users[email] && users[email].verified)
        return say("e-signup", "An account with this email already exists. Please sign in.");

      busy(btn, true);
      var salt = randHex(16);
      hashPw($("pw").value, salt)
        .then(function (h) {
          users[email] = {
            first: $("fn").value.trim(),
            last: $("ln").value.trim(),
            email: email,
            phone: (cc.charAt(0) === "+" ? cc : "+" + cc) + " " + $("ph").value.trim(),
            salt: salt,
            hash: h,
            verified: false,
            created: Date.now()
          };
          saveUsers(users);
          return issueCode(email);
        })
        .then(function () {
          busy(btn, false);
          go("verify");
        })
        .catch(function () {
          busy(btn, false);
          say("e-signup", "Something went wrong. Please try again.");
        });
    };

  /* =========================================================
     SIGN IN
     ========================================================= */
  if ($("f-signin")) {
    if (location.hash === "#activated") {
      say("e-signin", "Account activated. Sign in to continue.", true);
      history.replaceState(null, "", location.pathname + location.search);
    }
    var last = sGet("sessionStorage", "auth.lastEmail");
    if (last && $("sem")) $("sem").value = last;

    $("f-signin").onsubmit = function (e) {
      e.preventDefault();
      var btn = this.querySelector("button[type=submit]"),
        email = norm($("sem").value),
        m = !mailRe.test(email)
          ? "Enter a valid email address."
          : !$("spw").value
            ? "Enter your password."
            : "";
      say("e-signin", m);
      if (m) return;

      var u = getUsers()[email],
        bad = "Incorrect email or password.";
      if (!u) return say("e-signin", bad);

      busy(btn, true);
      hashPw($("spw").value, u.salt)
        .then(function (h) {
          if (h !== u.hash) {
            busy(btn, false);
            return say("e-signin", bad);
          }
          if (!u.verified) {
            // right password, but email never verified: send a fresh code
            return issueCode(email).then(function () {
              location.href = "signup.html#verify";
            });
          }
          sSet(
            "localStorage",
            "auth.session",
            JSON.stringify({ email: email, name: u.first, at: Date.now() })
          );
          busy(btn, false);
          say("e-signin", "Signed in. Welcome back, " + u.first + ".", true);
          setTimeout(function () {
            location.href =
              CONFIG.AFTER_LOGIN_URL || (isAdmin(email) ? "admin.html" : "account.html");
          }, 700);
        })
        .catch(function () {
          busy(btn, false);
          say("e-signin", "Something went wrong. Please try again.");
        });
    };
  }


  /* =========================================================
     ACCOUNT + ADMIN PAGES (need a signed-in session)
     ========================================================= */
  function signOut() {
    sDel("localStorage", "auth.session");
    location.href = "signin.html";
  }
  if ($("signout")) $("signout").onclick = signOut;

  var sess = null;
  try {
    sess = JSON.parse(sGet("localStorage", "auth.session") || "null");
  } catch (e) {}
  var allUsers = getUsers(),
    me = sess && allUsers[sess.email];

  if ($("acct")) {
    if (!me || !me.verified) {
      location.replace("signin.html");
      return;
    }
    $("hello").textContent = "Hello, " + me.first;
    $("a-email").textContent = me.email;
    $("a-since").textContent = new Date(me.created).toLocaleDateString();
    $("a-fn").value = me.first;
    $("a-ln").value = me.last;
    $("a-ph").value = me.phone;
    if (isAdmin(me.email)) $("a-admin").hidden = false;

    $("f-prof").onsubmit = function (e) {
      e.preventDefault();
      var fn = $("a-fn").value.trim(),
        ln = $("a-ln").value.trim(),
        ph = $("a-ph").value.trim();
      if (!fn || !ln) return say("e-prof", "Enter your first and last name.");
      if (ph.replace(/\D/g, "").length < 7)
        return say("e-prof", "Enter a valid phone number.");
      me.first = fn;
      me.last = ln;
      me.phone = ph;
      saveUsers(allUsers);
      $("hello").textContent = "Hello, " + fn;
      say("e-prof", "Changes saved.", true);
    };

    $("f-pass").onsubmit = function (e) {
      e.preventDefault();
      var n = $("a-new").value;
      if (!$("a-cur").value) return say("e-pass", "Enter your current password.");
      if (n.length < 8)
        return say("e-pass", "Use a new password with at least 8 characters.");
      if (n !== $("a-new2").value) return say("e-pass", "The new passwords do not match.");
      hashPw($("a-cur").value, me.salt).then(function (h) {
        if (h !== me.hash) return say("e-pass", "Current password is incorrect.");
        var salt = randHex(16);
        hashPw(n, salt).then(function (nh) {
          me.salt = salt;
          me.hash = nh;
          saveUsers(allUsers);
          $("f-pass").reset();
          say("e-pass", "Password updated.", true);
        });
      });
    };

    $("a-del").onclick = function () {
      if (!confirm("Delete your account? This cannot be undone.")) return;
      delete allUsers[me.email];
      saveUsers(allUsers);
      signOut();
    };
  }

  if ($("adm")) {
    if (!me || !isAdmin(me.email)) {
      location.replace(me ? "account.html" : "signin.html");
      return;
    }
    $("adm-me").textContent = me.email;

    var cell = function (tr, text) {
      var td = document.createElement("td");
      td.textContent = text; // textContent: user input is never parsed as HTML
      tr.appendChild(td);
      return td;
    };
    var act = function (td, label, cls, fn) {
      var b = document.createElement("button");
      b.className = "btn sm " + cls;
      b.textContent = label;
      b.onclick = fn;
      td.appendChild(b);
    };

    var render = function () {
      var q = $("q").value.trim().toLowerCase(),
        f = $("flt").value,
        list = Object.keys(allUsers)
          .map(function (k) {
            return allUsers[k];
          })
          .sort(function (a, b) {
            return b.created - a.created;
          }),
        week = Date.now() - 7 * 864e5;

      $("s-total").textContent = list.length;
      $("s-ver").textContent = list.filter(function (u) { return u.verified; }).length;
      $("s-unv").textContent = list.filter(function (u) { return !u.verified; }).length;
      $("s-new").textContent = list.filter(function (u) { return u.created > week; }).length;

      var rows = list.filter(function (u) {
        if (f === "verified" && !u.verified) return false;
        if (f === "pending" && u.verified) return false;
        return !q || (u.first + " " + u.last + " " + u.email + " " + u.phone).toLowerCase().indexOf(q) > -1;
      });

      var tb = $("rows");
      tb.textContent = "";
      if (!rows.length) {
        var er = document.createElement("tr"),
          ec = cell(er, list.length ? "No users match your search." : "No users have registered yet.");
        ec.colSpan = 6;
        ec.className = "empty";
        tb.appendChild(er);
      }
      rows.forEach(function (u) {
        var tr = document.createElement("tr");
        cell(tr, u.first + " " + u.last + (isAdmin(u.email) ? " (admin)" : ""));
        cell(tr, u.email);
        cell(tr, u.phone);
        var st = cell(tr, "");
        var pill = document.createElement("span");
        pill.className = "pill" + (u.verified ? " ok" : "");
        pill.textContent = u.verified ? "Verified" : "Pending";
        st.appendChild(pill);
        cell(tr, new Date(u.created).toLocaleDateString());
        var ac = cell(tr, "");
        if (u.email !== me.email) {
          act(ac, u.verified ? "Unverify" : "Verify", "ghost", function () {
            u.verified = !u.verified;
            if (u.verified) { delete u.code; delete u.codeExp; delete u.tries; }
            saveUsers(allUsers);
            render();
          });
          act(ac, "Delete", "danger", function () {
            if (!confirm("Delete " + u.email + "? This cannot be undone.")) return;
            delete allUsers[u.email];
            saveUsers(allUsers);
            render();
          });
        } else ac.textContent = "You";
        tb.appendChild(tr);
      });
    };
    $("q").oninput = render;
    $("flt").onchange = render;
    render();
  }

  /* =========================================================
     START (last, so boxes and handlers exist)
     ========================================================= */
  route();
})();
