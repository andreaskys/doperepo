'use client';

import { useEffect, useState } from 'react';
import type { Venue } from '../venues/lib';

const API = process.env.NEXT_PUBLIC_API_URL;

export default function VenueGrid() {
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(API + '/api/v1/public/venues')
      .then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar espaços');
        return r.json();
      })
      .then(setVenues)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Erro ao carregar espaços'));
  }, []);

  if (error) return <p className="muted">{error}</p>;
  if (!venues) return <p className="muted">Carregando espaços…</p>;
  if (venues.length === 0) return <p className="muted">Nenhum espaço publicado ainda. Seja o primeiro a <a href="/venues/new">anunciar</a>.</p>;

  return (
    <section className="venue-grid">
      {venues.map((v) => (
        <a key={v.id} className="vcard" href={`/venues/${v.id}/reservar`}>
          <div className="vcard-cover">
            {v.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.cover_url} alt={v.title} />
            ) : (
              <div className="vcard-cover-ph" />
            )}
          </div>
          <div className="vcard-body">
            <h3>{v.title}</h3>
            <p className="muted">{v.city}/{v.state} · {v.capacity} pessoas</p>
            <p className="vcard-price">R$ {v.price_per_day}<span>/dia</span></p>
          </div>
        </a>
      ))}
    </section>
  );
}
