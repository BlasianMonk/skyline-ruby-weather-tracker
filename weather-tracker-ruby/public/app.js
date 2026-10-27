'use strict';

/* Skyline's browser layer. All weather/API persistence runs through the Ruby backend. */
const $ = (id) => document.getElementById(id);
const state = {
  places: [], activePlaceId: null, weather: null, history: [],
  unit: readPref('skyline-unit', 'F') === 'C' ? 'C' : 'F',
  historyDays: 14, searchResults: [], requestToken: 0
};
let searchTimer;
let searchSeq = 0;
let toastTimer;

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (_) { /* private mode */ }
}
async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Accept': 'application/json', ...options.headers }, ...options });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { throw new Error('The server returned an invalid response.'); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function text(id, value) { $(id).textContent = value == null ? '—' : String(value); }
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function toast(message) {
  text('toast', message); show('toast'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide('toast'), 4500);
}
function flash(message) { text('flash', message); show('flash'); }
function clearFlash() { hide('flash'); }
function degrees(value) {
  return typeof value === 'number' ? Math.round(state.unit === 'F' ? value * 9 / 5 + 32 : value) : '—';
}
function wind(value) {
  return typeof value === 'number' ? Math.round(state.unit === 'F' ? value / 1.609344 : value) : '—';
}
function precipitation(value) {
  return typeof value === 'number' ? (state.unit === 'F' ? value / 25.4 : value).toFixed(state.unit === 'F' ? 2 : 1) : '—';
}
function tempUnit() { return state.unit === 'F' ? '°F' : '°C'; }
function shortRegion(place) { return [place.admin1, place.country].filter(Boolean).join(', '); }
function num(value, fallback = '—') { return typeof value === 'number' ? Math.round(value) : fallback; }
function clipPercent(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }
function clockFromCityTime(value) {
  if (!value || !value.includes('T')) return '—';
  const [hourText, minText] = value.split('T')[1].split(':');
  const hour = Number(hourText), minute = Number(minText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '—';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
function hourLabel(value) {
  if (!value || !value.includes('T')) return '—';
  const hour = Number(value.slice(11, 13));
  return `${hour % 12 || 12}${hour >= 12 ? 'p' : 'a'}`;
}
function dayLabel(isoDate, options = { weekday: 'short' }) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${isoDate}T12:00:00Z`));
}
function observationLabel(isoTimestamp, short = false) {
  const place = state.places.find((p) => p.id === state.activePlaceId);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: place?.timezone || 'UTC', month: 'short', day: 'numeric',
      ...(short ? {} : { hour: 'numeric', minute: '2-digit' })
    }).format(new Date(isoTimestamp));
  } catch (_) { return new Date(isoTimestamp).toLocaleDateString('en-US'); }
}

const SUN = '<circle cx="55" cy="51" r="17" fill="#F4CA71"/><g stroke="#F9D78F" stroke-width="4" stroke-linecap="round"><path d="M55 22v-8M55 88v-8M26 51h-8M92 51h-8M34 30l-6-6M82 78l-6-6M76 30l6-6M28 78l6-6"/></g>';
const MOON = '<path d="M65 17a30 30 0 1 0 27 44A32 32 0 0 1 65 17Z" fill="#D9E3FF"/><circle cx="40" cy="40" r="3" fill="#AEBFF1"/>';
const CLOUD = '<path d="M28 81c-13 0-22-9-22-20 0-11 9-20 20-20 3 0 6 0 8 1 4-15 16-25 32-25 18 0 32 12 34 28 11 1 19 10 19 21 0 12-10 22-23 22H28Z" fill="#E6F0FF"/><path d="M29 81c-11 0-19-8-19-18s8-18 18-18c4 0 7 1 10 3 3-15 16-26 31-26 17 0 30 12 31 27" fill="none" stroke="#BAD1F0" stroke-width="3" opacity=".8"/>';
const RAIN = '<g stroke="#80D4F8" stroke-linecap="round" stroke-width="6"><path d="M30 94l-6 12M58 94l-6 12M86 94l-6 12"/></g>';
const SNOW = '<g stroke="#BDEBFF" stroke-linecap="round" stroke-width="3"><path d="M29 96v16M21 104h16M58 96v16M50 104h16M87 96v16M79 104h16"/></g>';
const STORM = '<path d="M63 83 48 106h14l-7 21 29-33H67l9-11Z" fill="#F2C26D"/>';
const FOG = '<g stroke="#C6D8EF" stroke-linecap="round" stroke-width="5" opacity=".8"><path d="M19 94h80M30 108h63"/></g>';
function iconSvg(code, isDay = true) {
  let pieces = '';
  if (code === 0) pieces = isDay ? SUN : MOON;
  else if ([1, 2].includes(code)) pieces = `${isDay ? SUN : MOON}<g transform="translate(9 20) scale(.82)">${CLOUD}</g>`;
  else if ([45, 48].includes(code)) pieces = CLOUD + FOG;
  else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) pieces = `<g transform="translate(0 -10)">${CLOUD}</g>` + RAIN;
  else if ([71, 73, 75, 77, 85, 86].includes(code)) pieces = `<g transform="translate(0 -10)">${CLOUD}</g>` + SNOW;
  else if ([95, 96, 99].includes(code)) pieces = `<g transform="translate(0 -10)">${CLOUD}</g>` + STORM;
  else pieces = CLOUD;
  // Only predetermined SVG fragments are used; API values cannot inject markup.
  return `<svg viewBox="0 0 128 136" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true">${pieces}</svg>`;
}
function condition(code) {
  const map = {
    0: 'Clear skies', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain',
    65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow',
    73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers',
    81: 'Rain showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorms', 96: 'Thunderstorm & hail', 99: 'Thunderstorm & hail'
  };
  return map[code] || 'Changing conditions';
}
function uvDescription(value) {
  if (typeof value !== 'number') return '—';
  return value < 3 ? 'LOW' : value < 6 ? 'MODERATE' : value < 8 ? 'HIGH' : value < 11 ? 'VERY HIGH' : 'EXTREME';
}

function renderUnits() {
  $('unit-f').classList.toggle('active', state.unit === 'F');
  $('unit-c').classList.toggle('active', state.unit === 'C');
  $('unit-f').setAttribute('aria-pressed', String(state.unit === 'F'));
  $('unit-c').setAttribute('aria-pressed', String(state.unit === 'C'));
}
function renderPlaces() {
  const list = $('places-list');
  list.replaceChildren();
  text('location-count', state.places.length);
  if (!state.places.length) {
    const note = document.createElement('div');
    note.className = 'no-places';
    note.textContent = 'Search above to save your first location.';
    list.append(note);
    return;
  }
  for (const place of state.places) {
    const wrapper = document.createElement('div');
    wrapper.className = 'place-wrapper';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `place-item${state.activePlaceId === place.id ? ' selected' : ''}`;
    const pin = document.createElement('span'); pin.className = 'place-pin'; pin.textContent = '⌖';
    const label = document.createElement('span'); label.className = 'place-label';
    const name = document.createElement('span'); name.className = 'place-name'; name.textContent = place.name;
    const detail = document.createElement('span'); detail.className = 'place-detail'; detail.textContent = place.admin1 || place.country;
    label.append(name, detail);
    const temperature = document.createElement('span'); temperature.className = 'place-temp';
    temperature.textContent = typeof place.last_temperature === 'number' ? `${degrees(place.last_temperature)}°` : '';
    button.append(pin, label, temperature);
    button.addEventListener('click', () => selectPlace(place.id));
    const remove = document.createElement('button');
    remove.className = 'remove-place'; remove.type = 'button'; remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${place.name}`); remove.title = `Remove ${place.name}`;
    remove.addEventListener('click', () => removePlace(place));
    wrapper.append(button, remove); list.append(wrapper);
  }
}
function renderWeather() {
  const place = state.places.find((p) => p.id === state.activePlaceId);
  const weather = state.weather;
  if (!place || !weather) return;
  const now = weather.current;
  const today = weather.daily[0] || {};
  text('hero-city', place.name);
  text('hero-region', shortRegion(place));
  text('hero-temperature', degrees(now.temperature));
  text('hero-degree', tempUnit());
  text('hero-condition', condition(now.code));
  text('hero-feels', `Feels like ${degrees(now.feels_like)}${tempUnit()}`);
  text('hero-summary', `It's ${condition(now.code).toLowerCase()} in ${place.name} right now.`);
  $('hero-icon').innerHTML = iconSvg(now.code, now.is_day !== 0);
  text('metric-humidity', `${num(now.humidity)}%`);
  $('humidity-bar').style.width = `${clipPercent(now.humidity)}%`;
  text('metric-wind', `${wind(now.wind)} ${state.unit === 'F' ? 'mph' : 'km/h'}`);
  text('metric-rain', `${precipitation(now.precipitation)} ${state.unit === 'F' ? 'in' : 'mm'}`);
  text('metric-uv', typeof today.uv_max === 'number' ? today.uv_max.toFixed(1) : '—');
  text('uv-label', uvDescription(today.uv_max));
  text('sunrise-time', clockFromCityTime(today.sunrise));
  text('sunset-time', clockFromCityTime(today.sunset));
  text('rain-probability', `${num(today.rain_chance)}%`);
  $('rain-bar').style.width = `${clipPercent(today.rain_chance)}%`;
  renderHourly(weather.hourly);
  renderForecast(weather.daily);
  renderHistory();
}
function renderForecast(days) {
  const grid = $('forecast-list'); grid.replaceChildren();
  days.forEach((day, index) => {
    const cell = document.createElement('div'); cell.className = 'day-card';
    const name = document.createElement('div'); name.className = 'day-name'; name.textContent = index === 0 ? 'Today' : dayLabel(day.date);
    const date = document.createElement('div'); date.className = 'day-date'; date.textContent = dayLabel(day.date, { month: 'short', day: 'numeric' });
    const icon = document.createElement('div'); icon.className = 'day-icon'; icon.innerHTML = iconSvg(day.code, true);
    const temps = document.createElement('div'); temps.className = 'day-temps';
    const high = document.createElement('span'); high.textContent = `${degrees(day.high)}°`;
    const low = document.createElement('span'); low.className = 'low'; low.textContent = `${degrees(day.low)}°`;
    temps.append(high, low);
    const rain = document.createElement('div'); rain.className = 'day-rain'; rain.textContent = `☂ ${num(day.rain_chance)}%`;
    cell.title = `${condition(day.code)} · High ${degrees(day.high)}°, low ${degrees(day.low)}°`;
    cell.append(name, date, icon, temps, rain); grid.append(cell);
  });
}

const NS = 'http://www.w3.org/2000/svg';
function svgElement(tag, attrs = {}, content = undefined) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  if (content !== undefined) el.textContent = content;
  return el;
}
function lineGraph(container, values, labels, graphId, countLabels = 7) {
  container.replaceChildren();
  if (!values.length) return;
  const width = 900, height = 210, left = 48, right = 20, top = 26, bottom = 36;
  const w = width - left - right, h = height - top - bottom;
  const min = Math.floor(Math.min(...values) - 2), max = Math.ceil(Math.max(...values) + 2);
  const span = max - min || 4;
  const x = (i) => left + (i / Math.max(1, values.length - 1)) * w;
  const y = (v) => top + h - ((v - min) / span) * h;
  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Temperature graph' });
  const defs = svgElement('defs');
  const gradient = svgElement('linearGradient', { id: graphId, x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.append(svgElement('stop', { offset: '0%', 'stop-color': '#8bb1ff', 'stop-opacity': '.30' }), svgElement('stop', { offset: '100%', 'stop-color': '#8bb1ff', 'stop-opacity': '0' }));
  defs.append(gradient); svg.append(defs);
  for (let i = 0; i <= 3; i++) {
    const v = min + span * i / 3;
    const gy = y(v);
    svg.append(svgElement('line', { x1: left, y1: gy, x2: width - right, y2: gy, stroke: '#2b3d52', 'stroke-width': 1, 'stroke-dasharray': '4 6' }));
    svg.append(svgElement('text', { x: 5, y: gy + 4, class: 'chart-axis' }, `${degrees(v)}°`));
  }
  const pts = values.map((v, i) => [x(i), y(v)]);
  const path = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(2)} ${py.toFixed(2)}`).join(' ');
  const area = `${path} L${x(values.length - 1)} ${top + h} L${x(0)} ${top + h} Z`;
  svg.append(svgElement('path', { d: area, fill: `url(#${graphId})` }));
  svg.append(svgElement('path', { d: path, fill: 'none', stroke: '#9db9ff', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  const step = Math.max(1, Math.ceil((values.length - 1) / (countLabels - 1)));
  pts.forEach(([px, py], index) => {
    if (index % step !== 0 && index !== values.length - 1) return;
    svg.append(svgElement('circle', { cx: px, cy: py, r: 4.5, fill: '#a5c5ff', stroke: '#17283e', 'stroke-width': 3 }));
    svg.append(svgElement('text', { x: px, y: height - 7, class: 'chart-axis', 'text-anchor': 'middle' }, labels[index]));
  });
  container.append(svg);
}
function renderHourly(hours) {
  const valid = hours.filter((hour) => typeof hour.temperature === 'number');
  lineGraph($('hourly-chart'), valid.map((hour) => hour.temperature), valid.map((hour) => hourLabel(hour.time)), 'hourly-fill', 8);
}
function renderHistory() {
  const container = $('history-chart');
  const observations = state.history.filter((row) => typeof row.temperature === 'number');
  if (observations.length < 2) {
    container.replaceChildren();
    const empty = document.createElement('div'); empty.className = 'history-empty';
    const title = document.createElement('strong'); title.textContent = observations.length ? 'Your first reading is saved!' : 'No recorded weather yet';
    const description = document.createElement('span');
    description.textContent = 'Return in another hour or schedule the capture script to build a temperature trend.';
    empty.append(title, description); container.append(empty);
    return;
  }
  lineGraph(container, observations.map((row) => row.temperature), observations.map((row) => observationLabel(row.recorded_at, true)), 'history-fill', 7);
}
function setView(mode) {
  for (const id of ['dashboard', 'empty-state', 'loading']) hide(id);
  show(mode);
}
async function loadPlaces() {
  const data = await api('/api/places');
  state.places = data.places;
  const storedId = Number(readPref('skyline-place', 0));
  const place = state.places.find((p) => p.id === state.activePlaceId) ||
    state.places.find((p) => p.id === storedId) || state.places[0];
  state.activePlaceId = place?.id || null;
  renderPlaces();
  if (place) await selectPlace(place.id);
  else setView('empty-state');
}
async function selectPlace(id) {
  if (!state.places.some((p) => p.id === id)) return;
  state.activePlaceId = id; state.history = []; savePref('skyline-place', id);
  $('export-history').href = `/api/places/${id}/history.csv?days=${state.historyDays}`;
  const token = ++state.requestToken;
  renderPlaces(); clearFlash(); setView('loading');
  $('sidebar').classList.remove('open'); $('mobile-shade').classList.remove('open');
  try {
    const data = await api(`/api/places/${id}/weather`);
    if (state.requestToken !== token) return;
    state.weather = data.weather;
    const place = state.places.find((p) => p.id === id);
    if (place) place.last_temperature = data.weather.current.temperature;
    renderPlaces();
    text('last-updated', `Updated ${observationLabel(data.fetched_at)} · ${data.weather.timezone_abbreviation || 'local'}`);
    renderWeather(); setView('dashboard');
    await loadHistory(id, token);
  } catch (error) {
    if (state.requestToken !== token) return;
    setView('empty-state'); flash(error.message);
  }
}
async function loadHistory(id, token = state.requestToken) {
  try {
    const data = await api(`/api/places/${id}/history?days=${state.historyDays}`);
    if (token !== state.requestToken) return;
    state.history = data.snapshots;
    renderHistory();
  } catch (error) { toast(`History unavailable: ${error.message}`); }
}
async function removePlace(place) {
  if (!confirm(`Remove ${place.name} and its recorded history?`)) return;
  try {
    await api(`/api/places/${place.id}`, { method: 'DELETE' });
    state.places = state.places.filter((p) => p.id !== place.id);
    if (state.activePlaceId === place.id) {
      state.activePlaceId = null;
      ++state.requestToken;
      const next = state.places[0];
      if (next) await selectPlace(next.id); else { savePref('skyline-place', ''); setView('empty-state'); }
    }
    renderPlaces(); toast(`${place.name} removed from tracking.`);
  } catch (error) { flash(error.message); }
}

function hideSearchResults() { hide('search-results'); $('city-search').setAttribute('aria-expanded', 'false'); }
function renderSearchResults(results) {
  const list = $('search-results'); list.replaceChildren();
  state.searchResults = results;
  if (!results.length) {
    const empty = document.createElement('div'); empty.className = 'search-message';
    empty.textContent = 'No matching cities found. Try a different search.'; list.append(empty);
  }
  results.forEach((place) => {
    const button = document.createElement('button'); button.className = 'search-result'; button.type = 'button'; button.setAttribute('role', 'option');
    const pin = document.createElement('div'); pin.className = 'search-result-icon'; pin.textContent = '⌖';
    const label = document.createElement('div');
    const title = document.createElement('div'); title.className = 'search-result-name'; title.textContent = place.name;
    const subtitle = document.createElement('div'); subtitle.className = 'search-result-country'; subtitle.textContent = shortRegion(place);
    label.append(title, subtitle);
    const add = document.createElement('div'); add.className = 'search-result-add'; add.textContent = '+';
    button.append(pin, label, add); button.addEventListener('click', () => addPlace(place)); list.append(button);
  });
  show('search-results'); $('city-search').setAttribute('aria-expanded', 'true');
}
async function searchCities(query) {
  const token = ++searchSeq;
  if (query.length < 2) { hideSearchResults(); return; }
  const box = $('search-results');
  box.replaceChildren();
  const loading = document.createElement('div'); loading.className = 'search-message'; loading.textContent = 'Searching cities...';
  box.append(loading); show('search-results');
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if (token !== searchSeq) return;
    renderSearchResults(data.results);
  } catch (error) {
    if (token !== searchSeq) return;
    box.replaceChildren();
    const message = document.createElement('div'); message.className = 'search-message'; message.textContent = error.message;
    box.append(message); show('search-results');
  }
}
async function addPlace(place) {
  hideSearchResults(); $('city-search').value = ''; ++searchSeq;
  try {
    const data = await api('/api/places', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geocoding_id: place.geocoding_id })
    });
    const existing = state.places.some((p) => p.id === data.place.id);
    if (!existing) state.places.unshift(data.place);
    renderPlaces();
    await selectPlace(data.place.id);
    toast(existing ? `Showing ${place.name}.` : `${place.name} added to your locations.`);
  } catch (error) { flash(error.message); }
}
function toggleUnit(unit) {
  state.unit = unit; savePref('skyline-unit', unit);
  renderUnits(); renderPlaces(); renderWeather();
}
function setHistoryDays(days) {
  state.historyDays = days;
  if (state.activePlaceId) $('export-history').href = `/api/places/${state.activePlaceId}/history.csv?days=${days}`;
  $('history-14').classList.toggle('segmented-active', days === 14);
  $('history-30').classList.toggle('segmented-active', days === 30);
  $('history-14').setAttribute('aria-pressed', String(days === 14));
  $('history-30').setAttribute('aria-pressed', String(days === 30));
  if (state.activePlaceId) loadHistory(state.activePlaceId);
}
function updateClock() {
  const now = new Date();
  text('header-clock', new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(now));
  text('page-date', new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now));
}
function init() {
  text('footer-year', new Date().getFullYear());
  renderUnits(); updateClock(); setInterval(updateClock, 60_000);
  $('unit-f').addEventListener('click', () => toggleUnit('F'));
  $('unit-c').addEventListener('click', () => toggleUnit('C'));
  $('history-14').addEventListener('click', () => setHistoryDays(14));
  $('refresh-weather').addEventListener('click', () => { if (state.activePlaceId) selectPlace(state.activePlaceId); });
  $('history-30').addEventListener('click', () => setHistoryDays(30));
  for (const id of ['add-place-button', 'empty-add']) $(id).addEventListener('click', () => { $('city-search').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('mobile-menu').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('mobile-shade').addEventListener('click', () => { $('sidebar').classList.remove('open'); $('mobile-shade').classList.remove('open'); });
  // Keep the dimmed backdrop in sync when opening from mobile.
  $('mobile-menu').addEventListener('click', () => $('mobile-shade').classList.toggle('open', $('sidebar').classList.contains('open')));
  $('city-search').addEventListener('input', (event) => {
    clearTimeout(searchTimer); const query = event.target.value.trim();
    if (query.length < 2) { ++searchSeq; hideSearchResults(); return; }
    searchTimer = setTimeout(() => searchCities(query), 320);
  });
  $('city-search').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideSearchResults();
    if (event.key === 'Enter' && state.searchResults.length && !$('search-results').classList.contains('hidden')) {
      event.preventDefault(); addPlace(state.searchResults[0]);
    }
  });
  document.addEventListener('click', (event) => {
    if (!$('search-wrap').contains(event.target)) hideSearchResults();
  });
  // A lightweight foreground refresh; the hourly CLI scheduler records while away.
  setInterval(() => { if (!document.hidden && state.activePlaceId) selectPlace(state.activePlaceId); }, 15 * 60_000);
  loadPlaces().catch((error) => { setView('empty-state'); flash(`Could not load locations: ${error.message}`); });
}
document.addEventListener('DOMContentLoaded', init);
