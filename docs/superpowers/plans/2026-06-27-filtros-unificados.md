# Filtros unificados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Localização num input (city/state/neighborhood), date-range picker (calendário popover) e slider de duas alças para o valor.

**Architecture:** Backend ganha param `loc`. Frontend ganha `DateRangePicker` e `RangeSlider` e reescreve `venue-filters` usando-os.

**Tech Stack:** Go + sqlc; Next.js 15 + React 19 + TS strict + `motion/react`.

## Global Constraints
- **Spec:** `docs/superpowers/specs/2026-06-27-filtros-unificados.md`.
- `loc` casa `city`/`state`/`neighborhood` (ILIKE). Demais params (city/state/min_price/max_price/start/end) seguem existindo no backend.
- Datas só filtram com ambas e `start < end`; valor garante `min ≤ max`. Busca nunca 400/500.
- **sqlc:** regen + `git add internal/db/sqlc/`.
- **Gates:** backend `go build`/`go test`; frontend `npm run typecheck` + build no container.

---

### Task 1: Backend — param `loc`

**Files:** `backend/internal/db/queries/venues.sql`, `internal/db/sqlc/` (regen), `internal/venues/service.go`, `internal/venues/handler.go`.

- [ ] **Step 1: Query** — em `SearchPublishedVenues`, antes do `ORDER BY`:
```sql
  AND (@loc::text = '' OR v.city ILIKE '%' || @loc::text || '%'
       OR v.state ILIKE '%' || @loc::text || '%'
       OR v.neighborhood ILIKE '%' || @loc::text || '%')
```
- [ ] **Step 2: Regen** — `"$(go env GOPATH)/bin/sqlc" generate`; conferir `Loc string` em `SearchPublishedVenuesParams`.
- [ ] **Step 3: Service** — `SearchFilters` ganha `Loc string`; em `buildSearchParams` adicionar `p.Loc = strings.TrimSpace(f.Loc)`; em `isEmpty()` adicionar `&& strings.TrimSpace(f.Loc) == ""`.
- [ ] **Step 4: Handler** — em `parseSearchFilters`, antes do `return f`: `f.Loc = q.Get("loc")`.
- [ ] **Step 5: Build + smoke**
```bash
docker compose exec -T backend go build ./... && docker compose exec -T backend go test ./...
docker compose restart backend >/dev/null 2>&1; sleep 3
B=http://localhost:8080/api/v1
for k in "loc=são paulo" "loc=SP" "loc=Centro"; do echo "$k -> $(curl -s "$B/public/venues?$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote_plus(sys.argv[1].split('=')[1]))" "$k" | sed "s/^/loc=/")" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')"; done
```
Expected: build/test ok; "são paulo" e "SP" retornam os de SP; bairro filtra.
- [ ] **Step 6: Commit** — `git add` (sql, sqlc, service, handler) → `feat(busca): param loc (cidade/estado/bairro num input)`.

---

### Task 2: `RangeSlider` (duas alças)

**Files:** Create `frontend/app/components/range-slider.tsx`, `range-slider.css`.

- [ ] **Step 1: Componente** — `range-slider.tsx`:
```tsx
'use client';

import './range-slider.css';

interface Props {
  min: number;
  max: number;
  ceil: number;
  step?: number;
  onChange: (min: number, max: number) => void;
}

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR')}`;

