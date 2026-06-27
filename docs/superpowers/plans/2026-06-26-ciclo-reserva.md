# Ciclo de vida da reserva — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o host veja, confirme e recuse reservas, e que host e convidado cancelem — fechando a máquina de estados PENDING/CONFIRMED/CANCELLED.

**Architecture:** Cada transição: o service busca a reserva com o `host_id` do venue (1 query), autoriza no Go via função pura, e roda um `UPDATE` guardado por status (atômico/race-safe). Frontend ganha uma página de "reservas recebidas" (host) com Confirmar/Recusar/Cancelar e um botão Cancelar na página do convidado, com abas entre as duas.

**Tech Stack:** Go + Gin, pgx/sqlc, PostgreSQL · Next.js 15 + React 19 + TypeScript (strict).

## Global Constraints

- **Backend type-safety via sqlc:** após editar `internal/db/queries/bookings.sql`, rodar `sqlc generate` a partir de `./backend` (gera `internal/db/sqlc/`, nunca editar à mão).
- **Frontend:** TypeScript **strict**; tipos de domínio centralizados em `frontend/app/venues/lib.ts`.
- **Transições (máquina de estados):** PENDING→CONFIRMED só host; PENDING→CANCELLED host ou convidado; CONFIRMED→CANCELLED host ou convidado; CANCELLED é terminal.
- **Erros HTTP precisos:** `ErrBookingNotFound`→404, `ErrNotAuthorized`→403, `ErrInvalidTransition`→409.
- **Atomicidade sem lock:** transição é `UPDATE bookings ... WHERE id=$1 AND status=<esperado> RETURNING *`; 0 linhas (corrida) → `ErrInvalidTransition`.
- **UI no padrão do site (`docs/design.md`):** `.venue-card`/`.badge`/`.button(.ghost|.danger)`, durações <300ms, só `transform`/`opacity`, `prefers-reduced-motion`.
- **Fora de escopo:** notificações/e-mail, múltiplas PENDING competindo, pagamento/reembolso, editar datas.
- **Gates:** `cd backend && go test ./... && go build ./...`; `cd frontend && npm run typecheck && npm run build`.

---

## File Structure

**Backend**
- Modify: `backend/internal/db/queries/bookings.sql` — 4 queries novas.
- Regenerate: `backend/internal/db/sqlc/bookings.sql.go` (via `sqlc generate`).
- Modify: `backend/internal/bookings/service.go` — erros, `bookingAuth`, `canConfirm`/`canCancel`, `ListByHost`/`Confirm`/`Cancel`.
- Create: `backend/internal/bookings/lifecycle_test.go` — unit tests puros.
- Modify: `backend/internal/bookings/handler.go` — rotas + `listReceived`/`confirm`/`cancel` + `receivedBookingResp` + `writeBookingErr`.

**Frontend**
- Modify: `frontend/app/venues/lib.ts` — `ReceivedBooking` + `BookingsAPI.received/confirm/cancel`.
- Create: `frontend/app/reservas/shared.tsx` — `ReservasTabs`, `STATUS_LABEL`, `statusBadge`.
- Modify: `frontend/app/reservas/page.tsx` — abas + ação Cancelar.
- Create: `frontend/app/reservas/recebidas/page.tsx` — página do host.
- Modify: `frontend/app/globals.css` — `.reservas-tabs`/`.reservas-tab` + `.badge.cancelled`.

---

## Task 1: SQL das transições + sqlc generate

**Files:**
- Modify: `backend/internal/db/queries/bookings.sql`
- Regenerate: `backend/internal/db/sqlc/bookings.sql.go`

**Interfaces:**
- Produces: `GetBookingWithOwner(ctx, id) (GetBookingWithOwnerRow, error)` com campos `ID, VenueID, GuestID int64; Status BookingStatus; HostID int64`. `ConfirmBooking(ctx, id) (Booking, error)`, `CancelBooking(ctx, id) (Booking, error)`. `ListBookingsByHost(ctx, hostID) ([]ListBookingsByHostRow, error)` com `ID, VenueID, GuestID, StartDate, EndDate, TotalPrice, Status, CreatedAt, VenueTitle, VenueCity, VenueState, GuestName, GuestEmail`.

