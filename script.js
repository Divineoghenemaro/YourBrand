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
  try {
    var wn = JSON.parse(window.name);
    if (wn && wn.__auth) mem = wn.__auth;
  } catch (e) {}
  function keepMem() {
    try {
      window.name = JSON.stringify({ __auth: mem });
    } catch (e) {}
  }
  function sGet(store, k) {
    try {
      var v = window[store].getItem(k);
      if (v !== null) return v;
    } catch (e) {}
    return mem[store + k] || null;
  }
  function sSet(store, k, v) {
    try {
      window[store].setItem(k, v);
      delete mem[store + k];
    } catch (e) {
      mem[store + k] = v; // storage blocked: keep it across pages via window.name
      keepMem();
    }
  }
  function sDel(store, k) {
    delete mem[store + k];
    keepMem();
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
     PASSWORD SHOW / HIDE (every .password-toggle button)
     ========================================================= */
  var EYE =
    '🙈',
    EYE_OFF =
    '👁️';
  Array.prototype.forEach.call(document.querySelectorAll(".password-toggle"), function (btn) {
    var inp = btn.parentNode.querySelector("input");
    if (!inp) return;
    var paint = function () {
      var hidden = inp.type === "password";
      btn.innerHTML = hidden ? EYE : EYE_OFF;
      btn.setAttribute("aria-label", hidden ? "Show password" : "Hide password");
      btn.setAttribute("aria-pressed", hidden ? "false" : "true");
    };
    btn.onclick = function () {
      inp.type = inp.type === "password" ? "text" : "password";
      paint();
      inp.focus();
    };
    paint();
  });

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
  function sendCode(user, code, purpose) {
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
  // Phone input with country flags + dial codes (intl-tel-input, loaded in signup.html).
  // The initial country is guessed from the browser language; no IP lookup is made.
  var iti = null;
  if ($("ph") && window.intlTelInput) {
    var known = window.intlTelInput.getCountryData().map(function (c) {
      return c.iso2;
    });
    var guess =
      (navigator.languages || [navigator.language || ""])
        .map(function (l) {
          return (l.split("-")[1] || "").toLowerCase();
        })
        .filter(function (r) {
          return known.indexOf(r) > -1;
        })[0] || "us";
    iti = window.intlTelInput($("ph"), {
      initialCountry: guess,
      separateDialCode: true,
      strictMode: true,
      loadUtils: function () {
        return import("https://cdn.jsdelivr.net/npm/intl-tel-input@26.0.6/build/js/utils.js");
      }
    });
  }
  function phoneOk() {
    if (iti) {
      var v = iti.isValidNumber(); // null until the validation data has loaded
      if (v !== null) return v;
    }
    return $("ph").value.replace(/\D/g, "").length >= 7;
  }

  if ($("f-signup"))
    $("f-signup").onsubmit = function (e) {
      e.preventDefault();
      var btn = this.querySelector("button[type=submit]"),
        email = norm($("em").value),
        m;

      if (!$("fn").value.trim() || !$("ln").value.trim())
        m = "Enter your first and last name.";
      else if (!mailRe.test(email)) m = "Enter a valid email address.";
      else if (!phoneOk()) m = "Enter a valid phone number for the selected country.";
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
            phone: iti ? iti.getNumber() : $("ph").value.trim(),
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
    if (location.hash === "#activated" || location.hash === "#reset") {
      say(
        "e-signin",
        location.hash === "#reset"
          ? "Password updated. Sign in with your new password."
          : "Account activated. Sign in to continue.",
        true
      );
      history.replaceState(null, "", location.pathname + location.search);
    }
    if ($("forgot"))
      $("forgot").onclick = function () {
        var v = norm($("sem").value);
        if (mailRe.test(v)) sSet("sessionStorage", "auth.lastEmail", v);
      };
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
     PASSWORD RESET (reset.html): email -> 6-digit code -> new password
     Same demo/real-delivery rules as sign up: see sendCode() and CONFIG.
     The response is identical whether or not the email has an account.
     ========================================================= */
  if ($("v-rq")) {
    var rBoxes = [],
      rTimer,
      rDemo = document.createElement("div"),
      rVal = function () {
        return rBoxes
          .map(function (b) {
            return b.value;
          })
          .join("");
      },
      rClear = function () {
        rBoxes.forEach(function (b) {
          b.value = "";
        });
        if (rBoxes[0]) rBoxes[0].focus();
      };
    rDemo.className = "demo";
    rDemo.hidden = true;
    for (var ri = 0; ri < 6; ri++) {
      (function (i) {
        var b = document.createElement("input");
        b.type = "text";
        b.inputMode = "numeric";
        b.maxLength = 1;
        b.setAttribute("aria-label", "Digit " + (i + 1));
        b.autocomplete = i ? "off" : "one-time-code";
        b.oninput = function () {
          b.value = b.value.replace(/\D/g, "");
          if (b.value && rBoxes[i + 1]) rBoxes[i + 1].focus();
        };
        b.onkeydown = function (e) {
          if (e.key === "Backspace" && !b.value && rBoxes[i - 1]) rBoxes[i - 1].focus();
        };
        b.onfocus = function () {
          b.select();
        };
        b.onpaste = function (e) {
          var t = ((e.clipboardData && e.clipboardData.getData("text")) || "")
            .replace(/\D/g, "")
            .slice(0, 6);
          if (!t) return;
          e.preventDefault();
          t.split("").forEach(function (c, k) {
            rBoxes[k].value = c;
          });
          (rBoxes[t.length] || rBoxes[5]).focus();
        };
        $("rcodes").appendChild(b);
        rBoxes.push(b);
      })(ri);
    }
    $("rcodes").parentNode.insertBefore(rDemo, $("rcodes").nextSibling);

    var rCd = function () {
      clearInterval(rTimer);
      var end = Date.now() + CONFIG.RESEND_SECONDS * 1000;
      $("rresendTxt").hidden = false;
      $("rresend").hidden = true;
      var tick = function () {
        var left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        $("rcd").textContent = left;
        if (left <= 0) {
          clearInterval(rTimer);
          $("rresendTxt").hidden = true;
          $("rresend").hidden = false;
        }
      };
      tick();
      rTimer = setInterval(tick, 500);
    };

    var rSend = function (email) {
      var users = getUsers(),
        u = users[email];
      sSet("sessionStorage", "auth.reset", email);
      rDemo.hidden = true;
      if (!u) return Promise.resolve(); // unknown email: say nothing different
      var code = newCode();
      u.rcode = code;
      u.rexp = Date.now() + CONFIG.CODE_TTL_MIN * 60000;
      u.rtries = 0;
      saveUsers(users);
      return sendCode(u, code, "reset").then(function () {
        if (CONFIG.DEMO_MODE) {
          rDemo.innerHTML =
            "<span>Demo mode: no email service is connected, so your code is</span><b></b>";
          rDemo.lastChild.textContent = code;
          rDemo.hidden = false;
        }
      });
    };

    var rPre = sGet("sessionStorage", "auth.reset") || sGet("sessionStorage", "auth.lastEmail");
    if (rPre) $("rem").value = rPre;

    $("f-rq").onsubmit = function (e) {
      e.preventDefault();
      var btn = this.querySelector("button[type=submit]"),
        email = norm($("rem").value);
      if (!mailRe.test(email)) return say("e-rq", "Enter a valid email address.");
      say("e-rq", "");
      busy(btn, true);
      rSend(email).then(function () {
        busy(btn, false);
        $("rsentTo").textContent = email;
        $("v-rq").classList.remove("on");
        $("v-rn").classList.add("on");
        rCd();
        rClear();
      });
    };

    $("rresend").onclick = function () {
      var email = sGet("sessionStorage", "auth.reset");
      if (!email) return location.reload();
      rSend(email).then(function () {
        rClear();
        rCd();
        say("e-rn", "A new code has been sent.", true);
      });
    };

    $("f-rn").onsubmit = function (e) {
      e.preventDefault();
      var btn = this.querySelector("button[type=submit]"),
        email = sGet("sessionStorage", "auth.reset"),
        users = getUsers(),
        u = email && users[email],
        c = rVal(),
        p = $("rpw").value,
        m;
      if (!email) return location.reload();
      if (c.length < 6) m = "Enter all 6 digits of the code.";
      else if (p.length < 8) m = "Use a password with at least 8 characters.";
      else if (p !== $("rpw2").value) m = "The passwords do not match.";
      say("e-rn", m);
      if (m) return;

      var bad = "That code is invalid or has expired. Request a new one.";
      if (!u || !u.rcode || Date.now() > u.rexp || (u.rtries || 0) >= CONFIG.MAX_TRIES)
        return say("e-rn", bad);
      if (c !== u.rcode) {
        u.rtries = (u.rtries || 0) + 1;
        saveUsers(users);
        var left = CONFIG.MAX_TRIES - u.rtries;
        say("e-rn", left > 0 ? "Incorrect code. " + left + (left === 1 ? " attempt" : " attempts") + " left." : bad);
        return rClear();
      }

      busy(btn, true);
      var salt = randHex(16);
      hashPw(p, salt).then(function (h) {
        u.salt = salt;
        u.hash = h;
        u.verified = true; // the code proved they own this email
        delete u.rcode;
        delete u.rexp;
        delete u.rtries;
        saveUsers(users);
        sDel("sessionStorage", "auth.reset");
        sSet("sessionStorage", "auth.lastEmail", email);
        clearInterval(rTimer);
        say("e-rn", "Password updated. Redirecting to sign in…", true);
        setTimeout(function () {
          location.href = "signin.html#reset";
        }, 900);
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
     TRADINGVIEW WIDGET (follows the site theme)
     The embed reads its settings once, so it is rebuilt with colours
     taken from the CSS variables whenever the theme changes.
     ========================================================= */
  var tvBox = $("tv-widget");
  if (tvBox) {
    // [label, "EXCHANGE:SYMBOL|default range"]; edit to change the markets
    var TV_SYMBOLS = [
      ["Apple", "NASDAQ:AAPL|1D"],
      ["Google", "NASDAQ:GOOGL|1D"],
      ["Microsoft", "NASDAQ:MSFT|1D"]
    ];
    var tvLoaded = false,
      tvTimer;
    var cssVar = function (n) {
      return getComputedStyle(root).getPropertyValue(n).trim();
    };
    var isLight = function () {
      var t = root.getAttribute("data-theme");
      return t ? t === "light" : matchMedia("(prefers-color-scheme:light)").matches;
    };
    var renderTV = function () {
      tvLoaded = true;
      var up = cssVar("--accent"),
        down = cssVar("--err"),
        cfg = {
          colorTheme: isLight() ? "light" : "dark",
          backgroundColor: "rgba(0, 0, 0, 0)",
          isTransparent: true,
          fontColor: cssVar("--mute"),
          widgetFontColor: cssVar("--text"),
          gridLineColor: cssVar("--line"),
          lineColor: up,
          topColor: cssVar("--glow"),
          bottomColor: "rgba(0, 0, 0, 0)",
          upColor: up,
          downColor: down,
          borderUpColor: up,
          borderDownColor: down,
          wickUpColor: up,
          wickDownColor: down,
          volumeUpColor: up,
          volumeDownColor: down,
          lineWidth: 2,
          lineType: 0,
          chartType: "area",
          locale: "en",
          chartOnly: false,
          scalePosition: "right",
          scaleMode: "Normal",
          fontFamily: "Manrope, system-ui, -apple-system, Segoe UI, sans-serif",
          valuesTracking: "1",
          changeMode: "price-and-percent",
          symbols: TV_SYMBOLS,
          dateRanges: ["1d|1", "1m|30", "3m|60", "12m|1D", "60m|1W", "all|1M"],
          fontSize: "10",
          headerFontSize: "medium",
          autosize: true,
          width: "100%",
          height: "100%",
          noTimeScale: false,
          hideDateRanges: false,
          hideMarketStatus: false,
          hideSymbolLogo: false
        };
      tvBox.textContent = "";
      var w = document.createElement("div");
      w.className = "tradingview-widget-container__widget";
      var s = document.createElement("script");
      s.src =
        "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
      s.async = true;
      s.innerHTML = JSON.stringify(cfg);
      tvBox.appendChild(w);
      tvBox.appendChild(s);
    };
    var retheme = function () {
      if (!tvLoaded) return; // not on screen yet: it will load with the current theme
      clearTimeout(tvTimer);
      tvTimer = setTimeout(renderTV, 120);
    };
    new MutationObserver(retheme).observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    var mq = matchMedia("(prefers-color-scheme:light)");
    if (mq.addEventListener) mq.addEventListener("change", retheme);

    // load when the section is near the screen (saves bandwidth)
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(
        function (en) {
          if (en[0].isIntersecting) {
            io.disconnect();
            renderTV();
          }
        },
        { rootMargin: "400px" }
      );
      io.observe(tvBox);
    } else renderTV();
  }

  /* =========================================================
     TICKER TAPE (index.html only; follows the site theme)
     ========================================================= */
  var tickBox = $("ticker");
  if (tickBox) {
    var TICKER_SYMBOLS =
      "FOREXCOM:SPXUSD,FOREXCOM:NSXUSD,FOREXCOM:DJI,FX:EURUSD,BITSTAMP:BTCUSD," +
      "BITSTAMP:ETHUSD,CMCMARKETS:GOLD,OANDA:XAUUSD,BINANCE:BTCUSDT," +
      "FOREXCOM:XAUUSD,BINANCE:ETHUSDT";
    var tickLight = function () {
      var t = root.getAttribute("data-theme");
      return t ? t === "light" : matchMedia("(prefers-color-scheme:light)").matches;
    };
    var tickTimer;
    var renderTicker = function () {
      tickBox.textContent = "";
      var el = document.createElement("tv-ticker-tape");
      el.setAttribute("symbols", TICKER_SYMBOLS);
      el.setAttribute("theme", tickLight() ? "light" : "dark");
      el.setAttribute("transparent", ""); // lets the site background show through
      tickBox.appendChild(el);
    };
    // load TradingView's component once
    if (!document.getElementById("tv-ticker-js")) {
      var ts = document.createElement("script");
      ts.id = "tv-ticker-js";
      ts.type = "module";
      ts.src = "https://widgets.tradingview-widget.com/w/en/tv-ticker-tape.js";
      document.head.appendChild(ts);
    }
    renderTicker();
    var reTicker = function () {
      clearTimeout(tickTimer);
      tickTimer = setTimeout(renderTicker, 120);
    };
    new MutationObserver(reTicker).observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    var tmq = matchMedia("(prefers-color-scheme:light)");
    if (tmq.addEventListener) tmq.addEventListener("change", reTicker);
  }


document.addEventListener("DOMContentLoaded", () => {

  const widgetContainer =
    document.querySelector(".binance-responsive");

  const widgetScale =
    document.querySelector(".binance-scale");

  const widget =
    document.querySelector(".binance-converter-widget");


  /* ==============================
     RESPONSIVE WIDGET SCALING
  ============================== */

  function resizeBinanceWidget() {

    if (!widgetContainer || !widgetScale) return;

    const availableWidth =
      widgetContainer.clientWidth;

    const scale =
      Math.min(1, availableWidth / 300);

    widgetScale.style.setProperty(
      "--binance-scale",
      scale
    );

    widgetScale.style.height =
      `${300 * scale}px`;
  }


  resizeBinanceWidget();

  window.addEventListener(
    "resize",
    resizeBinanceWidget
  );


  /* ==============================
     BINANCE THEME
  ============================== */

  function getCurrentTheme() {

    const root =
      document.documentElement;

    if (root.dataset.theme === "dark") {
      return "dark";
    }

    if (root.dataset.theme === "light") {
      return "light";
    }

    return window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches
      ? "dark"
      : "light";
  }


  function updateBinanceTheme() {

    if (!widget) return;

    widget.dataset.theme =
      getCurrentTheme();
  }


  updateBinanceTheme();


  /* ==============================
     WATCH YOUR EXISTING THEME TOGGLE
  ============================== */

  const themeObserver =
    new MutationObserver(() => {

      updateBinanceTheme();

      /*
       * Recalculate because changing theme
       * can alter widget dimensions.
       */
      setTimeout(
        resizeBinanceWidget,
        100
      );

    });


  themeObserver.observe(
    document.documentElement,
    {
      attributes: true,
      attributeFilter: ["data-theme"]
    }
  );


  /* ==============================
     FOLLOW SYSTEM THEME
  ============================== */

  const systemTheme =
    window.matchMedia(
      "(prefers-color-scheme: dark)"
    );

  systemTheme.addEventListener(
    "change",
    () => {

      if (
        !document.documentElement
          .hasAttribute("data-theme")
      ) {
        updateBinanceTheme();
      }

    }
  );

});

/* =========================================================
     PLATFORMS SCROLLING BAR (right to left, with real logos)
     slug = icon name in the Simple Icons library (loaded from a CDN)
     logo = your own file, e.g. "img/metatrader.png" (shown in full colour,
            and used instead of slug if both are set)
     ========================================================= */
  var plBox = $("partners");
  if (plBox) {
    var ICON_CDN = "https://cdn.jsdelivr.net/npm/simple-icons@13/icons/";
    var PLATFORMS = [
      { name: "TradingView", slug: "tradingview" },
      { name: "Yahoo Finance", logo: "https://companieslogo.com/img/orig/yahoo-finance-e577cb16.png" },
      { name: "Trust Wallet", logo: "https://vectorseek.com/wp-content/uploads/2024/07/Trust-Wallet-Shield-Logo-Vector-Logo-Vector.svg-.png" },
      { name: "MetaTrader", logo: "https://www.infinox.co.uk/fca/wp-content/uploads/sites/5/2023/06/MT5-hero-pic.webp" },
      { name: "Coinbase", logo: "https://brandlogo.org/wp-content/uploads/2024/04/Coinbase-Icon.png" },
      { name: "Binance", logo: "https://upload.wikimedia.org/wikipedia/commons/5/57/Binance_Logo.png" },
      { name: "Kraken", logo: "https://logos-world.net/wp-content/uploads/2021/02/Kraken-Logo.png" },
      { name: "Bybit", logo: "https://crystalpng.com/wp-content/uploads/2025/11/Bybit-logo.png" },
      { name: "Dexscreener", logo: "https://investx.fr/en/wp-content/uploads/sites/5/2025/05/image-4.webp" },
      { name: "Forex Factory", logo: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQSxeNU4BaWfNL7M_EvTNkBNkRf-rGZfkzObhYeEIeU4A&s" },
      { name: "OKX", slug: "okx" },
      { name: "Exness", logo: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSAackvaFxgKvUMb4VeKptg8T7u4x7GofcbA-tysPBJ_A&s=10" },
      { name: "KuCoin", slug: "kucoin" },
      { name: "Bitget", logo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f3/Logo_Bitget.svg/3840px-Logo_Bitget.svg.png" },
      { name: "MetaMask", logo: "https://www.pngall.com/wp-content/uploads/17/Metamask-Open-Source-Logo-PNG-thumb.png" }, 
      { name: "Interactive Brokers", logo: "https://m.foolcdn.com/media/affiliates/original_images/IB_logo_stacked_black_text3x_ZTsS8cn_PFvJPJw.png" },
      { name: "Luno", logo: "https://framerusercontent.com/images/iwCmTrjcCzqEqGCgCGVr84H7oAY.png" }
    ];

    var badge = function (name) {
      var mk = document.createElement("span");
      mk.className = "mk";
      mk.textContent = name.charAt(0);
      return mk;
    };

    var plTrack = document.createElement("div");
    plTrack.className = "marquee-track";
    plTrack.style.setProperty("--dur", PLATFORMS.length * 3 + "s"); // lower = faster

    // two identical copies make the loop seamless
    [false, true].forEach(function (copy) {
      PLATFORMS.forEach(function (p) {
        var item = document.createElement("span");
        item.className = "pl";
        if (copy) item.setAttribute("aria-hidden", "true");

        var src = p.logo || (p.slug ? ICON_CDN + p.slug + ".svg" : "");
        if (src) {
          var img = document.createElement("img");
          img.src = src;
          img.alt = "";
          if (!p.logo) img.className = "si";
          img.onerror = function () {
            // logo missing: swap to the letter badge
            item.replaceChild(badge(p.name), img);
          };
          item.appendChild(img);
        } else {
          item.appendChild(badge(p.name));
        }
        item.appendChild(document.createTextNode(p.name));
        plTrack.appendChild(item);
      });
    });
    plBox.appendChild(plTrack);
  }
  

  /* =========================================================
     HERO CHART + MARKET OVERVIEW (follow the site theme)
     TradingView reads settings once, so each widget is rebuilt
     from the CSS variables when the theme changes.
     ========================================================= */
  var cv = function (n) {
      return getComputedStyle(root).getPropertyValue(n).trim();
    },
    light = function () {
      var t = root.getAttribute("data-theme");
      return t ? t === "light" : matchMedia("(prefers-color-scheme:light)").matches;
    },
    themeCbs = [],
    themeTimer;
  function onTheme(fn) {
    themeCbs.push(fn);
  }
  function fireTheme() {
    clearTimeout(themeTimer);
    themeTimer = setTimeout(function () {
      themeCbs.forEach(function (f) {
        f();
      });
    }, 120);
  }
  new MutationObserver(fireTheme).observe(root, {
    attributes: true,
    attributeFilter: ["data-theme"]
  });
  var tmq2 = matchMedia("(prefers-color-scheme:light)");
  if (tmq2.addEventListener) tmq2.addEventListener("change", fireTheme);

  function whenNear(el, fn) {
    if (!("IntersectionObserver" in window)) return fn();
    var o = new IntersectionObserver(
      function (en) {
        if (en[0].isIntersecting) {
          o.disconnect();
          fn();
        }
      },
      { rootMargin: "400px" }
    );
    o.observe(el);
  }

  // Advanced chart in the hero
  var heroBox = $("tv-hero");
  if (heroBox) {
    var renderHero = function () {
      var cfg = {
        allow_symbol_change: true,
        calendar: false,
        details: true,
        hide_side_toolbar: true,
        hide_top_toolbar: false,
        hide_legend: false,
        hide_volume: false,
        hotlist: false,
        interval: "5",
        locale: "en",
        save_image: false,
        style: "1",
        symbol: "OANDA:XAUUSD",
        theme: light() ? "light" : "dark",
        timezone: "Etc/UTC",
        backgroundColor: "rgba(0, 0, 0, 0)",
        gridColor: cv("--line"),
        watchlist: [
          "OANDA:EURUSD",
          "OANDA:USDJPY",
          "BINANCE:BTCUSDT",
          "BINANCE:XRPUSDT",
          "CRYPTO:ETHUSD"
        ],
        withdateranges: false,
        compareSymbols: [
          { symbol: "BINANCE:BTCUSDT", position: "SameScale" },
          { symbol: "FX:USDJPY", position: "SameScale" }
        ],
        support_host: "https://www.tradingview.com",
        studies: [],
        autosize: true
      };
      heroBox.textContent = "";
      var w = document.createElement("div");
      w.className = "tradingview-widget-container__widget";
      var s = document.createElement("script");
      s.src =
        "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
      s.async = true;
      s.innerHTML = JSON.stringify(cfg);
      heroBox.appendChild(w);
      heroBox.appendChild(s);
    };
    renderHero(); // first thing visitors see, so load immediately
    onTheme(renderHero);
  }

  // Market overview under the chart in Markets
  var ovBox = $("tv-overview");
  if (ovBox) {
    // edit sections / symbols here
    var OVERVIEW_SECTORS = [
      { sectionName: "Indices", symbols: ["FOREXCOM:SPXUSD", "FOREXCOM:NSXUSD", "FOREXCOM:DJI", "FOREXCOM:UKXGBP"] },
      { sectionName: "Stocks", symbols: ["NASDAQ:AAPL", "NASDAQ:ADBE", "NASDAQ:NVDA", "NASDAQ:TSLA"] },
      {
        sectionName: "Crypto",
        symbols: [
          "BITSTAMP:BTCUSD", "BITSTAMP:ETHUSD", "CRYPTO:XRPUSD", "COINBASE:BTCUSD", "BINANCE:BTCUSDT",
          "BINANCE:SOLUSDT", "BINANCE:XRPUSDT", "BINANCE:ZECUSDT", "BINANCE:NEARUSDT", "BINANCE:BNBUSDT"
        ]
      },
      {
        sectionName: "Forex",
        symbols: [
          "OANDA:EURUSD", "FX:EURUSD", "OANDA:GBPUSD", "FX:USDJPY",
          "OANDA:AUDUSD", "OANDA:NZDUSD", "FX:USDCHF", "OANDA:EURCHF"
        ]
      }
    ];
    var ovLoaded = false;
    var renderOv = function () {
      ovLoaded = true;
      if (!document.getElementById("tv-overview-js")) {
        var ms = document.createElement("script");
        ms.id = "tv-overview-js";
        ms.type = "module";
        ms.src = "https://widgets.tradingview-widget.com/w/en/tv-market-overview.js";
        document.head.appendChild(ms);
      }
      ovBox.textContent = "";
      var el = document.createElement("tv-market-overview");
      el.setAttribute("symbol-sectors", JSON.stringify(OVERVIEW_SECTORS));
      el.setAttribute("theme", light() ? "light" : "dark");
      el.setAttribute("transparent", ""); // site background shows through
      el.setAttribute("width", "100%");
      el.setAttribute("height", "100%");
      ovBox.appendChild(el);
    };
    whenNear(ovBox, renderOv);
    onTheme(function () {
      if (ovLoaded) renderOv();
    });
  }

  /* =========================================================
     START (last, so boxes and handlers exist)
     ========================================================= */
  route();
})();
