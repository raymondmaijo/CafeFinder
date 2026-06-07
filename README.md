Global Cafe Finder
Zero API keys. Zero registration. 100% free and open source.
Requirements

Python 3.8+ (uses only stdlib — no pip installs needed)
A browser

Quick Start
Put all four files in the same folder:
cafe-finder/
├── cafe_server.py   ← Python backend (replaces Java)
├── index.html
├── styles.css
└── script.js
Then run:
bash
python3 cafe_server.py

Open your browser at:
http://localhost:8080

How It Works
LayerTechBackendPython 3 http.server — no frameworks, no dependenciesGeocodingNominatim (OSM) → auto-falls back to Photon (Komoot)Cafe dataOpenStreetMap Overpass APIMapLeaflet.js + OpenStreetMap tiles
