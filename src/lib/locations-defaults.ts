// src/lib/locations-defaults.ts
// Single source of truth for the default values a new location starts with.
// Shared by BOTH the single Add-location form (LocationsClient) and the bulk
// location importer (LocationsBulkClient + api/locations/bulk) so the two paths
// can never drift apart. Store days default to all week (off-days are assigned
// later); the store window is the widest sensible default (08:00–23:59).

export const LOCATION_DEFAULTS = {
  geofence_m: 150,
  store_days: 'Mon-Sun',
  store_start: '08:00',
  store_end: '23:59',
} as const

// Acceptable latitude / longitude ranges, used to validate imported coordinates.
export const LAT_RANGE = { min: -90, max: 90 }
export const LNG_RANGE = { min: -180, max: 180 }
