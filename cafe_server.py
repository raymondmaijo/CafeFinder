#!/usr/bin/env python3
"""
Global Cafe Finder - Python Backend
Run: python3 cafe_server.py
Serves on: http://localhost:8080
"""

import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

PORT = 8080
STATIC_DIR = Path(__file__).parent  # serve index.html, styles.css, script.js from same folder

USER_AGENT = "GlobalCafeFinderApp/1.0 (open-source educational project; github.com/cafe-finder)"

# ---------------------------------------------------------------------------
# Geocoding: tries Nominatim first, falls back to Photon (Komoot)
# Both are 100% free, no key required.
# ---------------------------------------------------------------------------
NOMINATIM_URL  = "https://nominatim.openstreetmap.org/search"
PHOTON_URL     = "https://photon.komoot.io/api/"
OVERPASS_URL   = "https://overpass-api.de/api/interpreter"


def http_get(url: str, timeout: int = 12) -> tuple[int, str]:
    """Perform a GET request. Returns (status_code, body_text)."""
    req = urllib.request.Request(url)
    req.add_header("User-Agent",      USER_AGENT)
    req.add_header("Accept",          "application/json")
    req.add_header("Accept-Language", "en")
    req.add_header("Accept-Encoding", "identity")  # avoid gzip so we can read raw
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        print(f"[HTTP {e.code}] {url[:80]}  body={body[:120]}", file=sys.stderr)
        return e.code, body
    except urllib.error.URLError as e:
        print(f"[URLError] {e.reason} -> {url[:80]}", file=sys.stderr)
        return 503, str(e.reason)
    except Exception as e:
        print(f"[ERROR] {e} -> {url[:80]}", file=sys.stderr)
        return 500, str(e)


def geocode_nominatim(query: str) -> tuple[int, str]:
    """Try Nominatim. Returns (status, json_body_string)."""
    params = urllib.parse.urlencode({
        "q":              query,
        "format":         "json",
        "limit":          "5",
        "addressdetails": "1",
    })
    url = f"{NOMINATIM_URL}?{params}"
    print(f"[geocode] Nominatim: {query!r}", file=sys.stderr)
    return http_get(url, timeout=10)


def geocode_photon(query: str) -> tuple[int, str]:
    """
    Fallback: Photon (photon.komoot.io) - OSM-based, always open.
    Returns GeoJSON FeatureCollection; we reshape it to look like Nominatim output.
    """
    params = urllib.parse.urlencode({"q": query, "limit": "5", "lang": "en"})
    url = f"{PHOTON_URL}?{params}"
    print(f"[geocode] Photon fallback: {query!r}", file=sys.stderr)
    status, body = http_get(url, timeout=10)
    if status != 200:
        return status, body

    try:
        data = json.loads(body)
        results = []
        for feat in data.get("features", []):
            props = feat.get("properties", {})
            coords = feat.get("geometry", {}).get("coordinates", [None, None])
            lon, lat = coords[0], coords[1]

            # Build a display name similar to Nominatim
            parts = [
                props.get("name", ""),
                props.get("city", "") or props.get("town", "") or props.get("village", ""),
                props.get("state", ""),
                props.get("country", ""),
            ]
            display_name = ", ".join(p for p in parts if p)

            results.append({
                "lat":          str(lat),
                "lon":          str(lon),
                "display_name": display_name or props.get("name", "Unknown"),
                "type":         props.get("osm_value", props.get("type", "")),
                "class":        props.get("osm_key", ""),
                "importance":   props.get("extent", 0),
            })
        return 200, json.dumps(results)
    except Exception as e:
        print(f"[Photon parse error] {e}", file=sys.stderr)
        return 500, json.dumps({"error": True, "message": f"Failed to parse Photon response: {e}"})


def geocode(query: str) -> tuple[int, str]:
    """Try Nominatim; on 403/429/5xx fall back to Photon automatically."""
    status, body = geocode_nominatim(query)
    if status == 200:
        return 200, body

    print(f"[geocode] Nominatim returned {status}, trying Photon fallback…", file=sys.stderr)
    return geocode_photon(query)


def fetch_cafes(lat: str, lon: str, radius: str) -> tuple[int, str]:
    """Query Overpass API for cafes around lat/lon within radius metres."""
    try:
        lat_f    = float(lat)
        lon_f    = float(lon)
        radius_i = min(int(float(radius)), 10000)
    except ValueError as e:
        return 400, json.dumps({"error": True, "message": f"Invalid parameter: {e}"})

    if not (-90 <= lat_f <= 90) or not (-180 <= lon_f <= 180):
        return 400, json.dumps({"error": True, "message": "Coordinates out of range."})

    query = (
        f"[out:json][timeout:30];"
        f"(node[\"amenity\"=\"cafe\"](around:{radius_i},{lat},{lon});"
        f"way[\"amenity\"=\"cafe\"](around:{radius_i},{lat},{lon}););"
        f"out center tags;"
    )
    params = urllib.parse.urlencode({"data": query})
    url    = f"{OVERPASS_URL}?{params}"
    print(f"[cafes] lat={lat} lon={lon} r={radius_i}m", file=sys.stderr)
    return http_get(url, timeout=30)


