package notifications

import (
	"context"
	"encoding/json"
	"log"
	"mime"
	"net/smtp"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	amqp "github.com/rabbitmq/amqp091-go"

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
