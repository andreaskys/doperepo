# Design — Filtros unificados (loc · range de datas · slider duplo)

**Data:** 2026-06-27
**Objetivo:** unificar os filtros — **um** input de localização (cidade/estado/bairro),
**um** date-range picker (entrada+saída) e **um** slider de **duas alças** (mín/máx).
**Escopo:** backend (1 param) + frontend (2 componentes novos + barra). Refina
`2026-06-27-filtros-loc-data-valor.md`.

## Decisões (do brainstorming)
| Tema | Escolha |
| --- | --- |
| Localização | **Input único** "Cidade, estado ou bairro" → param `loc` casa `city`/`state`/`neighborhood` (ILIKE). |
| Data | **Calendário popover** (clica entrada, depois saída; intervalo destacado). Componente custom. |
| Valor | **Range slider de 2 alças** (substitui os 2 ElasticSliders). 0–5000, passo 50, com rótulos R$mín–R$máx. |

## Arquitetura

### 1. Backend — param `loc` (`SearchPublishedVenues`)
Adicionar (mantendo os existentes, que ficam inertes):
```sql
  AND (@loc::text = '' OR v.city ILIKE '%' || @loc::text || '%'
       OR v.state ILIKE '%' || @loc::text || '%'
       OR v.neighborhood ILIKE '%' || @loc::text || '%')
```
- `SearchFilters` ganha `Loc string`; `buildSearchParams` seta `p.Loc`; `parseSearchFilters` lê `loc`; `isEmpty()` inclui `Loc`. sqlc regen → param `Loc string`.

### 2. Frontend — `DateRangePicker` (`components/date-range-picker.tsx` + `.css`)
- Props: `start: string` (`YYYY-MM-DD`), `end: string`, `onChange(start, end)`.
- Campo (botão) mostra `dd/mm – dd/mm` ou "Selecione as datas"; abre **popover** com calendário de 1 mês (nav ‹/›).
- Seleção: sem start (ou ambos preenchidos) → define start, limpa end; com start e sem end → se clique ≥ start define end e fecha, senão redefine start. Dias **passados desabilitados**. "Limpar" no rodapé. Fecha em clique-fora.
- Destaque de start/end/intervalo. Comparação por string ISO (ordena lexicograficamente).

### 3. Frontend — `RangeSlider` (`components/range-slider.tsx` + `.css`)
- Props: `min, max, ceil, step?, onChange(min, max)`.
- **Dois `<input type="range">` sobrepostos** (técnica padrão: `pointer-events:none` no input, `auto` no thumb → ambas as alças pegáveis) + trilho com **segmento preenchido** entre as alças (gradiente da marca). Clampa `min ≤ max`. Rótulos `R$mín`/`R$máx`.

### 4. Frontend — `venue-filters.tsx` (reescrito) + `lib.ts` + `venue-grid.tsx`
- Estado: `loc, start, end, min, max`.
- 3 controles: input `loc` · `<DateRangePicker>` · `<RangeSlider ceil=5000 step=50>`.
- `submit`: `loc` (trim); datas só se ambas e `start < end`; `min/max` só >0 (garante `min ≤ max`). `clear` zera.
- `lib.ts`: `VenueSearchParams.loc?`; `searchVenues` envia `loc`. `venue-grid` lê `loc`/`start`/`end`/`min_price`/`max_price` da URL.

### 5. Estilos (`app/globals.css`)
- `.drp*` (campo/popover/grid/dias), `.rs*` (trilho/fill/thumbs/rótulos), layout dos 3 grupos.

## Regras
- AND de tudo. Data exige as duas e entrada<saída. Valor garante mín≤máx. `loc` vazio = sem filtro. Nada quebra a busca.

## Testes
- **Backend smoke:** `?loc=são paulo` (casa city), `?loc=SP` (casa state), `?loc=<bairro>`.
- **Frontend:** typecheck + build; smoke visual (input único filtra; calendário marca intervalo; slider duplo move 2 alças e filtra; limpar zera).

## Fora de escopo
ElasticSlider (componente fica no repo, sem uso na barra). Sem nav de 2 meses no calendário, sem presets de data.
