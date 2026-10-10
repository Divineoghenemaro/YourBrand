#!/usr/bin/env python3
"""Add ?v=<version> to every local script/style/icon link so browsers (and GitHub Pages' CDN)
never serve a stale copy after you push an update.

  python3 tools/bump-version.py                 # version = current time
  python3 tools/bump-version.py --version abc1  # e.g. a git commit id (the deploy workflow does this)
"""
import argparse, pathlib, re, time

root = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--version", default=time.strftime("%Y%m%d%H%M%S"))
v = ap.parse_args().version
pat = re.compile(r'((?:src|href)=")((?!https?:|//|#|data:|mailto:|tel:)[\w\-./]+\.(?:js|css|svg|webmanifest))(?:\?v=[^"]*)?(")')
n = 0
for f in root.glob("*.html"):
    t = f.read_text(encoding="utf-8")
    new = pat.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}", t)
    if new != t:
        f.write_text(new, encoding="utf-8"); n += 1
print(f"version {v} applied to {n} page(s)")
