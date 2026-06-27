# Design — Robustez das notificações (retry + DLQ)

**Data:** 2026-06-27
**Contexto:** o worker de notificações (spec `2026-06-26-notificacoes-design`)
hoje é best-effort puro: qualquer erro de processamento vira `log` + `ack`
(descarte). Esta iteração adiciona **retry de erros transitórios** e uma
**dead-letter queue** para mensagens que não dá pra processar.
**Abordagem:** B (retry no processo + DLQ alimentada por publish direto), escolhida
no brainstorming — backoff exponencial casa com retry no processo; topologia mínima.

## Objetivo

- Erro **transitório** (SMTP/Mailpit fora, blip de DB) → tentar de novo 3x com
  backoff exponencial antes de desistir.
- Erro **permanente** (mensagem malformada, dados sumiram) → direto pra DLQ.
- Mensagens esgotadas/permanentes → **`notifications.dlq`** (durável), estacionadas
  para inspeção/reprocesso manual.
- Sempre `ack` após processar (sucesso ou DLQ) — nada fica preso na fila.

## Contexto (código atual)

- `internal/platform/rabbitmq/rabbitmq.go`: `New` declara só `NotificationsQueue`
  ("notifications", durable). `Publish(ctx, queue, body)` usa o canal `p.ch`.
  `Consume(queue)` abre um **canal próprio** (autoAck=false).
- `internal/notifications/consumer.go`: `Start` faz `c.handle(ctx, d.Body)` +
  `d.Ack(false)` (sempre). `handle` é `void`: unmarshal → `GetBookingNotificationData`
  → `renderMail` → `sendMail`; em erro só loga e retorna.
- `Consumer{deliveries, q, smtpAddr}`; `NewConsumer(broker, q, smtpAddr)`.

## Decisões desta feature

| Decisão | Escolha | Por quê |
| --- | --- | --- |
| Topologia | **DLQ alimentada por publish direto (sem DLX)** | Abordagem B; topologia mínima (uma fila). |
| Retry | **3 tentativas, backoff exponencial (1s, 2s)** | Resiliência a falha transitória sem segurar a mensagem demais. |
| Permanente | **`Unmarshal` e `pgx.ErrNoRows` → direto pra DLQ** | Retry não ajuda; só desperdiça. |
| Concorrência | **`sync.Mutex` no `Publisher.Publish`** | Worker e handlers HTTP publicam no mesmo canal; canal AMQP não é goroutine-safe (corrida latente). |

## Arquitetura

### 1. RabbitMQ (`internal/platform/rabbitmq/rabbitmq.go`)

- Nova constante: `DeadLetterQueue = "notifications.dlq"`.
- Em `New`, declarar a DLQ (durável, sem args), além da fila principal:
  ```go
  if _, err := ch.QueueDeclare(DeadLetterQueue, true, false, false, false, nil); err != nil {
      _ = conn.Close()
      return nil, fmt.Errorf("declarar DLQ: %w", err)
  }
  ```
- `Publisher` ganha `mu sync.Mutex`; `Publish` serializa o uso do canal:
  ```go
  func (p *Publisher) Publish(ctx context.Context, queue string, body []byte) error {
      p.mu.Lock()
      defer p.mu.Unlock()
      return p.ch.PublishWithContext(ctx, "", queue, false, false, amqp.Publishing{
          ContentType: "application/json", Body: body, DeliveryMode: amqp.Persistent,
      })
  }
  ```
  (O canal de `Consume` é separado — consumir não é bloqueado pelo mutex.)

### 2. Classificação de erro (`consumer.go`)

```go
type permanentError struct{ err error }

func (e permanentError) Error() string { return e.err.Error() }
func (e permanentError) Unwrap() error { return e.err }

func permanent(err error) error { return permanentError{err} }
func isPermanent(err error) bool {
	var pe permanentError
	return errors.As(err, &pe)
}
```

### 3. `process` (substitui `handle`) — devolve erro classificado

```go
func (c *Consumer) process(ctx context.Context, body []byte) error {
	var ev Event
	if err := json.Unmarshal(body, &ev); err != nil {
		return permanent(fmt.Errorf("unmarshal: %w", err))
	}
	row, err := c.q.GetBookingNotificationData(ctx, sqlc.GetBookingNotificationDataParams{
		RecipientID: ev.RecipientID, BookingID: ev.BookingID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return permanent(fmt.Errorf("dados ausentes (booking=%d): %w", ev.BookingID, err))
		}
		return fmt.Errorf("dados (booking=%d): %w", ev.BookingID, err) // transitório
	}
	subject, text := renderMail(ev.Type, MailData{
		RecipientName: row.RecipientName, VenueTitle: row.VenueTitle,
		StartDate: dateStr(row.StartDate), EndDate: dateStr(row.EndDate),
		TotalPrice: priceStr(row.TotalPrice),
	})
	if err := sendMail(c.smtpAddr, row.RecipientEmail, subject, text); err != nil {
		return fmt.Errorf("envio (to=%s): %w", row.RecipientEmail, err) // transitório
	}
	return nil
}
```

