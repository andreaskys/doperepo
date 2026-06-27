# Retry + DLQ das notificações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o worker de notificações resiliente — retry de erros transitórios (3x, backoff exponencial) e uma dead-letter queue para mensagens não processáveis.

**Architecture:** O worker classifica o erro (permanente vs transitório), tenta de novo os transitórios no processo com backoff, e publica na `notifications.dlq` o que esgota ou é permanente. Um mutex no `Publisher.Publish` torna o canal de publish goroutine-safe (worker + handlers HTTP compartilham).

**Tech Stack:** Go, RabbitMQ (amqp091), `net/smtp`, Mailpit.

## Global Constraints

- **Abordagem B:** DLQ alimentada por `Publish` direto (sem DLX). Fila `notifications.dlq` durável.
- **Retry:** `maxAttempts = 3`; `backoff(n) = 1s << (n-1)` (1s, 2s, 4s); só espera entre tentativas.
- **Permanente** (sem retry → DLQ): `json.Unmarshal` falhou; `GetBookingNotificationData` retornou `pgx.ErrNoRows`. **Transitório:** demais erros de DB; `sendMail`.
- **Sempre `ack`** após processar (sucesso ou DLQ).
- **Goroutine-safety:** `sync.Mutex` no `Publisher.Publish` (canal de `Consume` é separado).
- **Best-effort mantido:** se o `Publish` na DLQ falhar, loga e segue.
- **Gates:** `cd backend && go test ./... && go build ./...`.

---

## File Structure

- Modify: `backend/internal/platform/rabbitmq/rabbitmq.go` — const `DeadLetterQueue`, declarar a DLQ, `mu sync.Mutex` no `Publish`.
- Modify: `backend/internal/notifications/consumer.go` — `permanentError`/`isPermanent`/`permanent`, `backoff`, `process` (ex-`handle`), `consume`, `deadLetter`, `Consumer`+`broker`, `Start` usa `consume`.
- Create: `backend/internal/notifications/retry_test.go` — unit de `backoff` e `isPermanent`.

---

## Task 1: DLQ durável + Publish goroutine-safe

**Files:**
- Modify: `backend/internal/platform/rabbitmq/rabbitmq.go`

**Interfaces:**
- Produces: `rabbitmq.DeadLetterQueue = "notifications.dlq"`; `Publisher.Publish` serializado por mutex; DLQ declarada em `New`.

- [ ] **Step 1: Import `sync` e o campo no struct**

No bloco de imports de `rabbitmq.go`:
```go
import (
	"context"
	"fmt"
	"sync"

	amqp "github.com/rabbitmq/amqp091-go"
)
```
Troque o struct `Publisher`:
```go
type Publisher struct {
	conn *amqp.Connection
	ch   *amqp.Channel
	mu   sync.Mutex
}
```

- [ ] **Step 2: Constante da DLQ + declarar em `New`**

Logo após a const `NotificationsQueue`:
```go
// DeadLetterQueue guarda as notificações que não puderam ser processadas
// (esgotaram retry ou erro permanente), para inspeção/reprocesso manual.
const DeadLetterQueue = "notifications.dlq"
```
Em `New`, após o `QueueDeclare(NotificationsQueue, ...)`, adicione:
```go
	if _, err := ch.QueueDeclare(DeadLetterQueue, true, false, false, false, nil); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("declarar DLQ: %w", err)
	}
```

- [ ] **Step 3: Mutex no `Publish`**

Troque o método `Publish`:
```go
func (p *Publisher) Publish(ctx context.Context, queue string, body []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.ch.PublishWithContext(ctx, "", queue, false, false, amqp.Publishing{
		ContentType:  "application/json",
		Body:         body,
		DeliveryMode: amqp.Persistent,
	})
}
```

- [ ] **Step 4: Build + vet**

