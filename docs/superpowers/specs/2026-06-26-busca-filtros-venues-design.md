# Design — Busca e filtros na listagem pública de espaços

**Data:** 2026-06-26
**Item do MVP:** #3 (parcial → completa a parte de busca/filtros)
**Escopo desta spec:** APENAS busca + filtros. **Cache Redis fica adiado** para
uma iteração futura (decisão do brainstorming).

## Objetivo

Permitir que o visitante encontre espaços publicados filtrando por **cidade**,
**capacidade mínima**, **faixa de preço (máximo/dia)**, **texto livre**
(título/descrição) e **comodidades**. Filtros combinam via **E** (AND). Hoje a
listagem pública (`GET /api/v1/public/venues`) retorna todos os publicados sem
qualquer filtro (`ORDER BY created_at DESC LIMIT 60`).

## Contexto

- Listagem atual: `internal/db/queries/venues.sql` → `ListPublishedVenues` →
  `venues.Service.ListPublished` → `handler.listPublic` → grade em
  `frontend/app/components/venue-grid.tsx`.
- Stack e arquitetura: ver `docs/stack.md`, `docs/architecture.md`. Decisão
  `pgx + sqlc` (type-safe) em `docs/decisions.md`.
- Schema: `venues` tem `city`, `state`, `capacity` (INT), `price_per_day`
  (NUMERIC(12,2)), `amenities` (text[]), `status`. Migrations já vão até
  `0003_venue_features.sql`.

## Decisões desta feature

| Decisão | Escolha | Por quê |
| --- | --- | --- |
| Montagem da query | **Query única no sqlc com guarda sentinela** (Abordagem A) | Mantém o type-safe do sqlc (honra `decisions.md`), um único caminho de código, testável. Volume MVP (`LIMIT 60`) não pede builder dinâmico. |
| Aplicação dos filtros | **Botão "Buscar" + estado na URL** (`?city=..`) | URL compartilhável/favoritável, menos requisições, idiomático no Next.js App Router. |
| Cache Redis | **Adiado** | Fora do escopo; entra quando o tráfego pedir. |
| Comodidade inválida no filtro | **Descartada em silêncio** | Busca é tolerante; não faz sentido dar 400 numa listagem pública. |
| Paginação | **Sem paginação; `LIMIT 60` fixo** | YAGNI no MVP. "Load more" fica para depois se necessário. |
| Texto livre | **`ILIKE '%q%'` em título/descrição** | Simples e suficiente no MVP; full-text/trigram fica anotado como futuro. |

## Arquitetura

### 1. SQL (`internal/db/queries/venues.sql`)

Substituir `ListPublishedVenues` por `SearchPublishedVenues :many`, **mesmas
colunas de saída** (id, title, description, capacity, price_per_day, city, state,
cover_url):

```sql
-- name: SearchPublishedVenues :many
-- Listagem pública com filtros opcionais (sentinela vazio = sem filtro).
SELECT
    v.id, v.title, v.description, v.capacity, v.price_per_day, v.city, v.state,
    COALESCE((SELECT p.url FROM venue_photos p WHERE p.venue_id = v.id ORDER BY p.position, p.id LIMIT 1), '')::text AS cover_url
FROM venues v
WHERE v.status = 'PUBLISHED'
  AND (@city = ''                  OR v.city ILIKE @city)
  AND (@min_capacity::int = 0      OR v.capacity >= @min_capacity)
  AND (@max_price::numeric = 0     OR v.price_per_day <= @max_price)
  AND (@q = ''                     OR v.title ILIKE '%' || @q || '%' OR v.description ILIKE '%' || @q || '%')
  AND (cardinality(@amenities::text[]) = 0 OR v.amenities @> @amenities)
ORDER BY v.created_at DESC
LIMIT 60;
```

Chamada sem filtros (todos os sentinelas vazios) = comportamento idêntico ao de
hoje. **Requer `sqlc generate` a partir de `./backend`** (config em `sqlc.yaml`).
A query antiga `ListPublishedVenues` é removida (caminho único).

### 2. Service (`internal/venues/service.go`)

Trocar `ListPublished(ctx)` por:

```go
type SearchFilters struct {
    City        string   // "" = sem filtro
    MinCapacity int32    // 0  = sem filtro
    MaxPrice    string   // "" = sem filtro (parseado p/ numeric)
    Query       string   // "" = sem filtro
    Amenities   []string // vazio = sem filtro
}

func (s *Service) Search(ctx context.Context, f SearchFilters) ([]sqlc.SearchPublishedVenuesRow, error)
```

Normalização dentro do `Search`:
- `City`, `Query`: `strings.TrimSpace`. Para `City`, montar `ILIKE` exato por
  cidade (o handler/serviço decide se envolve `%`; no MVP a comparação é por
  igualdade case-insensitive: `@city = nome` via `ILIKE` sem curingas).
