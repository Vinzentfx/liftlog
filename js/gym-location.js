// Local-only gym geofence and map picker. Coordinates never enter LiftLog's
// database or cloud snapshot; the browser stores only this device's chosen
// point, radius and last prompt day.

import { el, openSheet, closeSheet, toast } from './ui.js';
import { t } from './i18n.js';
import { todaysDays } from './schedule.js';

const KEY = 'liftlog.gymLocation.v1';
const DEFAULT_RADIUS = 120;

export function loadGymLocation() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!value || !validCoordinate(value.latitude, value.longitude)) return null;
    return {
      latitude: Number(value.latitude), longitude: Number(value.longitude),
      radius: clamp(Number(value.radius) || DEFAULT_RADIUS, 50, 500),
      enabled: value.enabled !== false, lastPromptDay: value.lastPromptDay || null,
    };
  } catch { return null; }
}

export function saveGymLocation(value) {
  const current = loadGymLocation() || {};
  const next = { ...current, ...value };
  if (!validCoordinate(next.latitude, next.longitude)) throw new Error('INVALID_LOCATION');
  next.radius = clamp(Number(next.radius) || DEFAULT_RADIUS, 50, 500);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearGymLocation() {
  try { localStorage.removeItem(KEY); } catch { /* unavailable storage */ }
}

export function distanceMeters(a, b) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const lat1 = rad(a.latitude), lat2 = rad(b.latitude);
  const dLat = lat2 - lat1, dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function nearbyPlannedWorkout(config, position, plan, sessions, now = Date.now()) {
  if (!config?.enabled || !plan || !validCoordinate(position?.latitude, position?.longitude)) return null;
  const dayKey = localDayKey(now);
  if (config.lastPromptDay === dayKey) return null;
  const today = todaysDays(plan, sessions);
  // Location may only start a day explicitly assigned to this weekday. The
  // unscheduled fallback is a suggestion, not "today's selected workout".
  if (!today.scheduled || !today.days.length) return null;
  const distance = distanceMeters(config, position);
  if (distance > config.radius + Math.min(Number(position.accuracy) || 0, 75)) return null;
  return { plan, day: today.days[0], distance, dayKey };
}

export function currentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(Object.assign(new Error('UNSUPPORTED'), { code: 'UNSUPPORTED' })); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      (error) => reject(Object.assign(new Error('LOCATION'), { code: error.code === 1 ? 'DENIED' : error.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE' })),
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 9000, ...options }
    );
  });
}

