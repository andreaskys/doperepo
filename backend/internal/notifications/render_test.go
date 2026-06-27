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
