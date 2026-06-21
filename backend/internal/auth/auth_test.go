package auth

import "testing"

func TestRandomTokenHexAndUnique(t *testing.T) {
	a, err := randomToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 64 { // 32 bytes -> 64 hex chars
		t.Fatalf("esperava 64 chars, veio %d", len(a))
	}
	b, _ := randomToken()
	if a == b {
		t.Fatal("tokens de sessão não podem repetir")
	}
}
