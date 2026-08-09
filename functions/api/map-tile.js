// Same-origin map tile relay for Cloudflare Pages. Some mobile privacy filters
// block third-party tile hosts even though the app itself is allowed. Values
// are strictly numeric and the upstream is fixed, so this cannot become an
// open proxy.
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const zoom = integer(url.searchParams.get('z'));
  const x = integer(url.searchParams.get('x'));
  const y = integer(url.searchParams.get('y'));
  const size = Number.isInteger(zoom) ? 2 ** zoom : 0;
  if (zoom < 13 || zoom > 19 || x < 0 || y < 0 || x >= size || y >= size) {
    return new Response('Invalid tile', { status: 400 });
  }

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/map-tile?z=${zoom}&x=${x}&y=${y}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(`https://a.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${x}/${y}.png`, {
    cf: { cacheEverything: true, cacheTtl: 604800 },
  });
  if (!upstream.ok) return new Response('Map unavailable', { status: 502 });
  const response = new Response(upstream.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  await cache.put(cacheKey, response.clone());
  return response;
}

function integer(value) {
  return /^\d+$/.test(value || '') ? Number(value) : NaN;
}