- [ ] **Step 1: Acrescentar as queries no fim de `bookings.sql`**

```sql
-- name: GetBookingWithOwner :one
-- Autorização + estado: traz o host_id do venue junto.
SELECT b.id, b.venue_id, b.guest_id, b.status, v.host_id
FROM bookings b
JOIN venues v ON v.id = b.venue_id
WHERE b.id = $1;

-- name: ConfirmBooking :one
UPDATE bookings SET status = 'CONFIRMED'
WHERE id = $1 AND status = 'PENDING'
RETURNING *;

-- name: CancelBooking :one
UPDATE bookings SET status = 'CANCELLED'
WHERE id = $1 AND status <> 'CANCELLED'
RETURNING *;

-- name: ListBookingsByHost :many
SELECT b.id, b.venue_id, b.guest_id, b.start_date, b.end_date, b.total_price,
       b.status, b.created_at,
       v.title AS venue_title, v.city AS venue_city, v.state AS venue_state,
       u.name AS guest_name, u.email AS guest_email
FROM bookings b
JOIN venues v ON v.id = b.venue_id
JOIN users u ON u.id = b.guest_id
WHERE v.host_id = $1
ORDER BY b.created_at DESC;
```

- [ ] **Step 2: Gerar o código sqlc**

Run: `cd backend && sqlc generate` (se faltar o binário: `go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest`)
Expected: sem erros; surgem `GetBookingWithOwnerRow`, `ListBookingsByHostRow` e os métodos no `internal/db/sqlc/bookings.sql.go`.

- [ ] **Step 3: Confirmar tipos gerados**

Run: `grep -nE "type (GetBookingWithOwnerRow|ListBookingsByHostRow) struct" -A14 backend/internal/db/sqlc/bookings.sql.go`
Expected: `GetBookingWithOwnerRow{ ID, VenueID, GuestID int64; Status BookingStatus; HostID int64 }`; `ListBookingsByHostRow` com `VenueTitle/VenueCity/VenueState/GuestName/GuestEmail string`.

- [ ] **Step 4: Build (additivo — verde)**

Run: `cd backend && go build ./...`
Expected: sem erros (nada usa as queries ainda).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/db/queries/bookings.sql backend/internal/db/sqlc/bookings.sql.go
git commit -m "feat(bookings): queries de transição e listagem por host (sqlc)"
```

---

## Task 2: Service — autorização pura + métodos de transição

**Files:**
- Modify: `backend/internal/bookings/service.go`
- Create: `backend/internal/bookings/lifecycle_test.go`

**Interfaces:**
- Consumes: queries da Task 1; `sqlc.BookingStatusPENDING/CONFIRMED/CANCELLED`; `pgx.ErrNoRows`.
- Produces: `ErrBookingNotFound`, `ErrNotAuthorized`, `ErrInvalidTransition`; `bookingAuth{hostID,guestID int64; status sqlc.BookingStatus}`; `canConfirm(bookingAuth,int64) error`; `canCancel(bookingAuth,int64) error`; `Service.ListByHost(ctx,int64) ([]sqlc.ListBookingsByHostRow,error)`; `Service.Confirm(ctx,int64,int64) (sqlc.Booking,error)`; `Service.Cancel(ctx,int64,int64) (sqlc.Booking,error)`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `backend/internal/bookings/lifecycle_test.go`:

```go
package bookings

import (
	"testing"

	"github.com/doperepo/backend/internal/db/sqlc"
)

