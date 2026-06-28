# Filtros Localização/Data/Valor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a barra de filtros por Localização (cidade/UF), Data (entrada/saída com disponibilidade) e Valor (faixa mín–máx com input + ElasticSlider portado).

**Architecture:** Backend estende `SearchPublishedVenues` (state, min_price, disponibilidade por datas). Frontend porta o ElasticSlider (TS+CSS), reescreve `venue-filters` com os 3 grupos e propaga os params em `lib.ts`/`venue-grid`.

**Tech Stack:** Go + sqlc + pgx; Next.js 15 + React 19 + TS strict + `motion/react`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-27-filtros-loc-data-valor.md`.
- **ElasticSlider portado** pra TS + CSS puro — sem `@chakra-ui/react`/`react-icons`. Lógica elástica idêntica.
- **Disponibilidade:** exclui espaços com reserva **não-cancelada** sobreposta a `[start,end)`. Datas só filtram se ambas presentes e `start < end`.
- **Valor:** faixa; `min_price`/`max_price` só quando > 0; garante `min ≤ max`. Teto do slider R$5.000, passo R$50.
- **Busca nunca 400/500 por filtro** (inválido → sentinela, como hoje).
- **sqlc:** após editar `.sql`, `sqlc generate` de `./backend` + `git add internal/db/sqlc/`.
- **Gates:** backend `go build`/`go test ./...`; frontend `npm run typecheck` + build no container.

---

### Task 1: Backend — busca ganha estado, min_price e disponibilidade

**Files:**
- Modify: `backend/internal/db/queries/venues.sql`
- Regenerate: `backend/internal/db/sqlc/`
- Modify: `backend/internal/venues/service.go`
- Modify: `backend/internal/venues/handler.go`

**Interfaces:**
- Produces: `GET /public/venues` aceita `state`, `min_price`, `start`, `end` (YYYY-MM-DD).

- [ ] **Step 1: Estender a query**

Em `backend/internal/db/queries/venues.sql`, na `SearchPublishedVenues`, adicionar as cláusulas antes do `ORDER BY`:
```sql
  AND (@state::text = '' OR lower(v.state) = lower(@state::text))
  AND (@min_price::numeric = 0 OR v.price_per_day >= @min_price::numeric)
  AND (
    @start::date IS NULL OR @end::date IS NULL OR NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.venue_id = v.id AND b.status <> 'CANCELLED'
        AND daterange(b.start_date, b.end_date, '[)') && daterange(@start::date, @end::date, '[)')
    )
  )
```
(Manter as cláusulas existentes de city/min_capacity/max_price/q/amenities.)

- [ ] **Step 2: Regerar sqlc + conferir os params**

Run (de `backend/`):
```bash
"$(go env GOPATH)/bin/sqlc" generate
sed -n '/type SearchPublishedVenuesParams/,/^}/p' internal/db/sqlc/venues.sql.go
```
Expected: o struct ganha `State string`, `MinPrice pgtype.Numeric`, `Start pgtype.Date`, `End pgtype.Date`.

- [ ] **Step 3: Service — filtros novos**

Em `backend/internal/venues/service.go`:

3a. Adicionar `"time"` ao import.

3b. `SearchFilters` ganha campos:
```go
type SearchFilters struct {
	City        string
	MinCapacity int32
	MaxPrice    string
	MinPrice    string
	State       string
	Start       *time.Time
	End         *time.Time
	Query       string
	Amenities   []string
}
```

3c. `buildSearchParams` — adicionar antes do `return p, nil`:
```go
	p.State = strings.TrimSpace(f.State)

	minStr := strings.TrimSpace(f.MinPrice)
	if minStr == "" {
		minStr = "0"
	}
	var mn pgtype.Numeric
	if err := mn.Scan(minStr); err != nil {
		return p, ErrInvalidPrice
	}
	p.MinPrice = mn

	// disponibilidade só quando as duas datas existem e start < end
	if f.Start != nil && f.End != nil && f.Start.Before(*f.End) {
		p.Start = pgtype.Date{Time: *f.Start, Valid: true}
		p.End = pgtype.Date{Time: *f.End, Valid: true}
	}
