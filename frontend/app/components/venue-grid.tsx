'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PublicAPI, type Venue } from '../venues/lib';

export default function VenueGrid() {
  const params = useSearchParams();
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [error, setError] = useState('');

  const hasFilters = params.toString().length > 0;

  useEffect(() => {
    setVenues(null);
    setError('');
    PublicAPI.searchVenues({
      city: params.get('city') ?? undefined,
      minCapacity: params.get('min_capacity') ? Number(params.get('min_capacity')) : undefined,
      maxPrice: params.get('max_price') ? Number(params.get('max_price')) : undefined,
      q: params.get('q') ?? undefined,
      amenities: (params.get('amenities') ?? '').split(',').map((a) => a.trim()).filter(Boolean),
    })
      .then(setVenues)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Erro ao carregar espaços'));
  }, [params]);

  if (error) return <p className="muted">{error}</p>;
  if (!venues) return <p className="muted">Carregando espaços…</p>;
  if (venues.length === 0) {
    return hasFilters ? (
      <p className="muted">Nenhum espaço encontrado com esses filtros. <a href="/">Limpar filtros</a>.</p>
    ) : (
      <p className="muted">Nenhum espaço publicado ainda. Seja o primeiro a <a href="/venues/new">anunciar</a>.</p>
    );
  }

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
