# Design — Notificações in-app + sino no Dock

**Data:** 2026-06-27
**Objetivo:** um sino no topo do site (junto ao Dock) que mostra, para host e
convidado, as notificações dos eventos de reserva (solicitada/confirmada/
cancelada), com badge de não-lidas e painel dropdown.
**Contexto:** hoje as notificações são só e-mail (RabbitMQ → worker → Mailpit).
Não há persistência in-app nem endpoint para o usuário ver suas notificações.

## Decisões (do brainstorming)

| Tema | Escolha |
| --- | --- |
| UX do sino | **Dropdown ancorado** (painel abre no próprio sino). |
| Lido/badge | **Badge com contagem; abrir o painel marca todas lidas.** Não-lidas destacadas. |
| Atualização | **Poll leve a cada 30s** (+ ao montar). |
| Gravação | **Abordagem B:** o `notifications.Notifier` grava a linha in-app (síncrono, durável) e publica o e-mail. `bookings.Service` intocado. |

## Arquitetura

### 1. Persistência (`backend/migrations/0005_notifications.sql`)

```sql
CREATE TABLE notifications (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_id BIGINT      NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    type       TEXT        NOT NULL, -- booking_requested|booking_confirmed|booking_cancelled
    read       BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
```

⚠️ Migrations são initdb (só em volume novo). Como o DB de dev tem os dados de
QA, o `0005` é aplicado **manualmente** (psql/Adminer), sem `down -v`.

### 2. Queries (`backend/internal/db/queries/notifications.sql`)

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
Requer `sqlc generate`.

### 3. Gravação no Notifier (`internal/notifications/notifier.go`)

`Notifier` ganha `q *sqlc.Queries`; `NewNotifier(pub *rabbitmq.Publisher, q *sqlc.Queries)`.
Cada `BookingRequested/Confirmed/Cancelled` chama um `record` que:
```go
func (n *Notifier) record(ctx context.Context, t EventType, bookingID, recipientID int64) {
	if n.q != nil {
		if err := n.q.CreateNotification(ctx, sqlc.CreateNotificationParams{
			UserID: recipientID, BookingID: bookingID, Type: string(t),
		}); err != nil {
			log.Printf("notif: persist in-app: %v", err) // best-effort
		}
	}
	n.emit(ctx, t, bookingID, recipientID) // e-mail (assíncrono, best-effort)
}
```
A porta `bookings.Notifier` **não muda** (mesmos 3 métodos).

### 4. Handler HTTP (`internal/notifications/handler.go`)

`Handler{ q *sqlc.Queries }`; `NewHandler(q)`. Rotas atrás de `requireAuth`:

| Rota | Ação |
| --- | --- |
| `GET /notifications` | lista (até 20) do usuário logado |
| `GET /notifications/unread-count` | `{ "count": N }` |
| `POST /notifications/read` | marca todas lidas → 204 |

DTO:
```go
type notificationResp struct {
	ID         int64  `json:"id"`
	Type       string `json:"type"`
	Read       bool   `json:"read"`
	CreatedAt  string `json:"created_at"`  // RFC3339
	BookingID  int64  `json:"booking_id"`
	VenueTitle string `json:"venue_title"`
	StartDate  string `json:"start_date"`  // YYYY-MM-DD
	EndDate    string `json:"end_date"`
}
```
Usa o usuário da sessão (`c.MustGet("user").(sqlc.User)`). Datas via helper
(`pgtype.Date`→string); `created_at` via `pgtype.Timestamptz`→RFC3339.

### 5. Wiring (`internal/server/server.go`)

- `notifications.NewNotifier(deps.Broker, queries)` (passa `queries`).
- Registrar `notifications.NewHandler(queries).Routes(api, authH.RequireAuth())`.

### 6. Frontend — API (`app/venues/lib.ts`)

```ts
export type NotificationType = 'booking_requested' | 'booking_confirmed' | 'booking_cancelled';
export interface AppNotification {
  id: number; type: NotificationType; read: boolean; created_at: string;
  booking_id: number; venue_title: string; start_date: string; end_date: string;
}
```
O sino faz `fetch` direto (NÃO o `req()`, que redireciona pra /login no 401):
deslogado (401) apenas **esconde o sino**, sem redirecionar.

### 7. Frontend — sino (`app/components/notification-bell.tsx`)

Componente próprio (client), colocado no `.site-nav` ao lado do `<Dock>`:
- Ao montar: busca `unread-count`. **401 → não renderiza nada e para o poll.**
  200 → mostra o sino e inicia **poll de 30s** (limpa o intervalo no unmount).
- Badge com a contagem quando > 0.
- Clique → alterna o dropdown. Ao abrir: busca a lista, exibe, chama
  `markRead` (badge → 0). Clique-fora fecha (listener no `document`).
- Item: ícone + texto por tipo (`Nova solicitação de reserva` / `Reserva
  confirmada` / `Reserva cancelada`) + `venue_title` + datas; não-lidas
  destacadas. Clicar navega: `requested` → `/reservas/recebidas`, demais →
  `/reservas`.
- `site-nav.tsx`: adicionar `<NotificationBell />` ao lado do `<Dock>`.
- CSS no padrão do site (`docs/design.md`): `.notif-bell`, `.notif-badge`,
  `.notif-panel`, `.notif-item`/`.notif-item.unread`. Durações <300ms, só
  `transform`/`opacity` na entrada do painel, `prefers-reduced-motion`.

## Fluxo de dados (confirmar, exemplo)

```
host confirma → svc.Confirm → notifier.BookingConfirmed(bookingID, guestID)
  → CreateNotification(user=guest, booking, "booking_confirmed")  [in-app, durável]
  → emit → fila (e-mail, async)
...convidado... sino faz poll → unread-count = 1 → badge "1"
  → abre painel → list → "Reserva confirmada — <espaço>" → markRead → badge 0
```

## Erros & degradação

- Persist in-app falha → log; a reserva e o e-mail seguem (best-effort).
- `GET` com erro de DB → 500; o sino mantém o último estado e não quebra a página.
- Deslogado → 401 → sino some, sem redirect, poll para.

## Testes

- Pouca lógica pura nova (DB + glue) → validação por **smoke**:
  1. Disparar transições (host/guest) → linhas em `notifications`.
  2. `GET /notifications` (logado) retorna os itens; `unread-count` bate.
  3. `POST /notifications/read` → `unread-count` = 0.
  4. Sem cookie → `GET /notifications/unread-count` = 401.
- Testes existentes verdes (a mudança de assinatura do `NewNotifier` só afeta o `server.go`).
- Gates: `cd backend && go test ./... && go build ./...`; `cd frontend && npm run typecheck && npm run build`.

## Fora de escopo (anotado para o futuro)

- Lido por-item; tempo real/SSE; preferências de notificação (opt-out);
  paginação além de 20; "ver todas" em página dedicada; notificações fora do
  ciclo de reserva; estado global de "logado" no front (o sino se vira no 401).