/** Open a small, dependency-free OpenStreetMap picker with a fixed centre pin. */
export function gymMapPicker(onSave) {
  const saved = loadGymLocation();
  let centre = saved ? { latitude: saved.latitude, longitude: saved.longitude } : null;
  let zoom = 16, dragging = false, origin = null, originWorld = null;
  let gymRequest = 0, gymTimer = null;
  const tiles = el('div.geo-map-tiles');
  const markers = el('div.geo-map-markers');
  const map = el('div.geo-map', { role: 'application', 'aria-label': t('gym.mapLabel') }, [
    tiles, markers, el('div.geo-map-shade'), el('div.geo-map-pin', { 'aria-hidden': 'true' }, ['●']),
  ]);
  const coordinates = el('div.small.muted', { text: t('gym.mapWaiting') });
  const nearby = el('div.geo-nearby', {}, [el('div.small.muted', { text: t('gym.gymsWaiting') })]);
  const save = el('button.btn.primary.full', { disabled: !centre }, [t('gym.savePoint')]);

  const paint = () => {
    if (!centre) return;
    coordinates.textContent = `${centre.latitude.toFixed(5)}, ${centre.longitude.toFixed(5)}`;
    save.disabled = false;
    renderTiles(tiles, centre, zoom);
    renderGymMarkers(markers, map, centre, zoom, markers._gyms || [], chooseGym);
  };
  const chooseGym = (gym) => {
    centre = { latitude: gym.latitude, longitude: gym.longitude };
    paint();
    coordinates.textContent = gym.name;
  };
  const loadGyms = () => {
    clearTimeout(gymTimer);
    gymTimer = setTimeout(async () => {
      if (!centre) return;
      const request = ++gymRequest;
      nearby.replaceChildren(el('div.small.muted', { text: t('gym.gymsLoading') }));
      try {
        const gyms = await nearbyGyms(centre);
        if (request !== gymRequest) return;
        markers._gyms = gyms;
        renderGymMarkers(markers, map, centre, zoom, gyms, chooseGym);
        renderGymList(nearby, gyms, chooseGym);
      } catch {
        if (request === gymRequest) nearby.replaceChildren(el('div.small.muted', { text: t('gym.gymsUnavailable') }));
      }
    }, 350);
  };
  const locate = async () => {
    coordinates.textContent = t('gym.locating');
    try { centre = await currentPosition({ enableHighAccuracy: true }); paint(); loadGyms(); }
    catch (error) { coordinates.textContent = locationErrorText(error.code); }
  };

  map.addEventListener('pointerdown', (event) => {
    if (!centre) return;
    dragging = true; origin = { x: event.clientX, y: event.clientY };
    originWorld = latLonToWorld(centre, zoom); map.setPointerCapture(event.pointerId);
  });
  map.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
    centre = worldToLatLon({ x: originWorld.x - dx, y: originWorld.y - dy }, zoom);
    paint();
  });
  const stop = () => { if (dragging) loadGyms(); dragging = false; };
  map.addEventListener('pointerup', stop); map.addEventListener('pointercancel', stop);

  save.addEventListener('click', () => {
    if (!centre) return;
    onSave({ latitude: centre.latitude, longitude: centre.longitude });
    closeSheet(); toast(t('gym.locationSaved'));
  });
  const zoomButton = (label, delta) => el('button.icon-btn', { onclick: () => {
    zoom = clamp(zoom + delta, 13, 19); paint(); loadGyms();
  }, 'aria-label': t(delta > 0 ? 'gym.zoomIn' : 'gym.zoomOut') }, [label]);

  openSheet(t('gym.pickTitle'), el('div', {}, [
    el('div.small.muted', { style: { marginBottom: '10px' }, text: t('gym.pickIntro') }),
    map,
    el('div.row.between', { style: { marginTop: '9px' } }, [coordinates,
      el('div.row', {}, [zoomButton('−', -1), zoomButton('+', 1)])]),
    nearby,
    el('button.btn.ghost.full.sm', { style: { marginTop: '10px' }, onclick: locate }, [t('gym.useCurrent')]),
    save,
    el('div.geo-attribution', {}, [t('gym.mapBy') + ' ',
      el('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, ['OpenStreetMap'])]),
  ]));
  if (centre) { paint(); loadGyms(); } else locate();
}

async function nearbyGyms(centre) {
  const point = `${centre.latitude.toFixed(6)},${centre.longitude.toFixed(6)}`;
  const query = `[out:json][timeout:12];(nwr(around:3500,${point})["leisure"="fitness_centre"];nwr(around:3500,${point})["leisure"="fitness_station"];nwr(around:3500,${point})["sport"="fitness"];);out center tags;`;
  let data = null;
  for (const endpoint of ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter']) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (response.ok) { data = await response.json(); break; }
    } catch { /* Try the other public Overpass instance. */ }
    finally { clearTimeout(timeout); }
  }
  if (!data) throw new Error('GYMS_UNAVAILABLE');
  const seen = new Set();
  return (data.elements || []).map((item) => ({
    id: `${item.type}-${item.id}`,
    latitude: Number(item.lat ?? item.center?.lat), longitude: Number(item.lon ?? item.center?.lon),
    name: item.tags?.name || t('gym.unnamedGym'),
  })).filter((gym) => validCoordinate(gym.latitude, gym.longitude) && !seen.has(gym.id) && seen.add(gym.id))
    .sort((a, b) => distanceMeters(centre, a) - distanceMeters(centre, b)).slice(0, 12);
}

function renderGymMarkers(host, map, centre, zoom, gyms, onChoose) {
  const width = map.clientWidth || 420, height = map.clientHeight || 260;
  const origin = latLonToWorld(centre, zoom);
  host.replaceChildren(...gyms.map((gym) => {
    const point = latLonToWorld(gym, zoom);
    return el('button.geo-gym-marker', {
      type: 'button', title: gym.name, 'aria-label': t('gym.chooseNamed', { name: gym.name }),
      style: { left: `${point.x - origin.x + width / 2}px`, top: `${point.y - origin.y + height / 2}px` },
      onclick: () => onChoose(gym),
    }, ['🏋']);
  }));
}

function renderGymList(host, gyms, onChoose) {
  if (!gyms.length) {
    host.replaceChildren(el('div.small.muted', { text: t('gym.noGyms') })); return;
  }
  host.replaceChildren(el('div.small.faint', { text: t('gym.nearbyGyms') }), el('div.geo-gym-list', {},
    gyms.slice(0, 5).map((gym) => el('button.chip', { onclick: () => onChoose(gym) }, [gym.name]))));
}

function renderTiles(host, centre, zoom) {
  const width = host.parentElement?.clientWidth || 420;
  const height = host.parentElement?.clientHeight || 260;
  const world = latLonToWorld(centre, zoom);
  const startX = Math.floor((world.x - width / 2) / 256);
  const endX = Math.floor((world.x + width / 2) / 256);
  const startY = Math.floor((world.y - height / 2) / 256);
  const endY = Math.floor((world.y + height / 2) / 256);
  const count = 2 ** zoom; const fragment = document.createDocumentFragment();
  for (let x = startX; x <= endX; x++) for (let y = startY; y <= endY; y++) {
    if (y < 0 || y >= count) continue;
    const wrappedX = ((x % count) + count) % count;
    fragment.append(el('img', {
      src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`, alt: '', draggable: 'false',
      style: { left: `${x * 256 - world.x + width / 2}px`, top: `${y * 256 - world.y + height / 2}px` },
    }));
  }
  host.replaceChildren(fragment);
}

function latLonToWorld(point, zoom) {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin(clamp(point.latitude, -85.0511, 85.0511) * Math.PI / 180);
  return { x: (point.longitude + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

function worldToLatLon(point, zoom) {
  const scale = 256 * 2 ** zoom;
  const n = Math.PI - 2 * Math.PI * point.y / scale;
  return { longitude: point.x / scale * 360 - 180,
    latitude: 180 / Math.PI * Math.atan(Math.sinh(n)) };
}

const validCoordinate = (lat, lon) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
  && Number(lat) >= -90 && Number(lat) <= 90 && Number(lon) >= -180 && Number(lon) <= 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const localDayKey = (time) => {
  const date = new Date(time), pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const locationErrorText = (code) => {
  if (code === 'DENIED') return t('gym.error.DENIED');
  if (code === 'TIMEOUT') return t('gym.error.TIMEOUT');
  if (code === 'UNSUPPORTED') return t('gym.error.UNSUPPORTED');
  return t('gym.error.UNAVAILABLE');
};
