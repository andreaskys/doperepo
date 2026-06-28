'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ElasticSlider from './elastic-slider';

const PRICE_CEIL = 5000;

export default function VenueFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [city, setCity] = useState(params.get('city') ?? '');
  const [state, setState] = useState(params.get('state') ?? '');
  const [start, setStart] = useState(params.get('start') ?? '');
  const [end, setEnd] = useState(params.get('end') ?? '');
  const [min, setMin] = useState(Number(params.get('min_price') ?? '') || 0);
  const [max, setMax] = useState(Number(params.get('max_price') ?? '') || 0);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const qs = new URLSearchParams();
    if (city.trim()) qs.set('city', city.trim());
    if (state.trim()) qs.set('state', state.trim().toUpperCase());
    if (start && end && start < end) {
      qs.set('start', start);
      qs.set('end', end);
    }
    let lo = min;
    let hi = max;
    if (lo > 0 && hi > 0 && lo > hi) [lo, hi] = [hi, lo];
    if (lo > 0) qs.set('min_price', String(lo));
    if (hi > 0) qs.set('max_price', String(hi));
    const query = qs.toString();
    router.push(query ? `/?${query}` : '/');
  }

  function clear() {
    setCity('');
    setState('');
    setStart('');
    setEnd('');
    setMin(0);
    setMax(0);
    router.push('/');
  }

  return (
    <form className="venue-filters" onSubmit={submit}>
      <div className="filter-groups">
        <div className="filter-group">
          <p className="field-label">Localização</p>
          <div className="row">
            <input className="filter-input" placeholder="Cidade" value={city} onChange={(e) => setCity(e.target.value)} />
            <input className="filter-input uf" placeholder="UF" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} />
          </div>
        </div>

        <div className="filter-group">
          <p className="field-label">Data</p>
          <div className="row">
            <label className="date-field">Entrada<input type="date" className="filter-input" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="date-field">Saída<input type="date" className="filter-input" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
        </div>

        <div className="filter-group">
          <p className="field-label">Valor (R$/dia)</p>
          <div className="price-row">
            <div className="price-cell">
              <input className="filter-input" type="number" min={0} max={PRICE_CEIL} step={50} placeholder="Mínimo" value={min || ''} onChange={(e) => setMin(Number(e.target.value) || 0)} />
              <ElasticSlider value={min} startingValue={0} maxValue={PRICE_CEIL} isStepped stepSize={50} onChange={setMin} />
            </div>
            <div className="price-cell">
              <input className="filter-input" type="number" min={0} max={PRICE_CEIL} step={50} placeholder="Máximo" value={max || ''} onChange={(e) => setMax(Number(e.target.value) || 0)} />
              <ElasticSlider value={max} startingValue={0} maxValue={PRICE_CEIL} isStepped stepSize={50} onChange={setMax} />
            </div>
          </div>
        </div>
      </div>

      <div className="filter-actions">
        <button type="button" className="button ghost" onClick={clear}>Limpar filtros</button>
        <button type="submit" className="button">Buscar</button>
      </div>
    </form>
  );
}
