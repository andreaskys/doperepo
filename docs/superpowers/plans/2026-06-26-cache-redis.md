# Cache Redis da listagem pública — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servir a listagem pública sem filtros a partir do Redis (cache-aside), com invalidação imediata quando um anúncio muda.

**Architecture:** O `venues.Search` faz cache-aside quando os filtros estão vazios; a listagem passa a devolver um read-model `[]PublicVenue` (preço como string) para o cache ser limpo. Invalidação por TTL (5 min) + `DEL` da chave única nas escritas que mexem na listagem.

**Tech Stack:** Go + Gin, pgx/sqlc, go-redis v9.

## Global Constraints

- **Escopo:** cachear **só a listagem sem filtros**. Buscas filtradas → sempre Postgres.
- **Frescor:** TTL **5 min** (`publicListTTL`) + invalidação em `Publish`/`Update`/`Delete`/`AddPhoto`/`DeletePhoto`.
- **Chave única:** `venues:public:list`.
- **Best-effort:** erro de Redis NUNCA derruba a request — cai pro Postgres / loga e segue.
- **Convenção:** client Redis importado como `goredis "github.com/redis/go-redis/v9"` (como em `auth`/`server`); miss = `goredis.Nil`.
- **Gates:** `cd backend && go test ./... && go build ./...` (frontend não muda).

---

## File Structure

- Create: `backend/internal/venues/cache.go` — chave, TTL, get/set/del do cache.
- Modify: `backend/internal/venues/service.go` — `PublicVenue`, `toPublicVenues`, `isEmpty`, `Search` (tipo + cache), `Service`+`redis`, `NewService(+redis)`, invalidação nas escritas.
- Modify: `backend/internal/venues/handler.go` — `listPublic` devolve `[]PublicVenue`; remove `publicVenueResp`.
- Modify: `backend/internal/venues/search_test.go` — teste de `isEmpty`.
- Modify: `backend/internal/server/server.go` — passa `deps.Redis`.

---

## Task 1: Read-model PublicVenue + Search devolve []PublicVenue

**Files:**
- Modify: `backend/internal/venues/service.go`
- Modify: `backend/internal/venues/handler.go`

**Interfaces:**
- Consumes: `priceString` (handler.go, mesmo pacote), `sqlc.SearchPublishedVenuesRow`.
- Produces: `type PublicVenue struct{...}`; `toPublicVenues([]sqlc.SearchPublishedVenuesRow) []PublicVenue`; `Search(ctx, SearchFilters) ([]PublicVenue, error)`.

- [ ] **Step 1: Adicionar `PublicVenue` + `toPublicVenues` e trocar o retorno do `Search` em `service.go`**

Adicione (perto do topo, após os tipos existentes ou antes de `Search`):
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

func toPublicVenues(rows []sqlc.SearchPublishedVenuesRow) []PublicVenue {
	out := make([]PublicVenue, 0, len(rows))
	for _, v := range rows {
		out = append(out, PublicVenue{
			ID: v.ID, Title: v.Title, Description: v.Description, Capacity: v.Capacity,
			PricePerDay: priceString(v.PricePerDay), City: v.City, State: v.State, CoverURL: v.CoverUrl,
		})
	}
	return out
}
```
Troque o método `Search` por:
```go
func (s *Service) Search(ctx context.Context, f SearchFilters) ([]PublicVenue, error) {
	params, err := buildSearchParams(f)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.SearchPublishedVenues(ctx, params)
	if err != nil {
		return nil, err
	}
	return toPublicVenues(rows), nil
}
```

- [ ] **Step 2: Simplificar `listPublic` e remover `publicVenueResp` em `handler.go`**

Troque o corpo de `listPublic` por:
```go
func (h *Handler) listPublic(c *gin.Context) {
	list, err := h.svc.Search(c.Request.Context(), parseSearchFilters(c.Request.URL.Query()))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao listar"})
		return
	}
	c.JSON(http.StatusOK, list)
}
```
E **remova** o struct `publicVenueResp` (era usado só aqui). `priceString` continua (usado por `toPublicVenues` e por `venueDTO`).

- [ ] **Step 3: Build + suíte**

Run: `cd backend && go build ./... && go test ./...`
Expected: sem erros; testes verdes. (O JSON da listagem é idêntico — `PublicVenue` tem as mesmas tags do antigo `publicVenueResp`.)

- [ ] **Step 4: Commit**

```bash
git add backend/internal/venues/service.go backend/internal/venues/handler.go
git commit -m "refactor(venues): listagem pública devolve read-model PublicVenue"
```

---

## Task 2: Injetar Redis no venues.Service

**Files:**
- Modify: `backend/internal/venues/service.go`
- Modify: `backend/internal/server/server.go`

**Interfaces:**
- Produces: `NewService(q *sqlc.Queries, store *storage.Client, redis *goredis.Client) *Service`; campo `Service.redis`.

- [ ] **Step 1: Adicionar o import e o campo em `service.go`**

No bloco de imports de `service.go`, adicione:
```go
	goredis "github.com/redis/go-redis/v9"