func TestCanConfirm(t *testing.T) {
	const host, guest = int64(1), int64(2)
	pend := bookingAuth{hostID: host, guestID: guest, status: sqlc.BookingStatusPENDING}
	if err := canConfirm(pend, host); err != nil {
		t.Fatalf("host confirma PENDING deveria ok, veio %v", err)
	}
	if err := canConfirm(pend, guest); err != ErrNotAuthorized {
		t.Fatalf("convidado não confirma: esperava ErrNotAuthorized, veio %v", err)
	}
	conf := bookingAuth{hostID: host, guestID: guest, status: sqlc.BookingStatusCONFIRMED}
	if err := canConfirm(conf, host); err != ErrInvalidTransition {
		t.Fatalf("confirmar não-PENDING: esperava ErrInvalidTransition, veio %v", err)
	}
}

func TestCanCancel(t *testing.T) {
	const host, guest, other = int64(1), int64(2), int64(3)
	for _, st := range []sqlc.BookingStatus{sqlc.BookingStatusPENDING, sqlc.BookingStatusCONFIRMED} {
		b := bookingAuth{hostID: host, guestID: guest, status: st}
		if err := canCancel(b, guest); err != nil {
			t.Fatalf("convidado cancela %s deveria ok, veio %v", st, err)
		}
		if err := canCancel(b, host); err != nil {
			t.Fatalf("host cancela %s deveria ok, veio %v", st, err)
		}
		if err := canCancel(b, other); err != ErrNotAuthorized {
			t.Fatalf("terceiro cancela %s: esperava ErrNotAuthorized, veio %v", st, err)
		}
	}
	cancelled := bookingAuth{hostID: host, guestID: guest, status: sqlc.BookingStatusCANCELLED}
	if err := canCancel(cancelled, guest); err != ErrInvalidTransition {
		t.Fatalf("cancelar já-CANCELLED: esperava ErrInvalidTransition, veio %v", err)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && go test ./internal/bookings/... 2>&1 | head`
Expected: FALHA de compilação ("undefined: bookingAuth / canConfirm / canCancel / ErrNotAuthorized / ErrInvalidTransition").

- [ ] **Step 3: Implementar no `service.go`**

Adicione aos `var (...)` de erros existentes:
```go
	ErrBookingNotFound   = errors.New("reserva não encontrada")
	ErrNotAuthorized     = errors.New("ação não permitida")
	ErrInvalidTransition = errors.New("transição de estado inválida")
```

E acrescente (o pacote já importa `context`, `errors`, `pgx`, `sqlc`):
```go
// bookingAuth carrega só o necessário p/ decidir transições (puro/testável).
type bookingAuth struct {
	hostID  int64
	guestID int64
	status  sqlc.BookingStatus
}

func canConfirm(b bookingAuth, userID int64) error {
	if userID != b.hostID {
		return ErrNotAuthorized
	}
	if b.status != sqlc.BookingStatusPENDING {
		return ErrInvalidTransition
	}
	return nil
}

func canCancel(b bookingAuth, userID int64) error {
	if userID != b.hostID && userID != b.guestID {
		return ErrNotAuthorized
	}
	if b.status == sqlc.BookingStatusCANCELLED {
		return ErrInvalidTransition
	}
	return nil
}

// ListByHost: reservas recebidas nos espaços do host.
func (s *Service) ListByHost(ctx context.Context, hostID int64) ([]sqlc.ListBookingsByHostRow, error) {
	return s.q.ListBookingsByHost(ctx, hostID)
}

// Confirm: host confirma uma reserva PENDING.
func (s *Service) Confirm(ctx context.Context, bookingID, userID int64) (sqlc.Booking, error) {
	row, err := s.q.GetBookingWithOwner(ctx, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Booking{}, ErrBookingNotFound
	}
	if err != nil {
		return sqlc.Booking{}, err
	}
	if err := canConfirm(bookingAuth{hostID: row.HostID, guestID: row.GuestID, status: row.Status}, userID); err != nil {
		return sqlc.Booking{}, err
	}
	b, err := s.q.ConfirmBooking(ctx, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Booking{}, ErrInvalidTransition // estado mudou na corrida
	}
	return b, err
}

// Cancel: host ou convidado cancela (PENDING ou CONFIRMED).
func (s *Service) Cancel(ctx context.Context, bookingID, userID int64) (sqlc.Booking, error) {
	row, err := s.q.GetBookingWithOwner(ctx, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Booking{}, ErrBookingNotFound
	}
	if err != nil {
		return sqlc.Booking{}, err
	}
	if err := canCancel(bookingAuth{hostID: row.HostID, guestID: row.GuestID, status: row.Status}, userID); err != nil {
		return sqlc.Booking{}, err
	}
	b, err := s.q.CancelBooking(ctx, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Booking{}, ErrInvalidTransition
	}
	return b, err
}
```

- [ ] **Step 4: Rodar os testes (verde) + build**

Run: `cd backend && go test ./internal/bookings/... -run 'TestCanConfirm|TestCanCancel' -v 2>&1 | tail -8`
Expected: PASS em `TestCanConfirm` e `TestCanCancel`.
Run: `cd backend && go build ./...`
Expected: sem erros (handler ainda não usa os métodos — tudo compila).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/bookings/service.go backend/internal/bookings/lifecycle_test.go
git commit -m "feat(bookings): autorização e métodos Confirm/Cancel/ListByHost"
```

---

## Task 3: Handler — rotas e endpoints

**Files:**
- Modify: `backend/internal/bookings/handler.go`

**Interfaces:**
- Consumes: `Service.ListByHost/Confirm/Cancel`, erros da Task 2; helpers existentes `bookingDTO`, `dateStr`, `priceStr`.
- Produces: rotas `GET /bookings/received`, `POST /bookings/:id/confirm`, `POST /bookings/:id/cancel`.

- [ ] **Step 1: Registrar as rotas**

Em `handler.go`, no `Routes`, após a linha `rg.GET("/bookings", requireAuth, h.listMine)` adicione:
```go
	rg.GET("/bookings/received", requireAuth, h.listReceived)
	rg.POST("/bookings/:id/confirm", requireAuth, h.confirm)
	rg.POST("/bookings/:id/cancel", requireAuth, h.cancel)
```

- [ ] **Step 2: Adicionar handlers + DTO + mapeamento de erro**

Acrescente em `handler.go` (o pacote já importa `errors`, `net/http`, `strconv`, `gin`, `sqlc`):
```go
func (h *Handler) listReceived(c *gin.Context) {
	user := c.MustGet("user").(sqlc.User)
	rows, err := h.svc.ListByHost(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao listar"})
		return
	}
	out := make([]receivedBookingResp, 0, len(rows))
	for _, b := range rows {
		out = append(out, receivedBookingResp{
			ID: b.ID, VenueID: b.VenueID, VenueTitle: b.VenueTitle,
			VenueCity: b.VenueCity, VenueState: b.VenueState,
			GuestName: b.GuestName, GuestEmail: b.GuestEmail,
			StartDate: dateStr(b.StartDate), EndDate: dateStr(b.EndDate),
			TotalPrice: priceStr(b.TotalPrice), Status: string(b.Status),
		})
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) confirm(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}
	user := c.MustGet("user").(sqlc.User)
	b, err := h.svc.Confirm(c.Request.Context(), id, user.ID)
	if err != nil {
		writeBookingErr(c, err)
		return
	}
	c.JSON(http.StatusOK, bookingDTO(b))
}

func (h *Handler) cancel(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}
	user := c.MustGet("user").(sqlc.User)
	b, err := h.svc.Cancel(c.Request.Context(), id, user.ID)
	if err != nil {
		writeBookingErr(c, err)
		return
	}
	c.JSON(http.StatusOK, bookingDTO(b))
}

func writeBookingErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrBookingNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotAuthorized):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidTransition):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro interno"})
	}
}

type receivedBookingResp struct {
	ID         int64  `json:"id"`
	VenueID    int64  `json:"venue_id"`
	VenueTitle string `json:"venue_title"`
	VenueCity  string `json:"venue_city"`
	VenueState string `json:"venue_state"`
	GuestName  string `json:"guest_name"`
	GuestEmail string `json:"guest_email"`
	StartDate  string `json:"start_date"`
	EndDate    string `json:"end_date"`
	TotalPrice string `json:"total_price"`
	Status     string `json:"status"`
}
```

- [ ] **Step 3: Build + vet + suíte**

Run: `cd backend && go build ./... && go vet ./internal/bookings/... && go test ./...`
Expected: sem erros; testes verdes.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/bookings/handler.go
git commit -m "feat(bookings): rotas received/confirm/cancel"
```

---

## Task 4: Frontend — tipos e API

**Files:**
- Modify: `frontend/app/venues/lib.ts`

**Interfaces:**
- Consumes: `Booking`, `BookingStatus`, `req`, `API` (já em `lib.ts`).
- Produces: `interface ReceivedBooking`; `BookingsAPI.received(): Promise<ReceivedBooking[]>`, `BookingsAPI.confirm(id: string): Promise<Booking>`, `BookingsAPI.cancel(id: string): Promise<Booking>`.

- [ ] **Step 1: Adicionar o tipo `ReceivedBooking`**

Depois da `interface Booking` em `lib.ts`:
```ts
export interface ReceivedBooking extends Booking {
  venue_id: number;
  guest_name: string;
  guest_email: string;
}
```

- [ ] **Step 2: Estender `BookingsAPI`**

Adicione as 3 entradas ao objeto `BookingsAPI` (antes do `}` de fechamento):
```ts
  received: () => req<ReceivedBooking[]>('/bookings/received'),
  confirm: (id: string) => req<Booking>(`/bookings/${id}/confirm`, { method: 'POST' }),
  cancel: (id: string) => req<Booking>(`/bookings/${id}/cancel`, { method: 'POST' }),
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/venues/lib.ts
git commit -m "feat(front): ReceivedBooking + BookingsAPI received/confirm/cancel"
```

---

## Task 5: Frontend — componente compartilhado + página do convidado

**Files:**
- Create: `frontend/app/reservas/shared.tsx`
- Modify: `frontend/app/reservas/page.tsx`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `BookingsAPI`, `Booking`, `BookingStatus`; `usePathname` de `next/navigation`.
- Produces: `ReservasTabs`, `STATUS_LABEL`, `statusBadge(status)` exportados de `./shared`.

- [ ] **Step 1: Criar `reservas/shared.tsx`**

```tsx
'use client';

import { usePathname } from 'next/navigation';
import type { BookingStatus } from '../venues/lib';

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
};

