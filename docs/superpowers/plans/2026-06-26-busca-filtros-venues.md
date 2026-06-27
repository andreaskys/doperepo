# Busca e Filtros na Listagem Pública — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir filtrar a listagem pública de espaços por cidade, capacidade mínima, preço máximo, texto livre e comodidades (combinando via AND), com estado na URL.

**Architecture:** Query única no sqlc com guarda sentinela (filtro vazio = sem filtro). O handler parseia query params da URL para `SearchFilters`; o service normaliza e monta os params do sqlc; o frontend tem uma barra de filtros que escreve na URL e uma grade que lê a URL e busca. Cache Redis fica fora deste plano.

**Tech Stack:** Go + Gin, pgx/sqlc, PostgreSQL · Next.js 15 + React 19 + TypeScript (strict).

## Global Constraints

- **Backend type-safety:** toda query nova passa por **sqlc** (decisão de `docs/decisions.md`). Após editar `internal/db/queries/venues.sql`, rodar `sqlc generate` a partir de `./backend`.
- **Frontend:** TypeScript **strict**. Tipos de domínio centralizados em `frontend/app/venues/lib.ts` — reusar, não redeclarar.
- **UI/animação (`docs/design.md`):** durações <300ms; só `transform`/`opacity`; nunca `transition: all` nem `ease-in`; respeitar `prefers-reduced-motion`; chips e tokens `--brand-*` já existentes.
- **Escopo fixo:** `LIMIT 60`, sem paginação; sem cache Redis; texto livre via `ILIKE` (sem trigram).
- **A listagem nunca quebra:** params inválidos (número malformado, comodidade desconhecida) viram sentinela/descarte — nunca retornam 400.
- **Gates de verificação (`CLAUDE.md`):** backend `cd backend && go test ./...` e `go build ./...`; frontend `cd frontend && npm run typecheck && npm run build`.

---

## File Structure

**Backend**
- Modify: `backend/internal/db/queries/venues.sql` — troca `ListPublishedVenues` por `SearchPublishedVenues`.
- Regenerate: `backend/internal/db/sqlc/venues.sql.go` — via `sqlc generate` (não editar à mão).
- Modify: `backend/internal/venues/service.go` — `ListPublished` → `Search` + helpers puros `sanitizeAmenities`, `buildSearchParams`.
- Modify: `backend/internal/venues/handler.go` — `listPublic` lê query params via `parseSearchFilters`.
- Create: `backend/internal/venues/search_test.go` — unit tests puros (sem DB).
- Create: `backend/migrations/0004_venue_search_indexes.sql` — índices de busca.

**Frontend**
- Modify: `frontend/app/venues/lib.ts` — `PublicAPI.searchVenues` + `VenueSearchParams`.
- Create: `frontend/app/components/venue-filters.tsx` — barra de filtros (escreve URL).
- Modify: `frontend/app/components/venue-grid.tsx` — lê URL, busca filtrada, estado vazio distinto.
- Modify: `frontend/app/page.tsx` — `<Suspense>` envolvendo filtros + grade.
- Modify: `frontend/app/globals.css` — estilos `.venue-filters` / `.filter-input` / `.filter-actions`.

---

## Task 1: SQL `SearchPublishedVenues` + sqlc generate

**Files:**
- Modify: `backend/internal/db/queries/venues.sql`
- Regenerate: `backend/internal/db/sqlc/venues.sql.go`

**Interfaces:**
- Produces: query/método sqlc `SearchPublishedVenues(ctx, SearchPublishedVenuesParams) ([]SearchPublishedVenuesRow, error)`. `SearchPublishedVenuesParams{ City string; MinCapacity int32; MaxPrice pgtype.Numeric; Q string; Amenities []string }`. `SearchPublishedVenuesRow` tem os mesmos campos de `ListPublishedVenuesRow` (ID, Title, Description, Capacity, PricePerDay pgtype.Numeric, City, State, CoverUrl).

- [ ] **Step 1: Garantir o sqlc instalado**

Run: `sqlc version`
Se faltar: `go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest` (ou rodar via Docker: `docker run --rm -v "$(pwd)/backend:/src" -w /src sqlc/sqlc generate`).

- [ ] **Step 2: Substituir a query `ListPublishedVenues` por `SearchPublishedVenues`**

