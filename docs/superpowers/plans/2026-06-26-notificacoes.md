# Notificações por e-mail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar e-mail (capturado pelo Mailpit) nas transições de reserva — solicitada→host, confirmada→convidado, cancelada→outra parte — de forma best-effort.

**Architecture:** O `bookings.Service` publica um evento mínimo `{type, booking_id, recipient_id}` na fila `notifications` após cada transição (best-effort). Um worker no pacote `internal/notifications` consome, busca os fatos, renderiza um e-mail texto-puro e envia via `net/smtp` pro Mailpit.

**Tech Stack:** Go + Gin, pgx/sqlc, RabbitMQ (amqp091), `net/smtp` (stdlib), Mailpit.

## Global Constraints

- **Backend type-safety via sqlc:** após editar `internal/db/queries/bookings.sql`, rodar `sqlc generate` a partir de `./backend` (gera `internal/db/sqlc/`, nunca editar à mão).
- **Best-effort:** publish após a transição (log em falha, nunca propaga); worker loga+ack em qualquer erro (sem retry/DLQ).
- **Degradação:** broker `nil` ou `SMTP_ADDR` vazio → notificações desligadas; o fluxo de reserva funciona normalmente.
- **Sem dependência nova:** SMTP via `net/smtp` da stdlib. E-mail **texto puro, PT-BR**. Remetente `no-reply@espacos.local` (display "Espaços").
- **Anti-gotcha:** `NewNotifier` recebe `*rabbitmq.Publisher` concreto (nil-pointer → no-op); NÃO uma interface (evita typed-nil panic).
- **Gates:** `cd backend && go test ./... && go build ./...`.

---

## File Structure

- Modify: `backend/internal/db/queries/bookings.sql` — estende `LockVenueForBooking` (+host_id) e adiciona `GetBookingNotificationData`.
- Regenerate: `backend/internal/db/sqlc/bookings.sql.go`.
- Modify: `backend/internal/config/config.go` — `SMTPAddr`.
- Modify: `backend/internal/platform/rabbitmq/rabbitmq.go` — `Consume`.
- Create: `backend/internal/notifications/notifier.go` — `Event`, `EventType`, `Notifier` (publish).
- Create: `backend/internal/notifications/render.go` — `renderMail` (puro) + `MailData`.
- Create: `backend/internal/notifications/render_test.go` — unit tests.
- Create: `backend/internal/notifications/consumer.go` — `Consumer` + `sendMail`.
- Modify: `backend/internal/bookings/service.go` — porta `Notifier`, `NewService(+notifier)`, publish em Create/Confirm/Cancel.
- Modify: `backend/internal/server/server.go` — injeta `notifications.NewNotifier(deps.Broker)`.
- Modify: `backend/cmd/api/main.go` — inicia o `Consumer`.

---

## Task 1: SQL (host_id no lock + dados de notificação) + generate

**Files:**
- Modify: `backend/internal/db/queries/bookings.sql`
- Regenerate: `backend/internal/db/sqlc/bookings.sql.go`

**Interfaces:**
- Produces: `LockVenueForBookingRow` ganha `HostID int64`. `GetBookingNotificationData(ctx, GetBookingNotificationDataParams{RecipientID, BookingID int64}) (GetBookingNotificationDataRow, error)` com `VenueTitle string; StartDate, EndDate pgtype.Date; TotalPrice pgtype.Numeric; RecipientName, RecipientEmail string`.

- [ ] **Step 1: Estender o lock e adicionar a query de dados**

Em `bookings.sql`, troque a query `LockVenueForBooking` por (adiciona `host_id`):
```sql
-- name: LockVenueForBooking :one
-- Pessimistic lock: trava a linha do espaço até o fim da tx.
SELECT id, status, host_id FROM venues WHERE id = $1 FOR UPDATE;
```
E adicione no fim do arquivo:
```sql
-- name: GetBookingNotificationData :one
-- Fatos p/ montar o e-mail (parametrizado por reserva e destinatário).
SELECT v.title AS venue_title, b.start_date, b.end_date, b.total_price,
       u.name AS recipient_name, u.email AS recipient_email
FROM bookings b
JOIN venues v ON v.id = b.venue_id
JOIN users u ON u.id = @recipient_id
WHERE b.id = @booking_id;
```

