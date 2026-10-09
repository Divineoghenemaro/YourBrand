#!/usr/bin/env python3
"""One-command setup: set your live URL (for Google), brand name and Supabase keys.

  python3 tools/setup-site.py --url https://www.example.com --brand "Acme Capital" \
          --supabase-url https://abcd.supabase.co --anon-key eyJ...

Safe to run again; it remembers what it replaced last time (tools/.site.json).
"""
import argparse, datetime, json, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
state_file = pathlib.Path(__file__).resolve().parent / ".site.json"
state = json.loads(state_file.read_text()) if state_file.exists() else {}

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--url", help="public address of the site, e.g. https://www.example.com (no trailing slash needed)")
ap.add_argument("--brand", help='brand name, e.g. "Acme Capital"')
ap.add_argument("--supabase-url", help="Supabase Project URL")
ap.add_argument("--anon-key", help="Supabase anon public key")
a = ap.parse_args()
if not any([a.url, a.brand, a.supabase_url, a.anon_key]):
    ap.print_help(); sys.exit(1)

def edit(path, fn):
    p = root / path
    if not p.exists(): return
    t = p.read_text(encoding="utf-8"); n = fn(t)
    if n != t: p.write_text(n, encoding="utf-8")

html = sorted(root.glob("*.html"))
seo_files = html + [root / n for n in ("robots.txt", "sitemap.xml", "manifest.webmanifest")]

if a.url:
    url = a.url.rstrip("/")
    if not re.match(r"^https?://", url): sys.exit("--url must start with https://")
    prev = state.get("url", "https://YOUR-DOMAIN")
    for f in seo_files: edit(f.name, lambda t: t.replace(prev, url))
    today = datetime.date.today().isoformat()
    edit("sitemap.xml", lambda t: re.sub(r"(<loc>[^<]+</loc>)(?:<lastmod>[^<]*</lastmod>)?", r"\1<lastmod>%s</lastmod>" % today, t))
    state["url"] = url
    print("✓ URL set to", url)
    if re.match(r"^https://[^/]+/[^/]+", url):
        print("  note: Google only reads robots.txt/sitemap.xml at the root of a domain. For a project site (user.github.io/repo) use a custom domain or a user site.")

if a.brand:
    prev = state.get("brand", "Your Brand")
    for f in html + [root / "manifest.webmanifest", root / "sitemap.xml"]: edit(f.name, lambda t: t.replace(prev, a.brand))
    edit("supabase.js", lambda t: t.replace('brand: "%s"' % prev, 'brand: "%s"' % a.brand))
    state["brand"] = a.brand
    print("✓ Brand set to", a.brand)

if a.supabase_url or a.anon_key:
    def cfg(t):
        if a.supabase_url: t = re.sub(r'URL:\s*"[^"]*"', 'URL: "%s"' % a.supabase_url.rstrip("/"), t, count=1)
        if a.anon_key: t = re.sub(r'ANON_KEY:\s*"[^"]*"', 'ANON_KEY: "%s"' % a.anon_key, t, count=1)
        return t
    edit("sb-config.js", cfg)
    print("✓ Supabase keys written to sb-config.js")

state_file.write_text(json.dumps(state, indent=2))
print("\nNext: commit and push, then open status.html on your live site to check the connection.")
