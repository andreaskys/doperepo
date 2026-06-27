#!/usr/bin/env bash
# Popula o ambiente local com dados de QA via API (contas reais que logam,
# espaços publicados variados e reservas em todos os estados).
# Uso: ./scripts/seed-qa.sh   (com a stack no ar: docker compose up -d)
#
# Idempotente o suficiente: se um e-mail já existe, faz login em vez de registrar.
set -euo pipefail

BASE="${BASE:-http://localhost:8080/api/v1}"
ORIGIN="${ORIGIN:-http://localhost:3100}"
PASS="dope12345"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

jqget() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

# auth COOKIEFILE NAME EMAIL — registra (ou loga se já existe) e guarda o cookie.
auth() {
  local cookie="$1" name="$2" email="$3" code
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: $ORIGIN" -c "$cookie" \
    -X POST "$BASE/auth/register" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$PASS\"}")
  if [ "$code" != "201" ]; then
    curl -s -o /dev/null -H "Origin: $ORIGIN" -c "$cookie" \
      -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"$PASS\"}"
  fi
}

# venue COOKIEFILE JSON → publica e ecoa o id
venue() {
  local cookie="$1" body="$2" id
  id=$(curl -s -H "Origin: $ORIGIN" -b "$cookie" -X POST "$BASE/venues" \
    -H 'Content-Type: application/json' -d "$body" | jqget '["id"]')
  curl -s -o /dev/null -H "Origin: $ORIGIN" -b "$cookie" -X POST "$BASE/venues/$id/publish"
  echo "$id"
}

# book COOKIEFILE VENUE_ID START END → ecoa o booking id
book() {
  curl -s -H "Origin: $ORIGIN" -b "$1" -X POST "$BASE/venues/$2/bookings" \
    -H 'Content-Type: application/json' -d "{\"start_date\":\"$3\",\"end_date\":\"$4\"}" | jqget '["id"]'
}

echo "→ contas"
auth "$TMP/host.txt"  "Marina Anfitriã" "host@dope.local"
auth "$TMP/guest.txt" "Bruno Convidado" "guest@dope.local"

echo "→ espaços publicados"
V1=$(venue "$TMP/host.txt" '{"title":"Salão Vista Verde","description":"Amplo salão para casamentos e festas, com jardim.","capacity":200,"price_per_day":"1500","address":"Av. das Flores, 100","city":"São Paulo","state":"SP","amenities":["wifi","piscina","estacionamento"],"features":["jardim","palco"]}')
V2=$(venue "$TMP/host.txt" '{"title":"Galpão Industrial","description":"Espaço urbano para shows e eventos corporativos.","capacity":500,"price_per_day":"900","address":"Rua do Porto, 50","city":"São Paulo","state":"SP","amenities":["som","palco","banheiros"],"features":["pé-direito alto"]}')
V3=$(venue "$TMP/host.txt" '{"title":"Chácara do Lago","description":"Eventos ao ar livre à beira do lago.","capacity":80,"price_per_day":"600","address":"Estrada do Lago, km 4","city":"Campinas","state":"SP","amenities":["piscina","churrasqueira","estacionamento"],"features":["lago","quiosque"]}')
V4=$(venue "$TMP/host.txt" '{"title":"Rooftop Centro","description":"Cobertura com vista para confraternizações.","capacity":40,"price_per_day":"2000","address":"Rua Alta, 900","city":"Rio de Janeiro","state":"RJ","amenities":["wifi","ar_condicionado"],"features":["vista panorâmica"]}')
echo "  venues: $V1 $V2 $V3 $V4"

echo "→ reservas (estados variados)"
B1=$(book "$TMP/guest.txt" "$V1" 2026-09-01 2026-09-03)   # → confirmar
B2=$(book "$TMP/guest.txt" "$V2" 2026-09-10 2026-09-12)   # fica PENDENTE
B3=$(book "$TMP/guest.txt" "$V3" 2026-09-20 2026-09-22)   # → cancelar
curl -s -o /dev/null -H "Origin: $ORIGIN" -b "$TMP/host.txt"  -X POST "$BASE/bookings/$B1/confirm"  # CONFIRMADA
curl -s -o /dev/null -H "Origin: $ORIGIN" -b "$TMP/guest.txt" -X POST "$BASE/bookings/$B3/cancel"   # CANCELADA
echo "  bookings: $B1 (confirmada) $B2 (pendente) $B3 (cancelada)"

cat <<EOF

✅ Dados de QA criados. Stack: http://localhost:$(echo "$ORIGIN" | sed 's#.*:##')

Contas (senha: $PASS)
  HOST      host@dope.local   → 4 espaços; veja "Reservas recebidas"
  CONVIDADO guest@dope.local  → 3 reservas (confirmada/pendente/cancelada)

QA sugerido:
  • Home: busque por cidade "São Paulo" (2), capacidade mín. 100, preço máx. 1000, "salão", comodidade Piscina
  • Logado como CONVIDADO: /reservas → cancele/veja estados
  • Logado como HOST: /reservas/recebidas → Confirmar/Recusar/Cancelar
  • E-mails das transições: Mailpit em http://localhost:8025
EOF