export function statusBadge(status: BookingStatus): string {
  return 'badge ' + (status === 'CONFIRMED' ? 'pub' : status === 'CANCELLED' ? 'cancelled' : 'draft');
}

export function ReservasTabs() {
  const path = usePathname();
  const cls = (href: string) => 'reservas-tab' + (path === href ? ' on' : '');
  return (
    <nav className="reservas-tabs">
      <a className={cls('/reservas')} href="/reservas">Minhas reservas</a>
      <a className={cls('/reservas/recebidas')} href="/reservas/recebidas">Reservas recebidas</a>
    </nav>
  );
}
```

- [ ] **Step 2: Reescrever `reservas/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { BookingsAPI, type Booking } from '../venues/lib';
import { ReservasTabs, STATUS_LABEL, statusBadge } from './shared';

export default function ReservasPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setBookings(await BookingsAPI.mine());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar reservas');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function cancel(id: string) {
    setBusyId(id);
    setError('');
    try {
      await BookingsAPI.cancel(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cancelar');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="container">
      <ReservasTabs />
      <h1>Minhas reservas</h1>
      {error && <p className="error">{error}</p>}
      {!bookings ? (
        <p className="muted">Carregando…</p>
      ) : bookings.length === 0 ? (
        <p className="muted">Você ainda não tem reservas. <a href="/">Explorar espaços</a>.</p>
      ) : (
        <ul className="venue-list">
          {bookings.map((b) => (
            <li key={b.id} className="venue-card">
              <div>
                <strong>{b.venue_title}</strong>
                <span className={statusBadge(b.status)}>{STATUS_LABEL[b.status]}</span>
                <p className="muted">{b.venue_city}/{b.venue_state} · {b.start_date} → {b.end_date} · R$ {b.total_price}</p>
              </div>
              {b.status !== 'CANCELLED' && (
                <div className="venue-actions">
                  <button className="button danger" disabled={busyId === b.id} onClick={() => cancel(b.id)}>
                    {busyId === b.id ? '...' : 'Cancelar'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Adicionar CSS no fim de `globals.css`**

```css
/* --- Abas e badge das reservas --- */
.reservas-tabs {
  display: flex;
  gap: 8px;
  margin: 0 0 20px;
}
.reservas-tab {
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 14px;
  color: #444;
  border: 1px solid #d4d4d4;
  transition: background 150ms var(--ease-out), color 150ms var(--ease-out),
    border-color 150ms var(--ease-out);
}
.reservas-tab.on {
  background: var(--brand-purple);
  color: #fff;
  border-color: var(--brand-purple);
}
.badge.cancelled {
  background: #fbeaea;
  color: #c0252a;
}
```

- [ ] **Step 4: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/reservas/shared.tsx frontend/app/reservas/page.tsx frontend/app/globals.css
git commit -m "feat(front): abas das reservas + cancelar na página do convidado"
```

---

## Task 6: Frontend — página de reservas recebidas (host)

**Files:**
- Create: `frontend/app/reservas/recebidas/page.tsx`

**Interfaces:**
- Consumes: `BookingsAPI.received/confirm/cancel`, `ReceivedBooking`; `ReservasTabs`, `STATUS_LABEL`, `statusBadge` de `../shared`.

- [ ] **Step 1: Criar `reservas/recebidas/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { BookingsAPI, type ReceivedBooking } from '../../venues/lib';
import { ReservasTabs, STATUS_LABEL, statusBadge } from '../shared';

export default function RecebidasPage() {
  const [bookings, setBookings] = useState<ReceivedBooking[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setBookings(await BookingsAPI.received());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar reservas');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function act(id: string, fn: (id: string) => Promise<unknown>) {
    setBusyId(id);
    setError('');
    try {
      await fn(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na ação');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="container">
      <ReservasTabs />
      <h1>Reservas recebidas</h1>
      {error && <p className="error">{error}</p>}
      {!bookings ? (
        <p className="muted">Carregando…</p>
      ) : bookings.length === 0 ? (
        <p className="muted">Você ainda não recebeu reservas.</p>
      ) : (
        <ul className="venue-list">
          {bookings.map((b) => (
            <li key={b.id} className="venue-card">
              <div>
                <strong>{b.venue_title}</strong>
                <span className={statusBadge(b.status)}>{STATUS_LABEL[b.status]}</span>
                <p className="muted">{b.guest_name} · {b.venue_city}/{b.venue_state} · {b.start_date} → {b.end_date} · R$ {b.total_price}</p>
              </div>
              <div className="venue-actions">
                {b.status === 'PENDING' && (
                  <>
                    <button className="button" disabled={busyId === b.id} onClick={() => act(b.id, BookingsAPI.confirm)}>
                      {busyId === b.id ? '...' : 'Confirmar'}
                    </button>
                    <button className="button ghost" disabled={busyId === b.id} onClick={() => act(b.id, BookingsAPI.cancel)}>
                      Recusar
                    </button>
                  </>
                )}
                {b.status === 'CONFIRMED' && (
                  <button className="button danger" disabled={busyId === b.id} onClick={() => act(b.id, BookingsAPI.cancel)}>
                    {busyId === b.id ? '...' : 'Cancelar'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: exit 0; rota `/reservas/recebidas` aparece na lista de páginas.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/reservas/recebidas/page.tsx
git commit -m "feat(front): página de reservas recebidas (host) com confirmar/recusar/cancelar"
```

---

## Task 7: Verificação integrada (smoke do ciclo)

**Files:** nenhum (validação ponta a ponta) + `docs/mvp-checklist.md`.

- [ ] **Step 1: Gates automáticos**

Run: `cd backend && go test ./... && go build ./...`
Run: `cd frontend && npm run typecheck` (build de produção pode estar bloqueado por `.next` do container — typecheck é o gate de correção)
Expected: verde.

- [ ] **Step 2: Subir a stack (se não estiver no ar)**

Run: `docker compose up -d --build backend frontend`
Expected: backend :8080 e frontend respondendo. (Portas podem estar remapeadas no `.env`.)

- [ ] **Step 3: Smoke do ciclo via API (2 usuários: host e convidado)**

Registre 2 usuários, crie um venue publicado pelo host, e exercite o ciclo. Cookies por usuário via `-c/-b`. Esqueleto:
```bash
B=http://localhost:8080/api/v1
O='-H Origin:http://localhost:3100'
# host
curl -s $O -c host.txt -X POST $B/auth/register -H 'Content-Type: application/json' -d '{"name":"Host","email":"h@x.com","password":"teste1234"}'
# cria venue publicado (id no retorno) ... POST $B/venues, depois POST $B/venues/:id/publish
# convidado
curl -s $O -c guest.txt -X POST $B/auth/register -H 'Content-Type: application/json' -d '{"name":"Guest","email":"g@x.com","password":"teste1234"}'
# convidado solicita reserva -> PENDING
curl -s $O -b guest.txt -X POST $B/venues/<VID>/bookings -H 'Content-Type: application/json' -d '{"start_date":"2026-08-01","end_date":"2026-08-03"}'
# host vê em received; estranho/convidado não
curl -s $O -b host.txt  $B/bookings/received
# host confirma -> 200 CONFIRMED
curl -s $O -b host.txt  -X POST $B/bookings/<BID>/confirm -w '\n%{http_code}\n'
# convidado confirma -> 403 ; confirmar de novo -> 409
curl -s $O -b guest.txt -X POST $B/bookings/<BID>/confirm -w '\n%{http_code}\n'
# convidado cancela confirmada -> 200 CANCELLED ; cancelar de novo -> 409
curl -s $O -b guest.txt -X POST $B/bookings/<BID>/cancel  -w '\n%{http_code}\n'
```
Expected: PENDING aparece só pro host em `received`; confirm pelo host = 200/CONFIRMED; confirm pelo convidado = 403; confirm repetido = 409; cancel pelo convidado = 200/CANCELLED; cancel repetido = 409.

- [ ] **Step 4: Smoke da UI**

Logado como host em `/reservas/recebidas`: ver a solicitação, **Confirmar** (badge vira "Confirmada"), depois **Cancelar**. Como convidado em `/reservas`: ver o status e **Cancelar** uma PENDING/CONFIRMED. Abas alternam entre as duas telas.

- [ ] **Step 5: Atualizar o checklist do MVP e commitar**

Em `docs/mvp-checklist.md`, item #4: anotar que o ciclo agora fecha (host confirma/recusa, ambos cancelam; visão de recebidas). 
```bash
git add docs/mvp-checklist.md
git commit -m "docs: item #4 do MVP — ciclo de reserva completo (host aprova/cancela)"
```

---

## Notas de execução

- **Subagentes não têm Bash nesta sessão** → a execução é inline; o TDD cobre a lógica pura (`canConfirm`/`canCancel`), e o SQL/autorização são validados no smoke da Task 7 (padrão do repo, sem harness de DB).
- **`sqlc generate` é obrigatório** após a Task 1 (gera `bookings.sql.go`, não editar à mão).
- Notificações, paginação de recebidas e edição de datas ficam fora (anotados na spec).