```
Troque o struct `Service` e o `NewService`:
```go
type Service struct {
	q     *sqlc.Queries
	store *storage.Client // pode ser nil se o MinIO não subiu
	redis *goredis.Client
}

func NewService(q *sqlc.Queries, store *storage.Client, redis *goredis.Client) *Service {
	return &Service{q: q, store: store, redis: redis}
}
```

- [ ] **Step 2: Passar `deps.Redis` em `server.go`**

Troque a linha do `venuesH`:
```go
	venuesH := venues.NewHandler(venues.NewService(queries, deps.Storage, deps.Redis))
```

- [ ] **Step 3: Build**

Run: `cd backend && go build ./...`
Expected: sem erros (o campo `redis` ainda não é usado — ok).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/venues/service.go backend/internal/server/server.go
git commit -m "feat(venues): injeta Redis no service"
```

---

## Task 3: Cache-aside no Search + isEmpty (TDD)

**Files:**
- Create: `backend/internal/venues/cache.go`
- Modify: `backend/internal/venues/service.go`
- Modify: `backend/internal/venues/search_test.go`

**Interfaces:**
- Consumes: `Service.redis`, `PublicVenue`, `toPublicVenues` (Tasks 1-2).
- Produces: `(f SearchFilters) isEmpty() bool`; `(s *Service) cachedPublicList(ctx) ([]PublicVenue, bool)`; `cachePublicList(ctx, []PublicVenue)`; `invalidatePublicList(ctx)`.

- [ ] **Step 1: Escrever o teste de `isEmpty` (falha) em `search_test.go`**

```go
func TestSearchFiltersIsEmpty(t *testing.T) {
	if !(SearchFilters{}).isEmpty() {
		t.Fatal("zero-value deveria ser vazio")
	}
	if !(SearchFilters{City: "  ", MaxPrice: " ", Query: "\t"}).isEmpty() {
		t.Fatal("só espaços deveria contar como vazio")
	}
	cases := []SearchFilters{
		{City: "SP"}, {MinCapacity: 1}, {MaxPrice: "100"}, {Query: "x"}, {Amenities: []string{"wifi"}},
	}
	for i, f := range cases {
		if f.isEmpty() {
			t.Fatalf("caso %d deveria ter filtro: %+v", i, f)
		}
	}
}
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && go test ./internal/venues/... -run TestSearchFiltersIsEmpty 2>&1 | head`
Expected: FALHA de compilação ("f.isEmpty undefined").

- [ ] **Step 3: Criar `cache.go`**

