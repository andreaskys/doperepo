# Design — Dashboard financeiro (Fase B)

**Data:** 2026-06-27
**Objetivo:** acrescentar à página `/perfil` um dashboard financeiro do **host**:
KPIs de receita + gráfico de receita por mês, com animações.
**Escopo:** Fase B de 2 (a Fase A — perfil & conta — já está entregue). Ver
`docs/superpowers/specs/2026-06-27-perfil-fase-a-design.md`.

## Decisões (do brainstorming)
| Tema | Escolha |
| --- | --- |
| Perspectiva | **Host** (receita dos aluguéis dos próprios espaços). Lado convidado fora. |
| Visualização | **Cards de KPI + gráfico de receita/mês** em SVG/CSS próprio (sem nova dependência). |
| Receita | **Confirmada** (`CONFIRMED`, realizada) vs **Pendente** (`PENDING`, pipeline); `CANCELLED` não conta. |
| Agregação | No **SQL** (eficiente/escala), não no Go. |
| Receita/mês | Agrupada por **`start_date`** (mês do evento/aluguel), incluindo meses futuros. |
| Contagem de espaços | Reaproveita o `VenuesAPI.listMine()` já carregado no `/perfil` (não vai no endpoint). |

## Arquitetura

### 1. Queries (`backend/internal/db/queries/bookings.sql`)
```sql
-- name: HostRevenueSummary :one
SELECT
  COALESCE(SUM(b.total_price) FILTER (WHERE b.status = 'CONFIRMED'), 0)::numeric AS confirmed_revenue,
  COALESCE(SUM(b.total_price) FILTER (WHERE b.status = 'PENDING'),   0)::numeric AS pending_revenue,
  COUNT(*) FILTER (WHERE b.status = 'CONFIRMED') AS confirmed_count,
  COUNT(*) FILTER (WHERE b.status = 'PENDING')   AS pending_count,
  COUNT(*) FILTER (WHERE b.status = 'CANCELLED') AS cancelled_count,
  COUNT(*)                                       AS total_count
FROM bookings b
JOIN venues v ON v.id = b.venue_id
WHERE v.host_id = @host_id;

-- name: HostRevenueByMonth :many
SELECT
  date_trunc('month', b.start_date)::date AS month,
  COALESCE(SUM(b.total_price) FILTER (WHERE b.status = 'CONFIRMED'), 0)::numeric AS revenue
FROM bookings b
JOIN venues v ON v.id = b.venue_id
WHERE v.host_id = @host_id
  AND b.status <> 'CANCELLED'
  AND b.start_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
GROUP BY 1
ORDER BY 1;
```
Requer `sqlc generate`. (`FILTER` é suportado pelo Postgres; sqlc gera os campos como `pgtype.Numeric`/`int64`/`pgtype.Date`.)

### 2. `bookings.Service` (`internal/bookings/service.go`)
- `HostMetrics(ctx, hostID int64) (HostMetrics, error)` — roda as duas queries e monta o struct (abaixo). `avg_ticket` calculado no Go via helper puro `avgTicket(confirmedRevenue float64, confirmedCount int64) float64` (guard: count 0 → 0).
- A conversão `pgtype.Numeric → string` reaproveita o `priceStr` já existente no handler; para o `avgTicket` o service converte a receita confirmada para float (helper `numericToFloat`).
- Tipo de retorno (no pacote bookings):
  ```go
  type MonthRevenue struct { Month string; Revenue string }
  type HostMetrics struct {
      ConfirmedRevenue, PendingRevenue, AvgTicket string
      ConfirmedCount, PendingCount, CancelledCount, TotalBookings int64
      ByMonth []MonthRevenue
  }
  ```

### 3. Handler (`internal/bookings/handler.go`)
- Rota nova: `rg.GET("/host/metrics", requireAuth, h.metrics)`.
- `metrics` pega `currentUser(c).ID`, chama `svc.HostMetrics`, responde DTO JSON:
  `{confirmed_revenue, pending_revenue, avg_ticket, confirmed_count, pending_count, cancelled_count, total_bookings, by_month:[{month,revenue}]}`.
  Valores monetários como **string**; `month` no formato `YYYY-MM`.
- Erro → 500 genérico; 401 já é do middleware.

### 4. Frontend — `lib.ts`
- `interface MonthRevenue { month: string; revenue: string }`
- `interface HostMetrics { confirmed_revenue: string; pending_revenue: string; avg_ticket: string; confirmed_count: number; pending_count: number; cancelled_count: number; total_bookings: number; by_month: MonthRevenue[] }`
- `ProfileAPI.metrics = () => req<HostMetrics>('/host/metrics')`.

### 5. Frontend — seção no `/perfil` (`app/perfil/page.tsx`)
Nova ordem da página: **Cabeçalho → Dashboard → Meus anúncios → Editar conta**.
- `ProfilePage` busca `ProfileAPI.metrics()` (além de `me()`/`listMine()`); passa as métricas + contagem de espaços (de `venues`) para `<Dashboard>`.
- Componente `Dashboard`:
  - **Cards de KPI:** Receita confirmada (card de destaque com `--brand-gradient`), Receita pendente, Reservas (confirmadas/total), Ticket médio, Espaços publicados (derivado de `venues.filter(status==='PUBLISHED').length`). Cada número anima com **count-up** (de 0 ao valor) usando `useEffect`+`requestAnimationFrame`; moeda formatada em BRL (`Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})`).
  - **Gráfico receita/mês:** barras em SVG/CSS; altura proporcional ao máximo do período; entram com `scaleY` + stagger (`motion`); rótulo do mês (`jun`, `jul`…) e valor no topo/hover.
  - **Vazio** (`total_bookings === 0`): painel "Você ainda não tem reservas — publique um espaço para começar a faturar." (link para `/venues/new`).
  - **Erro:** se `metrics()` falhar, a seção mostra "não foi possível carregar o resumo financeiro"; o resto do perfil continua.

### 6. Frontend — estilos (`app/globals.css`)
Classes `.dash`, `.kpi-grid`, `.kpi-card` (+ `.kpi-card.feature` no destaque), `.kpi-value`, `.kpi-label`, `.chart`, `.chart-bar`, `.chart-empty`. Raio/sombra no padrão dos cards existentes.

## Design & animações (padrão do site, `docs/design.md`)
Count-up e crescimento das barras respeitam `prefers-reduced-motion` (sem animação → valor/altura final direto, sem transição). Durações <300ms, só `transform`/`opacity`. Card de destaque usa `--brand-gradient` com texto branco.

## Erros & estados
- 401 → `/login` (via `req()`).
- `metrics()` falha → seção com mensagem de erro isolada; perfil não quebra.
- Sem reservas → estado vazio convidativo.
- Sem espaços publicados → KPI "Espaços" mostra 0.

## Testes
- **Unit puro:** `avgTicket(revenue, count)` — `count==0 → 0`; `1000,4 → 250`.
- **Smoke:** `GET /host/metrics` logado como `host@dope.local` retorna receita confirmada > 0 e `by_month` coerente com o seed; usuário sem reservas retorna tudo zero e `by_month: []`.
- Gates: backend `docker compose exec -T backend go test ./...`; frontend `npm run typecheck` e `npm run build` (no container).

## Fora desta fase (futuro)
Lado convidado (gastos/viagens), filtros de período, exportar CSV, ocupação (%),
comparativo entre espaços, gráfico com lib dedicada.