Run: `cd backend && go build ./... && go vet ./internal/platform/rabbitmq/...`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/platform/rabbitmq/rabbitmq.go
git commit -m "feat(rabbitmq): DLQ durável + Publish goroutine-safe (mutex)"
```

---

## Task 2: Classificação de erro + backoff (TDD)

**Files:**
- Modify: `backend/internal/notifications/consumer.go`
- Create: `backend/internal/notifications/retry_test.go`

**Interfaces:**
- Produces: `permanent(error) error`, `isPermanent(error) bool`, `backoff(int) time.Duration`; constantes `maxAttempts = 3`, `baseBackoff = time.Second`.

- [ ] **Step 1: Escrever o teste que falha (`retry_test.go`)**

```go
package notifications

import (
	"errors"
	"testing"
	"time"
)

func TestBackoff(t *testing.T) {
	cases := map[int]time.Duration{1: time.Second, 2: 2 * time.Second, 3: 4 * time.Second}
	for attempt, want := range cases {
		if got := backoff(attempt); got != want {
			t.Fatalf("backoff(%d) = %v, queria %v", attempt, got, want)
		}
	}
}

func TestIsPermanent(t *testing.T) {
	base := errors.New("falha")
	if !isPermanent(permanent(base)) {
		t.Fatal("permanent(err) deveria ser permanente")
	}
	if isPermanent(base) {
		t.Fatal("erro comum não deveria ser permanente")
	}
	if !errors.Is(permanent(base), base) {
		t.Fatal("permanent deveria desembrulhar o erro original")
	}
}
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && go test ./internal/notifications/... -run 'TestBackoff|TestIsPermanent' 2>&1 | head`
Expected: FALHA de compilação ("undefined: backoff / permanent / isPermanent").

- [ ] **Step 3: Implementar em `consumer.go`**

Adicione os imports `errors` e `time` ao bloco de imports (os usados aqui; `fmt`/`pgx` entram na Task 3). O bloco fica:
```go
import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net/smtp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/doperepo/backend/internal/db/sqlc"
	"github.com/doperepo/backend/internal/platform/rabbitmq"
)
```
Adicione (perto do topo, após as consts `mailFrom*`):
```go
const (
	maxAttempts = 3
	baseBackoff = time.Second
)

// permanentError marca um erro que não adianta tentar de novo (vai direto à DLQ).
type permanentError struct{ err error }

func (e permanentError) Error() string { return e.err.Error() }
func (e permanentError) Unwrap() error { return e.err }

func permanent(err error) error { return permanentError{err} }

func isPermanent(err error) bool {
	var pe permanentError
	return errors.As(err, &pe)
}

func backoff(attempt int) time.Duration { return baseBackoff << (attempt - 1) }
```

- [ ] **Step 4: Rodar (verde) + build**

Run: `cd backend && go test ./internal/notifications/... -run 'TestBackoff|TestIsPermanent' -v 2>&1 | grep -E "PASS|FAIL|ok"`
Expected: PASS em `TestBackoff` e `TestIsPermanent`.
Run: `cd backend && go build ./...`
Expected: sem erros (`errors`/`time` são usados por `isPermanent`/`backoff`; o `handle` antigo segue intacto).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/notifications/consumer.go backend/internal/notifications/retry_test.go
git commit -m "feat(notifications): classificação permanente/transitório + backoff"
```

---

## Task 3: Loop de retry, DLQ e wiring do worker

**Files:**
- Modify: `backend/internal/notifications/consumer.go`

**Interfaces:**
- Consumes: `permanent`/`isPermanent`/`backoff` (Task 2); `rabbitmq.DeadLetterQueue`, `(*rabbitmq.Publisher).Publish` (Task 1).
- Produces: `Consumer` com `broker`; `process`/`consume`/`deadLetter`; `Start` usa `consume`.

- [ ] **Step 1: Adicionar imports `fmt` e `pgx`**

