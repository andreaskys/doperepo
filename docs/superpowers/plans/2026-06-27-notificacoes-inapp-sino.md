# Notificações in-app + sino — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um sino no topo do site que mostra (host e convidado) as notificações dos eventos de reserva, com badge de não-lidas e painel dropdown.

**Architecture:** Uma tabela `notifications`; o `notifications.Notifier` (já chamado em cada transição) grava a linha in-app além de enfileirar o e-mail. Endpoints `GET /notifications`, `unread-count` e `POST /read`. No front, um sino próprio ao lado do Dock que faz poll do unread-count e abre um dropdown.

**Tech Stack:** Go + Gin, pgx/sqlc, Next.js 15 + React 19 + TS.

## Global Constraints

- **Abordagem B:** o `Notifier` grava in-app (síncrono, durável, best-effort) + publica e-mail; `bookings.Service` intocado.
- **Migration initdb:** `0005` aplicado **manualmente** no DB de dev (preserva QA), sem `down -v`.
- **Best-effort:** erro de persist in-app → log; nunca derruba a reserva.
- **Sino:** poll a cada 30s; **401 → some e para o poll** (sem redirect). Abrir o painel marca todas lidas.
- **UI no padrão do site** (`docs/design.md`): tokens `--brand`, durações <300ms, só `transform`/`opacity`, `prefers-reduced-motion`.
- **Gates:** `cd backend && go test ./... && go build ./...`; `cd frontend && npm run typecheck && npm run build`.

---

## File Structure

- Create: `backend/migrations/0005_notifications.sql`
- Create: `backend/internal/db/queries/notifications.sql` (+ regenerate)
- Modify: `backend/internal/notifications/notifier.go` — `+queries`, `record`.
- Create: `backend/internal/notifications/handler.go` — endpoints HTTP.
- Modify: `backend/internal/server/server.go` — wiring (NewNotifier + handler).
- Modify: `frontend/app/venues/lib.ts` — tipo + `NotificationsAPI` (fetch direto).
- Create: `frontend/app/components/notification-bell.tsx`
- Modify: `frontend/app/components/site-nav.tsx` — adiciona o sino.
- Modify: `frontend/app/globals.css` — estilos do sino.

---

## Task 1: Tabela + queries (sqlc)

**Files:**
- Create: `backend/migrations/0005_notifications.sql`
- Create: `backend/internal/db/queries/notifications.sql`
- Regenerate: `backend/internal/db/sqlc/notifications.sql.go`

**Interfaces:**
- Produces: `CreateNotification(ctx, CreateNotificationParams{UserID, BookingID int64; Type string}) error`; `ListNotificationsByUser(ctx, userID) ([]ListNotificationsByUserRow, error)` com `ID int64; Type string; Read bool; CreatedAt pgtype.Timestamptz; BookingID int64; VenueTitle string; StartDate, EndDate pgtype.Date`; `CountUnreadNotifications(ctx, userID) (int64, error)`; `MarkNotificationsRead(ctx, userID) error`.

- [ ] **Step 1: Criar a migração** — `backend/migrations/0005_notifications.sql`:
```sql
CREATE TABLE notifications (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_id BIGINT      NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    type       TEXT        NOT NULL,
    read       BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
```

- [ ] **Step 2: Criar as queries** — `backend/internal/db/queries/notifications.sql`:
```sql
-- name: CreateNotification :exec
INSERT INTO notifications (user_id, booking_id, type)
VALUES (@user_id, @booking_id, @type);

-- name: ListNotificationsByUser :many
SELECT n.id, n.type, n.read, n.created_at,
       n.booking_id, v.title AS venue_title, b.start_date, b.end_date
FROM notifications n
JOIN bookings b ON b.id = n.booking_id
JOIN venues v ON v.id = b.venue_id
WHERE n.user_id = $1
ORDER BY n.created_at DESC
LIMIT 20;

-- name: CountUnreadNotifications :one
SELECT count(*) FROM notifications WHERE user_id = $1 AND read = false;

-- name: MarkNotificationsRead :exec
UPDATE notifications SET read = true WHERE user_id = $1 AND read = false;
```

