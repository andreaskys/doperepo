package notifications

import (
	"context"
	"encoding/json"
	"log"

	"github.com/doperepo/backend/internal/db/sqlc"
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

// Notifier grava a notificação in-app (durável) e publica o e-mail (async).
// pub nil → sem e-mail; q nil → sem in-app. Ambos best-effort.
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

// record grava a notificação in-app e publica o e-mail (ambos best-effort).
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