Em `backend/internal/db/queries/venues.sql`, troque o bloco `-- name: ListPublishedVenues :many ...` por:

```sql
-- name: SearchPublishedVenues :many
-- Listagem pública com filtros opcionais (sentinela vazio = sem filtro).
SELECT
    v.id, v.title, v.description, v.capacity, v.price_per_day, v.city, v.state,
    COALESCE((SELECT p.url FROM venue_photos p WHERE p.venue_id = v.id ORDER BY p.position, p.id LIMIT 1), '')::text AS cover_url
FROM venues v
WHERE v.status = 'PUBLISHED'
  AND (@city::text = '' OR lower(v.city) = lower(@city::text))
  AND (@min_capacity::int = 0 OR v.capacity >= @min_capacity::int)
  AND (@max_price::numeric = 0 OR v.price_per_day <= @max_price::numeric)
  AND (@q::text = '' OR v.title ILIKE '%' || @q::text || '%' OR v.description ILIKE '%' || @q::text || '%')
  AND (cardinality(@amenities::text[]) = 0 OR v.amenities @> @amenities::text[])
ORDER BY v.created_at DESC
LIMIT 60;
```

- [ ] **Step 3: Gerar o código sqlc**

Run: `cd backend && sqlc generate`
Expected: sem erros; `internal/db/sqlc/venues.sql.go` passa a ter `SearchPublishedVenuesParams`, `SearchPublishedVenuesRow` e o método `SearchPublishedVenues`. (`ListPublishedVenues` deixa de existir.)

- [ ] **Step 4: Confirmar os tipos gerados dos params**

Run: `grep -n "type SearchPublishedVenuesParams" -A8 backend/internal/db/sqlc/venues.sql.go`
Expected: campos `City string`, `MinCapacity int32`, `MaxPrice pgtype.Numeric`, `Q string`, `Amenities []string`. Se algum vier como `interface{}`/tipo errado, os casts `::text/::int/::numeric/::text[]` da query garantem a inferência — confira se foram mantidos.

- [ ] **Step 5: Verificar build (vai falhar no service — esperado)**

Run: `cd backend && go build ./... 2>&1 | head`
Expected: erro em `internal/venues/service.go` referenciando `ListPublishedVenues` (removida). Isso é esperado e será corrigido na Task 2/3. Não commitar ainda.

> Observação: Task 1 não tem commit isolado porque a remoção da query quebra o build até a Task 3. Commit acontece ao final da Task 3.

---

## Task 2: Service — helpers puros + método `Search`

**Files:**
- Modify: `backend/internal/venues/service.go`
- Create: `backend/internal/venues/search_test.go`

**Interfaces:**
- Consumes: `SearchPublishedVenues` (Task 1); `allowedAmenities`, `ErrInvalidPrice`, `pgtype` (já em `service.go`).
- Produces:
  - `type SearchFilters struct { City string; MinCapacity int32; MaxPrice string; Query string; Amenities []string }`
  - `func sanitizeAmenities(in []string) []string`
  - `func buildSearchParams(f SearchFilters) (sqlc.SearchPublishedVenuesParams, error)`
  - `func (s *Service) Search(ctx context.Context, f SearchFilters) ([]sqlc.SearchPublishedVenuesRow, error)`

- [ ] **Step 1: Escrever os testes que falham**

Crie `backend/internal/venues/search_test.go`:

```go
package venues

import (
	"reflect"
	"testing"
)

func TestSanitizeAmenities(t *testing.T) {
	got := sanitizeAmenities([]string{"wifi", "inexistente", "piscina"})
	if want := []string{"wifi", "piscina"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("esperava %v, veio %v", want, got)
	}
	if got := sanitizeAmenities(nil); len(got) != 0 {
		t.Fatalf("nil deveria virar slice vazio, veio %v", got)
	}
}

func TestBuildSearchParams(t *testing.T) {
	p, err := buildSearchParams(SearchFilters{
		City: "  Rio  ", MinCapacity: 10, MaxPrice: "", Query: "  festa ",
		Amenities: []string{"wifi", "xxx"},
	})
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if p.City != "Rio" || p.Q != "festa" || p.MinCapacity != 10 {
		t.Fatalf("trim/campos incorretos: %+v", p)
	}
	if !reflect.DeepEqual(p.Amenities, []string{"wifi"}) {
		t.Fatalf("amenities não sanitizadas: %v", p.Amenities)
	}
	if !p.MaxPrice.Valid {
		t.Fatal("MaxPrice vazio deveria virar numeric válido (sentinela 0)")
	}
	if _, err := buildSearchParams(SearchFilters{MaxPrice: "abc"}); err == nil {
		t.Fatal("preço inválido deveria retornar erro")
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && go test ./internal/venues/... 2>&1 | head`
Expected: FALHA de compilação ("undefined: sanitizeAmenities", "undefined: buildSearchParams", "SearchFilters").