- [ ] **Step 3: Gerar + verificar tipos**

Run: `cd backend && sqlc generate`
Run: `grep -nE "type (CreateNotificationParams|ListNotificationsByUserRow) struct" -A10 internal/db/sqlc/notifications.sql.go`
Expected: `CreateNotificationParams{UserID, BookingID int64; Type string}`; `ListNotificationsByUserRow` com `ID,BookingID int64; Type string; Read bool; CreatedAt pgtype.Timestamptz; VenueTitle string; StartDate,EndDate pgtype.Date`.

- [ ] **Step 4: Build (additivo)**

Run: `cd backend && go build ./...`
Expected: sem erros (nada usa as queries ainda).

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/0005_notifications.sql backend/internal/db/queries/notifications.sql backend/internal/db/sqlc/notifications.sql.go
git commit -m "feat(notifications): tabela e queries de notificação in-app (sqlc)"
```

---

## Task 2: Notifier grava in-app + wiring

**Files:**
- Modify: `backend/internal/notifications/notifier.go`
- Modify: `backend/internal/server/server.go`

**Interfaces:**
- Consumes: `CreateNotification` (Task 1).
- Produces: `NewNotifier(pub *rabbitmq.Publisher, q *sqlc.Queries) *Notifier`.

- [ ] **Step 1: `notifier.go` — campo `q`, novo construtor, `record`**

Adicione `"github.com/doperepo/backend/internal/db/sqlc"` aos imports. Troque o struct, o construtor e os métodos:
```go
type Notifier struct {
	pub *rabbitmq.Publisher
	q   *sqlc.Queries
}

func NewNotifier(pub *rabbitmq.Publisher, q *sqlc.Queries) *Notifier {
	return &Notifier{pub: pub, q: q}
}

func (n *Notifier) BookingRequested(ctx context.Context, bookingID, recipientID int64) {
	n.record(ctx, BookingRequested, bookingID, recipientID)
}
func (n *Notifier) BookingConfirmed(ctx context.Context, bookingID, recipientID int64) {
	n.record(ctx, BookingConfirmed, bookingID, recipientID)
}
func (n *Notifier) BookingCancelled(ctx context.Context, bookingID, recipientID int64) {
	n.record(ctx, BookingCancelled, bookingID, recipientID)
}

// record grava a notificação in-app (durável) e publica o e-mail (async). Ambos best-effort.
func (n *Notifier) record(ctx context.Context, t EventType, bookingID, recipientID int64) {
	if n.q != nil {
		if err := n.q.CreateNotification(ctx, sqlc.CreateNotificationParams{
			UserID: recipientID, BookingID: bookingID, Type: string(t),
		}); err != nil {
			log.Printf("notif: persist in-app: %v", err)
		}
	}
	n.emit(ctx, t, bookingID, recipientID)
}
```
(O `emit` permanece igual.)

- [ ] **Step 2: `server.go` — passar `queries` ao NewNotifier**

Troque a linha do `bookingsH`:
```go
	bookingsH := bookings.NewHandler(bookings.NewService(deps.DB, queries, notifications.NewNotifier(deps.Broker, queries)))
```

- [ ] **Step 3: Build + suíte**

Run: `cd backend && go build ./... && go test ./...`
Expected: sem erros; verde (nenhum teste constrói NewNotifier).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/notifications/notifier.go backend/internal/server/server.go
git commit -m "feat(notifications): grava notificação in-app no Notifier"
```

---

## Task 3: Endpoints HTTP

**Files:**
- Create: `backend/internal/notifications/handler.go`
- Modify: `backend/internal/server/server.go`

**Interfaces:**
- Consumes: `ListNotificationsByUser`/`CountUnreadNotifications`/`MarkNotificationsRead` (Task 1); `authH.RequireAuth()`; `dateStr` (consumer.go, mesmo pacote).
- Produces: `NewHandler(q *sqlc.Queries) *Handler`; `(*Handler).Routes(rg *gin.RouterGroup, requireAuth gin.HandlerFunc)`.

