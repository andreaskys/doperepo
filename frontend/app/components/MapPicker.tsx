'use client';

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, CircleMarker, LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';

const BR_CENTER: [number, number] = [-14.235, -51.925];

export interface MapSelection {
  lat: number;
  lng: number;
  address?: string;
  city?: string;
  state?: string;
}

interface MapPickerProps {
  lat: number | null;
  lng: number | null;
  onSelect?: (sel: MapSelection) => void;
}

// Seletor de localização: clica no mapa → marca o ponto e (via Nominatim/OSM)
// devolve endereço/cidade/UF. ponytail: Leaflet puro, sem react-leaflet (compat
// com React 19) e sem API key.
export default function MapPicker({ lat, lng, onSelect }: MapPickerProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import('leaflet');
      const L = mod.default || mod;
      if (cancelled || !elRef.current || mapRef.current) return;

      const has = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
      const map = L.map(elRef.current).setView(has ? [lat, lng] : BR_CENTER, has ? 15 : 4);
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      const place = (la: number, ln: number) => {
        if (markerRef.current) markerRef.current.setLatLng([la, ln]);
        else
          markerRef.current = L.circleMarker([la, ln], {
            radius: 9,
            color: '#6b4fd0',
            fillColor: '#6b4fd0',
            fillOpacity: 0.9,
            weight: 2,
          }).addTo(map);
      };
      if (has) place(lat, lng);

      map.on('click', async (e: LeafletMouseEvent) => {
        const { lat: la, lng: ln } = e.latlng;
        place(la, ln);
        let geo: Partial<MapSelection> = {};
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${ln}&accept-language=pt-BR`
          );
          const d = await res.json();
          const a = d.address || {};
          const uf = (a['ISO3166-2-lvl4'] || '').split('-')[1] || '';
          geo = {
            address: [a.road, a.house_number].filter(Boolean).join(', ') || a.suburb || '',
            city: a.city || a.town || a.village || a.municipality || a.county || '',
            state: uf,
          };
        } catch {
          /* sem geocode: segue só com lat/lng */
        }
        onSelectRef.current?.({ lat: la, lng: ln, ...geo });
      });

      setTimeout(() => map.invalidateSize(), 50);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // init uma vez; coords iniciais lidas no mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={elRef} className="map-picker" />;
}
