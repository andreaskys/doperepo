# Design — Notificações por e-mail (eventos de reserva)

**Data:** 2026-06-26
**Contexto MVP:** liga o subsistema de notificações que estava só andaimado
(fila `notifications` declarada, `Publisher.Publish` existe mas **sem nenhum
chamador**, e nenhum worker/SMTP). Fecha o gancho previsto no compose
(`SMTP_ADDR: mailpit:1025`, comentado "client Go entra junto com a feature").
**Escopo:** e-mail nos 3 eventos do ciclo de reserva, entrega **best-effort**.

## Objetivo

Enviar e-mail (capturado pelo Mailpit em dev) nas transições de reserva:
- **Solicitada** (Create) → **host** ("nova solicitação de reserva")
- **Confirmada** (Confirm) → **convidado** ("sua reserva foi confirmada")
- **Cancelada/recusada** (Cancel) → **a outra parte** (host cancela → convidado;
  convidado cancela → host)

A reserva nunca falha por causa do e-mail (publish após a transição; tudo
best-effort).

## Contexto (código atual)

- `internal/platform/rabbitmq/rabbitmq.go`: `Publisher{conn,ch}` com
  `New(url)`, `Publish(ctx, queue, body)`, `Close()`; `NotificationsQueue =
  "notifications"` (durable, já declarada). **Sem `Consume`.**
- `cmd/api/main.go`: cria `broker` (não-fatal; nil se `RABBITMQ_URL` vazio ou
  broker fora), injeta em `server.Deps`. Graceful shutdown com `defer broker.Close()`.
- `internal/server/server.go`: monta `bookings.NewService(deps.DB, queries)` —
  **sem broker**.
- `internal/bookings/service.go`: `Create` (tx: `LockVenueForBooking` → overlap →
  `CreateBooking`), `Confirm`/`Cancel` (com `GetBookingWithOwner` → `host_id`,
  `guest_id`, `status`). `LockVenueForBooking` hoje retorna só `{id, status}`.
- `internal/config/config.go`: 12-factor via `os.Getenv`. **Sem `SMTPAddr`.**
- `docker-compose.yml`: backend já recebe `SMTP_ADDR: mailpit:1025` e
  `RABBITMQ_URL`. Mailpit SMTP :1025, web/API :8025.

## Decisões desta feature

| Decisão | Escolha | Por quê |
| --- | --- | --- |
| Modelo da mensagem | **Evento de domínio `{type, booking_id, recipient_id}`; worker busca e renderiza** (Abordagem A) | Concentra notificação num pacote; `bookings` só publica. Mensagem mínima; render puro/testável. |
| Entrega | **Best-effort** | Publish após a transição (log em falha); worker loga+ack em erro, sem retry/DLQ. Casa com o "warn-and-continue" existente e o Mailpit de dev. |
| Cliente SMTP | **`net/smtp` (stdlib)** | Mailpit aceita plaintext sem auth; sem dependência nova. |
| Formato do e-mail | **Texto puro, PT-BR** | MVP; HTML fica para depois. |
| Remetente | **`Espaços <no-reply@espacos.local>`** (fixo) | Suficiente em dev. |
| Onde roda o worker | **Mesma process da API (goroutine)** | Simples; binário separado só quando escalar. |
| Acoplamento | **Porta `Notifier` definida em `bookings`**; impl em `notifications` | `bookings` não importa `notifications` (inversão de dependência). |

## Arquitetura

### 1. Evento (`internal/notifications/notifier.go`)

```go
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
```

`Notifier` concreto (lado publish), implementa a porta de `bookings`:
```go
type publisher interface {
	Publish(ctx context.Context, queue string, body []byte) error
}

type Notifier struct{ pub publisher } // pub pode ser nil

func NewNotifier(pub publisher) *Notifier { return &Notifier{pub: pub} }

func (n *Notifier) BookingRequested(ctx context.Context, bookingID, recipientID int64) {
	n.emit(ctx, BookingRequested, bookingID, recipientID)
}
// BookingConfirmed, BookingCancelled idem.

func (n *Notifier) emit(ctx context.Context, t EventType, bookingID, recipientID int64) {
	if n.pub == nil { // broker desligado
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
`*rabbitmq.Publisher` satisfaz `publisher`. (`notifications` importa `rabbitmq`
para a constante da fila; sem ciclo.)

### 2. Porta em `bookings` + publicação (`internal/bookings/service.go`)

```go
// Notifier é a porta best-effort de notificação (impl em internal/notifications).
type Notifier interface {
	BookingRequested(ctx context.Context, bookingID, recipientID int64)
	BookingConfirmed(ctx context.Context, bookingID, recipientID int64)
	BookingCancelled(ctx context.Context, bookingID, recipientID int64)
}
```
`NewService(pool, q)` → `NewService(pool, q, notifier Notifier)`; o `Service`
guarda `notifier`. Publicação **após** o sucesso de cada transição:
- **Create:** `LockVenueForBooking` passa a retornar `host_id`; após `tx.Commit`,
  `s.notifier.BookingRequested(ctx, booking.ID, venue.HostID)`.
- **Confirm:** após `ConfirmBooking`, `s.notifier.BookingConfirmed(ctx, b.ID, row.GuestID)`.
- **Cancel:** após `CancelBooking`, recipient = `row.HostID` se o ator é o
  convidado, senão `row.GuestID`; `s.notifier.BookingCancelled(ctx, b.ID, recipient)`.

`Notifier` é sempre não-nil (o `server` injeta o concreto, que no-opa se broker nil).

### 3. SQL (`internal/db/queries/bookings.sql`)

- Estender `LockVenueForBooking` (additivo): `SELECT id, status, host_id FROM
  venues WHERE id = $1 FOR UPDATE;` → o row ganha `HostID`. O uso atual
  (`venue.Status`) segue igual.
- Novo `GetBookingNotificationData :one` (fatos p/ o e-mail; parametrizado por
  booking e destinatário):
  ```sql
  SELECT v.title AS venue_title, b.start_date, b.end_date, b.total_price,
         u.name AS recipient_name, u.email AS recipient_email
  FROM bookings b
  JOIN venues v ON v.id = b.venue_id
  JOIN users u ON u.id = @recipient_id
  WHERE b.id = @booking_id;
  ```
Requer `sqlc generate`.

### 4. Render (`internal/notifications/render.go`) — puro/testável

```go
type MailData struct {
	RecipientName string
	VenueTitle    string
	StartDate     string // "2006-01-02"
	EndDate       string
	TotalPrice    string
}

