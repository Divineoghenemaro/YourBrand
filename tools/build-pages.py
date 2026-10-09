import os, re, json
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

def ic(p):
    return ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>')

ICONS = {
 "home": ic('<path d="M3 11l9-8 9 8"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>'),
 "markets": ic('<path d="M3 17l5-6 4 3 8-9"/><path d="M15 5h5v5"/><path d="M3 21h18"/>'),
 "trade": ic('<path d="M7 20V4"/><path d="M3 8l4-4 4 4"/><path d="M17 4v16"/><path d="M13 16l4 4 4-4"/>'),
 "wallet": ic('<path d="M3 7a2 2 0 012-2h12v4"/><path d="M3 7v11a2 2 0 002 2h15a1 1 0 001-1V10a1 1 0 00-1-1H5a2 2 0 01-2-2z"/><circle cx="16.5" cy="14.5" r="1.2"/>'),
 "portfolio": ic('<circle cx="12" cy="12" r="9"/><path d="M12 3v9l7.8 4.5"/>'),
 "orders": ic('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>'),
 "history": ic('<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.4"/><path d="M3 4v4h4"/><path d="M12 7.5V12l3 2"/>'),
 "settings": ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),
 "admin": ic('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
 "out": ic('<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>'),
 "bell": ic('<path d="M6 9a6 6 0 1112 0c0 5 2 6.5 2 6.5H4S6 14 6 9z"/><path d="M10 19a2 2 0 004 0"/>'),
 "chev": ic('<path d="M6 9l6 6 6-6"/>'),
 "plan": ic('<path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.9L12 16.5 6.7 19.2l1-5.9L3.5 9.2l5.9-.9z"/>'),
 "theme": ic('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 000 18z" fill="currentColor"/>'),
 "money": ic('<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2A2.6 2.2 0 0012 8c-1.5 0-2.6.8-2.6 2s1.1 1.6 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2a2.6 2.2 0 01-2.5-1.2M12 6v2M12 16v2"/>'),
 "lock": ic('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
 "user": ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),
 "gear": ic('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
 "send": ic('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>'),
 "recv": ic('<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>'),
 "tg": ic('<path d="M21 3L2.5 10.2l6 2.3L11 20l3.2-4.5L19 19z"/><path d="M8.5 12.5L21 3"/>'),
}
PLACEHOLDER = ('<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
               '<circle cx="12" cy="8.5" r="4.4"/><path d="M3.2 24c0-5.2 3.9-8.6 8.8-8.6s8.8 3.4 8.8 8.6z"/></svg>')

def avatar(cls="", extra=""):
    return f'<span class="av {cls}" {extra}>{PLACEHOLDER}<img alt="" hidden></span>'

SIDE = [("home","account.html","Dashboard"),("markets","markets.html","Markets"),
        ("trade","trade.html","Trade"),("wallet","wallet.html","Wallet"),
        ("portfolio","portfolio.html","Portfolio"),("orders","orders.html","Orders"),
        ("history","history.html","History"),("settings","settings.html","Settings")]
TABS = [("home","account.html","Home"),("markets","markets.html","Markets"),
        ("trade","trade.html","Trade"),("portfolio","portfolio.html","Portfolio"),
        ("wallet","wallet.html","Wallet")]
TAB_ACTIVE = {"orders":"portfolio","history":"portfolio"}

BELL = f'''<button class="icon bell" id="notif-btn" aria-label="Notifications" aria-expanded="false" aria-controls="notif-panel">{ICONS["bell"]}<span class="badge" id="notif-badge" hidden>0</span></button>'''
NOTIF_PANEL = '''<div class="notif-panel" id="notif-panel" hidden>
    <div class="np-head"><b>Notifications</b><button class="link-btn" id="notif-readall" type="button">Mark all read</button></div>
    <div id="notif-list"></div>
  </div>'''

def shell(title, active, main, main_attrs="", extra="", body_cls="", noindex=False):
    side = ""
    for k, href, label in SIDE:
        cls = ' class="active"' if k == active else ""
        side += f'<a{cls} href="{href}" title="{label}"><span class="ni">{ICONS[k]}</span><span class="lbl">{label}</span></a>\n      '
    cls = ' class="active"' if active == "admin" else ""
    side += f'<a{cls} href="admin.html" title="Admin" data-admin hidden><span class="ni">{ICONS["admin"]}</span><span class="lbl">Admin</span></a>'
    ta = TAB_ACTIVE.get(active, active)
    tabs = ""
    for k, href, label in TABS:
        cls = ' class="active"' if k == ta else ""
        tabs += f'<a{cls} href="{href}"><span class="ni">{ICONS[k]}</span><span>{label}</span></a>\n  '
    scripts = ('<script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n    '
               '<script defer src="sb-config.js"></script>\n    <script defer src="supabase.js"></script>\n    <script defer src="script.js"></script>\n    '
               '<script defer src="feed.js"></script>\n    <script defer src="dashboard.js"></script>\n    ' + extra)
    font = "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&amp;display=swap"
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Your Brand — {title}</title>
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f3f7f5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#06120f" media="(prefers-color-scheme: dark)">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="manifest" href="manifest.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="{font}" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="{font}"></noscript>
<link href="style.css" rel="stylesheet">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
    {scripts}
</head>
<body class="trade-app is-loading{body_cls}">
<header>
  <div class="bar">
    <a class="brand" href="account.html"><span class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="#04231a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l5-6 4 3 7-9"/></svg></span>Your Brand</a>
    <div class="sp"></div>
    <div class="app-actions">
      {BELL}
      <a href="settings.html" aria-label="Profile and settings" class="av sm" id="profile-chip">{PLACEHOLDER}<img alt="" hidden></a>
    </div>
  </div>
  {NOTIF_PANEL}
</header>
<div class="app-shell">
  <aside class="sidebar" id="sidebar">
    <a class="side-user" href="settings.html" title="Profile">
      {avatar("md")}
      <div class="meta"><b id="side-name">Trader</b><small id="side-email"></small></div>
    </a>
    <div class="side-nav" role="navigation" aria-label="Account">
      {side}
    </div>
    <button class="side-signout" id="signout" title="Sign out">{ICONS["out"]}<span class="lbl">Sign out</span></button>
  </aside>
  <main class="app-main"{main_attrs}>
{main}
  </main>
</div>
<div class="tab-bar" role="navigation" aria-label="Account">
  {tabs}
</div>
<div class="modal" id="chart-modal" hidden role="dialog" aria-modal="true" aria-label="Live chart">
  <div class="modal-card">
    <div class="modal-head"><div><b id="cm-sym"></b><small id="cm-price"></small></div><button class="icon" id="cm-close" type="button" aria-label="Close chart">&times;</button></div>
    <div class="cm-stats" id="cm-stats" hidden></div>
    <div class="chart-box" id="cm-chart"></div>
  </div>
</div>
</body>
</html>
'''

def head(h1, lead, actions=""):
    a = f'<div class="head-actions">{actions}</div>' if actions else ""
    idattr = ' id="hello"' if h1 == "Hello" else ""
    return f'''    <div class="page-head">
      <div><h1{idattr}>{h1}</h1><p class="lead">{lead}</p></div>
      {a}
    </div>'''

CUR = '<span class="cur-code">USD</span>'
pages = {}
PILL = '<span class="live-pill" id="feed-status">Connecting…</span>'

# ---------- Dashboard ----------
pages["account.html"] = shell("Dashboard", "home", head("Hello", "Here is your account today.", PILL) + f"""
    <section class="panel glow">
      <div class="eyebrow-row"><span class="eyebrow">Total balance</span><a class="plan-chip" id="plan-chip" href="settings.html#plan" hidden></a></div>
      <div class="balance" id="total-balance">$0.00</div>
      <div id="balance-sub"></div>
      <div class="head-actions" style="margin-top:20px">
        <a class="btn" href="wallet.html#deposit">Deposit</a>
        <a class="btn ghost" href="wallet.html#withdraw">Withdraw</a>
        <a class="btn ghost" href="wallet.html#send">Send</a>
        <a class="btn ghost" href="wallet.html#receive">Receive</a>
      </div>
      <div class="mini-stats">
        <div><span>Available</span><b id="stat-avail">$0.00</b></div>
        <div><span>In trades</span><b id="stat-inpos">$0.00</b></div>
        <div><span>Open P&amp;L</span><b id="stat-pnl">$0.00</b></div>
      </div>
    </section>
    <section class="panel" id="home-plans">
      <div class="panel-head"><h2>Plans</h2><a href="settings.html#plan">Details →</a></div>
      <p class="hint" id="home-plan-note" style="margin:0 0 14px"></p>
      <div id="home-plans-body"></div>
      <div class="err plan-msg" role="status"></div>
    </section>
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Watchlist</h2><a href="markets.html">Markets →</a></div>
        <div id="market-watch"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Open positions</h2><a href="portfolio.html">Portfolio →</a></div>
        <div id="positions-preview"></div>
      </section>
    </div>
    <section class="panel help">
      <span class="ni">{ICONS["tg"]}</span>
      <div class="help-text"><h2>Need trading assistance?</h2><p>Chat with our team on Telegram for help with trades, funding or choosing a plan.</p></div>
      <a class="btn" id="telegram-link" href="https://t.me/yourbrand_support" target="_blank" rel="noopener noreferrer">Chat on Telegram</a>
    </section>""", ' id="acct"')

# ---------- Markets ----------
pages["markets.html"] = shell("Markets", "markets", head("Markets", "Live prices for popular assets.", PILL) + """
    <div class="tabs" role="tablist">
      <button class="active" data-market-tab="all">All</button>
      <button data-market-tab="crypto">Crypto</button>
      <button data-market-tab="forex">Forex</button>
      <button data-market-tab="stocks">Stocks</button>
    </div>
    <section class="panel">
      <div class="tbl-wrap"><table>
        <thead><tr><th>Asset</th><th>Price</th><th>24h</th><th></th></tr></thead>
        <tbody id="market-table"></tbody>
      </table></div>
    </section>""", ' id="trade-page"')

# ---------- Trade ----------
pages["trade.html"] = shell("Trade", "trade", head("Trade", "Trade at the live market price.", PILL) + f"""
    <div class="grid-2" style="margin-top:0">
      <section class="panel glow">
        <div class="gate" id="trade-gate" hidden></div>
        <div class="seg" role="group" aria-label="Order side">
          <button class="active" data-side="Buy">Buy</button>
          <button data-side="Sell">Sell</button>
        </div>
        <label for="order-asset">Asset</label>
        <select id="order-asset"></select>
        <div class="label-row"><label for="order-amount">Amount ({CUR})</label><button class="link-btn" id="max-btn" type="button">Max</button></div>
        <input id="order-amount" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00">
        <div class="kv"><span>Available</span><b id="trade-avail">$0.00</b></div>
        <div class="kv"><span>Leverage</span><b id="trade-lev">—</b></div>
        <div class="kv"><span>Buying power</span><b id="trade-bp">—</b></div>
        <div class="kv"><span>Position size</span><b id="trade-size">—</b></div>
        <div class="kv"><span>Estimated units</span><b id="est-units">—</b></div>
        <button class="btn full" id="place-order">Buy BTC</button>
        <div class="err" id="trade-msg" role="status"></div>
        <p class="hint">Buy opens a long position and Sell opens a short. Your amount is the margin, so you can't trade more than your available balance. Your plan's leverage (x factor squared) multiplies the position size and your profit or loss, and a loss can never exceed your margin. <a class="link" href="wallet.html#deposit">Add funds</a></p>
      </section>
      <section class="panel">
        <div class="eyebrow" id="trade-symbol">BTC/USD</div>
        <div class="price-big" id="trade-price">—</div>
        <div id="trade-change" style="font-weight:700"></div>
        <div class="panel-head" style="margin-top:26px"><h2>Recent orders</h2><a href="orders.html">All →</a></div>
        <div id="trade-activity"></div>
      </section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Live chart</h2><span class="eyebrow" id="chart-sym"></span></div>
      <div class="chart-box" id="trade-chart"></div>
    </section>""", ' id="trade-page"')

# ---------- Wallet ----------
pages["wallet.html"] = shell("Wallet", "wallet", head("Wallet", "Deposit, withdraw, send and receive money.") + f"""
    <section class="panel glow">
      <div class="eyebrow">Available to trade, send or withdraw</div>
      <div class="balance" id="w-avail">$0.00</div>
    </section>
    <div class="tabs" role="tablist" style="margin-top:22px">
      <button class="active" data-wtab="deposit">Deposit</button>
      <button data-wtab="withdraw">Withdraw</button>
      <button data-wtab="send">Send</button>
      <button data-wtab="receive">Receive</button>
    </div>
    <section class="panel" id="panel-deposit">
      <div class="form-grid">
        <div><label for="d-coin">Coin</label><select id="d-coin"></select></div>
        <div><label for="d-net">Network</label><select id="d-net"></select></div>
      </div>
      <label for="d-amt">Amount ({CUR})</label>
      <input id="d-amt" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00">
      <div class="kv"><span>You send</span><b id="d-est">—</b></div>
      <p class="hint" id="d-plan-hint" style="margin:0 0 6px"></p>
      <label>Deposit address</label>
      <div class="addr-box"><code id="d-addr"></code><button class="btn sm ghost" id="d-copy" type="button">Copy</button></div>
      <p class="hint" id="d-warn"></p>
      <button class="btn full" id="d-done" type="button">I've sent the funds</button>
      <div class="err" id="e-dep" role="status"></div>
    </section>
    <section class="panel" id="panel-withdraw" hidden>
      <div class="form-grid">
        <div><label for="w-coin">Coin</label><select id="w-coin"></select></div>
        <div><label for="w-net">Network</label><select id="w-net"></select></div>
      </div>
      <label for="w-addr">Destination address</label>
      <input id="w-addr" autocomplete="off" spellcheck="false" placeholder="Paste wallet address">
      <div class="label-row"><label for="w-amt">Amount ({CUR})</label><button class="link-btn" id="w-max" type="button">Max</button></div>
      <input id="w-amt" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00">
      <div class="kv"><span>Network fee</span><b id="w-fee">$0.00</b></div>
      <div class="kv"><span>You receive</span><b id="w-recv">—</b></div>
      <button class="btn full" id="w-submit" type="button">Request withdrawal</button>
      <div class="err" id="e-wd" role="status"></div>
      <p class="hint">Only money not tied up in open trades can be withdrawn. Double-check the address and network: crypto transfers can't be reversed.</p>
    </section>
    <section class="panel" id="panel-send" hidden>
      <label for="t-email">Receiver's Gmail</label>
      <input id="t-email" type="email" autocomplete="off" spellcheck="false" placeholder="name@gmail.com">
      <div class="lookup" id="t-lookup" role="status"></div>
      <div class="label-row"><label for="t-amt">Amount ({CUR})</label><button class="link-btn" id="t-max" type="button">Max</button></div>
      <input id="t-amt" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00">
      <label for="t-note">Note (optional)</label>
      <input id="t-note" maxlength="80" placeholder="What's it for?">
      <button class="btn full" id="t-send" type="button">Send money</button>
      <div class="err" id="e-send" role="status"></div>
      <p class="hint">The amount leaves your balance right away and is held until our team approves the transfer. If it is cancelled, it returns to you.</p>
    </section>
    <section class="panel" id="panel-receive" hidden>
      <label>Your Gmail</label>
      <div class="addr-box"><code id="r-email"></code><button class="btn sm ghost" id="r-copy" type="button">Copy</button></div>
      <p class="hint">Share this Gmail with the person sending you money. They must enter it exactly in their Send form. Incoming transfers appear below once they're submitted.</p>
      <div class="tbl-wrap" style="margin-top:16px"><table>
        <thead><tr><th>Date</th><th>From</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody id="rx-table"></tbody>
      </table></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Transactions</h2></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Date</th><th>Type</th><th>Details</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody id="tx-table"></tbody>
      </table></div>
    </section>""", ' id="trade-page"')

# ---------- Portfolio ----------
pages["portfolio.html"] = shell("Portfolio", "portfolio",
    head("Portfolio", "What you hold and how it is split.",
         PILL + '<a class="btn ghost" href="orders.html">Orders</a><a class="btn ghost" href="history.html">History</a>') + """
    <section class="panel glow">
      <div class="panel-head"><h2>Allocation</h2></div>
      <div style="display:flex;align-items:center;gap:36px;flex-wrap:wrap">
        <div class="donut" id="donut"><span><b id="donut-total">$0.00</b><small>Total value</small></span></div>
        <div class="legend" id="legend"></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Open positions</h2><span class="hint" style="margin:0">Tap an asset for its live chart</span></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Asset</th><th>Side</th><th>Margin</th><th>Entry</th><th>Now</th><th>P&amp;L</th><th></th></tr></thead>
        <tbody id="positions-full"></tbody>
      </table></div>
    </section>""", ' id="trade-page"')

# ---------- Orders ----------
pages["orders.html"] = shell("Orders", "orders", head("Orders", "Every order you have placed.") + """
    <section class="panel">
      <div class="tbl-wrap"><table>
        <thead><tr><th>Date</th><th>Asset</th><th>Action</th><th>Amount</th><th>Price</th></tr></thead>
        <tbody id="orders-table"></tbody>
      </table></div>
    </section>""", ' id="trade-page"')

# ---------- History ----------
pages["history.html"] = shell("History", "history",
    head("History", "Your closed trades.", '<button class="btn ghost" id="export-history">Export CSV</button>') + """
    <section class="panel">
      <div class="tbl-wrap"><table>
        <thead><tr><th>Closed</th><th>Asset</th><th>Side</th><th>Amount</th><th>Entry</th><th>Exit</th><th>Held</th><th>P&amp;L</th></tr></thead>
        <tbody id="history-table"></tbody>
      </table></div>
    </section>""", ' id="trade-page"')

# ---------- Settings (accordion) ----------
def acc(id_, icon, title, sub, body):
    return f"""    <details class="acc" id="sec-{id_}">
      <summary><span class="ni">{ICONS[icon]}</span><span class="acc-t"><b>{title}</b><small id="sum-{id_}">{sub}</small></span><span class="chev">{ICONS["chev"]}</span></summary>
      <div class="acc-body">
{body}
      </div>
    </details>
"""

settings_main = head("Settings", "Tap a section to open it.") + "\n    <div class=\"acc-list\">\n"
settings_main += acc("profile", "user", "Profile", "Photo, name and phone", f"""        <div class="av-row">
          {avatar("xl", 'id="settings-avatar"')}
          <div>
            <div class="btns">
              <button class="btn" id="avatar-pick" type="button">Upload photo</button>
              <button class="btn ghost" id="avatar-remove" type="button" hidden>Remove</button>
            </div>
            <input id="avatar-file" type="file" accept="image/*" hidden>
            <div class="err" id="e-avatar" role="status" style="margin-top:10px"></div>
          </div>
        </div>
        <form id="f-prof" style="margin-top:14px">
          <div class="form-grid">
            <div><label for="a-fn">First name</label><input id="a-fn" autocomplete="given-name"></div>
            <div><label for="a-ln">Last name</label><input id="a-ln" autocomplete="family-name"></div>
          </div>
          <label for="a-ph">Phone</label><input id="a-ph" type="tel" autocomplete="tel">
          <label for="a-email">Email</label><input id="a-email" disabled>
          <div class="err" id="e-prof" role="status"></div>
          <button class="btn" type="submit">Save changes</button>
        </form>""")
settings_main += acc("plan", "plan", "Plan", "Your plan", """        <div id="plan-body"></div>
        <div class="err plan-msg" role="status"></div>""")
settings_main += acc("appearance", "theme", "Appearance", "Theme", """        <p class="hint" style="margin:0 0 12px">Applies to every page of your account.</p>
        <div class="seg three" role="group" aria-label="Theme">
          <button data-theme-choice="system">System</button>
          <button data-theme-choice="light">Light</button>
          <button data-theme-choice="dark">Dark</button>
        </div>""")
settings_main += acc("currency", "money", "Currency", "US Dollar", """        <label for="cur-select" style="margin-top:0">Show amounts in</label>
        <select id="cur-select"></select>
        <p class="hint" id="cur-hint"></p>""")
settings_main += acc("password", "lock", "Password", "Change your password", """        <form id="f-pass">
          <label for="a-cur" style="margin-top:0">Current password</label><input id="a-cur" type="password" autocomplete="current-password">
          <div class="form-grid">
            <div><label for="a-new">New password</label><input id="a-new" type="password" autocomplete="new-password"></div>
            <div><label for="a-new2">Confirm new password</label><input id="a-new2" type="password" autocomplete="new-password"></div>
          </div>
          <div class="err" id="e-pass" role="status"></div>
          <button class="btn" type="submit">Update password</button>
        </form>""")
settings_main += acc("account", "gear", "Account", "Admin and delete account", """        <div class="head-actions">
          <a class="btn ghost" href="admin.html" data-admin hidden>Admin panel</a>
          <button class="btn danger" id="a-del" type="button">Delete account</button>
        </div>""")
settings_main += """    </div>
    <button class="btn ghost full logout-btn" id="settings-logout" type="button">""" + ICONS["out"] + """ Log out</button>"""
pages["settings.html"] = shell("Settings", "settings", settings_main, ' id="trade-page"')

# ---------- Admin ----------
admin_main = head("Admin", "Signed in as <b id=\"adm-who\"></b>. Manage users, money, messages and site features.") + """
    <div class="gate" id="adm-demo" hidden><b>Demo mode.</b> Supabase isn't connected, so admin access here is checked in the browser only and is not secure. Connect Supabase before going live.</div>
    <div class="tabs" role="tablist">
      <button class="active" data-atab="users">Users</button>
      <button data-atab="tx">Transactions</button>
      <button data-atab="msgs">Messages</button>
      <button data-atab="analytics">Analytics</button>
      <button data-atab="site">Site features</button>
    </div>

    <div id="atab-users">
      <div class="stat-grid">
        <div class="stat-card"><span>Total users</span><b id="s-total">0</b></div>
        <div class="stat-card"><span>New (7 days)</span><b id="s-new">0</b></div>
        <div class="stat-card"><span>On a plan</span><b id="s-plan">0</b></div>
        <div class="stat-card"><span>Total balances</span><b id="s-bal">$0.00</b></div>
      </div>
      <section class="panel">
        <div class="toolbar"><input id="q" type="search" placeholder="Search name, email or phone"></div>
        <p class="hint" style="margin:0 0 8px">Click a user's first name to see everything about them and manage their account.</p>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Balance</th><th>Joined</th><th>Access</th></tr></thead>
          <tbody id="rows"></tbody>
        </table></div>
      </section>
    </div>

    <div id="atab-tx" hidden>
      <section class="panel">
        <div class="panel-head"><h2>Transactions</h2>
          <select id="tx-flt" style="width:auto"><option value="pending">Needs action</option><option value="all">All recent</option></select></div>
        <p class="hint" style="margin:0 0 10px">Deposits, withdrawals, transfers and plan upgrades. Amounts are in USD.</p>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Date</th><th>Type</th><th>User</th><th>Details</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody id="tx-rows"></tbody>
        </table></div>
      </section>
    </div>

    <div id="atab-msgs" hidden>
      <section class="panel">
        <div class="panel-head"><h2>New message</h2></div>
        <label for="m-title" style="margin-top:0">Title</label><input id="m-title" maxlength="80" placeholder="Short headline">
        <label for="m-body">Message</label><textarea id="m-body" rows="3" maxlength="400" placeholder="Users receive this as a notification"></textarea>
        <label>Recipients</label>
        <div class="radio-row"><label><input type="radio" name="m-aud" id="m-aud-all" checked> All users</label><label><input type="radio" name="m-aud" id="m-aud-sel"> Choose users</label></div>
        <div id="m-pick-box" hidden>
          <div class="toolbar"><input id="m-search" type="search" placeholder="Search users"><button class="btn sm ghost" id="m-pick-all" type="button">Select all</button><button class="btn sm ghost" id="m-pick-none" type="button">Clear</button></div>
          <div class="pickbox" id="m-picker"></div>
        </div>
        <label>Delivery</label>
        <div class="radio-row"><label><input type="radio" name="m-when" id="m-when-now" checked> Send now</label><label><input type="radio" name="m-when" id="m-when-later"> Schedule</label></div>
        <input id="m-at" type="datetime-local" hidden>
        <button class="btn full" id="m-send" type="button">Send message</button>
        <div class="err" id="m-msg" role="status"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Messages</h2></div>
        <p class="hint" style="margin:0 0 10px">Scheduled messages can be cancelled before they go out. Delivered messages can be recalled, which removes them from users' notifications.</p>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Message</th><th>To</th><th>Delivery</th><th>Status</th><th></th></tr></thead>
          <tbody id="m-rows"></tbody>
        </table></div>
      </section>
    </div>

    <div id="atab-analytics" hidden>
      <section class="panel">
        <div class="toolbar">
          <select id="an-range" style="width:auto"><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7" selected>Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom range</option></select>
          <input id="an-from" type="date" style="width:auto" hidden><input id="an-to" type="date" style="width:auto" hidden>
          <button class="btn sm ghost" id="an-refresh" type="button">Refresh</button>
        </div>
        <p class="hint" id="an-note" style="margin:0 0 12px"></p>
        <div class="stat-grid" id="an-cards"></div>
        <div class="tabs" id="an-metrics" style="margin-bottom:10px">
          <button data-am="views" class="active">Page views</button><button data-am="visitors">Visitors</button><button data-am="sessions">Sessions</button><button data-am="signups">Sign-ups</button><button data-am="trades">Trades</button>
        </div>
        <div class="an-chart" id="an-chart"></div>
      </section>
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>Top pages</h2></div><div id="an-pages"></div></section>
        <section class="panel"><div class="panel-head"><h2>Audience</h2></div><div id="an-dev"></div></section>
      </div>
      <section class="panel"><div class="panel-head"><h2>Activity</h2></div><div id="an-events"></div></section>
    </div>

    <div id="atab-site" hidden>
      <section class="panel">
        <div class="panel-head"><h2>Plans</h2></div>
        <p class="hint" style="margin:0 0 12px">Shown on the public home page and in every user account. Plans are ordered by minimum balance.</p>
        <div id="pe-list"></div>
        <button class="btn ghost" id="pe-add" type="button" style="margin-top:12px">+ Add plan</button>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Brand &amp; options</h2></div>
        <label for="st-brand" style="margin-top:0">Brand name (replaces "Your Brand" on every page)</label><input id="st-brand" maxlength="40" placeholder="Your Brand">
        <label>Brand logo (square image)</label>
        <div class="logo-row"><span class="brand"><span class="mark lg" id="st-logo-prev"></span></span>
          <div class="head-actions"><button class="btn sm" id="st-logo-pick" type="button">Upload logo</button><button class="btn sm ghost" id="st-logo-del" type="button" hidden>Remove</button></div>
          <input id="st-logo-file" type="file" accept="image/*" hidden></div>
        <p class="hint" style="margin:6px 0 0">Shown before the brand name in the header and footer of every page, and as the browser-tab icon. It is cropped to a square.</p>
        <div class="form-grid">
          <div><label for="st-fee" style="margin-top:0">Upgrade fee (% of plan minimum)</label><input id="st-fee" type="number" min="0" step="any"></div>
          <div><label for="st-auto" style="margin-top:0">Auto-confirm deposits (seconds, 0 = admin approves)</label><input id="st-auto" type="number" min="0" step="1"></div>
          <div><label for="st-mind">Minimum deposit (USD)</label><input id="st-mind" type="number" min="0" step="any"></div>
          <div><label for="st-minw">Minimum withdrawal (USD)</label><input id="st-minw" type="number" min="0" step="any"></div>
        </div>
        <label for="st-tg">Telegram support link</label><input id="st-tg" placeholder="https://t.me/yourbrand_support">
      </section>
      <button class="btn full" id="st-save" type="button">Save site features</button>
      <div class="err" id="st-msg" role="status"></div>
    </div>

    <div class="drawer" id="user-drawer" hidden>
      <aside class="drawer-card" role="dialog" aria-modal="true" aria-label="User details">
        <div class="drawer-head"><div><h2 id="ud-title"></h2><small id="ud-sub"></small></div><button class="icon" id="ud-close" type="button" aria-label="Close">&times;</button></div>
        <section class="ud-manage">
          <h3 class="ud-h" style="margin-top:0">Balance</h3>
          <div class="form-grid">
            <div><label for="ud-amt" style="margin-top:0">Amount (USD)</label><input id="ud-amt" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00"></div>
            <div><label for="ud-reason" style="margin-top:0">Note to user (optional)</label><input id="ud-reason" maxlength="120" placeholder="Reason"></div>
          </div>
          <label class="chk"><input type="checkbox" id="ud-send-note" checked> Send the user a notification about this change</label>
          <div class="head-actions" style="margin-top:12px"><button class="btn" id="ud-credit" type="button">Top up balance</button><button class="btn ghost" id="ud-debit" type="button">Remove from balance</button></div>
          <h3 class="ud-h">Send a notification</h3>
          <input id="ud-ntitle" maxlength="80" placeholder="Title">
          <textarea id="ud-ntext" rows="2" maxlength="300" placeholder="Message" style="margin-top:8px"></textarea>
          <button class="btn" id="ud-notify" type="button" style="margin-top:10px">Send to this user</button>
          <div class="err" id="ud-msg" role="status"></div>
        </section>
        <section class="ud-manage" style="margin-top:18px">
          <h3 class="ud-h" id="ud-trading" style="margin-top:0">Trade on behalf of this user</h3>
          <p class="hint" style="margin:0 0 10px">Opens and closes trades on this user's account at the live price. Margin comes from their available cash, and leverage follows their plan.</p>
          <div class="form-grid">
            <div><label for="ud-t-asset" style="margin-top:0">Asset</label><select id="ud-t-asset"></select></div>
            <div><label for="ud-t-side" style="margin-top:0">Side</label><select id="ud-t-side"><option value="Buy">Buy (long)</option><option value="Sell">Sell (short)</option></select></div>
          </div>
          <label for="ud-t-amt">Margin amount (USD)</label><input id="ud-t-amt" type="number" min="0" step="any" inputmode="decimal" placeholder="0.00">
          <div class="kv"><span>Available cash</span><b id="ud-t-cash">—</b></div>
          <div class="kv"><span>Live price</span><b id="ud-t-price">—</b></div>
          <div class="kv"><span>Leverage</span><b id="ud-t-lev">—</b></div>
          <label class="chk"><input type="checkbox" id="ud-t-note" checked> Notify the user about trades I place or close</label>
          <button class="btn" id="ud-t-open" type="button" style="margin-top:12px">Open trade</button>
          <div class="err" id="ud-t-msg" role="status"></div>
          <h4 class="ud-h">Open positions</h4>
          <div id="ud-t-pos"></div>
        </section>
        <div id="ud-info"></div>
        <div class="head-actions" style="margin-top:22px"><button class="btn ghost" id="ud-unverify" type="button">Unverify user</button><button class="btn danger" id="ud-del" type="button">Delete this user</button></div>
      </aside>
    </div>"""
pages["admin.html"] = shell("Admin", "admin", '<div class="panel"></div><div class="panel"></div>', ' id="adm"', '<script defer src="admin-guard.js"></script>', " admin-lock", True)
open(os.path.join(OUT, "admin-ui.js"), "w").write("window.SDSS_ADMIN_HTML = " + json.dumps(admin_main) + ";\n")

# ---------- Admin sign-in (built from signin.html) ----------
src = open(os.path.join(OUT, "signin.html")).read() if os.path.exists(os.path.join(OUT, "signin.html")) else ""
if src:
    card = """<section class="card">
        <div class="view on" id="v-admin">
          <h2>Admin sign in</h2>
          <p class="sub">Authorized administrators only.</p>
          <form id="f-admin-login" novalidate>
            <label for="aem">Admin email</label>
            <input id="aem" type="email" autocomplete="email" placeholder="admin@yourbrand.com" />
            <label for="apw">Password</label>
            <div class="password-wrap">
              <input id="apw" type="password" autocomplete="current-password" placeholder="Enter your password" />
              <button type="button" class="password-toggle" aria-label="Show password"></button>
            </div>
            <div class="err" id="e-admin" role="alert"></div>
            <button class="btn full" type="submit">Sign in to admin</button>
          </form>
          <p class="alt"><a href="signin.html">Back to user sign in</a></p>
        </div>
      </section>"""
    out = re.sub(r'<section class="card">.*?</section>', card, src, count=1, flags=re.S)
    out = re.sub(r'<title>.*?</title>', '<title>Admin sign in</title>', out, count=1, flags=re.S)
    out = re.sub(r'<meta name="robots" content="[^"]*" />', '<meta name="robots" content="noindex,nofollow,noarchive" />', out)
    out = re.sub(r'\s*<link rel="canonical"[^>]*>|\s*<meta (?:property="og:|name="twitter:)[^>]*>|\s*<meta name="description"[^>]*>', '', out)
    pages["admin-login.html"] = out

for name, html in pages.items():
    open(os.path.join(OUT, name), "w").write(html)
print("built", list(pages))
