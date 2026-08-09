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