- [ ] **Step 3: Implementar `SearchFilters`, helpers e `Search` em `service.go`**

Remova o método `ListPublished` e adicione (mantendo os imports `context`, `strings`, `pgtype`, e o pacote `sqlc` já presentes):

```go
type SearchFilters struct {
	City        string   // "" = sem filtro
	MinCapacity int32    // 0  = sem filtro
	MaxPrice    string   // "" = sem filtro (parseado p/ numeric)
	Query       string   // "" = sem filtro
	Amenities   []string // vazio = sem filtro
}

// sanitizeAmenities mantém só comodidades conhecidas (descarta o resto em silêncio).
func sanitizeAmenities(in []string) []string {
	out := make([]string, 0, len(in))
	for _, a := range in {
		if allowedAmenities[a] {
			out = append(out, a)
		}
	}
	return out
}

// buildSearchParams normaliza os filtros e monta os params do sqlc.
func buildSearchParams(f SearchFilters) (sqlc.SearchPublishedVenuesParams, error) {
	p := sqlc.SearchPublishedVenuesParams{
		City:        strings.TrimSpace(f.City),
		MinCapacity: f.MinCapacity,
		Q:           strings.TrimSpace(f.Query),
		Amenities:   sanitizeAmenities(f.Amenities),
	}
	priceStr := strings.TrimSpace(f.MaxPrice)
	if priceStr == "" {
		priceStr = "0" // sentinela: sem filtro de preço
	}
	var n pgtype.Numeric
	if err := n.Scan(priceStr); err != nil {
		return p, ErrInvalidPrice
	}
	p.MaxPrice = n
	return p, nil
}

// Search é a listagem pública com filtros opcionais (item #3 do MVP).
func (s *Service) Search(ctx context.Context, f SearchFilters) ([]sqlc.SearchPublishedVenuesRow, error) {
	params, err := buildSearchParams(f)
	if err != nil {
		return nil, err
	}
	return s.q.SearchPublishedVenues(ctx, params)
}
```

- [ ] **Step 4: Rodar os testes (o handler ainda referencia `ListPublished` → build do pacote falha)**

Run: `cd backend && go test ./internal/venues/... 2>&1 | head`
Expected: ainda FALHA de compilação, agora por `h.svc.ListPublished` em `handler.go` (resolvido na Task 3). Os novos símbolos já existem — sem "undefined" para `sanitizeAmenities`/`buildSearchParams`/`SearchFilters`.

> Sem commit nesta task: o pacote `venues` só volta a compilar ao final da Task 3.

---

## Task 3: Handler — `parseSearchFilters` + `listPublic` usando `Search`

**Files:**
- Modify: `backend/internal/venues/handler.go`
- Modify: `backend/internal/venues/search_test.go`

**Interfaces:**
- Consumes: `SearchFilters`, `Service.Search` (Task 2); `publicVenueResp`, `priceString` (já em `handler.go`).
- Produces: `func parseSearchFilters(q url.Values) SearchFilters`; `listPublic` passa a usar `Search`.

- [ ] **Step 1: Adicionar o teste de `parseSearchFilters` (falha)**

Acrescente em `backend/internal/venues/search_test.go` (e o import `"net/url"`):

