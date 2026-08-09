// Return only the public name and coordinates needed by the picker. The phone
// never contacts Overpass directly and detailed OSM tags are not forwarded.
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get('lat'));
  const longitude = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return Response.json({ error: 'Invalid location' }, { status: 400 });
  }

  // Photon is a fast OSM search index and is a better fit for this tiny place
  // lookup than running a live database query. Several common name fragments
  // cover chains whose names do not contain the generic word "fitness".
  const photonTerms = ['fitness', 'gym80', 'fit x', 'easyfitness', 'all inclusive fitness'];
  const photonResults = await Promise.allSettled(photonTerms.map(async (term) => {
    const endpoint = new URL('https://photon.komoot.io/api/');
    endpoint.search = new URLSearchParams({ q: term, lat: String(latitude), lon: String(longitude),
      zoom: '13', location_bias_scale: '0.02', limit: '20' });
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000),
      cf: { cacheEverything: true, cacheTtl: 3600 } });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.features || []).map((feature) => ({
      id: `${feature.properties?.osm_type || 'O'}-${feature.properties?.osm_id || ''}`,
      latitude: Number(feature.geometry?.coordinates?.[1]),
      longitude: Number(feature.geometry?.coordinates?.[0]),
      name: typeof feature.properties?.name === 'string' ? feature.properties.name.slice(0, 100) : null,
      kind: feature.properties?.leisure || feature.properties?.osm_value,
      key: feature.properties?.osm_key,
    }));
  }));
  const seenPhoton = new Set();
  const photonGyms = photonResults.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .filter((gym) => (gym.kind === 'fitness_centre' || gym.kind === 'sports_centre')
      && (gym.key === 'leisure' || gym.key == null)
      && distanceMetres(latitude, longitude, gym.latitude, gym.longitude) <= 7000
      && !seenPhoton.has(gym.id) && seenPhoton.add(gym.id));
  if (photonGyms.length) {
    return Response.json({ gyms: photonGyms }, { headers: { 'Cache-Control': 'public, max-age=1800' } });
  }

  // Fallback for unnamed centres that a text index cannot find.
  const south = (latitude - 0.035).toFixed(5), north = (latitude + 0.035).toFixed(5);
  const longitudeSpan = 0.035 / Math.max(Math.cos(latitude * Math.PI / 180), 0.25);
  const west = (longitude - longitudeSpan).toFixed(5), east = (longitude + longitudeSpan).toFixed(5);
  const box = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:12];(nwr["leisure"="fitness_centre"](${box});nwr["leisure"="fitness_station"](${box});nwr["sport"="fitness"](${box}););out center tags;`;
  let data = null;
  for (const endpoint of ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter']) {
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(14000), cf: { cacheEverything: true, cacheTtl: 1800 },
      });
      if (response.ok) { data = await response.json(); break; }
    } catch { /* Try the fallback instance. */ }
  }
  if (!data) return Response.json({ error: 'Gym lookup unavailable' }, { status: 502 });

  const gyms = (data.elements || []).map((item) => ({
    id: `${item.type}-${item.id}`,
    latitude: Number(item.lat ?? item.center?.lat),
    longitude: Number(item.lon ?? item.center?.lon),
    name: typeof item.tags?.name === 'string' ? item.tags.name.slice(0, 100) : null,
  })).filter((gym) => Number.isFinite(gym.latitude) && Number.isFinite(gym.longitude));
  return Response.json({ gyms }, { headers: { 'Cache-Control': 'public, max-age=900' } });
}

function distanceMetres(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