```go
package venues

import (
	"context"
	"encoding/json"
	"log"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

const (
	publicListCacheKey = "venues:public:list"
	publicListTTL      = 5 * time.Minute
)

// cachedPublicList devolve a listagem cacheada. Miss/erro → (nil, false).
func (s *Service) cachedPublicList(ctx context.Context) ([]PublicVenue, bool) {
	if s.redis == nil {
		return nil, false
	}
	data, err := s.redis.Get(ctx, publicListCacheKey).Bytes()
	if err != nil {
		if err != goredis.Nil {
			log.Printf("cache get: %v", err)
		}
		return nil, false
	}
	var list []PublicVenue
	if err := json.Unmarshal(data, &list); err != nil {
		log.Printf("cache unmarshal: %v", err)
		return nil, false
	}
	return list, true
}

// cachePublicList grava a listagem com TTL (best-effort).
func (s *Service) cachePublicList(ctx context.Context, list []PublicVenue) {
	if s.redis == nil {
		return
	}
	data, err := json.Marshal(list)
	if err != nil {
		log.Printf("cache marshal: %v", err)
		return
	}
	if err := s.redis.Set(ctx, publicListCacheKey, data, publicListTTL).Err(); err != nil {
		log.Printf("cache set: %v", err)
	}
}

// invalidatePublicList apaga a chave (best-effort).
func (s *Service) invalidatePublicList(ctx context.Context) {
	if s.redis == nil {
		return
	}
	if err := s.redis.Del(ctx, publicListCacheKey).Err(); err != nil {
		log.Printf("cache del: %v", err)
	}
}
```

- [ ] **Step 4: Adicionar `isEmpty` e o cache-aside no `Search` (`service.go`)**

Adicione o método (o pacote já importa `strings`):
```go
// isEmpty: nenhum filtro ativo (a listagem sem filtros é a cacheável).
func (f SearchFilters) isEmpty() bool {
	return strings.TrimSpace(f.City) == "" && f.MinCapacity == 0 &&
		strings.TrimSpace(f.MaxPrice) == "" && strings.TrimSpace(f.Query) == "" &&
		len(f.Amenities) == 0
}
```
Troque o `Search` por:
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
```

- [ ] **Step 5: Rodar (verde) + build**

Run: `cd backend && go test ./internal/venues/... -run TestSearchFiltersIsEmpty -v 2>&1 | grep -E "PASS|FAIL|ok"`
Expected: PASS.
Run: `cd backend && go build ./... && go test ./...`
Expected: sem erros; suíte verde.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/venues/cache.go backend/internal/venues/service.go backend/internal/venues/search_test.go
git commit -m "feat(venues): cache-aside da listagem pública sem filtros"
```

---

## Task 4: Invalidação nas escritas

**Files:**
- Modify: `backend/internal/venues/service.go`

**Interfaces:**
- Consumes: `invalidatePublicList` (Task 3).

- [ ] **Step 1: Invalidar em `Update`, `Publish`, `Delete`, `AddPhoto`, `DeletePhoto`**

`Update` — troque `return s.q.UpdateVenue(...)` por capturar e invalidar:
```go
	v, err := s.q.UpdateVenue(ctx, sqlc.UpdateVenueParams{
		ID:          id,
		Title:       in.Title,
		Description: in.Description,
		Capacity:    in.Capacity,
		PricePerDay: price,
		Address:     in.Address,
		City:        in.City,
		State:       in.State,
		Latitude:    in.Latitude,
		Longitude:   in.Longitude,
		Amenities:   orEmpty(in.Amenities),
		Features:    normFeatures(in.Features),
	})
	if err == nil {
		s.invalidatePublicList(ctx)
	}
	return v, err
```

`Publish`:
```go
func (s *Service) Publish(ctx context.Context, id int64) (sqlc.Venue, error) {
	v, err := s.q.PublishVenue(ctx, id)
	if err == nil {
		s.invalidatePublicList(ctx)
	}
	return v, err
}
```

`Delete` — troque `return s.q.DeleteVenue(ctx, id)` por:
```go
	err := s.q.DeleteVenue(ctx, id)
	if err == nil {
		s.invalidatePublicList(ctx)
	}
	return err
```

`AddPhoto` — troque `return s.q.AddVenuePhoto(...)` por:
```go
	photo, err := s.q.AddVenuePhoto(ctx, sqlc.AddVenuePhotoParams{
		VenueID:   venueID,
		ObjectKey: key,
		Url:       url,
		Position:  int32(len(existing)),
	})
	if err == nil {
		s.invalidatePublicList(ctx)
	}
	return photo, err
```

