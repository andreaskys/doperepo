# Dashboard financeiro (Perfil — Fase B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acrescentar ao `/perfil` um dashboard financeiro do host — cards de KPI (count-up) + gráfico de receita por mês — alimentado por um endpoint de agregação.

**Architecture:** Duas queries de agregação SQL no pacote `bookings`; o `Service` expõe passthroughs; o `Handler` monta o DTO (reusa `priceStr`/`dateStr`, calcula `avg_ticket` com helper puro testável) em `GET /host/metrics`. Frontend adiciona `ProfileAPI.metrics()` e um componente `Dashboard` no `/perfil`.

**Tech Stack:** Go + Gin + sqlc + pgx; Next.js 15 + React 19 + TS strict + `motion/react`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-27-perfil-fase-b-dashboard.md`.
- **Receita:** confirmada = `CONFIRMED`; pendente = `PENDING`; `CANCELLED` nunca conta. Agregação **no SQL**. Receita/mês por **`start_date`**, últimos 6 meses.
- **Dinheiro como string** no JSON (reusa `priceStr`); `month` no formato `YYYY-MM`.
- **DRY:** contagem de espaços publicados vem do `listMine()` já carregado no front — não do endpoint.
- **sqlc:** após editar `.sql`, rodar `sqlc generate` de `./backend` (`$(go env GOPATH)/bin/sqlc`) e `git add internal/db/sqlc/`.
- **Design/animação (`docs/design.md`):** `--brand-gradient` no KPI de destaque; count-up e barras respeitam `prefers-reduced-motion` (sem anim → valor/altura final direto); durações <300ms, só `transform`/`opacity`.
- **Não remover itens do Dock** (memória do usuário) — esta fase não toca no Dock.
- **Gates:** backend `docker compose exec -T backend go test ./...`; frontend (em `frontend/`) `npm run typecheck` e build no container `docker compose exec -T frontend npm run build`.

---

### Task 1: Queries de agregação + sqlc regen

**Files:**
- Modify: `backend/internal/db/queries/bookings.sql`
- Regenerate: `backend/internal/db/sqlc/bookings.sql.go` (+ `models.go` se necessário)

**Interfaces:**
- Produces (consumido pela Task 2):
  - `q.HostRevenueSummary(ctx, hostID int64) (sqlc.HostRevenueSummaryRow, error)` com campos `ConfirmedRevenue, PendingRevenue pgtype.Numeric`; `ConfirmedCount, PendingCount, CancelledCount, TotalCount int64`.
  - `q.HostRevenueByMonth(ctx, hostID int64) ([]sqlc.HostRevenueByMonthRow, error)` com `Month pgtype.Date`, `Revenue pgtype.Numeric`.

- [ ] **Step 1: Adicionar as queries**

Acrescentar ao final de `backend/internal/db/queries/bookings.sql`:
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

- [ ] **Step 2: Regerar o sqlc**

Run (de `backend/`):
```bash
"$(go env GOPATH)/bin/sqlc" generate
```
Expected: sem erros; `git status` mostra `internal/db/sqlc/bookings.sql.go` modificado. Conferir que existem os tipos `HostRevenueSummaryRow` e `HostRevenueByMonthRow`:
```bash
grep -nE "HostRevenueSummaryRow|HostRevenueByMonthRow" internal/db/sqlc/bookings.sql.go
```

- [ ] **Step 3: Build**

Run:
```bash
docker compose exec -T backend go build ./...
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/db/queries/bookings.sql backend/internal/db/sqlc/
git commit -m "feat(dashboard): queries de agregação de receita do host"
```

---

### Task 2: Service passthroughs + endpoint `GET /host/metrics` + unit

**Files:**
- Modify: `backend/internal/bookings/service.go`
- Modify: `backend/internal/bookings/handler.go`
- Create: `backend/internal/bookings/metrics_test.go`

**Interfaces:**
- Consumes (da Task 1): `q.HostRevenueSummary`, `q.HostRevenueByMonth`.
- Produces (HTTP): `GET /api/v1/host/metrics` → `{confirmed_revenue, pending_revenue, avg_ticket, confirmed_count, pending_count, cancelled_count, total_bookings, by_month:[{month,revenue}]}` (dinheiro string; month `YYYY-MM`).
- Produces (pure): `avgTicket(revenue float64, count int64) float64`.

- [ ] **Step 1: Escrever o teste que falha**

`backend/internal/bookings/metrics_test.go`:
```go
package bookings

