#!/usr/bin/env bash
# Mocka vários espaços publicados (cada um com 1 capa em gradiente) para testar
# o carrossel/parallax da landing e o grid da home.
# Uso: ./scripts/seed-mock-venues.sh   (com a stack no ar)
set -euo pipefail

BASE="${BASE:-http://localhost:8080/api/v1}"
ORIGIN="${ORIGIN:-http://localhost:3100}"
PASS="dope12345"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

jqget() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
FONT="$(ls /usr/share/fonts/**/*Bold*.ttf 2>/dev/null | head -1 || true)"

cover() {
  command -v magick >/dev/null || return 0
  local cookie="$1" id="$2" title="$3" c1="${4%%:*}" c2="${4##*:}" img="$TMP/c_$id.jpg"
  if [ -n "$FONT" ]; then
    magick -size 800x600 gradient:"$c1"-"$c2" -gravity center -font "$FONT" \
      -pointsize 44 -fill white -annotate 0 "$title" "$img" 2>/dev/null
  else
    magick -size 800x600 gradient:"$c1"-"$c2" "$img" 2>/dev/null
  fi
  [ -s "$img" ] && curl -s -o /dev/null -H "Origin: $ORIGIN" -b "$cookie" \
    -F "photo=@$img;type=image/jpeg" "$BASE/venues/$id/photos"
}

auth() {
  local cookie="$1" name="$2" email="$3" code
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: $ORIGIN" -c "$cookie" \
    -X POST "$BASE/auth/register" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$PASS\"}")
  [ "$code" = "201" ] || curl -s -o /dev/null -H "Origin: $ORIGIN" -c "$cookie" \
    -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\"}"
}

venue() {
  local cookie="$1" body="$2" id
  id=$(curl -s -H "Origin: $ORIGIN" -b "$cookie" -X POST "$BASE/venues" \
    -H 'Content-Type: application/json' -d "$body" | jqget '["id"]')
  curl -s -o /dev/null -H "Origin: $ORIGIN" -b "$cookie" -X POST "$BASE/venues/$id/publish"
  echo "$id"
}

C="$TMP/host.txt"
echo "→ login host"
auth "$C" "Marina Anfitriã" "host@dope.local"

# title | city | state | capacity | price | amenities | grad1:grad2
ROWS='
Espaço Aurora|Belo Horizonte|MG|150|1200|wifi,palco,estacionamento|#f43f5e:#7c3aed
Villa Toscana|Curitiba|PR|120|1800|piscina,churrasqueira,estacionamento|#f59e0b:#ef4444
Terraço Marina|Florianópolis|SC|60|1600|wifi,ar_condicionado|#06b6d4:#3b82f6
Casa de Campo Bela Vista|Campinas|SP|90|700|piscina,churrasqueira|#22c55e:#15803d
Loft Industrial 22|São Paulo|SP|70|1100|som,wifi|#64748b:#0f172a
Jardim das Acácias|Porto Alegre|RS|180|950|estacionamento,banheiros|#84cc16:#166534
Pavilhão Norte|Recife|PE|400|800|som,palco,banheiros|#0ea5e9:#1e3a8a
Espaço Lumière|Brasília|DF|110|1400|wifi,ar_condicionado,palco|#a855f7:#6d28d9
Quinta do Sol|Salvador|BA|130|1000|piscina,churrasqueira,estacionamento|#fb923c:#c2410c
Mirante das Pedras|Ouro Preto|MG|50|1300|wifi,acessibilidade|#14b8a6:#0f766e
Galeria Vértice|São Paulo|SP|85|1700|som,wifi,ar_condicionado|#ec4899:#831843
Hangar Eventos|Guarulhos|SP|600|1500|som,palco,estacionamento|#eab308:#713f12
'

echo "→ criando espaços + capas"
n=0
while IFS='|' read -r title city state cap price ams grad; do
  [ -z "${title:-}" ] && continue
  amjson=$(python3 -c "import json,sys;print(json.dumps(sys.argv[1].split(',')))" "$ams")
  body=$(python3 - "$title" "$city" "$state" "$cap" "$price" "$amjson" <<'PY'
import json,sys
t,city,state,cap,price,ams=sys.argv[1:7]
print(json.dumps({
  "title":t,"description":f"{t} — espaço para eventos em {city}/{state}.",
  "capacity":int(cap),"price_per_day":price,
  "address":"Rua Exemplo, 100","city":city,"state":state,
  "amenities":json.loads(ams),"features":["estrutura completa"]
}))
PY
)
  id=$(venue "$C" "$body")
  cover "$C" "$id" "$title" "$grad"
  n=$((n+1))
  echo "  [$n] $title ($city/$state) → venue $id"
done <<< "$ROWS"

echo "✅ $n espaços mockados (publicados, com capa). Total público:"
curl -s "$BASE/public/venues" | python3 -c "import sys,json;print('  ', len(json.load(sys.stdin)), 'espaços publicados')"
curl -s "$BASE/public/photos" | python3 -c "import sys,json;print('  ', len(json.load(sys.stdin)), 'fotos na vitrine')"
