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
