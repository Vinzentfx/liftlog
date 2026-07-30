#!/usr/bin/env python3
"""
Dev server for LiftLog.

Plain `http.server` lets the browser cache ES modules, so an edited file keeps
running the old version until the cache happens to expire — which silently
invalidates any verification you do. This sends no-store on everything.

Production (GitHub Pages) sets its own caching headers; this file is dev-only.

    python3 tools/devserver.py [port]

The port comes from the argument, else $PORT, else 5173 — so two of these can
run side by side when something else already holds the default.
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
        ".json": "application/json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep the console readable; errors still surface via log_error.
        if args and str(args[0]).startswith(("GET", "HEAD")) and "200" in str(args):
            return
        super().log_message(fmt, *args)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 5173))
    handler = partial(NoCacheHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"LiftLog dev server → http://localhost:{port}  (no-store)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