`DeletePhoto` — troque `return s.q.DeleteVenuePhoto(ctx, photoID)` por (a var `err` já existe no escopo):
```go
	err = s.q.DeleteVenuePhoto(ctx, photoID)
	if err == nil {
		s.invalidatePublicList(ctx)
	}
	return err
```

- [ ] **Step 2: Build + vet + suíte**

Run: `cd backend && go build ./... && go vet ./internal/venues/... && go test ./...`
Expected: sem erros; suíte verde.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/venues/service.go
git commit -m "feat(venues): invalida o cache da listagem nas escritas"
```

---

## Task 5: Verificação integrada (smoke)

**Files:** nenhum (validação ponta a ponta) + `docs/mvp-checklist.md`.

- [ ] **Step 1: Gates + rebuild backend**

Run: `cd backend && go test ./... && go build ./...`
Run: `docker compose up -d --build backend` (Go compila na imagem)
Expected: verde; backend saudável em :8080.

- [ ] **Step 2: Cache popula no 1º GET e a chave existe**

```bash
B=http://localhost:8080/api/v1
docker compose exec -T redis redis-cli DEL venues:public:list >/dev/null
curl -s "$B/public/venues" -o /dev/null
echo "EXISTS após GET: $(docker compose exec -T redis redis-cli EXISTS venues:public:list)"  # esperado 1
```
Expected: `EXISTS após GET: 1`.

- [ ] **Step 3: Filtro NÃO usa cache (não muda a chave)**

```bash
docker compose exec -T redis redis-cli DEL venues:public:list >/dev/null
curl -s "$B/public/venues?city=Nenhuma" -o /dev/null
echo "EXISTS após GET filtrado: $(docker compose exec -T redis redis-cli EXISTS venues:public:list)"  # esperado 0
```
Expected: `EXISTS após GET filtrado: 0`.

- [ ] **Step 4: Publicar invalida a chave**

```bash
O='-H Origin:http://localhost:3100'
curl -s $O -c /tmp/h.txt -X POST $B/auth/register -H 'Content-Type: application/json' -d '{"name":"H","email":"hc@x.com","password":"teste1234"}' -o /dev/null
VID=$(curl -s $O -b /tmp/h.txt -X POST $B/venues -H 'Content-Type: application/json' -d '{"title":"Espaço Cache","capacity":20,"price_per_day":"300","address":"R 1","city":"São Paulo","state":"SP"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s "$B/public/venues" -o /dev/null   # popula
echo "antes do publish: $(docker compose exec -T redis redis-cli EXISTS venues:public:list)"  # 1
curl -s $O -b /tmp/h.txt -X POST $B/venues/$VID/publish -o /dev/null
echo "após publish: $(docker compose exec -T redis redis-cli EXISTS venues:public:list)"      # 0 (invalidado)
echo "novo aparece: $(curl -s "$B/public/venues" | python3 -c 'import sys,json;print(any(v["title"]=="Espaço Cache" for v in json.load(sys.stdin)))')"  # True
```
Expected: antes 1, após publish 0, novo aparece True.

- [ ] **Step 5: Limpar dados de teste**

```bash
docker compose exec -T postgres psql -U app -d venues -c "DELETE FROM users WHERE email='hc@x.com';"
docker compose exec -T redis redis-cli DEL venues:public:list >/dev/null
rm -f /tmp/h.txt
```

- [ ] **Step 6: Atualizar o checklist e commitar**

Em `docs/mvp-checklist.md`, item #3: marcar como ✅ (busca/filtros + **cache Redis** concluídos).
```bash
git add docs/mvp-checklist.md
git commit -m "docs: item #3 do MVP concluído (busca/filtros + cache Redis)"
```

---

## Notas de execução

- **Subagentes sem Bash nesta sessão** → execução inline; TDD cobre `isEmpty`, o cache-aside valida no smoke (chave/hit/invalidação).
- **Rebuild do backend** necessário (Go compila na imagem).
- Cache de filtros/detalhe, métricas e warming ficam fora (anotados na spec).
