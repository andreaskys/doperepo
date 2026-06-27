package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"mime"
	"net/smtp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/doperepo/backend/internal/db/sqlc"
	"github.com/doperepo/backend/internal/platform/rabbitmq"
)

const (
	mailFromAddr   = "no-reply@espacos.local"
	mailFromHeader = "Espaços <no-reply@espacos.local>"
)

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

// Consumer lê eventos da fila e envia e-mails (best-effort) via SMTP.
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

// Start dispara a goroutine que processa a fila até o canal fechar.
func (c *Consumer) Start(ctx context.Context) {
	go func() {
		log.Printf("worker de notificações ouvindo a fila %q", rabbitmq.NotificationsQueue)
		for d := range c.deliveries {
			c.consume(ctx, d.Body)
			_ = d.Ack(false) // sempre ack após processar (sucesso ou DLQ)
		}
	}()
}

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
