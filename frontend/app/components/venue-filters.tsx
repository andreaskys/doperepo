'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AMENITIES } from '../venues/lib';

export default function VenueFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [city, setCity] = useState(params.get('city') ?? '');
  const [minCapacity, setMinCapacity] = useState(params.get('min_capacity') ?? '');
  const [maxPrice, setMaxPrice] = useState(params.get('max_price') ?? '');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [amenities, setAmenities] = useState<string[]>(
    (params.get('amenities') ?? '').split(',').map((a) => a.trim()).filter(Boolean)
  );

  const toggle = (k: string) =>
    setAmenities((cur) => (cur.includes(k) ? cur.filter((a) => a !== k) : [...cur, k]));

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const qs = new URLSearchParams();
    if (city.trim()) qs.set('city', city.trim());
    if (Number(minCapacity) > 0) qs.set('min_capacity', String(Number(minCapacity)));
    if (Number(maxPrice) > 0) qs.set('max_price', String(Number(maxPrice)));
    if (q.trim()) qs.set('q', q.trim());
    if (amenities.length) qs.set('amenities', amenities.join(','));
    const query = qs.toString();
    router.push(query ? `/?${query}` : '/');
  }

  function clear() {
    setCity('');
    setMinCapacity('');
    setMaxPrice('');
    setQ('');
    setAmenities([]);
    router.push('/');
  }

  return (
    <form className="venue-filters" onSubmit={submit}>
      <input className="filter-input" placeholder="Cidade" value={city} onChange={(e) => setCity(e.target.value)} />
      <input className="filter-input" type="number" min={1} placeholder="Capacidade mín." value={minCapacity} onChange={(e) => setMinCapacity(e.target.value)} />
      <input className="filter-input" type="number" min={0} step="0.01" placeholder="Preço máx./dia" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
      <input className="filter-input" placeholder="Título ou descrição" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        {AMENITIES.map((a) => (
          <button
            type="button"
            key={a.key}
            className={'chip' + (amenities.includes(a.key) ? ' on' : '')}
            onClick={() => toggle(a.key)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="filter-actions">
        <button type="submit" className="button">Buscar</button>
        <button type="button" className="button ghost" onClick={clear}>Limpar filtros</button>
      </div>
    </form>
  );
}