// renderMail devolve assunto + corpo (texto puro PT-BR) por tipo de evento.
func renderMail(t EventType, d MailData) (subject, body string)
```
Ex.: `BookingConfirmed` → assunto "Sua reserva foi confirmada ✅", corpo com
espaço, datas e total. Cada tipo tem seu assunto/corpo.

### 5. Worker (`internal/notifications/consumer.go`)

```go
type Consumer struct {
	deliveries <-chan amqp.Delivery
	q          *sqlc.Queries
	smtpAddr   string
}

func NewConsumer(broker *rabbitmq.Publisher, q *sqlc.Queries, smtpAddr string) (*Consumer, error)
func (c *Consumer) Start(ctx context.Context) // goroutine: range deliveries
```
Por mensagem: `json.Unmarshal(Event)` → `q.GetBookingNotificationData(...)` →
`renderMail` → `sendMail(smtpAddr, from, to, subject, body)` (`net/smtp`) → `ack`.
Qualquer erro → `log` + `ack` (best-effort, sem requeue). Remetente:
`const mailFrom = "Espaços <no-reply@espacos.local>"`.

### 6. `rabbitmq.go` — Consume

```go
// Consume abre um canal próprio (o de publish não é goroutine-safe) e entrega
// as mensagens da fila com ack manual.
func (p *Publisher) Consume(queue string) (<-chan amqp.Delivery, error) {
	ch, err := p.conn.Channel()
	if err != nil {
		return nil, err
	}
	return ch.Consume(queue, "", false, false, false, false, nil)
}
```

### 7. Config + wiring

- `config.go`: `SMTPAddr: get("SMTP_ADDR", "")`.
- `server.go`: `bookings.NewService(deps.DB, queries, notifications.NewNotifier(deps.Broker))`.
- `main.go`: depois do broker, se `broker != nil && cfg.SMTPAddr != ""`:
  ```go
  if cons, err := notifications.NewConsumer(broker, sqlc.New(db), cfg.SMTPAddr); err != nil {
      log.Printf("worker de notificações desabilitado: %v", err)
  } else {
      cons.Start(ctx)
  }
  ```

## Fluxo de dados (confirmar, exemplo)

```
host confirma → svc.Confirm → ConfirmBooking ok
  → notifier.BookingConfirmed(bookingID, guestID)  [best-effort]
  → Publish(Event{confirmed, bookingID, guestID}) na fila
  ...worker... Consume → GetBookingNotificationData → renderMail
  → net/smtp.SendMail(mailpit:1025) → Mailpit (visível em :8025)
```

## Tratamento de erros & degradação

- `RABBITMQ_URL`/broker indisponível **ou** `SMTP_ADDR` vazio → notificações
  desligadas; Create/Confirm/Cancel funcionam normalmente.
- Falha no publish → log, segue (a transição já teve sucesso).
- Worker: erro de unmarshal/query/render/send → log + ack (descarta a mensagem).

## Testes

- **Unit puro** (`internal/notifications/render_test.go`): `renderMail` para
  `booking_requested`/`confirmed`/`cancelled` — assunto não vazio e corpo contém
  o título do espaço e as datas; tipo desconhecido → assunto/corpo de fallback
  não vazios.
- **Smoke** (com a stack no ar): solicitar → confirmar → cancelar via API (host +
  convidado), depois `GET http://localhost:8025/api/v1/messages` e conferir **3
  e-mails** com os assuntos esperados e os destinatários certos (host na
  solicitação, convidado na confirmação, a outra parte no cancelamento).
- Gates: `cd backend && go test ./... && go build ./...`.

## Fora de escopo (anotado para o futuro)

- Retry / dead-letter / outbox transacional (entrega garantida).
- E-mail HTML / templates ricos.
- Reconexão automática do broker; worker em processo separado.
- Preferências de notificação (opt-out), notificação in-app/push.
- Provedor SMTP real (produção) com auth/TLS.