- [ ] **Step 2: Gerar**

Run: `cd backend && sqlc generate` (se faltar: `go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest`)
Expected: sem erros.

- [ ] **Step 3: Confirmar tipos**

Run: `grep -nE "HostID|type GetBookingNotificationData(Params|Row) struct" -A8 backend/internal/db/sqlc/bookings.sql.go`
Expected: `LockVenueForBookingRow` com `HostID int64`; `GetBookingNotificationDataParams{RecipientID, BookingID int64}`; `GetBookingNotificationDataRow{VenueTitle string; StartDate, EndDate pgtype.Date; TotalPrice pgtype.Numeric; RecipientName, RecipientEmail string}`.

- [ ] **Step 4: Build (additivo)**

Run: `cd backend && go build ./...`
Expected: sem erros (o `Create` usa `venue.Status`; `HostID` ainda não usado — ok).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/db/queries/bookings.sql backend/internal/db/sqlc/bookings.sql.go
git commit -m "feat(bookings): host_id no lock + GetBookingNotificationData (sqlc)"
```

---

## Task 2: Config SMTP + Consume no rabbitmq

**Files:**
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/platform/rabbitmq/rabbitmq.go`

**Interfaces:**
- Produces: `config.Config.SMTPAddr string`; `(*rabbitmq.Publisher).Consume(queue string) (<-chan amqp.Delivery, error)`.

- [ ] **Step 1: Adicionar `SMTPAddr` à config**

Em `config.go`, no struct `Config` (após `S3PublicURL`):
```go
	SMTPAddr string // host:port do SMTP (Mailpit em dev); vazio = worker desligado
```
E em `Load()`, no literal `Config{...}` (após `S3PublicURL: ...`):
```go
		SMTPAddr: get("SMTP_ADDR", ""),
```

- [ ] **Step 2: Adicionar `Consume` ao Publisher**

Em `rabbitmq.go`, após o método `Publish`:
```go
// Consume abre um canal PRÓPRIO (o canal de publish não é goroutine-safe) e
// entrega as mensagens da fila com ack manual.
func (p *Publisher) Consume(queue string) (<-chan amqp.Delivery, error) {
	ch, err := p.conn.Channel()
	if err != nil {
		return nil, err
	}
	return ch.Consume(queue, "", false, false, false, false, nil)
}
```

- [ ] **Step 3: Build**

Run: `cd backend && go build ./...`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/config/config.go backend/internal/platform/rabbitmq/rabbitmq.go
git commit -m "feat(infra): config SMTP_ADDR + Publisher.Consume"
```

---

## Task 3: Pacote notifications — evento, notifier e render (TDD)

**Files:**
- Create: `backend/internal/notifications/notifier.go`
- Create: `backend/internal/notifications/render.go`
- Create: `backend/internal/notifications/render_test.go`

**Interfaces:**
- Consumes: `rabbitmq.NotificationsQueue`, `(*rabbitmq.Publisher).Publish`.
- Produces: `EventType` (`BookingRequested/Confirmed/Cancelled`), `Event{Type,BookingID,RecipientID}`, `NewNotifier(*rabbitmq.Publisher) *Notifier` com métodos `BookingRequested/Confirmed/Cancelled(ctx, bookingID, recipientID int64)`; `MailData`; `renderMail(EventType, MailData) (subject, body string)`.

- [ ] **Step 1: Escrever o teste que falha (`render_test.go`)**

```go
package notifications

import (
	"strings"
	"testing"
)

func TestRenderMail(t *testing.T) {
	d := MailData{RecipientName: "Ana", VenueTitle: "Salão Vista", StartDate: "2026-08-01", EndDate: "2026-08-03", TotalPrice: "1000.00"}
	for _, tt := range []EventType{BookingRequested, BookingConfirmed, BookingCancelled} {
		subject, body := renderMail(tt, d)
		if subject == "" || body == "" {
			t.Fatalf("%s: assunto/corpo vazios", tt)
		}
		if !strings.Contains(body, "Salão Vista") || !strings.Contains(body, "Ana") {
			t.Fatalf("%s: corpo sem os dados: %q", tt, body)
		}
	}
	if _, body := renderMail(BookingConfirmed, d); !strings.Contains(body, "2026-08-01") {
		t.Fatalf("confirmada deveria mostrar a data: %q", body)
	}
	if s, b := renderMail(EventType("desconhecido"), d); s == "" || b == "" {
		t.Fatal("fallback não deveria ser vazio")
	}
}
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && go test ./internal/notifications/... 2>&1 | head`
Expected: FALHA de compilação (pacote/identificadores indefinidos).

- [ ] **Step 3: Criar `notifier.go`**

```go
package notifications