export default function RangeSlider({ min, max, ceil, step = 1, onChange }: Props) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const pct = (v: number) => (ceil === 0 ? 0 : (v / ceil) * 100);
  return (
    <div className="rs">
      <div className="rs-track">
        <div className="rs-fill" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
      </div>
      <input
        type="range" className="rs-input" min={0} max={ceil} step={step} value={min}
        onChange={(e) => onChange(Math.min(Number(e.target.value), max), max)}
        aria-label="Valor mínimo"
      />
      <input
        type="range" className="rs-input" min={0} max={ceil} step={step} value={max}
        onChange={(e) => onChange(min, Math.max(Number(e.target.value), min))}
        aria-label="Valor máximo"
      />
      <div className="rs-values"><span>{brl(lo)}</span><span>{brl(hi)}</span></div>
    </div>
  );
}
```
- [ ] **Step 2: CSS** — `range-slider.css`:
```css
.rs { position: relative; height: 46px; padding-top: 8px; }
.rs-track { position: absolute; top: 16px; left: 0; right: 0; height: 5px; border-radius: 9999px; background: rgba(107,79,208,0.18); }
.rs-fill { position: absolute; top: 0; bottom: 0; background: var(--brand-gradient); border-radius: 9999px; }
.rs-input { position: absolute; top: 8px; left: 0; width: 100%; height: 22px; margin: 0; background: transparent; -webkit-appearance: none; appearance: none; pointer-events: none; }
.rs-input::-webkit-slider-runnable-track { background: transparent; border: none; }
.rs-input::-moz-range-track { background: transparent; border: none; }
.rs-input::-webkit-slider-thumb { -webkit-appearance: none; pointer-events: auto; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid var(--brand-purple); cursor: grab; box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
.rs-input::-moz-range-thumb { pointer-events: auto; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid var(--brand-purple); cursor: grab; box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
.rs-values { position: absolute; top: 28px; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 12px; color: var(--brand-purple); font-weight: 600; }
```
- [ ] **Step 3: Typecheck + build + commit** — `feat(filtros): RangeSlider de duas alças`.

---

### Task 3: `DateRangePicker` (calendário popover)

**Files:** Create `frontend/app/components/date-range-picker.tsx`, `date-range-picker.css`.

- [ ] **Step 1: Componente** — `date-range-picker.tsx`:
```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import './date-range-picker.css';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dm = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

interface Props { start: string; end: string; onChange: (start: string, end: string) => void; }

export default function DateRangePicker({ start, end, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const base = start ? new Date(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1) : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = ymd(today);

  const pick = (ds: string) => {
    if (!start || (start && end)) onChange(ds, '');
    else if (ds < start) onChange(ds, '');
    else { onChange(start, ds); setOpen(false); }
  };

  const move = (delta: number) => setView((v) => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const firstWd = new Date(view.y, view.m, 1).getDay();
  const nDays = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let d = 1; d <= nDays; d++) cells.push(ymd(new Date(view.y, view.m, d)));

  const label = start || end ? `${dm(start) || '…'} – ${dm(end) || '…'}` : 'Selecione as datas';

  return (
    <div className="drp" ref={ref}>
      <button type="button" className="filter-input drp-field" onClick={() => setOpen((o) => !o)}>{label}</button>
      {open && (
        <div className="drp-pop">
          <div className="drp-head">
            <button type="button" onClick={() => move(-1)} aria-label="Mês anterior">‹</button>
            <span>{MONTHS[view.m]} {view.y}</span>
            <button type="button" onClick={() => move(1)} aria-label="Próximo mês">›</button>
          </div>
          <div className="drp-wd">{WD.map((w, i) => <span key={i}>{w}</span>)}</div>
          <div className="drp-grid">
            {cells.map((c, i) =>
              c === null ? <span key={i} /> : (
                <button
                  type="button" key={i} disabled={c < todayStr}
                  className={'drp-day' + (c === start ? ' on' : '') + (c === end ? ' on' : '') + (start && end && c > start && c < end ? ' mid' : '')}
                  onClick={() => pick(c)}
                >
                  {Number(c.slice(8, 10))}
                </button>
              )
            )}
          </div>
          <div className="drp-foot"><button type="button" onClick={() => onChange('', '')}>Limpar datas</button></div>
        </div>
      )}
    </div>
  );
}
```
- [ ] **Step 2: CSS** — `date-range-picker.css`:
```css
.drp { position: relative; }
.drp-field { text-align: left; cursor: pointer; width: 100%; }
.drp-pop { position: absolute; z-index: 60; top: calc(100% + 6px); left: 0; width: 280px; background: #fff; border: 1px solid #e6e4ef; border-radius: 14px; box-shadow: 0 12px 40px rgba(20,16,50,0.15); padding: 12px; }
.drp-head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; margin-bottom: 8px; }
.drp-head button { border: none; background: none; font-size: 20px; cursor: pointer; color: var(--brand-purple); width: 30px; height: 30px; border-radius: 8px; }
.drp-wd, .drp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.drp-wd { font-size: 11px; color: #888; text-align: center; margin-bottom: 4px; }
.drp-day { border: none; background: none; cursor: pointer; height: 34px; border-radius: 8px; font: inherit; color: #1f2430; }
.drp-day:hover:not(:disabled) { background: var(--brand-tint); }
.drp-day:disabled { color: #ccc; cursor: default; }
.drp-day.on { background: var(--brand-gradient); color: #fff; font-weight: 600; }
.drp-day.mid { background: var(--brand-tint); }
.drp-foot { margin-top: 8px; text-align: right; }
.drp-foot button { border: none; background: none; color: var(--brand-purple); cursor: pointer; font-size: 13px; }
```
- [ ] **Step 3: Typecheck + build + commit** — `feat(filtros): DateRangePicker (calendário popover)`.

---

### Task 4: `venue-filters` reescrito + `lib.ts` + `venue-grid`

**Files:** `frontend/app/components/venue-filters.tsx`, `frontend/app/venues/lib.ts`, `frontend/app/components/venue-grid.tsx`, `frontend/app/globals.css`.

- [ ] **Step 1: `lib.ts`** — em `VenueSearchParams` adicionar `loc?: string;`; em `searchVenues`, após `city`: `if (params.loc?.trim()) qs.set('loc', params.loc.trim());`.

- [ ] **Step 2: `venue-grid.tsx`** — no objeto de `searchVenues`, adicionar `loc: params.get('loc') ?? undefined,` (pode remover `state` do objeto; opcional).

- [ ] **Step 3: `venue-filters.tsx`** — substituir todo o arquivo:
```tsx
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
    if (start && end && start < end) { qs.set('start', start); qs.set('end', end); }
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    if (lo > 0) qs.set('min_price', String(lo));
    if (hi > 0 && hi < PRICE_CEIL) qs.set('max_price', String(hi));
    const query = qs.toString();
    router.push(query ? `/?${query}` : '/');
  }

  function clear() {
    setLoc(''); setStart(''); setEnd(''); setMin(0); setMax(PRICE_CEIL);
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
```
- [ ] **Step 4: Estilos** — substituir o bloco `.price-row`/`.price-cell` (não usados mais) por nada e garantir o grid; em `globals.css` os `.filter-groups`/`.filter-group` já existem. Adicionar (append) só se faltar:
```css
.filter-group { min-width: 0; }
```
- [ ] **Step 5: Typecheck + build + smoke**
```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled successfully|Type error|/ "
docker compose restart frontend >/dev/null 2>&1; sleep 4
curl -s -o /dev/null -w "GET /: %{http_code}\n" http://localhost:3100/
```
Visual: input único de localização; "Datas" abre calendário e marca intervalo; slider com 2 alças e rótulos; Buscar filtra; Limpar zera.
- [ ] **Step 6: Commit** — `feat(filtros): barra unificada (loc + range de datas + slider duplo)`.

## Self-Review
- Cobertura: loc backend (T1) · RangeSlider 2 alças (T2) · DateRangePicker popover (T3) · barra unificada + lib + grid (T4). ✔
- Consistência: `Loc` param (T1) ↔ `loc` query (T4 lib); `RangeSlider`/`DateRangePicker` props ↔ uso em venue-filters (T4). ✔
- Risco: dois range inputs sobrepostos — `pointer-events` nos thumbs resolve o grab; overlap exato no mesmo valor é limitação menor aceitável.
