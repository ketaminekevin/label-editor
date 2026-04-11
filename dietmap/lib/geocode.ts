const PLACES_API = 'https://maps.googleapis.com/maps/api/place';

export interface GeocodeResult {
  lat: number;
  lng: number;
  placeId: string;
}

/**
 * Find a restaurant via Google Places and return its coordinates + place_id.
 */
export async function geocodeRestaurant(
  name: string,
  address: string,
  nearLat: number,
  nearLng: number,
): Promise<GeocodeResult | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const queries = [
    `${name} ${address}`.trim(),
    name.trim(),
  ];

  for (const q of queries) {
    if (!q) continue;
    const url =
      `${PLACES_API}/findplacefromtext/json` +
      `?input=${encodeURIComponent(q)}` +
      `&inputtype=textquery` +
      `&fields=geometry,place_id` +
      `&locationbias=circle:5000@${nearLat},${nearLng}` +
      `&key=${apiKey}`;

    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json() as {
        status: string;
        candidates?: Array<{
          geometry: { location: { lat: number; lng: number } };
          place_id: string;
        }>;
      };
      if (data.status !== 'OK' || !data.candidates?.length) continue;
      const c = data.candidates[0];
      return {
        lat: c.geometry.location.lat,
        lng: c.geometry.location.lng,
        placeId: c.place_id,
      };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Fetch up to `limit` photo URLs for a Google place_id.
 * Returns ready-to-use image URLs (via the Places Photo endpoint redirect).
 */
export async function getPlacePhotos(
  placeId: string,
  limit = 5,
): Promise<string[]> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  if (!apiKey || !placeId) return [];

  try {
    const res = await fetch(
      `${PLACES_API}/details/json` +
      `?place_id=${encodeURIComponent(placeId)}` +
      `&fields=photos` +
      `&key=${apiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json() as {
      result?: { photos?: Array<{ photo_reference: string }> };
    };
    const refs = data.result?.photos?.slice(0, limit) ?? [];
    return refs.map(p =>
      `${PLACES_API}/photo?maxwidth=800&photo_reference=${encodeURIComponent(p.photo_reference)}&key=${apiKey}`
    );
  } catch {
    return [];
  }
}