No bloco de imports de `consumer.go`, adicione `"fmt"` (junto aos da stdlib) e `"github.com/jackc/pgx/v5"` (junto ao `pgtype`). Ficam usados pelo `process` neste task.

- [ ] **Step 2: `Consumer` guarda o `broker`**

Troque o struct e o `NewConsumer`:
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

- [ ] **Step 3: `Start` chama `consume`**

Troque o corpo do `for` no `Start`:
```go
func (c *Consumer) Start(ctx context.Context) {
	go func() {
		log.Printf("worker de notificações ouvindo a fila %q", rabbitmq.NotificationsQueue)
		for d := range c.deliveries {
			c.consume(ctx, d.Body)
			_ = d.Ack(false) // sempre ack após processar (sucesso ou DLQ)
		}
	}()
}
```

- [ ] **Step 4: Trocar `handle` por `process` (com erro classificado)**

Substitua o método `handle` inteiro por:
```go
// process executa uma tentativa; devolve erro classificado (permanent = não retentar).
func (c *Consumer) process(ctx context.Context, body []byte) error {
	var ev Event
	if err := json.Unmarshal(body, &ev); err != nil {
		return permanent(fmt.Errorf("unmarshal: %w", err))
	}
	row, err := c.q.GetBookingNotificationData(ctx, sqlc.GetBookingNotificationDataParams{
		RecipientID: ev.RecipientID,
		BookingID:   ev.BookingID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return permanent(fmt.Errorf("dados ausentes (booking=%d): %w", ev.BookingID, err))
		}
		return fmt.Errorf("dados (booking=%d): %w", ev.BookingID, err) // transitório
	}
	subject, text := renderMail(ev.Type, MailData{
		RecipientName: row.RecipientName,
		VenueTitle:    row.VenueTitle,
		StartDate:     dateStr(row.StartDate),
		EndDate:       dateStr(row.EndDate),
		TotalPrice:    priceStr(row.TotalPrice),
	})
	if err := sendMail(c.smtpAddr, row.RecipientEmail, subject, text); err != nil {
		return fmt.Errorf("envio (to=%s): %w", row.RecipientEmail, err) // transitório
	}
	return nil
}
```

- [ ] **Step 5: Adicionar `consume` (retry) e `deadLetter`**

```go
func (c *Consumer) consume(ctx context.Context, body []byte) {
	var err error
	attempt := 1
	for ; attempt <= maxAttempts; attempt++ {
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

type deadLetter struct {
	Reason   string `json:"reason"`
	Attempts int    `json:"attempts"`
	Body     string `json:"body"`
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
		log.Printf("notif worker: publish DLQ: %v", err) // best-effort
		return
	}
	log.Printf("notif worker: → DLQ (%s)", reason)
}
```

- [ ] **Step 6: Build + vet + suíte**

Run: `cd backend && go build ./... && go vet ./internal/notifications/... && go test ./...`
Expected: sem erros; testes verdes (incluindo `TestRenderMail`, `TestBackoff`, `TestIsPermanent`).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/notifications/consumer.go
git commit -m "feat(notifications): retry com backoff + dead-letter queue"
```

---

## Task 4: Verificação integrada (smoke da DLQ)

**Files:** nenhum (validação ponta a ponta).

- [ ] **Step 1: Gates + rebuild backend**

Run: `cd backend && go test ./... && go build ./...`
Run: `docker compose up -d --build backend`
Expected: verde; backend saudável; no log do backend aparece a DLQ declarada (sem erro) e "worker de notificações ouvindo...".

- [ ] **Step 2: DLQ existe e está vazia**

```bash
docker compose exec -T rabbitmq rabbitmqctl purge_queue notifications.dlq 2>/dev/null || true
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages | grep -E "notifications(\.dlq)?"
```
Expected: `notifications.dlq` aparece com `0`.

- [ ] **Step 3: Mensagem lixo (não-JSON) → DLQ (permanente)**

```bash
curl -s -u guest:guest -H 'content-type: application/json' \
  -X POST http://localhost:15672/api/exchanges/%2f/amq.default/publish \
  -d '{"properties":{},"routing_key":"notifications","payload":"isso-nao-e-json","payload_encoding":"string"}'
