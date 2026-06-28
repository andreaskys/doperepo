'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import DateRangePicker from './date-range-picker';
import RangeSlider from './range-slider';

const PRICE_CEIL = 5000;

export default function VenueFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [loc, setLoc] = useState(params.get('loc') ?? '');
  const [start, setStart] = useState(params.get('start') ?? '');
  const [end, setEnd] = useState(params.get('end') ?? '');
  const [min, setMin] = useState(Number(params.get('min_price') ?? '') || 0);
  const [max, setMax] = useState(Number(params.get('max_price') ?? '') || PRICE_CEIL);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const qs = new URLSearchParams();
    if (loc.trim()) qs.set('loc', loc.trim());
    if (start && end && start < end) {
      qs.set('start', start);
      qs.set('end', end);
    }
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    if (lo > 0) qs.set('min_price', String(lo));
    if (hi > 0 && hi < PRICE_CEIL) qs.set('max_price', String(hi));
    const query = qs.toString();
    router.push(query ? `/?${query}` : '/');
  }

  function clear() {
    setLoc('');
    setStart('');
    setEnd('');
    setMin(0);
    setMax(PRICE_CEIL);
    router.push('/');
  }

  return (
    <form className="venue-filters" onSubmit={submit}>
      <div className="filter-groups">
        <div className="filter-group">
          <p className="field-label">Localização</p>
          <input className="filter-input" placeholder="Cidade, estado ou bairro" value={loc} onChange={(e) => setLoc(e.target.value)} />
        </div>
        <div className="filter-group">
          <p className="field-label">Data</p>
          <DateRangePicker start={start} end={end} onChange={(s, e2) => { setStart(s); setEnd(e2); }} />
        </div>
        <div className="filter-group">
          <p className="field-label">Valor (R$/dia)</p>
          <RangeSlider min={min} max={max} ceil={PRICE_CEIL} step={50} onChange={(lo, hi) => { setMin(lo); setMax(hi); }} />
        </div>
      </div>
      <div className="filter-actions">
        <button type="button" className="button ghost" onClick={clear}>Limpar filtros</button>
        <button type="submit" className="button">Buscar</button>
      </div>
    </form>
  );
}