```
(O `p` já era `sqlc.SearchPublishedVenuesParams`; os novos campos `State`/`MinPrice`/`Start`/`End` existem após o regen. `Start`/`End` sem set ficam `Valid:false` = NULL.)

3d. `isEmpty()` inclui os novos:
```go
func (f SearchFilters) isEmpty() bool {
	return strings.TrimSpace(f.City) == "" && f.MinCapacity == 0 &&
		strings.TrimSpace(f.MaxPrice) == "" && strings.TrimSpace(f.MinPrice) == "" &&
		strings.TrimSpace(f.State) == "" && f.Start == nil && f.End == nil &&
		strings.TrimSpace(f.Query) == "" && len(f.Amenities) == 0
}
```

- [ ] **Step 4: Handler — parse dos novos params**

Em `backend/internal/venues/handler.go`:

4a. Adicionar `"time"` ao import.

4b. Em `parseSearchFilters`, antes do `return f`, adicionar:
```go
	f.State = q.Get("state")
	if mp := strings.TrimSpace(q.Get("min_price")); mp != "" {
		if v, err := strconv.ParseFloat(mp, 64); err == nil && !math.IsInf(v, 0) && !math.IsNaN(v) && v > 0 {
			f.MinPrice = mp
		}
	}
	if s, err := time.Parse("2006-01-02", strings.TrimSpace(q.Get("start"))); err == nil {
		f.Start = &s
	}
	if e, err := time.Parse("2006-01-02", strings.TrimSpace(q.Get("end"))); err == nil {
		f.End = &e
	}
```

- [ ] **Step 5: Build + testes + smoke**

Run:
```bash
docker compose exec -T backend go build ./... && docker compose exec -T backend go test ./...
docker compose restart backend >/dev/null 2>&1
for i in $(seq 1 20); do curl -sf http://localhost:8080/health >/dev/null 2>&1 && break; sleep 1; done
B=http://localhost:8080/api/v1
echo "estado SP:"; curl -s "$B/public/venues?state=SP" | python3 -c "import sys,json;print(' ',len(json.load(sys.stdin)),'resultados')"
echo "faixa 1000-1600:"; curl -s "$B/public/venues?min_price=1000&max_price=1600" | python3 -c "import sys,json;print(' ',len(json.load(sys.stdin)),'resultados')"
echo "disponibilidade 2026-09-01..03 (deve excluir o espaço reservado):"; curl -s "$B/public/venues?start=2026-09-01&end=2026-09-03" | python3 -c "import sys,json;d=json.load(sys.stdin);print(' ',len(d),'livres')"
```
Expected: build/test ok; SP retorna só os de SP; faixa filtra por preço; disponibilidade exclui quem tem reserva confirmada/pendente sobreposta.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/db/queries/venues.sql backend/internal/db/sqlc/ backend/internal/venues/service.go backend/internal/venues/handler.go
git commit -m "feat(busca): filtros de estado, preço mínimo e disponibilidade por datas"
```

---

### Task 2: ElasticSlider portado (TS + CSS)

**Files:**
- Create: `frontend/app/components/elastic-slider.tsx`
- Create: `frontend/app/components/elastic-slider.css`

**Interfaces:**
- Produces (Task 4): `<ElasticSlider value onChange startingValue maxValue isStepped stepSize leftIcon rightIcon />`.

- [ ] **Step 1: Componente**

