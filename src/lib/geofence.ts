// src/lib/geofence.ts
// Server-side GPS validation. Never trust client-side coordinates.

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000 // Earth radius in metres
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function isWithinGeofence(
  employeeLat: number,
  employeeLng: number,
  locationLat: number,
  locationLng: number,
  radiusMetres: number
): { passed: boolean; distanceMetres: number } {
  const distance = haversineDistance(
    employeeLat, employeeLng,
    locationLat, locationLng
  )
  return {
    passed: distance <= radiusMetres,
    distanceMetres: Math.round(distance),
  }
}