import (
	"context"
	"encoding/json"
	"log"

	"github.com/doperepo/backend/internal/platform/rabbitmq"
)

type EventType string

const (
	BookingRequested EventType = "booking_requested"
	BookingConfirmed EventType = "booking_confirmed"
	BookingCancelled EventType = "booking_cancelled"
)

type Event struct {
	Type        EventType `json:"type"`
	BookingID   int64     `json:"booking_id"`
	RecipientID int64     `json:"recipient_id"`
}

// Notifier publica eventos de reserva na fila (best-effort).
// pub nil (broker desligado) → no-op.
type Notifier struct{ pub *rabbitmq.Publisher }

func NewNotifier(pub *rabbitmq.Publisher) *Notifier { return &Notifier{pub: pub} }

func (n *Notifier) BookingRequested(ctx context.Context, bookingID, recipientID int64) {
	n.emit(ctx, BookingRequested, bookingID, recipientID)
}
func (n *Notifier) BookingConfirmed(ctx context.Context, bookingID, recipientID int64) {
	n.emit(ctx, BookingConfirmed, bookingID, recipientID)
}
func (n *Notifier) BookingCancelled(ctx context.Context, bookingID, recipientID int64) {
	n.emit(ctx, BookingCancelled, bookingID, recipientID)
}

func (n *Notifier) emit(ctx context.Context, t EventType, bookingID, recipientID int64) {
	if n.pub == nil {
		return
	}
	body, err := json.Marshal(Event{Type: t, BookingID: bookingID, RecipientID: recipientID})
	if err != nil {
		log.Printf("notif: marshal: %v", err)
		return
	}
	if err := n.pub.Publish(ctx, rabbitmq.NotificationsQueue, body); err != nil {
		log.Printf("notif: publish: %v", err) // best-effort
	}
}
```

- [ ] **Step 4: Criar `render.go`**

```go
package notifications

import "fmt"

type MailData struct {
	RecipientName string
	VenueTitle    string
	StartDate     string // "2006-01-02"
	EndDate       string
	TotalPrice    string
}

// renderMail devolve assunto + corpo (texto puro PT-BR) por tipo de evento.
func renderMail(t EventType, d MailData) (subject, body string) {
	switch t {
	case BookingRequested:
		subject = "Nova solicitação de reserva"
		body = fmt.Sprintf("Olá %s,\n\nVocê recebeu uma solicitação de reserva para %q.\nDatas: %s → %s · Total: R$ %s.\n\nConfirme ou recuse em \"Reservas recebidas\".\n\n— Espaços",
			d.RecipientName, d.VenueTitle, d.StartDate, d.EndDate, d.TotalPrice)
	case BookingConfirmed:
		subject = "Sua reserva foi confirmada"
		body = fmt.Sprintf("Olá %s,\n\nSua reserva em %q foi confirmada.\nDatas: %s → %s · Total: R$ %s.\n\n— Espaços",
			d.RecipientName, d.VenueTitle, d.StartDate, d.EndDate, d.TotalPrice)
	case BookingCancelled:
		subject = "Reserva cancelada"
		body = fmt.Sprintf("Olá %s,\n\nA reserva em %q foi cancelada.\nDatas: %s → %s.\n\n— Espaços",
			d.RecipientName, d.VenueTitle, d.StartDate, d.EndDate)
	default:
		subject = "Atualização da sua reserva"
		body = fmt.Sprintf("Olá %s,\n\nHouve uma atualização na sua reserva em %q.\n\n— Espaços",
			d.RecipientName, d.VenueTitle)
	}
	return subject, body
}
```

- [ ] **Step 5: Rodar (verde) + build**

Run: `cd backend && go test ./internal/notifications/... -v 2>&1 | grep -E "PASS|FAIL|ok"`
Expected: PASS em `TestRenderMail`.
Run: `cd backend && go build ./...`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/notifications/notifier.go backend/internal/notifications/render.go backend/internal/notifications/render_test.go
git commit -m "feat(notifications): evento, notifier (publish) e render de e-mail"
```