- [ ] **Step 1: Criar `handler.go`**

```go
package notifications

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/doperepo/backend/internal/db/sqlc"
)

type Handler struct{ q *sqlc.Queries }

func NewHandler(q *sqlc.Queries) *Handler { return &Handler{q: q} }

func (h *Handler) Routes(rg *gin.RouterGroup, requireAuth gin.HandlerFunc) {
	g := rg.Group("/notifications", requireAuth)
	g.GET("", h.list)
	g.GET("/unread-count", h.unreadCount)
	g.POST("/read", h.markRead)
}

type notificationResp struct {
	ID         int64  `json:"id"`
	Type       string `json:"type"`
	Read       bool   `json:"read"`
	CreatedAt  string `json:"created_at"`
	BookingID  int64  `json:"booking_id"`
	VenueTitle string `json:"venue_title"`
	StartDate  string `json:"start_date"`
	EndDate    string `json:"end_date"`
}

func (h *Handler) list(c *gin.Context) {
	user := c.MustGet("user").(sqlc.User)
	rows, err := h.q.ListNotificationsByUser(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao listar"})
		return
	}
	out := make([]notificationResp, 0, len(rows))
	for _, n := range rows {
		out = append(out, notificationResp{
			ID: n.ID, Type: n.Type, Read: n.Read, CreatedAt: tsStr(n.CreatedAt),
			BookingID: n.BookingID, VenueTitle: n.VenueTitle,
			StartDate: dateStr(n.StartDate), EndDate: dateStr(n.EndDate),
		})
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) unreadCount(c *gin.Context) {
	user := c.MustGet("user").(sqlc.User)
	count, err := h.q.CountUnreadNotifications(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"count": count})
}

func (h *Handler) markRead(c *gin.Context) {
	user := c.MustGet("user").(sqlc.User)
	if err := h.q.MarkNotificationsRead(c.Request.Context(), user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro"})
		return
	}
	c.Status(http.StatusNoContent)
}

func tsStr(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.Format(time.RFC3339)
}
```
(`dateStr` já existe no pacote — `consumer.go`.)

- [ ] **Step 2: Registrar no `server.go`** — após `bookingsH.Routes(api, authH.RequireAuth())`:
```go
	notifications.NewHandler(queries).Routes(api, authH.RequireAuth())
```

- [ ] **Step 3: Build + vet + suíte**

Run: `cd backend && go build ./... && go vet ./internal/notifications/... && go test ./...`
Expected: sem erros; verde.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/notifications/handler.go backend/internal/server/server.go
git commit -m "feat(notifications): endpoints list/unread-count/read"
```

---

## Task 4: Frontend — tipo + API

**Files:**
- Modify: `frontend/app/venues/lib.ts`

**Interfaces:**
- Produces: `NotificationType`, `AppNotification`; `NotificationsAPI.unreadCount(): Promise<number|null>` (null = 401), `list(): Promise<AppNotification[]>`, `markRead(): Promise<void>`.

- [ ] **Step 1: Adicionar tipo + API (fetch direto, sem redirect)** — no fim de `lib.ts` (`const API = process.env.NEXT_PUBLIC_API_URL` já existe no topo):
```ts
export type NotificationType = 'booking_requested' | 'booking_confirmed' | 'booking_cancelled';

export interface AppNotification {
  id: number;
  type: NotificationType;
  read: boolean;
  created_at: string;
  booking_id: number;
  venue_title: string;
  start_date: string;
  end_date: string;
}

