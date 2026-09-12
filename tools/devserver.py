#!/usr/bin/env python3
"""
Entwicklungsserver für LiftLog.

Das einfache `http.server` lässt den Browser ES-Module cachen, eine geänderte Datei läuft
dann mit der alten Version weiter, bis der Cache zufällig abläuft. Damit ist jede Prüfung,
die man macht, still wertlos. Dieser hier schickt no-store für alles.

In Produktion (GitHub Pages) gelten eigene Cache-Header, diese Datei ist nur für die
Entwicklung.

    python3 tools/devserver.py [port]

Der Port kommt aus dem Argument, sonst aus $PORT, sonst 5173. So können zwei davon
nebeneinander laufen, wenn schon etwas anderes den Standard belegt.
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
        # Die Konsole lesbar halten, Fehler kommen weiter über log_error.
        if args and str(args[0]).startswith(("GET", "HEAD")) and "200" in str(args):
            return
        super().log_message(fmt, *args)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 5173))
    handler = partial(NoCacheHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"LiftLog Entwicklungsserver auf http://localhost:{port}  (no-store)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
