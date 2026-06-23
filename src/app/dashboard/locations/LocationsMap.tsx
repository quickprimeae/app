'use client'
// src/app/dashboard/locations/LocationsMap.tsx
// Real interactive Google Map for the Locations page. Plots one marker per
// location at its real lat/lng, colored by the SAME status the page legend
// uses, fits the viewport to all markers (defaulting to Dubai), and calls
// onSelect when a marker is clicked — mirroring the list-row selection. Loads
// only the Maps JS API (see loadGoogleMaps); no Places/Geocoding.

import { useEffect, useRef, useState } from 'react'
import type { LocationRow } from '@/lib/locations-data'
import { loadGoogleMaps, MISSING_KEY } from '@/lib/google-maps'
import { T } from '@/lib/theme'

// Same status→color mapping as the legend / list dots on the Locations page.
function markerColor(status: string): string {
  if (status === 'active') return T.tealBright
  if (status === 'noshow') return T.red
  if (status === 'late') return T.amber
  return T.dimMid
}

const DUBAI_CENTER = { lat: 25.2048, lng: 55.2708 }

function pinIcon(status: string, selected: boolean): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: markerColor(status),
    fillOpacity: 1,
    strokeColor: selected ? T.white : T.bg,
    strokeWeight: selected ? 3 : 2,
    scale: selected ? 10 : 7,
  }
}

export default function LocationsMap({
  locations,
  selected,
  onSelect,
}: {
  locations: LocationRow[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  // Keep the latest onSelect without re-binding marker listeners every render.
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')

  // Init the map exactly once.
  useEffect(() => {
    let cancelled = false
    loadGoogleMaps()
      .then(({ maps }) => {
        if (cancelled || !containerRef.current) return
        mapRef.current = new maps.Map(containerRef.current, {
          center: DUBAI_CENTER,
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        })
        setPhase('ready')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const missing = e instanceof Error && e.message === MISSING_KEY
        setErrMsg(
          missing
            ? 'Map unavailable — Google Maps API key is not set.'
            : 'Map could not be loaded. Check your connection or API key.'
        )
        setPhase('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // (Re)build markers whenever the map becomes ready or the locations change.
  useEffect(() => {
    const map = mapRef.current
    if (phase !== 'ready' || !map) return

    // Clear any existing markers before rebuilding.
    markersRef.current.forEach((m) => m.setMap(null))
    markersRef.current.clear()

    const bounds = new google.maps.LatLngBounds()
    let plotted = 0
    for (const loc of locations) {
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue
      const position = { lat: loc.lat, lng: loc.lng }
      const marker = new google.maps.Marker({
        position,
        map,
        title: loc.name,
        icon: pinIcon(loc.status, loc.id === selected),
        zIndex: loc.id === selected ? 999 : 1,
      })
      marker.addListener('click', () => onSelectRef.current(loc.id))
      markersRef.current.set(loc.id, marker)
      bounds.extend(position)
      plotted++
    }

    if (plotted > 0) {
      map.fitBounds(bounds, 64)
      // Don't zoom too far in when there's a single (or tightly clustered) pin.
      google.maps.event.addListenerOnce(map, 'idle', () => {
        if ((map.getZoom() ?? 0) > 15) map.setZoom(15)
      })
    } else {
      map.setCenter(DUBAI_CENTER)
      map.setZoom(11)
    }
    // selected is intentionally not a dependency here — selection styling is
    // handled in the effect below without rebuilding/ refitting the markers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, phase])

  // Reflect the current selection by emphasizing that marker.
  useEffect(() => {
    if (phase !== 'ready') return
    markersRef.current.forEach((marker, id) => {
      const loc = locations.find((l) => l.id === id)
      if (!loc) return
      const isSel = id === selected
      marker.setIcon(pinIcon(loc.status, isSel))
      marker.setZIndex(isSel ? 999 : 1)
    })
  }, [selected, phase, locations])

  return (
    <>
      <div ref={containerRef} className="lp-map-canvas" />
      {phase !== 'ready' && (
        <div className="lp-map-state">
          {phase === 'loading' ? (
            <>
              <span className="lp-map-spinner" />
              <span>Loading map…</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 26 }}>🗺️</span>
              <span>{errMsg}</span>
            </>
          )}
        </div>
      )}
    </>
  )
}