---

## Task 4: Pacote notifications — worker (consumer + SMTP)

**Files:**
- Create: `backend/internal/notifications/consumer.go`

**Interfaces:**
- Consumes: `(*rabbitmq.Publisher).Consume` (Task 2), `sqlc.Queries.GetBookingNotificationData` (Task 1), `renderMail`/`Event` (Task 3).
- Produces: `NewConsumer(*rabbitmq.Publisher, *sqlc.Queries, smtpAddr string) (*Consumer, error)`; `(*Consumer).Start(ctx context.Context)`.

- [ ] **Step 1: Criar `consumer.go`**

```go
package notifications

import (
	"context"
	"encoding/json"
	"log"
	"mime"
	"net/smtp"
	"strings"

	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/doperepo/backend/internal/db/sqlc"
	"github.com/doperepo/backend/internal/platform/rabbitmq"
)

const (
	mailFromAddr   = "no-reply@espacos.local"
	mailFromHeader = "Espaços <no-reply@espacos.local>"
)

// Consumer lê eventos da fila e envia e-mails (best-effort) via SMTP.
type Consumer struct {
	deliveries <-chan amqp.Delivery
	q          *sqlc.Queries
	smtpAddr   string
}

func NewConsumer(broker *rabbitmq.Publisher, q *sqlc.Queries, smtpAddr string) (*Consumer, error) {
	deliveries, err := broker.Consume(rabbitmq.NotificationsQueue)
	if err != nil {
		return nil, err
	}
	return &Consumer{deliveries: deliveries, q: q, smtpAddr: smtpAddr}, nil
}

// Start dispara a goroutine que processa a fila até o canal fechar.
func (c *Consumer) Start(ctx context.Context) {
	go func() {
		log.Printf("worker de notificações ouvindo a fila %q", rabbitmq.NotificationsQueue)
		for d := range c.deliveries {
			c.handle(ctx, d.Body)
			_ = d.Ack(false) // best-effort: sempre ack (sem requeue)
		}
	}()
}

func (c *Consumer) handle(ctx context.Context, body []byte) {
	var ev Event
	if err := json.Unmarshal(body, &ev); err != nil {
		log.Printf("notif worker: unmarshal: %v", err)
		return
	}
	row, err := c.q.GetBookingNotificationData(ctx, sqlc.GetBookingNotificationDataParams{
		RecipientID: ev.RecipientID,
		BookingID:   ev.BookingID,
	})
	if err != nil {
		log.Printf("notif worker: dados (booking=%d): %v", ev.BookingID, err)
		return
	}
	subject, text := renderMail(ev.Type, MailData{
		RecipientName: row.RecipientName,
		VenueTitle:    row.VenueTitle,
		StartDate:     dateStr(row.StartDate),
		EndDate:       dateStr(row.EndDate),
		TotalPrice:    priceStr(row.TotalPrice),
	})
	if err := sendMail(c.smtpAddr, row.RecipientEmail, subject, text); err != nil {
		log.Printf("notif worker: envio (to=%s): %v", row.RecipientEmail, err)
	}
}

func sendMail(addr, to, subject, body string) error {
	msg := strings.Join([]string{
		"From: " + mailFromHeader,
		"To: " + to,
		"Subject: " + mime.QEncoding.Encode("UTF-8", subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		body,
	}, "\r\n")
	return smtp.SendMail(addr, nil, mailFromAddr, []string{to}, []byte(msg))
}

func dateStr(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format("2006-01-02")
}

func priceStr(n pgtype.Numeric) string {
	if !n.Valid {
		return "0"
	}
	v, err := n.Value()
	if err != nil || v == nil {
		return "0"
	}
	if s, ok := v.(string); ok {
		return s
	}
	return "0"
}
```

