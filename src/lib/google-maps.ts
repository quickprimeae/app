// src/lib/google-maps.ts
// Single-load wrapper around the Google Maps JavaScript API. Loads ONLY the
// core map + marker-rendering libraries — no Places, Geocoding, Directions or
// any other billable API is requested (we already have lat/lng, so no geocoding
// is needed). The first caller kicks off the script; every later caller reuses
// the same promise, so the script is fetched exactly once even across React
// re-mounts / fast-refresh.

import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

export type GoogleMapsLibs = {
  maps: google.maps.MapsLibrary
  marker: google.maps.MarkerLibrary
}

// Thrown (as the rejection reason's message) when the env key is absent, so the
// UI can show a specific "key missing" message vs. a generic load failure.
export const MISSING_KEY = 'MISSING_GOOGLE_MAPS_KEY'

let loadPromise: Promise<GoogleMapsLibs> | null = null

export function loadGoogleMaps(): Promise<GoogleMapsLibs> {
  if (loadPromise) return loadPromise

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!key) return Promise.reject(new Error(MISSING_KEY))

  // Must be called before importLibrary. 'weekly' is the standard channel.
  setOptions({ key, v: 'weekly' })

  loadPromise = Promise.all([importLibrary('maps'), importLibrary('marker')])
    .then(([maps, marker]) => ({ maps, marker }))
    .catch((e) => {
      // Let the next mount retry rather than caching a failed load.
      loadPromise = null
      throw e
    })

  return loadPromise
}
