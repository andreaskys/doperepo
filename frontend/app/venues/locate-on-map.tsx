'use client';

import { useEffect, useState } from 'react';
import MapPicker from '../components/MapPicker';

interface LocateOnMapProps {
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  lat: string;
  lng: string;
  onPick: (lat: number, lng: number) => void;
}

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR`;
    const res = await fetch(url);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
    }
  } catch {
    /* sem geocode */
  }
  return null;
}

export default function LocateOnMap({ address, neighborhood, city, state, lat, lng, onPick }: LocateOnMapProps) {
  const hasInitial = lat !== '' && lng !== '';
  const [status, setStatus] = useState<'loading' | 'ready'>(hasInitial ? 'ready' : 'loading');

  const query = [address, neighborhood, city, state, 'Brasil'].filter(Boolean).join(', ');

  async function locate() {
    setStatus('loading');
    const r = await geocode(query);
    if (r) onPick(r.lat, r.lng);
    setStatus('ready');
  }

  // Geocoda ao montar se ainda não há coords (renderiza o mapa só depois,
  // pq o MapPicker lê as coords iniciais só no mount).
  useEffect(() => {
    if (!hasInitial) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'loading') {
    return (
      <div>
        <p className="field-label">Confirme o local no mapa</p>
        <p className="muted">Localizando pelo endereço…</p>
      </div>
    );
  }

  const has = lat !== '' && lng !== '';
  return (
    <div>
      <p className="field-label">Confirme o local no mapa</p>
      <p className="muted">
        {has
          ? `📍 ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)} — clique no mapa para ajustar`
          : 'Não encontrei automaticamente — clique no mapa para marcar.'}
      </p>
      <MapPicker
        lat={has ? Number(lat) : null}
        lng={has ? Number(lng) : null}
        onSelect={({ lat: la, lng: ln }) => onPick(la, ln)}
      />
      <button type="button" className="button ghost" onClick={locate} style={{ marginTop: 10 }}>
        Apontar pelo endereço
      </button>
    </div>
  );
}