import "testing"

func TestAvgTicket(t *testing.T) {
	if got := avgTicket(0, 0); got != 0 {
		t.Fatalf("count 0 deve dar 0, veio %v", got)
	}
	if got := avgTicket(1000, 4); got != 250 {
		t.Fatalf("1000/4 deve dar 250, veio %v", got)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run:
```bash
docker compose exec -T backend go test ./internal/bookings/ -run TestAvgTicket -v
```
Expected: FAIL — `undefined: avgTicket`.

- [ ] **Step 3: Adicionar os passthroughs no service**

Em `backend/internal/bookings/service.go`, após `ListByHost`:
```go
// HostRevenueSummary agrega receita/contagens das reservas dos espaços do host.
func (s *Service) HostRevenueSummary(ctx context.Context, hostID int64) (sqlc.HostRevenueSummaryRow, error) {
	return s.q.HostRevenueSummary(ctx, hostID)
}

// HostRevenueByMonth devolve a receita confirmada por mês (últimos 6 meses).
func (s *Service) HostRevenueByMonth(ctx context.Context, hostID int64) ([]sqlc.HostRevenueByMonthRow, error) {
	return s.q.HostRevenueByMonth(ctx, hostID)
}
```

- [ ] **Step 4: Registrar a rota**

Em `handler.go`, no `Routes`, após a linha do `cancel`:
```go
	rg.GET("/host/metrics", requireAuth, h.metrics)
```

- [ ] **Step 5: Implementar o handler + helpers**

Adicionar em `handler.go` (perto do `listReceived`):
```go
type monthRevenueResp struct {
	Month   string `json:"month"`
	Revenue string `json:"revenue"`
}

type hostMetricsResp struct {
	ConfirmedRevenue string             `json:"confirmed_revenue"`
	PendingRevenue   string             `json:"pending_revenue"`
	AvgTicket        string             `json:"avg_ticket"`
	ConfirmedCount   int64              `json:"confirmed_count"`
	PendingCount     int64              `json:"pending_count"`
	CancelledCount   int64              `json:"cancelled_count"`
	TotalBookings    int64              `json:"total_bookings"`
	ByMonth          []monthRevenueResp `json:"by_month"`
}

func (h *Handler) metrics(c *gin.Context) {
	user := c.MustGet("user").(sqlc.User)
	ctx := c.Request.Context()
	sum, err := h.svc.HostRevenueSummary(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao carregar métricas"})
		return
	}
	months, err := h.svc.HostRevenueByMonth(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao carregar métricas"})
		return
	}
	by := make([]monthRevenueResp, 0, len(months))
	for _, m := range months {
		by = append(by, monthRevenueResp{
			Month:   m.Month.Time.Format("2006-01"),
			Revenue: priceStr(m.Revenue),
		})
	}
	avg := avgTicket(numericFloat(sum.ConfirmedRevenue), sum.ConfirmedCount)
	c.JSON(http.StatusOK, hostMetricsResp{
		ConfirmedRevenue: priceStr(sum.ConfirmedRevenue),
		PendingRevenue:   priceStr(sum.PendingRevenue),
		AvgTicket:        strconv.FormatFloat(avg, 'f', 2, 64),
		ConfirmedCount:   sum.ConfirmedCount,
		PendingCount:     sum.PendingCount,
		CancelledCount:   sum.CancelledCount,
		TotalBookings:    sum.TotalCount,
		ByMonth:          by,
	})
}

func avgTicket(revenue float64, count int64) float64 {
	if count <= 0 {
		return 0
	}
	return revenue / float64(count)
}

func numericFloat(n pgtype.Numeric) float64 {
	f, err := strconv.ParseFloat(priceStr(n), 64)
	if err != nil {
		return 0
	}
	return f
}
```
(`strconv` e `pgtype` já estão importados no handler.)

- [ ] **Step 6: Rodar o teste e ver passar + build/test geral**

Run:
```bash
docker compose exec -T backend go test ./internal/bookings/ -run TestAvgTicket -v
docker compose exec -T backend go build ./... && docker compose exec -T backend go test ./...
```
Expected: `TestAvgTicket` PASS; build ok; suíte verde.

- [ ] **Step 7: Smoke do endpoint**

Run (reinicia o backend e bate na rota com o login de QA):
```bash
cd /home/andreas/Documents/dope/doperepo
docker compose restart backend >/dev/null 2>&1
for i in $(seq 1 20); do curl -sf http://localhost:8080/health >/dev/null 2>&1 && break; sleep 1; done
J=/tmp/dash.cookies; B=http://localhost:8080/api/v1
curl -s -c $J -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"host@dope.local","password":"dope12345"}' >/dev/null
curl -s -b $J $B/host/metrics; echo
rm -f $J
```
Expected: JSON com `confirmed_revenue`, `pending_revenue`, `avg_ticket`, contagens e `by_month` (array de `{month:"YYYY-MM",revenue}`). Valores dependem do seed; estrutura deve bater.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/bookings/service.go backend/internal/bookings/handler.go backend/internal/bookings/metrics_test.go
git commit -m "feat(dashboard): GET /host/metrics com agregados de receita"
```

---

### Task 3: Frontend — tipo `HostMetrics` + `ProfileAPI.metrics`

**Files:**
- Modify: `frontend/app/venues/lib.ts`

**Interfaces:**
- Produces (consumido pela Task 4): `HostMetrics`, `MonthRevenue`, `ProfileAPI.metrics()`.

- [ ] **Step 1: Adicionar o tipo e o método**

Em `frontend/app/venues/lib.ts`, dentro do objeto `ProfileAPI` (adicionar a linha `metrics`) e os tipos logo acima dele:
```ts
export interface MonthRevenue {
  month: string;
  revenue: string;
}

export interface HostMetrics {
  confirmed_revenue: string;
  pending_revenue: string;
  avg_ticket: string;
  confirmed_count: number;
  pending_count: number;
  cancelled_count: number;
  total_bookings: number;
  by_month: MonthRevenue[];
}
```
E acrescentar ao `ProfileAPI`:
```ts
  metrics: () => req<HostMetrics>('/host/metrics'),
```

- [ ] **Step 2: Typecheck**

Run (em `frontend/`):
```bash
npm run typecheck
```
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/venues/lib.ts
git commit -m "feat(dashboard): tipo HostMetrics e ProfileAPI.metrics"
```

---

### Task 4: Frontend — componente `Dashboard` no `/perfil` + CSS

**Files:**
- Modify: `frontend/app/perfil/page.tsx`
- Modify: `frontend/app/globals.css` (append)

**Interfaces:**
- Consumes (da Task 3): `ProfileAPI.metrics()`, `HostMetrics`, `MonthRevenue`.
- Consumes (existente): `venues` (do `listMine`) para contar espaços publicados.

- [ ] **Step 1: Buscar métricas e reordenar a página**

Em `frontend/app/perfil/page.tsx`:

1a. No import do lib, acrescentar `type HostMetrics` e `type MonthRevenue`:
```tsx
import { ProfileAPI, VenuesAPI, type User, type Venue, type HostMetrics, type MonthRevenue } from '../venues/lib';
```

1b. Em `ProfilePage`, adicionar estado e fetch das métricas (junto dos outros):
```tsx
  const [metrics, setMetrics] = useState<HostMetrics | null>(null);
  const [metricsErr, setMetricsErr] = useState(false);
```
E no `useEffect`, após o `VenuesAPI.listMine()...`:
```tsx
    ProfileAPI.metrics()
      .then(setMetrics)
      .catch(() => setMetricsErr(true));
```

1c. Trocar o corpo do `return` para a nova ordem (Dashboard → Meus anúncios → Editar conta). Substituir o trecho que vai de `<EditAccount ... />` até o fim do `<section className="profile-section">` dos anúncios por:
```tsx
      <Dashboard metrics={metrics} error={metricsErr} publishedCount={(venues ?? []).filter((v) => v.status === 'PUBLISHED').length} reduce={!!reduce} />

      <section className="profile-section">
        <div className="list-head">
          <h2>Meus anúncios</h2>
          <a className="button ghost" href="/venues/mine">Gerenciar</a>
        </div>
        {!venues ? (
          <p className="muted">Carregando…</p>
        ) : venues.length === 0 ? (
          <p className="muted">Você ainda não anunciou. <a href="/venues/new">Criar o primeiro</a>.</p>
        ) : (
          <div className="profile-venues">
            {venues.map((v, i) => (
              <motion.a
                key={v.id}
                href={`/venues/${v.id}/edit`}
                className="vcard"
                initial={reduce ? undefined : { opacity: 0, y: 10 }}
                animate={reduce ? undefined : { opacity: 1, y: 0 }}
                transition={reduce ? undefined : { duration: 0.24, delay: Math.min(i * 0.05, 0.3) }}
              >
                <div className="vcard-cover">
                  {v.cover_url ? <img src={v.cover_url} alt={v.title} /> : <div className="vcard-cover-ph" />}
                </div>
                <div className="vcard-body">
                  <strong>{v.title}</strong>
                  <span className={'badge ' + (v.status === 'PUBLISHED' ? 'pub' : 'draft')}>
                    {v.status === 'PUBLISHED' ? 'Publicado' : 'Rascunho'}
                  </span>
                  <span className="muted">{v.city}/{v.state} · R$ {v.price_per_day}/dia</span>
                </div>
              </motion.a>
            ))}
          </div>
        )}
      </section>

      <EditAccount user={user} onUser={setUser} />
```

- [ ] **Step 2: Adicionar os componentes `Dashboard`, `KpiValue` e o hook de count-up**

No mesmo arquivo, abaixo de `EditAccount`, adicionar:
```tsx
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
};

function useCountUp(target: number, reduce: boolean) {
  const [val, setVal] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce) { setVal(target); return; }
    let raf = 0;
    const start = performance.now();
    const dur = 600;
    const tick = (t: number) => {
      const p = Math.min((t - start) / dur, 1);
      setVal(target * (1 - Math.pow(1 - p, 3))); // easeOutCubic
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduce]);
  return val;
}

function KpiValue({ target, format, reduce }: { target: number; format: (n: number) => string; reduce: boolean }) {
  const v = useCountUp(target, reduce);
  return <span className="kpi-value">{format(v)}</span>;
}

function Dashboard({ metrics, error, publishedCount, reduce }: {
  metrics: HostMetrics | null;
  error: boolean;
  publishedCount: number;
  reduce: boolean;
}) {
  if (error) {
    return (
      <section className="profile-section dash">
        <h2>Resumo financeiro</h2>
        <p className="muted">Não foi possível carregar o resumo financeiro.</p>
      </section>
    );
  }
  if (!metrics) {
    return (
      <section className="profile-section dash">
        <h2>Resumo financeiro</h2>
        <p className="muted">Carregando…</p>
      </section>
    );
  }

  const intFmt = (n: number) => String(Math.round(n));
  const months: MonthRevenue[] = metrics.by_month;
  const max = months.reduce((acc, m) => Math.max(acc, Number(m.revenue)), 0);

  return (
    <section className="profile-section dash">
      <h2>Resumo financeiro</h2>
      {metrics.total_bookings === 0 ? (
        <p className="chart-empty">Você ainda não tem reservas — <a href="/venues/new">publique um espaço</a> para começar a faturar.</p>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card feature">
              <KpiValue target={Number(metrics.confirmed_revenue)} format={brl} reduce={reduce} />
              <span className="kpi-label">Receita confirmada</span>
            </div>
            <div className="kpi-card">
              <KpiValue target={Number(metrics.pending_revenue)} format={brl} reduce={reduce} />
              <span className="kpi-label">Pendente (pipeline)</span>
            </div>
            <div className="kpi-card">
              <KpiValue target={metrics.confirmed_count} format={intFmt} reduce={reduce} />
              <span className="kpi-label">Reservas confirmadas</span>
            </div>
            <div className="kpi-card">
              <KpiValue target={Number(metrics.avg_ticket)} format={brl} reduce={reduce} />
              <span className="kpi-label">Ticket médio</span>
            </div>
            <div className="kpi-card">
              <KpiValue target={publishedCount} format={intFmt} reduce={reduce} />
              <span className="kpi-label">Espaços publicados</span>
            </div>
          </div>

          {months.length > 0 && (
            <div className="chart-wrap">
              <span className="kpi-label">Receita confirmada por mês</span>
              <div className="chart">
                {months.map((m, i) => {
                  const v = Number(m.revenue);
                  const h = max > 0 ? Math.max(Math.round((v / max) * 100), 2) : 2;
                  return (
                    <div className="chart-col" key={m.month} title={brl(v)}>
                      <motion.div
                        className="chart-bar"
                        style={{ height: `${h}%` }}
                        initial={reduce ? undefined : { scaleY: 0 }}
                        animate={reduce ? undefined : { scaleY: 1 }}
                        transition={reduce ? undefined : { duration: 0.4, delay: Math.min(i * 0.06, 0.4) }}
                      />
                      <span className="chart-month">{monthLabel(m.month)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Estilos do dashboard**

Append em `frontend/app/globals.css`:
```css
/* ===== Dashboard (Perfil Fase B) ===== */
.dash { gap: 18px; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; }
.kpi-card {
  display: flex; flex-direction: column; gap: 4px;
  padding: 16px; border-radius: 14px; background: #fff;
  border: 1px solid #ececf3; box-shadow: 0 1px 3px rgba(20, 16, 50, 0.05);
}
.kpi-card.feature { background: var(--brand-gradient); border: none; color: #fff; }
.kpi-value { font-size: 24px; font-weight: 700; line-height: 1.1; }
.kpi-label { font-size: 13px; opacity: 0.8; }
.chart-wrap { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.chart { display: flex; align-items: flex-end; gap: 10px; height: 160px; padding-top: 6px; }
.chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; justify-content: flex-end; }
.chart-bar {
  width: 100%; max-width: 48px; border-radius: 8px 8px 0 0;
  background: var(--brand-gradient); transform-origin: bottom;
}
.chart-month { font-size: 12px; color: var(--muted, #6b7280); }
.chart-empty { padding: 18px; border-radius: 14px; background: var(--brand-tint); }
```

- [ ] **Step 4: Typecheck + build no container**

Run:
```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | tail -6
```
Expected: typecheck sem erros; build conclui e lista a rota `/perfil`.

- [ ] **Step 5: Smoke visual**

Reiniciar o frontend e abrir `http://localhost:3100/perfil` logado como `host@dope.local`. Esperado: seção "Resumo financeiro" com cards (count-up anima de 0 ao valor), gráfico de barras crescendo com stagger, e a ordem Cabeçalho → Dashboard → Meus anúncios → Editar conta. Conta sem reservas → estado vazio.
```bash
docker compose restart frontend >/dev/null 2>&1
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3100/perfil && break; sleep 1; done
curl -s -o /dev/null -w "GET /perfil: %{http_code}\n" http://localhost:3100/perfil
```

- [ ] **Step 6: Commit**

```bash
git add frontend/app/perfil/page.tsx frontend/app/globals.css
git commit -m "feat(dashboard): resumo financeiro no /perfil (KPIs count-up + gráfico)"
```

---

## Self-Review

- **Cobertura da spec:** queries de agregação (T1) · service passthroughs + endpoint + DTO (T2) · `avg_ticket` helper + unit (T2) · `month` `YYYY-MM` e dinheiro string (T2) · lib `HostMetrics`+`metrics()` (T3) · cards KPI com count-up (T4) · gráfico receita/mês SVG/CSS animado (T4) · estado vazio e erro (T4) · contagem de espaços via `listMine` (T4) · `prefers-reduced-motion` (T4) · ordem da página (T4). ✔
- **Consistência de tipos:** `HostRevenueSummaryRow{ConfirmedRevenue,PendingRevenue pgtype.Numeric; *Count int64}` e `HostRevenueByMonthRow{Month pgtype.Date; Revenue pgtype.Numeric}` (T1) consumidos em T2; JSON `{confirmed_revenue,...,by_month:[{month,revenue}]}` (T2) espelhado por `HostMetrics`/`MonthRevenue` (T3) e consumido em T4. ✔
- **Sem placeholders:** todo passo traz código real + comando com saída esperada. ✔
- **Risco conhecido:** o casing exato dos campos gerados pelo sqlc (`ConfirmedRevenue`, `Month`, `Revenue`) é confirmado no T1 Step 2 (`grep`) e o T2 Step 6 (build) pega qualquer divergência. Se o sqlc nomear `total_count`→`TotalCount` diferente, ajustar o mapeamento no handler.