```go
func TestParseSearchFilters(t *testing.T) {
	if f := parseSearchFilters(url.Values{}); f.City != "" || f.MinCapacity != 0 ||
		f.MaxPrice != "" || f.Query != "" || len(f.Amenities) != 0 {
		t.Fatalf("vazio deveria dar sentinelas, veio %+v", f)
	}

	q := url.Values{}
	q.Set("city", "São Paulo")
	q.Set("min_capacity", "50")
	q.Set("max_price", "1200.50")
	q.Set("q", "salão")
	q.Set("amenities", "wifi, piscina ,")
	f := parseSearchFilters(q)
	if f.City != "São Paulo" || f.MinCapacity != 50 || f.MaxPrice != "1200.50" || f.Query != "salão" {
		t.Fatalf("parse incorreto: %+v", f)
	}
	if !reflect.DeepEqual(f.Amenities, []string{"wifi", "piscina"}) {
		t.Fatalf("amenities CSV incorreto: %v", f.Amenities)
	}

	bad := url.Values{}
	bad.Set("min_capacity", "abc")
	bad.Set("max_price", "xyz")
	f = parseSearchFilters(bad)
	if f.MinCapacity != 0 {
		t.Fatalf("min_capacity inválido deveria ser 0, veio %d", f.MinCapacity)
	}
	if f.MaxPrice != "" {
		t.Fatalf("max_price inválido deveria ser vazio, veio %q", f.MaxPrice)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && go test ./internal/venues/... 2>&1 | head`
Expected: FALHA ("undefined: parseSearchFilters"), ainda mais o erro de `ListPublished` no handler.

- [ ] **Step 3: Implementar `parseSearchFilters` e trocar `listPublic` em `handler.go`**

Adicione os imports `"net/url"` e `"strings"` ao bloco de imports de `handler.go` (já existe `"strconv"`). Adicione a função:

```go
// parseSearchFilters lê os filtros da query string. Valores inválidos viram
// sentinela (a listagem pública nunca retorna 400 por causa de filtro).
func parseSearchFilters(q url.Values) SearchFilters {
	f := SearchFilters{
		City:  q.Get("city"),
		Query: q.Get("q"),
	}
	if n, err := strconv.Atoi(strings.TrimSpace(q.Get("min_capacity"))); err == nil && n > 0 {
		f.MinCapacity = int32(n)
	}
	if mp := strings.TrimSpace(q.Get("max_price")); mp != "" {
		if _, err := strconv.ParseFloat(mp, 64); err == nil {
			f.MaxPrice = mp
		}
	}
	if a := strings.TrimSpace(q.Get("amenities")); a != "" {
		for _, part := range strings.Split(a, ",") {
			if p := strings.TrimSpace(part); p != "" {
				f.Amenities = append(f.Amenities, p)
			}
		}
	}
	return f
}
```

Troque o corpo de `listPublic` (a 1ª linha) de:

```go
	vs, err := h.svc.ListPublished(c.Request.Context())
```

para:

```go
	vs, err := h.svc.Search(c.Request.Context(), parseSearchFilters(c.Request.URL.Query()))
```

(O resto de `listPublic` — o loop que monta `publicVenueResp` — permanece igual; `SearchPublishedVenuesRow` tem os mesmos campos.)

- [ ] **Step 4: Rodar os testes (agora passam)**

Run: `cd backend && go test ./internal/venues/... -v 2>&1 | tail -20`
Expected: PASS em `TestSanitizeAmenities`, `TestBuildSearchParams`, `TestParseSearchFilters`.

- [ ] **Step 5: Build completo do backend**

Run: `cd backend && go build ./... && go vet ./internal/venues/...`
Expected: sem erros (pacote `venues` volta a compilar).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/db/queries/venues.sql backend/internal/db/sqlc/venues.sql.go \
        backend/internal/venues/service.go backend/internal/venues/handler.go \
        backend/internal/venues/search_test.go
