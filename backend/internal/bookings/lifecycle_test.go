package bookings

import (
	"testing"

	"github.com/doperepo/backend/internal/db/sqlc"
)

func TestCanConfirm(t *testing.T) {
	const host, guest = int64(1), int64(2)
	pend := bookingAuth{hostID: host, guestID: guest, status: sqlc.BookingStatusPENDING}
	if err := canConfirm(pend, host); err != nil {
		t.Fatalf("host confirma PENDING deveria ok, veio %v", err)
	}
	if err := canConfirm(pend, guest); err != ErrNotAuthorized {
		t.Fatalf("convidado não confirma: esperava ErrNotAuthorized, veio %v", err)
	}
	conf := bookingAuth{hostID: host, guestID: guest, status: sqlc.BookingStatusCONFIRMED}
	if err := canConfirm(conf, host); err != ErrInvalidTransition {
		t.Fatalf("confirmar não-PENDING: esperava ErrInvalidTransition, veio %v", err)
	}
}

func TestCanCancel(t *testing.T) {
	const host, guest, other = int64(1), int64(2), int64(3)
	for _, st := range []sqlc.BookingStatus{sqlc.BookingStatusPENDING, sqlc.BookingStatusCONFIRMED} {
		b := bookingAuth{hostID: host, guestID: guest, status: st}
		if err := canCancel(b, guest); err != nil {
			t.Fatalf("convidado cancela %s deveria ok, veio %v", st, err)
		}
		if err := canCancel(b, host); err != nil {
			t.Fatalf("host cancela %s deveria ok, veio %v", st, err)
		}
		if err := canCancel(b, other); err != ErrNotAuthorized {
			t.Fatalf("terceiro cancela %s: esperava ErrNotAuthorized, veio %v", st, err)
		}
	}
	cancelled := bookingAuth{hostID: host, guestID: guest, status: sqlc.BookingStatusCANCELLED}
	if err := canCancel(cancelled, guest); err != ErrInvalidTransition {
		t.Fatalf("cancelar já-CANCELLED: esperava ErrInvalidTransition, veio %v", err)
	}
}