- [ ] **Step 2: Build + suíte**

Run: `cd backend && go build ./... && go test ./...`
Expected: sem erros; testes verdes.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/notifications/consumer.go
git commit -m "feat(notifications): worker consumidor + envio SMTP (Mailpit)"
```

---

## Task 5: Ligar no fluxo de reserva (bookings + server)

**Files:**
- Modify: `backend/internal/bookings/service.go`
- Modify: `backend/internal/server/server.go`

**Interfaces:**
- Consumes: `notifications.NewNotifier` (Task 3); `LockVenueForBookingRow.HostID` (Task 1).
- Produces: porta `bookings.Notifier`; `bookings.NewService(pool, q, notifier Notifier)`.

- [ ] **Step 1: Porta + struct + construtor em `service.go`**

Adicione (após o bloco de erros, antes do struct `Service`):
```go
// Notifier é a porta best-effort de notificação (impl em internal/notifications).
type Notifier interface {
	BookingRequested(ctx context.Context, bookingID, recipientID int64)
	BookingConfirmed(ctx context.Context, bookingID, recipientID int64)
	BookingCancelled(ctx context.Context, bookingID, recipientID int64)
}
```
Troque o struct `Service` e `NewService`:
```go
type Service struct {
	pool     *pgxpool.Pool
	q        *sqlc.Queries
	notifier Notifier
}

func NewService(pool *pgxpool.Pool, q *sqlc.Queries, notifier Notifier) *Service {
	return &Service{pool: pool, q: q, notifier: notifier}
}
```

- [ ] **Step 2: Publicar nas transições**

Em `Create`, troque o fim (`if err := tx.Commit...` + `return booking, nil`) por:
```go
	if err := tx.Commit(ctx); err != nil {
		return sqlc.Booking{}, err
	}
	s.notifier.BookingRequested(ctx, booking.ID, venue.HostID)
	return booking, nil
```

Em `Confirm`, troque o fim (a partir de `b, err := s.q.ConfirmBooking`):
```go
	b, err := s.q.ConfirmBooking(ctx, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Booking{}, ErrInvalidTransition // estado mudou na corrida
	}
	if err != nil {
		return sqlc.Booking{}, err
	}
	s.notifier.BookingConfirmed(ctx, b.ID, row.GuestID)
	return b, nil
```

Em `Cancel`, troque o fim (a partir de `b, err := s.q.CancelBooking`):
```go
	b, err := s.q.CancelBooking(ctx, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Booking{}, ErrInvalidTransition
	}
	if err != nil {
		return sqlc.Booking{}, err
	}
	recipient := row.GuestID // host cancelou → avisa convidado
	if userID == row.GuestID {
		recipient = row.HostID // convidado cancelou → avisa host
	}
	s.notifier.BookingCancelled(ctx, b.ID, recipient)
	return b, nil
```

- [ ] **Step 3: Injetar o notifier em `server.go`**

Adicione ao bloco de imports de `server.go`:
```go
	"github.com/doperepo/backend/internal/notifications"
```
Troque a linha do `bookingsH`:
```go
	bookingsH := bookings.NewHandler(bookings.NewService(deps.DB, queries, notifications.NewNotifier(deps.Broker)))
```

- [ ] **Step 4: Build + suíte**

Run: `cd backend && go build ./... && go test ./...`
Expected: sem erros; testes verdes (os unit tests de `bookings` testam funções puras, não o construtor).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/bookings/service.go backend/internal/server/server.go
git commit -m "feat(bookings): publica eventos de notificação nas transições"
```

---

## Task 6: Iniciar o worker no main

**Files:**
- Modify: `backend/cmd/api/main.go`

**Interfaces:**
- Consumes: `notifications.NewConsumer` (Task 4), `sqlc.New`, `cfg.SMTPAddr`, `broker`.

- [ ] **Step 1: Adicionar imports**

No bloco de imports de `main.go`, adicione:
```go
	"github.com/doperepo/backend/internal/db/sqlc"
	"github.com/doperepo/backend/internal/notifications"
```

- [ ] **Step 2: Iniciar o consumer após o broker**

