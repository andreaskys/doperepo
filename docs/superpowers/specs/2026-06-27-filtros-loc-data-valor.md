# Design — Filtros: Localização · Data · Valor

**Data:** 2026-06-27
**Objetivo:** trocar a barra de filtros da home por 3 grupos — Localização
(cidade/UF), Data (entrada/saída com disponibilidade) e Valor (faixa mín–máx com
input + ElasticSlider portado).
**Escopo:** backend (busca) + frontend.

## Decisões (do brainstorming)
| Tema | Escolha |
| --- | --- |
| Conjunto | **Substituir** os filtros atuais pelos 3 (saem capacidade, comodidades, texto). |
| Data | Filtra **disponibilidade** — exclui espaços com reserva não-cancelada sobreposta. |
| Valor | **Faixa mín–máx** (dois valores). |
| Slider | **ElasticSlider portado** pra TS + CSS puro (sem `@chakra-ui/react`/`react-icons`); **2 instâncias** (mín/máx). Teto R$5.000, passo R$50. |

## Arquitetura

### 1. Backend — `SearchPublishedVenues` (`internal/db/queries/venues.sql`)
Adicionar os filtros (sentinela = sem filtro), em AND com os existentes:
```sql
  AND (@state::text = '' OR lower(v.state) = lower(@state::text))
  AND (@min_price::numeric = 0 OR v.price_per_day >= @min_price::numeric)
  AND (
    @start::date IS NULL OR @end::date IS NULL OR NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.venue_id = v.id AND b.status <> 'CANCELLED'
        AND daterange(b.start_date, b.end_date, '[)') && daterange(@start::date, @end::date, '[)')
    )
  )
```
`@start`/`@end` são `pgtype.Date` nuláveis (sem data → `Valid:false` → `NULL` → filtro pulado). Mantém `city`, `min_capacity`, `max_price`, `q`, `amenities`.

### 2. Backend — service (`internal/venues/service.go`)
- `SearchFilters` ganha: `State string`, `MinPrice string`, `Start, End *time.Time` (nil = sem data).
- `buildSearchParams`: normaliza `State` (trim), `MinPrice`/`MaxPrice` via `pgtype.Numeric` (vazio → "0"); `Start`/`End` → `pgtype.Date` (Valid quando não-nil **e** ambos presentes **e** start < end; senão ambos inválidos = sem filtro de data).
- `isEmpty()`: inclui `State==""`, `MinPrice==""`, `Start==nil && End==nil` (cache-aside só sem nenhum filtro).

### 3. Backend — handler (`internal/venues/handler.go`)
- `parseSearchFilters` lê `state`, `min_price` (numérico, ignora inválido), `start`/`end` (formato `YYYY-MM-DD` via `time.Parse`; inválido → nil).

### 4. Frontend — ElasticSlider portado (`app/components/elastic-slider.tsx` + `elastic-slider.css`)
- Porta o componente do React Bits **sem Tailwind/Chakra/react-icons**:
  - TS estrito; `leftIcon`/`rightIcon` default = SVG inline (`–`/`+`).
  - Props novas: `value?: number` (controlado) e `onChange?: (v: number) => void` (chamado quando o valor muda por drag).
  - Mantém a animação elástica (`useMotionValue`/`useTransform`/`decay`/overflow/scale).
  - `useEffect` reseeda o valor interno quando `value` muda (sync input→slider).
- CSS próprio (`.es-*` ou reusa `.slider-*` do componente), com `--brand` no range.

### 5. Frontend — `lib.ts`
- `VenueSearchParams` ganha `state?`, `minPrice?`, `startDate?`, `endDate?`.
- `searchVenues` adiciona à query: `state`, `min_price`, `start`, `end` (só quando preenchidos).

### 6. Frontend — `venue-filters.tsx` (reescrito) + `venue-grid.tsx`
- 3 grupos:
  - **Localização:** input Cidade + input Estado (UF, `maxLength=2`, upper).
  - **Data:** `<input type="date">` Entrada + `<input type="date">` Saída.
  - **Valor:** par mín/máx; cada um = input numérico + `<ElasticSlider value=… onChange=… startingValue={0} maxValue={5000} isStepped stepSize={50} />`. Mantém `min ≤ max` (ao soltar, ajusta).
- `submit`: monta a query só com campos válidos (datas só se ambas e start<end; valor só se >0; min≤max). `clear` zera tudo → `/`.
- `VenueGrid` lê `state`, `min_price`, `start`, `end` da URL e repassa em `searchVenues`.

### 7. Estilos (`app/globals.css`)
- Layout dos 3 grupos (labels + linha mín/máx), espaçamento dos sliders. CSS do slider fica no `elastic-slider.css` importado pelo componente.

## Regras & validação
- Todos os filtros em **AND**.
- **Data:** só filtra com as **duas** datas e `entrada < saída`; senão ignora (não quebra a lista).
- **Valor:** envia `min_price` se > 0 e `max_price` se > 0; garante `min ≤ max`.
- **Estado:** normaliza UF (2 letras maiúsculas).
- Entradas inválidas são ignoradas silenciosamente (busca nunca dá 500).

## Testes
- **Backend smoke:** `GET /public/venues?state=SP`, `?min_price=1000&max_price=1600`,
  `?start=2026-09-01&end=2026-09-03` (exclui o espaço reservado nesse período).
- **Frontend:** `npm run typecheck` + build; smoke visual (3 grupos, slider arrasta e
  sincroniza com input, busca aplica os filtros, limpar zera).

## Fora de escopo
Slider de 2 pontas único, ordenação, paginação, filtro de capacidade/comodidades
(removidos do front; SQL os mantém inertes). Sem cache para buscas filtradas (já era assim).
