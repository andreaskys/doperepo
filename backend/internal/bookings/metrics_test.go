package bookings

import "testing"

func TestAvgTicket(t *testing.T) {
	if got := avgTicket(0, 0); got != 0 {
		t.Fatalf("count 0 deve dar 0, veio %v", got)
	}
	if got := avgTicket(1000, 4); got != 250 {
		t.Fatalf("1000/4 deve dar 250, veio %v", got)
	}
}
