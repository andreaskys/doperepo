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