git commit -m "feat(venues): busca/filtros na listagem pública (sqlc + handler)"
```

---

## Task 4: Migração de índices de busca

**Files:**
- Create: `backend/migrations/0004_venue_search_indexes.sql`

**Interfaces:**
- Consumes: schema `venues` (colunas `city`, `capacity`, `price_per_day`, `amenities`).
- Produces: índices que aceleram os filtros (perf; a feature funciona sem eles).

- [ ] **Step 1: Criar a migração**

Crie `backend/migrations/0004_venue_search_indexes.sql`:

```sql
-- Índices p/ a busca pública (item #3). lower(city) casa com o filtro
-- lower(v.city) = lower($1); GIN em amenities acelera o operador @>.
-- Texto livre (ILIKE '%q%') fica sem índice no MVP (trigram é melhoria futura).
CREATE INDEX IF NOT EXISTS idx_venues_city      ON venues (lower(city));
CREATE INDEX IF NOT EXISTS idx_venues_capacity  ON venues (capacity);
CREATE INDEX IF NOT EXISTS idx_venues_price     ON venues (price_per_day);
CREATE INDEX IF NOT EXISTS idx_venues_amenities ON venues USING gin (amenities);
```

- [ ] **Step 2: Aplicar em DB de dev novo (volume limpo)**

Run: `docker compose down -v && docker compose up --build -d postgres`
Expected: Postgres sobe e roda `0001`→`0004` no initdb. (Se quiser preservar dados existentes, em vez do `down -v`, rode o SQL acima manualmente via Adminer em http://localhost:8081 ou `docker compose exec postgres psql ...`.)

- [ ] **Step 3: Conferir que os índices existem**

Run: `docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\di idx_venues_*"`
Expected: lista `idx_venues_city`, `idx_venues_capacity`, `idx_venues_price`, `idx_venues_amenities`.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/0004_venue_search_indexes.sql
git commit -m "feat(venues): índices para a busca pública"
```

---

## Task 5: Frontend — `PublicAPI.searchVenues` em `lib.ts`

**Files:**
- Modify: `frontend/app/venues/lib.ts`

**Interfaces:**
- Consumes: `API` (já no topo de `lib.ts`), tipo `Venue`.
- Produces:
  - `interface VenueSearchParams { city?: string; minCapacity?: number; maxPrice?: number; q?: string; amenities?: string[] }`
  - `PublicAPI.searchVenues(params: VenueSearchParams): Promise<Venue[]>`

- [ ] **Step 1: Adicionar o tipo e o helper no fim de `lib.ts`**

```ts
export interface VenueSearchParams {
  city?: string;
  minCapacity?: number;
  maxPrice?: number;
  q?: string;
  amenities?: string[];
}

// Endpoint público (sem auth) — não passa pelo req()/401.
export const PublicAPI = {
  searchVenues: async (params: VenueSearchParams): Promise<Venue[]> => {
    const qs = new URLSearchParams();
    if (params.city?.trim()) qs.set('city', params.city.trim());
    if (params.minCapacity && params.minCapacity > 0) qs.set('min_capacity', String(params.minCapacity));
    if (params.maxPrice && params.maxPrice > 0) qs.set('max_price', String(params.maxPrice));
    if (params.q?.trim()) qs.set('q', params.q.trim());
    if (params.amenities?.length) qs.set('amenities', params.amenities.join(','));
    const query = qs.toString();
    const res = await fetch(`${API}/api/v1/public/venues${query ? `?${query}` : ''}`);
    if (!res.ok) throw new Error('Erro ao carregar espaços');
    return res.json();
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: exit 0, sem erros.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/venues/lib.ts
git commit -m "feat(front): PublicAPI.searchVenues com filtros"
```

---

## Task 6: Frontend — componente `VenueFilters` + CSS

**Files:**
- Create: `frontend/app/components/venue-filters.tsx`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `AMENITIES` de `../venues/lib`; `useRouter`/`useSearchParams` de `next/navigation`.
- Produces: `export default function VenueFilters()` — escreve os filtros na URL (`/?city=..`).

- [ ] **Step 1: Criar `venue-filters.tsx`**

```tsx
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
```

- [ ] **Step 2: Adicionar CSS no fim de `globals.css`**

```css
/* --- Filtros da busca (home) --- */
.venue-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1.5rem;
}
.filter-input {
  flex: 1 1 180px;
  min-width: 140px;
}
.filter-actions {
  display: flex;
  gap: 0.5rem;
  flex-basis: 100%;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/venue-filters.tsx frontend/app/globals.css
git commit -m "feat(front): barra de filtros da busca"
```

---

## Task 7: Frontend — `venue-grid` lê a URL + `page` com Suspense

**Files:**
- Modify: `frontend/app/components/venue-grid.tsx`
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `PublicAPI.searchVenues` (Task 5), `VenueFilters` (Task 6), `useSearchParams`.
- Produces: grade que refaz a busca quando a URL muda; estado vazio distinto com/sem filtros.

- [ ] **Step 1: Reescrever `venue-grid.tsx`**

```tsx
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
      <p className="muted">Nenhum espaço encontrado com esses filtros.</p>
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
```

- [ ] **Step 2: Envolver filtros + grade em `<Suspense>` na `page.tsx`**

`useSearchParams` exige um limite de Suspense numa página estática (Next 15). Reescreva `frontend/app/page.tsx`:

```tsx
import { Suspense } from 'react';
import VenueGrid from './components/venue-grid';
import VenueFilters from './components/venue-filters';
import Footer from './components/footer';

export default function Home() {
  return (
    <>
      <main className="home">
        <section className="hero">
          <h1>Encontre o espaço perfeito para o seu evento</h1>
          <p>Casamentos, festas e festivais — alugue direto com o anfitrião.</p>
        </section>
        <section className="home-section">
          <h2>Espaços em destaque</h2>
          <Suspense fallback={<p className="muted">Carregando…</p>}>
            <VenueFilters />
            <VenueGrid />
          </Suspense>
        </section>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: exit 0; build gera as páginas (a `/` pode passar de estática para incluir um limite de Suspense — sem erro).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/venue-grid.tsx frontend/app/page.tsx
git commit -m "feat(front): grade lê filtros da URL + Suspense na home"
```

---

## Task 8: Verificação integrada (smoke manual)

**Files:** nenhum (validação ponta a ponta).

- [ ] **Step 1: Gates automáticos**

Run: `cd backend && go test ./... && go build ./...`
Run: `cd frontend && npm run typecheck && npm run build`
Expected: tudo verde.

- [ ] **Step 2: Subir a stack**

Run: `docker compose up --build -d`
Expected: backend em :8080, frontend em :3000. (Lembrete `CLAUDE.md`: no Windows+Docker, ao adicionar arquivos novos rode `docker compose restart frontend backend`.)

- [ ] **Step 3: Testar a API direto (com pelo menos 1 venue publicada no banco)**

```bash
curl -s "http://localhost:8080/api/v1/public/venues" | head -c 300            # sem filtro
curl -s "http://localhost:8080/api/v1/public/venues?min_capacity=50" | head   # capacidade
curl -s "http://localhost:8080/api/v1/public/venues?city=São%20Paulo" | head  # cidade
curl -s "http://localhost:8080/api/v1/public/venues?max_price=1000" | head    # preço
curl -s "http://localhost:8080/api/v1/public/venues?q=salao" | head           # texto
curl -s "http://localhost:8080/api/v1/public/venues?amenities=wifi,piscina" | head
curl -s "http://localhost:8080/api/v1/public/venues?min_capacity=abc" | head  # inválido → não quebra
```
Expected: cada chamada retorna `200` e um array JSON coerente; `min_capacity=abc` retorna a listagem normal (sem 400).

- [ ] **Step 4: Testar a UI**

Abra http://localhost:3000, use a barra de filtros, clique **Buscar**: a URL vira `/?city=..&min_capacity=..` e a grade atualiza. Recarregue a página → os filtros persistem (vêm da URL). "Limpar filtros" volta para `/`. Busca sem resultados mostra "Nenhum espaço encontrado com esses filtros."

- [ ] **Step 5: Atualizar o checklist do MVP**

Em `docs/mvp-checklist.md`, item #3: mudar 🟡 para ✅ na parte de busca/filtros, anotando que **cache Redis segue pendente** (fora do escopo deste plano).

```bash
git add docs/mvp-checklist.md
git commit -m "docs: item #3 do MVP — busca/filtros concluída (cache ainda pendente)"
```

---

## Notas de execução

- **Sem harness de teste com DB:** o repo só tem unit tests puros (ex.: `bookings/service_test.go`). Por isso o TDD aqui cobre a lógica pura (`sanitizeAmenities`, `buildSearchParams`, `parseSearchFilters`); o comportamento do SQL é validado no smoke manual da Task 8 (mesmo espírito da "prova" manual de concorrência do MVP).
- **`sqlc generate` é obrigatório** após a Task 1 — o arquivo `internal/db/sqlc/venues.sql.go` é gerado, não editado à mão.
- **Cache Redis, paginação e trigram** ficam fora deste plano (anotados como futuro na spec).
```
