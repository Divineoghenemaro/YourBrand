(function () {
  var root = document.documentElement,
    $ = function (i) {
      return document.getElementById(i);
    };
  try {
    var s = localStorage.getItem("theme");
    if (s) root.setAttribute("data-theme", s);
  } catch (e) {}
  $("theme").onclick = function () {
    var cur =
      root.getAttribute("data-theme") ||
      (matchMedia("(prefers-color-scheme:light)").matches ? "light" : "dark");
    var nx = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", nx);
    try {
      localStorage.setItem("theme", nx);
    } catch (e) {}
  };
  $("burger").onclick = function () {
    var n = $("nav"),
      o = n.classList.toggle("open");
    this.setAttribute("aria-expanded", o);
  };

  var views = ["signup", "verify"],
    timer;
  function show(v) {
    if (views.indexOf(v) < 0) v = "signup";
    views.forEach(function (x) {
      $("v-" + x).classList.toggle("on", x === v);
    });
    $("nav").classList.remove("open");
    if (v === "verify") startCd();
  }
  function route() {
    show((location.hash || "#signin").slice(1));
  }
  addEventListener("hashchange", route);
  route();

  var codes = $("codes"),
    boxes = [];
  for (var i = 0; i < 6; i++) {
    (function (i) {
      var b = document.createElement("input");
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
      };
      b.onpaste = function (e) {
        var t = (e.clipboardData.getData("text") || "")
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

  function startCd() {
    clearInterval(timer);
    var n = 45;
    $("cd").textContent = n;
    $("resendTxt").hidden = false;
    $("resend").hidden = true;
    timer = setInterval(function () {
      n--;
      $("cd").textContent = n;
      if (n <= 0) {
        clearInterval(timer);
        $("resendTxt").hidden = true;
        $("resend").hidden = false;
      }
    }, 1000);
  }
  $("resend").onclick = startCd;

  var mailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  $("f-signup").onsubmit = function (e) {
    e.preventDefault();
    var m;
    if (!$("fn").value.trim() || !$("ln").value.trim())
      m = "Enter your first and last name.";
    else if (!mailRe.test($("em").value)) m = "Enter a valid email address.";
    else if ($("ph").value.replace(/\D/g, "").length < 7)
      m = "Enter a valid phone number.";
    else if ($("pw").value.length < 8)
      m = "Use a password with at least 8 characters.";
    else if ($("pw").value !== $("pw2").value)
      m = "The passwords do not match.";
    $("e-signup").textContent = m || "";
    if (m) return;
    $("sentTo").textContent = $("em").value.trim();
    location.hash = "#verify";
    boxes[0].focus();
  };
  $("activate").onclick = function () {
    var c = boxes
      .map(function (b) {
        return b.value;
      })
      .join("");
    $("e-verify").textContent =
      c.length < 6 ? "Enter all 6 digits of the code." : "";
    if (c.length === 6) location.hash = "#signin";
  };
  $("f-signin").onsubmit = function (e) {
    e.preventDefault();
    $("e-signin").textContent = !mailRe.test($("sem").value)
      ? "Enter a valid email address."
      : !$("spw").value
        ? "Enter your password."
        : "";
  };
})();
