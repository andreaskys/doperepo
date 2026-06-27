package auth

import "testing"

func TestValidateNewPassword(t *testing.T) {
	if err := validateNewPassword("12345678"); err != nil {
		t.Fatalf("8 chars deveria passar, veio: %v", err)
	}
	if err := validateNewPassword("1234567"); err == nil {
		t.Fatal("7 chars deveria falhar")
	}
	if err := validateNewPassword(""); err == nil {
		t.Fatal("vazio deveria falhar")
	}
}