echo
sleep 2
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages | grep "notifications.dlq"
```
Expected: publish responde `{"routed":true}`; `notifications.dlq` passa a ter `1`.

- [ ] **Step 4: Evento válido com booking inexistente → DLQ (ErrNoRows permanente)**

```bash
curl -s -u guest:guest -H 'content-type: application/json' \
  -X POST http://localhost:15672/api/exchanges/%2f/amq.default/publish \
  -d '{"properties":{},"routing_key":"notifications","payload":"{\"type\":\"booking_confirmed\",\"booking_id\":999999,\"recipient_id\":999999}","payload_encoding":"string"}'
echo
sleep 2
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages | grep "notifications.dlq"
```
Expected: `notifications.dlq` = `2`.

- [ ] **Step 5: Inspecionar uma mensagem da DLQ (motivo legível)**

```bash
curl -s -u guest:guest -H 'content-type: application/json' \
  -X POST http://localhost:15672/api/queues/%2f/notifications.dlq/get \
  -d '{"count":1,"ackmode":"ack_requeue_true","encoding":"auto"}' | python3 -m json.tool | grep -i reason
```
Expected: um campo `reason` com a mensagem de erro (ex.: "unmarshal..." ou "dados ausentes...").

- [ ] **Step 6: Fluxo normal não vai pra DLQ**

```bash
docker compose exec -T rabbitmq rabbitmqctl purge_queue notifications.dlq >/dev/null
B=http://localhost:8080/api/v1; O='-H Origin:http://localhost:3100'
curl -s $O -c /tmp/h.txt -X POST $B/auth/register -H 'Content-Type: application/json' -d '{"name":"Host","email":"hd@x.com","password":"teste1234"}' -o /dev/null
VID=$(curl -s $O -b /tmp/h.txt -X POST $B/venues -H 'Content-Type: application/json' -d '{"title":"Espaço DLQ","capacity":20,"price_per_day":"300","address":"R 1","city":"São Paulo","state":"SP"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s $O -b /tmp/h.txt -X POST $B/venues/$VID/publish -o /dev/null
curl -s $O -c /tmp/g.txt -X POST $B/auth/register -H 'Content-Type: application/json' -d '{"name":"Guest","email":"gd@x.com","password":"teste1234"}' -o /dev/null
curl -s $O -b /tmp/g.txt -X POST $B/venues/$VID/bookings -H 'Content-Type: application/json' -d '{"start_date":"2026-10-01","end_date":"2026-10-03"}' -o /dev/null
sleep 2
echo "DLQ após fluxo normal: $(docker compose exec -T rabbitmq rabbitmqctl list_queues name messages | grep 'notifications.dlq')"  # esperado 0
```
Expected: a reserva gera e-mail no Mailpit e `notifications.dlq` continua `0`.

- [ ] **Step 7: Limpeza**

```bash
docker compose exec -T postgres psql -U app -d venues -c "DELETE FROM users WHERE email IN ('hd@x.com','gd@x.com');"
docker compose exec -T rabbitmq rabbitmqctl purge_queue notifications.dlq >/dev/null
rm -f /tmp/h.txt /tmp/g.txt
```

---

## Notas de execução

- **Subagentes sem Bash nesta sessão** → execução inline; TDD cobre `backoff`/`isPermanent`, o retry/DLQ valida no smoke.
- **Rebuild do backend** necessário (Go compila na imagem; também declara a DLQ nova).
- **Tasks 2 e 3** podem virar um único commit se o build isolado da Task 2 reclamar de imports — preferir rodar o build ao fim da Task 3.
- Retry não-bloqueante (DLX), re-drive da DLQ e métricas ficam fora (anotados na spec).
```