- `MaxPrice`: reusar lógica de `parsePrice`; vazio → sentinela numérico 0.
- `Amenities`: **descartar as que não estão em `allowedAmenities`** (silencioso).
- Montar `sqlc.SearchPublishedVenuesParams` e chamar a query.

### 3. Handler (`internal/venues/handler.go`)

`listPublic` passa a ler query params e montar `SearchFilters`:

| Query param | Tipo | Sentinela |
| --- | --- | --- |
| `city` | string | "" |
| `min_capacity` | int (parse tolerante) | 0 |
| `max_price` | string/decimal | "" |
| `q` | string | "" |
| `amenities` | CSV (`a,b,c`) | vazio |

Parse numérico inválido → sentinela (NUNCA retorna 400; a listagem sempre
responde). Saída mapeada para `publicVenueResp` (inalterado). Erro de DB → 500
"erro ao listar" (igual hoje).

### 4. Frontend

- **`app/venues/lib.ts`** — novo helper público (endpoint sem auth, não usa `req`/401):
  ```ts
  export interface VenueSearchParams {
    city?: string; minCapacity?: number; maxPrice?: number; q?: string; amenities?: string[];
  }
  export const PublicAPI = {
    searchVenues: (params: VenueSearchParams) => Promise<Venue[]>, // monta querystring + fetch
  };
  ```
- **`app/components/venue-filters.tsx`** (novo) — barra de filtros: cidade
  (input), capacidade mín. (number), preço máx. (number), texto (input), chips de
  comodidades (reusa `AMENITIES`). Botão **Buscar** → `router.push('/?'+qs)`.
  Valores iniciais lidos de `useSearchParams`. Botão "Limpar filtros".
- **`app/components/venue-grid.tsx`** — lê `useSearchParams`, chama
  `PublicAPI.searchVenues(...)`, refaz fetch quando a URL muda.
- **`app/page.tsx`** — segue server component; envolver filtros+grid em
  `<Suspense>` (exigência do `useSearchParams` no Next 15 em página estática).
- Visual conforme `docs/design.md`: chips, tokens `--brand-*`, durações <300ms,
  só `transform`/`opacity`, respeitar `prefers-reduced-motion`.

### 5. Índices (`backend/migrations/0004_venue_search_indexes.sql`)

```sql
CREATE INDEX IF NOT EXISTS idx_venues_city  ON venues (lower(city));
CREATE INDEX IF NOT EXISTS idx_venues_capacity ON venues (capacity);
CREATE INDEX IF NOT EXISTS idx_venues_price ON venues (price_per_day);
CREATE INDEX IF NOT EXISTS idx_venues_amenities ON venues USING gin (amenities);
```

ILIKE de texto fica **sem** índice trigram no MVP (seq scan aceitável nessa
escala; trigram/`pg_trgm` anotado como melhoria futura).

⚠️ Migrations são initdb (dev) — só aplicam em **volume novo**. Em DB de dev já
existente, rodar o `0004` manualmente (via Adminer ou `docker compose exec`).
Os índices são só performance; a feature funciona sem eles.

## Fluxo de dados

```
URL ?city=..&min_capacity=..  →  venue-filters (lê/escreve URL)
  →  venue-grid (lê URL)  →  PublicAPI.searchVenues
  →  GET /api/v1/public/venues?city=..  →  handler.listPublic
  →  service.Search  →  SearchPublishedVenues (sqlc)  →  Postgres
  →  JSON publicVenueResp[]  →  grade renderiza
```

## Tratamento de erros e estados

- Param numérico inválido → ignorado (sem filtro), listagem nunca quebra.
- Erro de DB → HTTP 500 `{"error":"erro ao listar"}` (comportamento atual).
- Erro de rede no front → mensagem de erro existente na grade.
- **Resultado vazio COM filtros** → mensagem distinta: "Nenhum espaço encontrado
  com esses filtros." + ação "Limpar filtros". Diferente do estado "nenhum
  publicado ainda" (sem filtros).

## Testes

`go test ./internal/venues/...`, seguindo o padrão de
`internal/bookings/service_test.go`. Casos para `Search` (tabela):
1. Sem filtros → retorna todos os publicados (= listagem atual).
2. Cada filtro isolado: cidade, capacidade mín., preço máx., texto, comodidade.
3. Combinação (AND) de 2+ filtros.
4. Comodidade inválida → descartada (não filtra por ela, não dá erro).
5. `min_capacity`/`max_price` inválidos no handler → tratados como sentinela.
6. Não publicados nunca aparecem, independente dos filtros.

Gates de verificação (de `CLAUDE.md`):
- Backend: `docker compose exec backend go test ./...`
- Frontend: `npm run typecheck` e `npm run build` (em `frontend/`)

## Fora de escopo (anotado para o futuro)

- Cache Redis da listagem.
- Paginação / "load more".
- Full-text / trigram (`pg_trgm`) no texto livre.
- Filtro por disponibilidade de datas, ordenação configurável (preço, capacidade).
```