# ---------------------------------------------------------------------------
# HTTP request handler
# ---------------------------------------------------------------------------

MIME_TYPES = {
    ".html": "text/html; charset=UTF-8",
    ".css":  "text/css; charset=UTF-8",
    ".js":   "application/javascript; charset=UTF-8",
    ".json": "application/json; charset=UTF-8",
    ".ico":  "image/x-icon",
    ".png":  "image/png",
    ".svg":  "image/svg+xml",
}


class CafeHandler(BaseHTTPRequestHandler):

    # ── silence default request logging (we do our own) ─────────────────────
    def log_message(self, fmt, *args):
        print(f"[{self.command}] {self.path}", file=sys.stderr)

    # ── helpers ──────────────────────────────────────────────────────────────

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json_response(self, status: int, body: str):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type",   "application/json; charset=UTF-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _json_error(self, status: int, message: str):
        body = json.dumps({"error": True, "message": message, "status": status})
        self._json_response(status, body)

    def _parse_qs(self) -> dict:
        parsed = urllib.parse.urlparse(self.path)
        return urllib.parse.parse_qs(parsed.query, keep_blank_values=False)

    def _qparam(self, qs: dict, key: str, default: str = None) -> str | None:
        vals = qs.get(key)
        if vals:
            return vals[0]
        return default

    # ── routing ──────────────────────────────────────────────────────────────

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path).path

        if parsed_path == "/api/geocode":
            self._handle_geocode()
        elif parsed_path == "/api/cafes":
            self._handle_cafes()
        else:
            self._handle_static(parsed_path)

    # ── /api/geocode ─────────────────────────────────────────────────────────

    def _handle_geocode(self):
        qs    = self._parse_qs()
        query = self._qparam(qs, "q", "").strip()

        if not query:
            self._json_error(400, "Missing required parameter: q")
            return
        if len(query) > 200:
            self._json_error(400, "Query too long (max 200 chars)")
            return

        status, body = geocode(query)

        if status == 200:
            self._json_response(200, body)
        elif status == 429:
            self._json_error(429, "Geocoding rate limit reached. Please wait a moment.")
        elif status == 503:
            self._json_error(503, "Geocoding service unreachable. Check your internet connection.")
        else:
            self._json_error(502, f"Geocoding failed (upstream status {status}).")

    # ── /api/cafes ────────────────────────────────────────────────────────────

    def _handle_cafes(self):
        qs     = self._parse_qs()
        lat    = self._qparam(qs, "lat", "")
        lon    = self._qparam(qs, "lon", "")
        radius = self._qparam(qs, "radius", "1500")

        if not lat or not lon:
            self._json_error(400, "Missing required parameters: lat and lon")
            return

        status, body = fetch_cafes(lat, lon, radius)

        if status == 200:
            self._json_response(200, body)
        elif status == 429:
            self._json_error(429, "Overpass rate limit hit. Try again in a moment.")
        elif status == 504 or status == 503:
            self._json_error(504, "Overpass API timed out or unreachable.")
        else:
            self._json_error(502, f"Overpass API returned status {status}.")

    # ── static files ──────────────────────────────────────────────────────────

    def _handle_static(self, path: str):
        # safety: strip leading slash, prevent path traversal
        rel = path.lstrip("/") or "index.html"
        if ".." in rel:
            self.send_response(403)
            self.end_headers()
            return

        file_path = STATIC_DIR / rel
        if not file_path.exists() or not file_path.is_file():
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"404 Not Found")
            return

        suffix    = file_path.suffix.lower()
        mime      = MIME_TYPES.get(suffix, "application/octet-stream")
        data      = file_path.read_bytes()

        self.send_response(200)
        self.send_header("Content-Type",   mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    server = HTTPServer(("", PORT), CafeHandler)
    print(f"")
    print(f"  ╔══════════════════════════════════════╗")
    print(f"  ║   Global Cafe Finder — Python Server ║")
    print(f"  ║   http://localhost:{PORT}              ║")
    print(f"  ║   Press Ctrl+C to stop               ║")
    print(f"  ╚══════════════════════════════════════╝")
    print(f"")
    print(f"  Geocoding: Nominatim → Photon fallback")
    print(f"  Cafes:     OpenStreetMap Overpass API")
    print(f"  Static:    {STATIC_DIR}")
    print(f"")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
        server.server_close()