`frontend/app/components/elastic-slider.tsx`:
```tsx
'use client';

import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import './elastic-slider.css';

const MAX_OVERFLOW = 50;

interface Props {
  value?: number;
  defaultValue?: number;
  startingValue?: number;
  maxValue?: number;
  className?: string;
  isStepped?: boolean;
  stepSize?: number;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  onChange?: (v: number) => void;
}

export default function ElasticSlider({
  value,
  defaultValue = 50,
  startingValue = 0,
  maxValue = 100,
  className = '',
  isStepped = false,
  stepSize = 1,
  leftIcon = <span className="es-ic">–</span>,
  rightIcon = <span className="es-ic">+</span>,
  onChange,
}: Props) {
  const [val, setVal] = useState<number>(value ?? defaultValue);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [region, setRegion] = useState<'left' | 'middle' | 'right'>('middle');
  const clientX = useMotionValue(0);
  const overflow = useMotionValue(0);
  const scale = useMotionValue(1);

  useEffect(() => {
    if (value !== undefined) setVal(value);
  }, [value]);

  useMotionValueEvent(clientX, 'change', (latest: number) => {
    if (!sliderRef.current) return;
    const { left, right } = sliderRef.current.getBoundingClientRect();
    let newValue: number;
    if (latest < left) {
      setRegion('left');
      newValue = left - latest;
    } else if (latest > right) {
      setRegion('right');
      newValue = latest - right;
    } else {
      setRegion('middle');
      newValue = 0;
    }
    overflow.jump(decay(newValue, MAX_OVERFLOW));
  });

  const commit = (v: number) => {
    setVal(v);
    onChange?.(v);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.buttons > 0 && sliderRef.current) {
      const { left, width } = sliderRef.current.getBoundingClientRect();
      let newValue = startingValue + ((e.clientX - left) / width) * (maxValue - startingValue);
      if (isStepped) newValue = Math.round(newValue / stepSize) * stepSize;
      newValue = Math.min(Math.max(newValue, startingValue), maxValue);
      commit(newValue);
      clientX.jump(e.clientX);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    handlePointerMove(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerUp = () => {
    animate(overflow, 0, { type: 'spring', bounce: 0.5 });
  };

  const rangePct = () => {
    const total = maxValue - startingValue;
    return total === 0 ? 0 : ((val - startingValue) / total) * 100;
  };

  return (
    <div className={`slider-container ${className}`}>
      <motion.div
        onHoverStart={() => animate(scale, 1.2)}
        onHoverEnd={() => animate(scale, 1)}
        onTouchStart={() => animate(scale, 1.2)}
        onTouchEnd={() => animate(scale, 1)}
        style={{ scale, opacity: useTransform(scale, [1, 1.2], [0.7, 1]) }}
        className="slider-wrapper"
      >
        <motion.div
          animate={{ scale: region === 'left' ? [1, 1.4, 1] : 1, transition: { duration: 0.25 } }}
          style={{ x: useTransform(() => (region === 'left' ? -overflow.get() / scale.get() : 0)) }}
        >
          {leftIcon}
        </motion.div>

        <div
          ref={sliderRef}
          className="slider-root"
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
        >
          <motion.div
            style={{
              scaleX: useTransform(() => {
                if (!sliderRef.current) return 1;
                const { width } = sliderRef.current.getBoundingClientRect();
                return 1 + overflow.get() / width;
              }),
              scaleY: useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.8]),
              transformOrigin: useTransform(() => {
                if (!sliderRef.current) return 'center';
                const { left, width } = sliderRef.current.getBoundingClientRect();
                return clientX.get() < left + width / 2 ? 'right' : 'left';
              }),
              height: useTransform(scale, [1, 1.2], [6, 12]),
              marginTop: useTransform(scale, [1, 1.2], [0, -3]),
              marginBottom: useTransform(scale, [1, 1.2], [0, -3]),
            }}
            className="slider-track-wrapper"
          >
            <div className="slider-track">
              <div className="slider-range" style={{ width: `${rangePct()}%` }} />
            </div>
          </motion.div>
        </div>

        <motion.div
          animate={{ scale: region === 'right' ? [1, 1.4, 1] : 1, transition: { duration: 0.25 } }}
          style={{ x: useTransform(() => (region === 'right' ? overflow.get() / scale.get() : 0)) }}
        >
          {rightIcon}
        </motion.div>
      </motion.div>
      <p className="value-indicator">{Math.round(val)}</p>
    </div>
  );
}

function decay(value: number, max: number): number {
  if (max === 0) return 0;
  const entry = value / max;
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
  return sigmoid * max;
}
```

- [ ] **Step 2: CSS**

`frontend/app/components/elastic-slider.css`:
```css
.slider-container { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6rem; width: 100%; }
.slider-wrapper { display: flex; width: 100%; touch-action: none; user-select: none; align-items: center; justify-content: center; gap: 0.75rem; }
.slider-root { position: relative; display: flex; width: 100%; max-width: 220px; flex-grow: 1; cursor: grab; touch-action: none; user-select: none; align-items: center; padding: 1rem 0; }
.slider-root:active { cursor: grabbing; }
.slider-track-wrapper { display: flex; flex-grow: 1; }
.slider-track { position: relative; height: 100%; flex-grow: 1; overflow: hidden; border-radius: 9999px; background-color: rgba(107, 79, 208, 0.18); }
.slider-range { position: absolute; height: 100%; background: var(--brand-gradient); border-radius: 9999px; }
.value-indicator { color: var(--brand-purple); position: absolute; transform: translateY(-1.1rem); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; }
.es-ic { color: #888; font-weight: 700; width: 18px; text-align: center; }
```

- [ ] **Step 3: Typecheck + build + commit**

```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled successfully|Type error"
git add frontend/app/components/elastic-slider.tsx frontend/app/components/elastic-slider.css
git commit -m "feat(filtros): ElasticSlider portado pra TS + CSS puro"
```
Expected: typecheck/build sem erros.

---

### Task 3: `lib.ts` — params de busca

**Files:**
- Modify: `frontend/app/venues/lib.ts`

**Interfaces:**
- Produces (Task 4): `VenueSearchParams` com `state`, `minPrice`, `startDate`, `endDate`; `searchVenues` envia `state`/`min_price`/`start`/`end`.