// Fetch direto (NÃO usa req(): o sino não pode redirecionar pra /login no 401).
export const NotificationsAPI = {
  // null = não logado (401); número = contagem de não-lidas.
  unreadCount: async (): Promise<number | null> => {
    const res = await fetch(`${API}/api/v1/notifications/unread-count`, { credentials: 'include' });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error('erro ao buscar notificações');
    return (await res.json()).count as number;
  },
  list: async (): Promise<AppNotification[]> => {
    const res = await fetch(`${API}/api/v1/notifications`, { credentials: 'include' });
    if (!res.ok) throw new Error('erro ao listar notificações');
    return res.json();
  },
  markRead: async (): Promise<void> => {
    await fetch(`${API}/api/v1/notifications/read`, { method: 'POST', credentials: 'include' });
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/venues/lib.ts
git commit -m "feat(front): NotificationsAPI + tipo AppNotification"
```

---

## Task 5: Frontend — sino + CSS + nav

**Files:**
- Create: `frontend/app/components/notification-bell.tsx`
- Modify: `frontend/app/components/site-nav.tsx`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `NotificationsAPI`, `AppNotification`, `NotificationType` (Task 4).

- [ ] **Step 1: Criar `notification-bell.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { NotificationsAPI, type AppNotification, type NotificationType } from '../venues/lib';

const LABEL: Record<NotificationType, string> = {
  booking_requested: 'Nova solicitação de reserva',
  booking_confirmed: 'Reserva confirmada',
  booking_cancelled: 'Reserva cancelada',
};

export default function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = async () => {
      try {
        const c = await NotificationsAPI.unreadCount();
        if (!active) return;
        if (c === null) {
          setShow(false);
          if (timer) clearInterval(timer);
          return;
        }
        setShow(true);
        setCount(c);
      } catch {
        /* mantém o estado atual */
      }
    };
    tick();
    timer = setInterval(tick, 30000);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        setItems(await NotificationsAPI.list());
        await NotificationsAPI.markRead();
        setCount(0);
      } catch {
        /* ignore */
      }
    }
  }

  function go(n: AppNotification) {
    setOpen(false);
    router.push(n.type === 'booking_requested' ? '/reservas/recebidas' : '/reservas');
  }

  if (!show) return null;

  return (
    <div className="notif-bell" ref={ref}>
      <button className="notif-trigger" onClick={toggle} aria-label="Notificações">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {count > 0 && <span className="notif-badge">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <p className="notif-head">Notificações</p>
          {!items ? (
            <p className="notif-empty">Carregando…</p>
          ) : items.length === 0 ? (
            <p className="notif-empty">Nenhuma notificação ainda.</p>
          ) : (
            <ul className="notif-list">
              {items.map((n) => (
                <li key={n.id} className={'notif-item' + (n.read ? '' : ' unread')} onClick={() => go(n)}>
                  <strong>{LABEL[n.type]}</strong>
                  <span className="muted">{n.venue_title} · {n.start_date} → {n.end_date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Adicionar o sino no `site-nav.tsx`** — import + render ao lado do Dock:
```tsx
import Dock, { type DockItemData } from './Dock';
import NotificationBell from './notification-bell';
```
```tsx
  return (
    <div className="site-nav">
      <Dock items={items} panelHeight={64} baseItemSize={44} magnification={64} dockHeight={140} distance={160} />
      <NotificationBell />
    </div>
  );
```

- [ ] **Step 3: CSS no fim de `globals.css`**

```css
/* --- Sino de notificações --- */
.notif-bell { position: fixed; top: 16px; right: 16px; z-index: 60; }
.notif-trigger {
  position: relative;
  width: 44px; height: 44px;
  display: grid; place-items: center;
  border-radius: 999px; border: 1px solid #eee; background: #fff; color: #444;
  cursor: pointer; box-shadow: 0 6px 18px rgba(60, 40, 120, 0.1);
  transition: transform var(--duration-press) var(--ease-out), color 150ms var(--ease-out);
}
.notif-trigger:active { transform: scale(0.95); }
@media (hover: hover) and (pointer: fine) { .notif-trigger:hover { color: var(--brand-purple); } }
.notif-badge {
  position: absolute; top: -4px; right: -4px;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 999px; background: var(--brand-purple); color: #fff;
  font-size: 11px; font-weight: 600; display: grid; place-items: center;
}
.notif-panel {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 320px; max-height: 60vh; overflow-y: auto;
  background: #fff; border: 1px solid #eee; border-radius: 14px;
  box-shadow: 0 16px 40px rgba(60, 40, 120, 0.16); padding: 8px;
  transform-origin: top right; animation: notif-pop var(--duration-popover) var(--ease-out);
}
@keyframes notif-pop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
.notif-head { font-weight: 600; font-size: 14px; margin: 6px 10px 8px; }
.notif-empty { color: #666; font-size: 14px; margin: 12px 10px; }
.notif-list { list-style: none; margin: 0; padding: 0; }
.notif-item {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px; border-radius: 10px; cursor: pointer; font-size: 14px;
  transition: background 150ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .notif-item:hover { background: #f6f5fb; } }
.notif-item.unread { background: var(--brand-tint); }
@media (prefers-reduced-motion: reduce) { .notif-panel { animation: none; } }
```

- [ ] **Step 4: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/notification-bell.tsx frontend/app/components/site-nav.tsx frontend/app/globals.css
git commit -m "feat(front): sino de notificações no Dock (badge + dropdown + poll)"
```

---

## Task 6: Verificação integrada (smoke)

**Files:** nenhum.

- [ ] **Step 1: Gates + aplicar 0005 no DB de dev + rebuild**

Run: `cd backend && go test ./... && go build ./...`
Run (aplica a migração preservando os dados de QA):
```bash
docker compose exec -T postgres psql -U app -d venues < backend/migrations/0005_notifications.sql
```
Run: `docker compose up -d --build backend frontend`
Expected: gates verdes; tabela `notifications` criada; backend/health OK; frontend recompila.

- [ ] **Step 2: Disparar uma transição → notificação in-app**

```bash
B=http://localhost:8080/api/v1; O='-H Origin:http://localhost:3100'
curl -s $O -c /tmp/g.txt -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"guest@dope.local","password":"dope12345"}' -o /dev/null
VID=$(curl -s "$B/public/venues" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
curl -s $O -b /tmp/g.txt -X POST $B/venues/$VID/bookings -H 'Content-Type: application/json' -d '{"start_date":"2026-11-01","end_date":"2026-11-03"}' -o /dev/null
```
(Gera uma notificação `booking_requested` para o **host** do espaço.)

- [ ] **Step 3: Conferir unread-count / list / mark-read / 401**

```bash
B=http://localhost:8080/api/v1; O='-H Origin:http://localhost:3100'
curl -s $O -c /tmp/h.txt -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"host@dope.local","password":"dope12345"}' -o /dev/null
echo "unread: $(curl -s $O -b /tmp/h.txt $B/notifications/unread-count)"
echo "lista:"; curl -s $O -b /tmp/h.txt $B/notifications | python3 -c "import sys,json;[print(' -',n['type'],n['venue_title'],'read='+str(n['read'])) for n in json.load(sys.stdin)]"
curl -s $O -b /tmp/h.txt -X POST $B/notifications/read -o /dev/null -w 'mark-read [%{http_code}]\n'
echo "unread após read: $(curl -s $O -b /tmp/h.txt $B/notifications/unread-count)"
echo "sem login: $(curl -s $O -o /dev/null -w '%{http_code}' $B/notifications/unread-count)"
rm -f /tmp/g.txt /tmp/h.txt
```
Expected: unread `{"count":>=1}`; lista mostra `booking_requested` com read=false; mark-read `[204]`; unread depois `{"count":0}`; sem login `401`.

- [ ] **Step 4: Smoke da UI**

Logado como `host@dope.local` em http://localhost:3100 → o **sino** (canto superior direito) mostra o badge; clicar abre o painel com a notificação; reabrir → badge zerado. Deslogado → sem sino.

- [ ] **Step 5: Atualizar o vault e commitar**

Em `docs/Home.md`, anotar o sino/notificações in-app no estado atual.
```bash
git add docs/Home.md
git commit -m "docs: notificações in-app + sino no Dock"
```

---

## Notas de execução

- **Subagentes sem Bash nesta sessão** → execução inline; sem lógica pura nova relevante → validação por smoke.
- **`sqlc generate`** após a Task 1; **aplicar `0005` manualmente** no DB de QA (Task 6) para não perder os dados.
- **Rebuild do backend** necessário (Go compila na imagem).
- Lido por-item, SSE, preferências e paginação ficam fora (anotados na spec).
