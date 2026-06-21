package bookings

import (
	"testing"
	"time"
)

func TestValidateStay(t *testing.T) {
	now := time.Date(2026, 6, 21, 0, 0, 0, 0, time.UTC)
	d := func(s string) time.Time { v, _ := time.Parse("2006-01-02", s); return v }

	if n, err := validateStay(d("2026-07-01"), d("2026-07-04"), now); err != nil || n != 3 {
		t.Fatalf("esperava 3 diárias, veio %d (err=%v)", n, err)
	}
	if _, err := validateStay(d("2026-07-04"), d("2026-07-01"), now); err == nil {
		t.Fatal("fim antes do início deveria falhar")
	}
	if _, err := validateStay(d("2026-07-01"), d("2026-07-01"), now); err == nil {
		t.Fatal("0 diárias deveria falhar")
	}
	if _, err := validateStay(d("2020-01-01"), d("2020-01-03"), now); err == nil {
		t.Fatal("data no passado deveria falhar")
	}
}
