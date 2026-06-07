const API_BASE = 'http://localhost:8080';
const DEFAULT_LAT = 20;
const DEFAULT_LNG = 0;
const DEFAULT_ZOOM = 3;
const CAFE_RADIUS = 1500;
const DEBOUNCE_MS = 400;

const $searchInput  = document.getElementById('searchInput');
const $suggestions  = document.getElementById('suggestions');
const $clearBtn     = document.getElementById('clearBtn');
const $geoBtn       = document.getElementById('geoBtn');
const $spinner      = document.getElementById('spinner');
const $cafeCount    = document.getElementById('cafeCount');

let map;
let cafeLayerGroup;
let debounceTimer = null;
let currentCafeMarkers = [];

function initMap() {
  map = L.map('map', {
    center: [DEFAULT_LAT, DEFAULT_LNG],
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  cafeLayerGroup = L.layerGroup().addTo(map);

  map.on('click', closeSuggestions);
}

function showSpinner() {
  $spinner.classList.add('active');
}

function hideSpinner() {
  $spinner.classList.remove('active');
}

function updateCafeCount(count) {
  if (count === null) {
    $cafeCount.hidden = true;
    return;
  }
  $cafeCount.hidden = false;
  $cafeCount.innerHTML = `<strong>${count}</strong> café${count !== 1 ? 's' : ''} nearby`;
}

function openSuggestions() {
  $suggestions.classList.add('open');
}

function closeSuggestions() {
  $suggestions.classList.remove('open');
}

function clearSuggestions() {
  $suggestions.innerHTML = '';
  closeSuggestions();
}

function buildSuggestionIcon() {
  return `<svg class="suggestion-pin" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>`;
}

function renderSuggestions(results) {
  clearSuggestions();
  if (!results || results.length === 0) {
    $suggestions.innerHTML = `<li class="no-results" role="option" aria-disabled="true">No results found</li>`;
    openSuggestions();
    return;
  }
  results.forEach((place, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('id', `suggestion-${i}`);
    const typeLabel = place.type || place.class || '';
    li.innerHTML = `
      ${buildSuggestionIcon()}
      <span class="suggestion-text">${escapeHtml(place.display_name)}</span>
      ${typeLabel ? `<span class="suggestion-type">${escapeHtml(typeLabel)}</span>` : ''}
    `;
    li.addEventListener('click', () => selectPlace(place));
    $suggestions.appendChild(li);
  });
  openSuggestions();
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function selectPlace(place) {
  const lat = parseFloat(place.lat);
  const lon = parseFloat(place.lon);
  $searchInput.value = place.display_name;
  $clearBtn.hidden = false;
  clearSuggestions();
  flyAndFetchCafes(lat, lon);
}

function flyAndFetchCafes(lat, lon, zoom = 15) {
  map.flyTo([lat, lon], zoom, { duration: 1.2, easeLinearity: 0.4 });
  map.once('moveend', () => fetchCafes(lat, lon));
}

async function fetchGeocoding(query) {
  const res = await fetch(`${API_BASE}/api/geocode?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Geocoding failed (${res.status})`);
  }
  return res.json();
}

async function fetchCafes(lat, lon) {
  showSpinner();
  cafeLayerGroup.clearLayers();
  currentCafeMarkers = [];
  updateCafeCount(null);

  try {
    const res = await fetch(`${API_BASE}/api/cafes?lat=${lat}&lon=${lon}&radius=${CAFE_RADIUS}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Cafe fetch failed (${res.status})`);
    }
    const data = await res.json();
    const elements = data.elements || [];
    renderCafeMarkers(elements);
    updateCafeCount(elements.length);
  } catch (err) {
    console.error('Cafe fetch error:', err);
    updateCafeCount(0);
    showToast(`Could not load cafes: ${err.message}`);
  } finally {
    hideSpinner();
  }
}

function buildCafeMarkerSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">
    <defs>
      <filter id="ds" x="-20%" y="-10%" width="140%" height="130%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.55)"/>
      </filter>
    </defs>
    <path d="M17 2C9.82 2 4 7.82 4 15c0 9.25 13 25 13 25s13-15.75 13-25C30 7.82 24.18 2 17 2z"
      fill="#f5e642" filter="url(#ds)"/>
    <circle cx="17" cy="15" r="7" fill="#0d0d0d"/>
    <text x="17" y="20" text-anchor="middle" font-size="10" fill="#f5e642" font-family="sans-serif">☕</text>
  </svg>`;
}

function createCafeIcon() {
  return L.divIcon({
    html: buildCafeMarkerSvg(),
    className: '',
    iconSize: [34, 42],
    iconAnchor: [17, 42],
    popupAnchor: [0, -44],
  });
}

function buildPopupHtml(tags) {
  const name = tags.name || 'Unnamed Café';
  const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']]
    .filter(Boolean).join(' ') || null;
  const phone = tags.phone || tags['contact:phone'] || null;
  const website = tags.website || tags['contact:website'] || null;
  const opening = tags.opening_hours || null;
  const wifi = tags.internet_access || null;
  const cuisine = tags.cuisine || null;

  const pinIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const phoneIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3.08 4.18 2 2 0 0 1 5.07 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L9.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 23 17z"/></svg>`;
  const clockIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  const webIcon  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  const wifiIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>`;

  let body = '';
  if (address)  body += `<div class="cafe-popup-row">${pinIcon}<span>${escapeHtml(address)}</span></div>`;
  if (phone)    body += `<div class="cafe-popup-row">${phoneIcon}<span>${escapeHtml(phone)}</span></div>`;
  if (opening)  body += `<div class="cafe-popup-row">${clockIcon}<span>${escapeHtml(opening)}</span></div>`;
  if (website)  body += `<div class="cafe-popup-row">${webIcon}<span><a href="${escapeHtml(website)}" target="_blank" rel="noopener" style="color:var(--accent-dim)">${escapeHtml(website.replace(/^https?:\/\//, ''))}</a></span></div>`;
  if (wifi)     body += `<div class="cafe-popup-row">${wifiIcon}<span>WiFi: ${escapeHtml(wifi)}</span></div>`;
  if (cuisine)  body += `<span class="cafe-popup-tag">${escapeHtml(cuisine)}</span>`;

  return `<div class="cafe-popup">
    <div class="cafe-popup-header">${escapeHtml(name)}</div>
    ${body ? `<div class="cafe-popup-body">${body}</div>` : ''}
  </div>`;
}

function renderCafeMarkers(elements) {
  const icon = createCafeIcon();
  elements.forEach(el => {
    const lat = el.type === 'way' ? el.center?.lat : el.lat;
    const lon = el.type === 'way' ? el.center?.lon : el.lon;
    if (lat == null || lon == null) return;
    const tags = el.tags || {};
    const marker = L.marker([lat, lon], { icon })
      .bindPopup(buildPopupHtml(tags), {
        maxWidth: 280,
        className: '',
      });
    cafeLayerGroup.addLayer(marker);
    currentCafeMarkers.push(marker);
  });
}

let toastTimer;
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);
      background:var(--surface);border:1.5px solid var(--coral);border-radius:8px;
      color:var(--text);font-family:var(--font-mono);font-size:12px;padding:10px 18px;
      z-index:3000;box-shadow:0 4px 20px rgba(0,0,0,0.5);
      transition:transform 0.3s ease,opacity 0.3s ease;opacity:0;
      max-width:calc(100vw - 40px);text-align:center;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  requestAnimationFrame(() => {
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(80px)';
    toast.style.opacity = '0';
  }, 3500);
}

$searchInput.addEventListener('input', () => {
  const val = $searchInput.value.trim();
  $clearBtn.hidden = val.length === 0;

  clearTimeout(debounceTimer);

  if (val.length < 2) {
    clearSuggestions();
    return;
  }

  debounceTimer = setTimeout(async () => {
    try {
      const results = await fetchGeocoding(val);
      renderSuggestions(results);
    } catch (err) {
      console.error('Geocoding error:', err);
      clearSuggestions();
      showToast(`Search error: ${err.message}`);
    }
  }, DEBOUNCE_MS);
});

$searchInput.addEventListener('keydown', (e) => {
  const items = $suggestions.querySelectorAll('li:not(.no-results)');
  if (!items.length) return;
  const current = $suggestions.querySelector('[aria-selected="true"]');
  let idx = current ? [...items].indexOf(current) : -1;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (current) current.removeAttribute('aria-selected');
    idx = (idx + 1) % items.length;
    items[idx].setAttribute('aria-selected', 'true');
    items[idx].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (current) current.removeAttribute('aria-selected');
    idx = (idx - 1 + items.length) % items.length;
    items[idx].setAttribute('aria-selected', 'true');
    items[idx].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const selected = $suggestions.querySelector('[aria-selected="true"]');
    if (selected) selected.click();
    else if (items.length === 1) items[0].click();
  } else if (e.key === 'Escape') {
    closeSuggestions();
    $searchInput.blur();
  }
});

$clearBtn.addEventListener('click', () => {
  $searchInput.value = '';
  $clearBtn.hidden = true;
  clearSuggestions();
  cafeLayerGroup.clearLayers();
  updateCafeCount(null);
  $searchInput.focus();
});

$geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  $geoBtn.classList.add('locating');
  showSpinner();

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $geoBtn.classList.remove('locating');
      const { latitude: lat, longitude: lon } = pos.coords;
      map.flyTo([lat, lon], 15, { duration: 1.2 });
      map.once('moveend', () => fetchCafes(lat, lon));
    },
    (err) => {
      $geoBtn.classList.remove('locating');
      hideSpinner();
      const messages = {
        1: 'Location access denied. Please allow location in browser settings.',
        2: 'Location unavailable. Try again.',
        3: 'Location request timed out.',
      };
      showToast(messages[err.code] || 'Could not get your location.');
    },
    { timeout: 10000, maximumAge: 60000 }
  );
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) {
    closeSuggestions();
  }
});

initMap();
