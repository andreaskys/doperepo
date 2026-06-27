# Design — Cache Redis da listagem pública

**Data:** 2026-06-26
**Contexto MVP:** fecha o item #3 (a parte de cache, adiada quando a busca foi
entregue). A listagem pública hoje vai sempre ao Postgres.
**Escopo:** cachear **apenas a listagem sem filtros**, com TTL + invalidação nas
escritas.

## Objetivo

Servir a grade da home (listagem pública sem filtros — o caso mais acessado) a
partir do Redis, com invalidação imediata quando um anúncio muda. Buscas com
filtros continuam indo direto ao Postgres.

## Contexto (código atual)

- `internal/venues/service.go`: `Search(ctx, SearchFilters) ([]sqlc.SearchPublishedVenuesRow, error)`
  é a listagem pública; `buildSearchParams` monta os params (filtros vazios =
  sentinelas = todos publicados). `NewService(q, store)` — **sem Redis**. Escritas
  que mexem na listagem: `Publish`, `Update`, `Delete`, `AddPhoto`, `DeletePhoto`.
- `internal/venues/handler.go`: `listPublic` mapeia as linhas para
  `publicVenueResp` usando `priceString(pgtype.Numeric) string`.
- `internal/platform/redis`: `New(ctx, url) (*goredis.Client, error)`. Padrão de
  uso (auth): service recebe `*goredis.Client`, usa `Get/Set/Del`, prefixo de
  chave, TTL; `redis.Nil` = miss. Redis é **fatal no startup** (sempre presente).
- `internal/server/server.go`: `venues.NewService(queries, deps.Storage)`.

## Decisões desta feature

| Decisão | Escolha | Por quê |
| --- | --- | --- |
| O que cachear | **Só a listagem sem filtros** | Caso mais acessado; chave única, invalidação simples, alto hit-rate. |
| Frescor | **TTL + invalidação nas escritas** | Listagem sempre fresca; TTL é só rede de segurança. |
| Integração | **Cache-aside no `Search` (Abordagem A)** + read-model `[]PublicVenue` | JSON do cache limpo/estável (desacoplado do sqlc); fronteira do service melhor. |
| TTL | **5 minutos** | Rede de segurança; a invalidação mantém o frescor. |
| Chave | **Única (`venues:public:list`)** | Listagem é `LIMIT 60` sem paginação. |

## Arquitetura

### 1. Read-model (`internal/venues/service.go`)

```go
// PublicVenue é o card da listagem pública (sem dados sensíveis do host).
type PublicVenue struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Capacity    int32  `json:"capacity"`
	PricePerDay string `json:"price_per_day"`
	City        string `json:"city"`
	State       string `json:"state"`
	CoverURL    string `json:"cover_url"`
}
```
JSON idêntico ao `publicVenueResp` atual → o handler devolve `[]PublicVenue`
direto e `publicVenueResp` é removido. Mapeamento:
```go
func toPublicVenues(rows []sqlc.SearchPublishedVenuesRow) []PublicVenue // usa priceString
```

### 2. `Search` com cache-aside

```go
func (s *Service) Search(ctx context.Context, f SearchFilters) ([]PublicVenue, error) {
	cacheable := f.isEmpty()
	if cacheable {
		if list, ok := s.cachedPublicList(ctx); ok {
			return list, nil
		}
	}
	params, err := buildSearchParams(f)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.SearchPublishedVenues(ctx, params)
	if err != nil {
		return nil, err
	}
	list := toPublicVenues(rows)
	if cacheable {
		s.cachePublicList(ctx, list)
	}
	return list, nil
}

// isEmpty: nenhum filtro ativo (trim em city/q/max_price).
func (f SearchFilters) isEmpty() bool {
	return strings.TrimSpace(f.City) == "" && f.MinCapacity == 0 &&
		strings.TrimSpace(f.MaxPrice) == "" && strings.TrimSpace(f.Query) == "" &&
		len(f.Amenities) == 0
}
```

### 3. Cache (`internal/venues/cache.go`)

```go
const publicListCacheKey = "venues:public:list"
const publicListTTL = 5 * time.Minute

func (s *Service) cachedPublicList(ctx context.Context) ([]PublicVenue, bool) {
	// s.redis nil ou erro/redis.Nil → (nil, false). hit → unmarshal → (list, true).
}
func (s *Service) cachePublicList(ctx context.Context, list []PublicVenue) {
	// json.Marshal → SET com TTL; erro → log (best-effort).
}
func (s *Service) invalidatePublicList(ctx context.Context) {
	// DEL publicListCacheKey; erro → log (best-effort).
}
```
Valor = `json.Marshal([]PublicVenue)` (tipos planos, round-trip perfeito).

### 4. Invalidação

`s.invalidatePublicList(ctx)` ao final (sucesso) de **`Publish`, `Update`,
`Delete`, `AddPhoto`, `DeletePhoto`**. `Create` não (nasce DRAFT, fora da
listagem). Over-invalidar (ex.: editar rascunho) só causa um miss — inofensivo.

### 5. Wiring

- `NewService(q *sqlc.Queries, store *storage.Client, redis *goredis.Client)`; o
  `Service` guarda `redis`.
- `server.go`: `venues.NewService(queries, deps.Storage, deps.Redis)`.
- `handler.go`: `listPublic` vira `list, err := h.svc.Search(...); ...; c.JSON(200, list)` (remove o loop e o tipo `publicVenueResp`).

## Erros & degradação

- Redis indisponível em runtime → `cachedPublicList` retorna miss, `cache`/
  `invalidate` logam e seguem; a listagem funciona do Postgres.
- Erro de cache **nunca** derruba a request (cache-aside best-effort).

## Testes

- **Unit puro** (`internal/venues/search_test.go`): `SearchFilters.isEmpty()` —
  zero-value → true; cada filtro isolado (city, min_capacity, max_price, query,
  amenities) → false; city/q só com espaços → true.
- **Smoke** (stack no ar):
  1. `GET /public/venues` (frio) → `redis-cli EXISTS venues:public:list` = 1.
  2. `GET` de novo → mesmo resultado (hit).
  3. Publicar um venue novo → `EXISTS` = 0 (invalidado) e o novo aparece no GET.
  4. `GET ?city=...` (filtrado) não usa cache (resultado correto).
- Gates: `cd backend && go test ./... && go build ./...` (frontend não muda).

## Fora de escopo (anotado para o futuro)

- Cache de buscas filtradas e do detalhe `GET /public/venues/:id`.
- Cache warming, métricas de hit/miss, invalidação por pub/sub.
- TTL/chave configuráveis por ambiente.