### 4. Loop de retry (`consume`) + backoff

```go
const (
	maxAttempts = 3
	baseBackoff = 1 * time.Second
)

func backoff(attempt int) time.Duration { return baseBackoff << (attempt - 1) } // 1s,2s,4s

func (c *Consumer) consume(ctx context.Context, body []byte) {
	var err error
	attempt := 0
	for attempt = 1; attempt <= maxAttempts; attempt++ {
		err = c.process(ctx, body)
		if err == nil {
			return // sucesso
		}
		if isPermanent(err) {
			log.Printf("notif worker: erro permanente (tentativa %d): %v", attempt, err)
			break
		}
		log.Printf("notif worker: falha transitória (tentativa %d/%d): %v", attempt, maxAttempts, err)
		if attempt < maxAttempts {
			time.Sleep(backoff(attempt))
		}
	}
	c.deadLetter(ctx, body, err, attempt)
}
```
`Start` passa a chamar `c.consume(ctx, d.Body)` (em vez de `handle`); `Ack` igual.

### 5. DLQ (`deadLetter`)

```go
type deadLetter struct {
	Reason   string `json:"reason"`
	Attempts int    `json:"attempts"`
	Body     string `json:"body"` // corpo original como string (aceita qualquer bytes)
}

func (c *Consumer) deadLetter(ctx context.Context, body []byte, cause error, attempts int) {
	reason := "desconhecido"
	if cause != nil {
		reason = cause.Error()
	}
	dl, err := json.Marshal(deadLetter{Reason: reason, Attempts: attempts, Body: string(body)})
	if err != nil {
		log.Printf("notif worker: marshal DLQ: %v", err)
		return
	}
	if err := c.broker.Publish(ctx, rabbitmq.DeadLetterQueue, dl); err != nil {
		log.Printf("notif worker: publish DLQ: %v", err) // se falhar, a msg some (best-effort)
		return
	}
	log.Printf("notif worker: → DLQ (%s)", reason)
}
```

### 6. Wiring (`consumer.go`)

`Consumer` guarda o `broker`:
```go
type Consumer struct {
	deliveries <-chan amqp.Delivery
	broker     *rabbitmq.Publisher
	q          *sqlc.Queries
	smtpAddr   string
}

func NewConsumer(broker *rabbitmq.Publisher, q *sqlc.Queries, smtpAddr string) (*Consumer, error) {
	deliveries, err := broker.Consume(rabbitmq.NotificationsQueue)
	if err != nil {
		return nil, err
	}
	return &Consumer{deliveries: deliveries, broker: broker, q: q, smtpAddr: smtpAddr}, nil
}
```
`main`/`server` **inalterados** (assinatura de `NewConsumer` não muda). O `handle`
antigo é removido (vira `process` + `consume`).

## Erros & degradação

- Best-effort mantido: se o `Publish` na DLQ falhar, loga e a mensagem original
  (já acked) some — aceitável no MVP.
- Broker/SMTP fora em runtime → transitórios são retried; outage > ~3s → DLQ.
- DLQ é durável (sobrevive a restart do broker).

## Testes

- **Unit puro** (`internal/notifications/retry_test.go`): `backoff(1)=1s`,
  `backoff(2)=2s`, `backoff(3)=4s`; `isPermanent(permanent(e))`=true;
  `isPermanent(errors.New("x"))`=false; `permanentError` desembrulha (`errors.Is`).
- **Smoke** (stack no ar; via API de management do RabbitMQ em :15672, guest/guest):
  1. Publicar **lixo** (não-JSON) na fila `notifications` → `notifications.dlq` vai
     de 0 → 1 (unmarshal permanente).
  2. Publicar evento válido com `booking_id` inexistente → DLQ +1 (`ErrNoRows` permanente).
  3. Fluxo normal (reserva real) → e-mail no Mailpit e DLQ **não** cresce.
  Conferir profundidade via `rabbitmqctl list_queues name messages`.
- Gates: `cd backend && go test ./... && go build ./...`.

## Fora de escopo (anotado para o futuro)

- Retry **não-bloqueante** e durável via DLX + fila de retry com TTL (Abordagem A).
- Endpoint/comando de **re-drive** da DLQ (reprocessar mensagens estacionadas).
- Métricas/alertas de DLQ; idempotência (dedup de reenvio); reconexão do broker.