- [ ] **Step 1: Estender o tipo e a query**

Em `frontend/app/venues/lib.ts`:

1a. No `VenueSearchParams`, adicionar:
```ts
  state?: string;
  minPrice?: number;
  startDate?: string;
  endDate?: string;
```
1b. Em `PublicAPI.searchVenues`, após a linha do `maxPrice`, adicionar:
```ts
    if (params.state?.trim()) qs.set('state', params.state.trim());
    if (params.minPrice && params.minPrice > 0) qs.set('min_price', String(params.minPrice));
    if (params.startDate) qs.set('start', params.startDate);
    if (params.endDate) qs.set('end', params.endDate);
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo
git add frontend/app/venues/lib.ts
git commit -m "feat(filtros): params state/min_price/start/end no searchVenues"
```
Expected: typecheck sem erros.

---

### Task 4: `venue-filters` reescrito + `venue-grid` + estilos

**Files:**
- Modify: `frontend/app/components/venue-filters.tsx`
- Modify: `frontend/app/components/venue-grid.tsx`
- Modify: `frontend/app/globals.css` (append)

**Interfaces:**
- Consumes: `ElasticSlider`, `VenueSearchParams`.

- [ ] **Step 1: Reescrever `venue-filters.tsx`**

Substituir todo o arquivo por:
```tsx
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
    let lo = min, hi = max;
    if (lo > 0 && hi > 0 && lo > hi) [lo, hi] = [hi, lo];
    if (lo > 0) qs.set('min_price', String(lo));
    if (hi > 0) qs.set('max_price', String(hi));
    const query = qs.toString();
    router.push(query ? `/?${query}` : '/');
  }

  function clear() {
    setCity(''); setState(''); setStart(''); setEnd(''); setMin(0); setMax(0);
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
```

- [ ] **Step 2: `venue-grid.tsx` lê os novos params**

Em `frontend/app/components/venue-grid.tsx`, no objeto passado a `PublicAPI.searchVenues`, adicionar (junto dos existentes):
```tsx
      state: params.get('state') ?? undefined,
      minPrice: params.get('min_price') ? Number(params.get('min_price')) : undefined,
      startDate: params.get('start') ?? undefined,
      endDate: params.get('end') ?? undefined,
```

- [ ] **Step 3: Estilos**

Append em `frontend/app/globals.css`:
```css
/* ===== Filtros (localização/data/valor) ===== */
.filter-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; align-items: start; }
.filter-group .row { display: flex; gap: 10px; }
.filter-input.uf { max-width: 70px; text-transform: uppercase; }
.date-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #555; flex: 1; }
.price-row { display: flex; gap: 16px; }
.price-cell { display: flex; flex-direction: column; gap: 14px; flex: 1; }
```

- [ ] **Step 4: Typecheck + build no container**

```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled successfully|Type error|/ "
```
Expected: sem erros.

- [ ] **Step 5: Smoke**

```bash
docker compose restart frontend >/dev/null 2>&1
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3100/ && break; sleep 1; done
curl -s -o /dev/null -w "GET /: %{http_code}\n" http://localhost:3100/
```
No navegador (logado, ou role até o app): os 3 grupos aparecem; arrastar o slider sincroniza com o input; "Buscar" filtra por cidade/UF/datas/valor; "Limpar" zera. Datas escolhidas excluem espaços ocupados.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/venue-filters.tsx frontend/app/components/venue-grid.tsx frontend/app/globals.css
git commit -m "feat(filtros): barra Localização/Data/Valor com ElasticSlider"
```

---

## Self-Review

- **Cobertura da spec:** SQL state/min_price/disponibilidade (T1) · SearchFilters/params/isEmpty/parse (T1) · ElasticSlider portado TS+CSS sem Chakra/react-icons + onChange/value (T2) · lib params (T3) · 3 grupos + 2 sliders sincronizados + min≤max + datas válidas (T4) · venue-grid repassa (T4). ✔
- **Consistência:** `SearchPublishedVenuesParams{State,MinPrice,Start,End}` (T1) usados em buildSearchParams (T1); `ElasticSlider` props `value`/`onChange` (T2) usados em venue-filters (T4); `VenueSearchParams` (T3) consumido por venue-grid (T4). ✔
- **Sem placeholders:** código real em todos os passos. ✔
- **Risco conhecido:** sliders controlados por `value` + `onChange` — ao arrastar, `onChange` atualiza o estado pai → `value` volta igual (sem jitter, pois o `useEffect` seta o mesmo número). Datas como string ISO comparáveis por `<` (mesmo formato `YYYY-MM-DD`).
