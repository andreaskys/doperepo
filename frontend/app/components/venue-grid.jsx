'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL;

export default function VenueGrid() {
  const [venues, setVenues] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(API + '/api/v1/public/venues')
      .then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar espaços');
        return r.json();
      })
      .then(setVenues)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="muted">{error}</p>;
  if (!venues) return <p className="muted">Carregando espaços…</p>;
  if (venues.length === 0) return <p className="muted">Nenhum espaço publicado ainda. Seja o primeiro a <a href="/venues/new">anunciar</a>.</p>;

  return (
    <section className="venue-grid">
      {venues.map((v) => (
        <article key={v.id} className="vcard">
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
        </article>
      ))}
    </section>
  );
}
