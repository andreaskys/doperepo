package venues

import (
	"net/url"
	"reflect"
	"testing"
)

func TestSanitizeAmenities(t *testing.T) {
	got := sanitizeAmenities([]string{"wifi", "inexistente", "piscina"})
	if want := []string{"wifi", "piscina"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("esperava %v, veio %v", want, got)
	}
	if got := sanitizeAmenities(nil); len(got) != 0 {
		t.Fatalf("nil deveria virar slice vazio, veio %v", got)
	}
}

func TestBuildSearchParams(t *testing.T) {
	p, err := buildSearchParams(SearchFilters{
		City: "  Rio  ", MinCapacity: 10, MaxPrice: "", Query: "  festa ",
		Amenities: []string{"wifi", "xxx"},
	})
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if p.City != "Rio" || p.Q != "festa" || p.MinCapacity != 10 {
		t.Fatalf("trim/campos incorretos: %+v", p)
	}
	if !reflect.DeepEqual(p.Amenities, []string{"wifi"}) {
		t.Fatalf("amenities não sanitizadas: %v", p.Amenities)
	}
	if !p.MaxPrice.Valid {
		t.Fatal("MaxPrice vazio deveria virar numeric válido (sentinela 0)")
	}
	if _, err := buildSearchParams(SearchFilters{MaxPrice: "abc"}); err == nil {
		t.Fatal("preço inválido deveria retornar erro")
	}
}

func TestParseSearchFilters(t *testing.T) {
	if f := parseSearchFilters(url.Values{}); f.City != "" || f.MinCapacity != 0 ||
		f.MaxPrice != "" || f.Query != "" || len(f.Amenities) != 0 {
		t.Fatalf("vazio deveria dar sentinelas, veio %+v", f)
	}

	q := url.Values{}
	q.Set("city", "São Paulo")
	q.Set("min_capacity", "50")
	q.Set("max_price", "1200.50")
	q.Set("q", "salão")
	q.Set("amenities", "wifi, piscina ,")
	f := parseSearchFilters(q)
	if f.City != "São Paulo" || f.MinCapacity != 50 || f.MaxPrice != "1200.50" || f.Query != "salão" {
		t.Fatalf("parse incorreto: %+v", f)
	}
	if !reflect.DeepEqual(f.Amenities, []string{"wifi", "piscina"}) {
		t.Fatalf("amenities CSV incorreto: %v", f.Amenities)
	}

	bad := url.Values{}
	bad.Set("min_capacity", "abc")
	bad.Set("max_price", "xyz")
	f = parseSearchFilters(bad)
	if f.MinCapacity != 0 {
		t.Fatalf("min_capacity inválido deveria ser 0, veio %d", f.MinCapacity)
	}
	if f.MaxPrice != "" {
		t.Fatalf("max_price inválido deveria ser vazio, veio %q", f.MaxPrice)
	}

	// max_price não-finito, negativo ou zero deve virar sentinela ("") — nunca
	// um filtro ativo (evita 500 no Numeric.Scan e lista vazia surpreendente).
	for _, bogus := range []string{"-5", "0", "Inf", "+Inf", "NaN", "1e500"} {
		v := url.Values{}
		v.Set("max_price", bogus)
		if got := parseSearchFilters(v).MaxPrice; got != "" {
			t.Fatalf("max_price=%q deveria virar sentinela, veio %q", bogus, got)
		}
	}
}