Logo após o bloco que cria `broker` (antes de `router := server.New(...)`), adicione:
```go
	// Worker de notificações — só sobe com broker e SMTP configurados.
	if broker != nil && cfg.SMTPAddr != "" {
		if cons, err := notifications.NewConsumer(broker, sqlc.New(db), cfg.SMTPAddr); err != nil {
			log.Printf("worker de notificações desabilitado: %v", err)
		} else {
			cons.Start(ctx)
		}
	}
```

- [ ] **Step 3: Build + vet**

Run: `cd backend && go build ./... && go vet ./...`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/api/main.go
git commit -m "feat(notifications): inicia o worker de e-mail no bootstrap"
```

---

## Task 7: Verificação integrada (smoke via Mailpit)

**Files:** nenhum (validação ponta a ponta).

- [ ] **Step 1: Gates + rebuild do backend**

Run: `cd backend && go test ./... && go build ./...`
Run: `docker compose up -d --build backend` (Go compila na imagem; precisa do binário novo)
Expected: verde; backend saudável em :8080.

- [ ] **Step 2: Limpar a caixa do Mailpit**

Run: `curl -s -X DELETE http://localhost:8025/api/v1/messages -o /dev/null -w '%{http_code}\n'`
Expected: 200 (inbox zerada).

- [ ] **Step 3: Disparar o ciclo (host + convidado)**

```bash
B=http://localhost:8080/api/v1; O='-H Origin:http://localhost:3100'
curl -s $O -c /tmp/h.txt -X POST $B/auth/register -H 'Content-Type: application/json' -d '{"name":"Host","email":"h2@x.com","password":"teste1234"}' -o /dev/null
curl -s $O -c /tmp/g.txt -X POST $B/auth/register -H 'Content-Type: application/json' -d '{"name":"Guest","email":"g2@x.com","password":"teste1234"}' -o /dev/null
VID=$(curl -s $O -b /tmp/h.txt -X POST $B/venues -H 'Content-Type: application/json' -d '{"title":"Espaço Notif","capacity":30,"price_per_day":"400","address":"R 1","city":"São Paulo","state":"SP"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s $O -b /tmp/h.txt -X POST $B/venues/$VID/publish -o /dev/null
BID=$(curl -s $O -b /tmp/g.txt -X POST $B/venues/$VID/bookings -H 'Content-Type: application/json' -d '{"start_date":"2026-09-01","end_date":"2026-09-03"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s $O -b /tmp/h.txt -X POST $B/bookings/$BID/confirm -o /dev/null
curl -s $O -b /tmp/g.txt -X POST $B/bookings/$BID/cancel  -o /dev/null
sleep 2
```

- [ ] **Step 4: Conferir o Mailpit**

```bash
curl -s http://localhost:8025/api/v1/messages | python3 -c '
import sys,json
m=json.load(sys.stdin)
print("total:", m["total"])
for x in m["messages"]:
    print(" -", x["Subject"], "->", [t["Address"] for t in x["To"]])
'
```
Expected: **total 3** — "Nova solicitação de reserva" → `h2@x.com`; "Sua reserva foi confirmada" → `g2@x.com`; "Reserva cancelada" → `h2@x.com` (convidado cancelou → host avisado).

- [ ] **Step 5: Limpar dados de teste**

```bash
docker compose exec -T postgres psql -U app -d venues -c "DELETE FROM users WHERE email IN ('h2@x.com','g2@x.com');"
rm -f /tmp/h.txt /tmp/g.txt
```

- [ ] **Step 6: Atualizar o vault e commitar**

Em `docs/Home.md` (e/ou `docs/decisions.md`), anotar que as notificações de reserva estão ativas (RabbitMQ → worker → Mailpit). 
```bash
git add docs/
git commit -m "docs: notificações de reserva ativas (RabbitMQ → Mailpit)"
```

---

## Notas de execução

- **Subagentes sem Bash nesta sessão** → execução inline; TDD cobre o render puro, o resto valida no smoke do Mailpit.
- **`sqlc generate` obrigatório** após a Task 1.
- **Rebuild do backend** é necessário (Go compila na imagem) pra o worker e as rotas novas subirem.
- Retry/DLQ/outbox, HTML, reconexão e opt-out ficam fora (anotados na spec).
