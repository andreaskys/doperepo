# Design — Endereço completo + etapa de mapa com geocoding

**Data:** 2026-06-27
**Objetivo:** no cadastro de espaço, separar a localização em dois passos — um
**formulário de endereço completo** (rua, bairro, cidade, estado, complemento) e
depois um **passo de mapa** que aponta o local automaticamente a partir do
endereço (geocoding direto), com ajuste manual do pino.
**Contexto:** hoje o passo "Localização" junta `address`/`city`/`state` + o
`MapPicker` (que só faz geocoding **reverso** no clique). `venues` não tem
`bairro`/`complemento`.

## Decisões (do brainstorming)

| Tema | Escolha |
| --- | --- |
| Campos novos | **Colunas no banco** (`neighborhood`, `complement`); `address` = rua+número. |
| Geocoding | **Abordagem A:** o passo do wizard faz o geocoding direto (Nominatim `/search`) e passa as coords ao `MapPicker` (que fica inalterado). |
| Editar | Ganha os campos novos (form único) + **mantém o mapa inline atual**; sem geocoding automático. |
| Coordenada | Continua **opcional** (lat/lng nullable). |

## Arquitetura

### 1. Schema (`backend/migrations/0006_venue_address.sql`)
```sql
ALTER TABLE venues
    ADD COLUMN neighborhood TEXT NOT NULL DEFAULT '',
    ADD COLUMN complement   TEXT NOT NULL DEFAULT '';
```
⚠️ Initdb — aplicar **manual** no DB de QA (sem `down -v`).

### 2. Queries (`backend/internal/db/queries/venues.sql`)
- `CreateVenue` e `UpdateVenue`: incluir `neighborhood` e `complement` nas
  colunas/`@params`.
- `GetVenueByID`, `ListVenuesByHost` usam `SELECT *` → já trazem os campos
  (sqlc gera `Venue.Neighborhood`/`Venue.Complement`).
- `ListPublishedVenues`/`SearchPublishedVenues` **não mudam** (card só usa cidade/estado).
Requer `sqlc generate`.

### 3. Service & Handler (`backend/internal/venues/`)
- `VenueInput` (service): + `Neighborhood string`, `Complement string`. `Create`
  e `Update` passam `Neighborhood`/`Complement` aos params (validação igual:
  rua/cidade/estado já são exigidos pelo `venueReq`; bairro/complemento livres).
- `venueReq` (handler): + `Neighborhood string json:"neighborhood"`,
  `Complement string json:"complement"` (sem `binding:"required"`). `toInput`
  mapeia.
- `venueResponse` (DTO): + `neighborhood`, `complement` (p/ a tela de editar carregar).

### 4. Tipos do front (`frontend/app/venues/lib.ts`)
`Venue` e `VenuePayload` ganham `neighborhood?: string` e `complement?: string`.

### 5. Wizard de criação (`frontend/app/venues/new/page.tsx`)
- `STEPS = ['Básico', 'Endereço', 'Mapa', 'Preço', 'Fotos', 'Revisão']` (6).
- Estado `f` ganha `neighborhood`, `complement`.
- **Passo "Endereço"** (índice 1, só forms): rua (`address`), bairro
  (`neighborhood`), cidade (`city`), estado (`state`, UF, maxLength 2),
  complemento (`complement`). `canNext(step===1)` = rua && cidade && estado.
- **Passo "Mapa"** (índice 2): renderiza `<LocateOnMap>` (novo componente).
- `payload()` inclui `neighborhood`/`complement`. Índices dos passos seguintes
  (Preço=3, Fotos=4, Revisão=5) ajustados; a criação do rascunho (que hoje roda
  ao sair do passo Preço) passa a disparar **ao sair do passo 3 (Preço)**.

### 6. Componente `LocateOnMap` (`frontend/app/venues/locate-on-map.tsx`)
Props: `{ address, neighborhood, city, state, lat, lng, onPick: (lat: number, lng: number) => void }`.
- `useEffect` no mount: se `lat`/`lng` vazios, monta a query e faz o geocoding
  direto; havendo resultado, `onPick(lat, lng)`.
- Botão "Apontar pelo endereço": refaz o geocoding sob demanda.
- Renderiza `<MapPicker lat lng onSelect={({lat,lng}) => onPick(lat,lng)} />` —
  clique **só move o pino** (não reescreve o endereço).
- Status: "Localizando…" / "Não encontrei automaticamente — clique no mapa para
  marcar." / "📍 lat, lng — clique para ajustar".

Geocoding direto (no componente):
```
GET https://nominatim.openstreetmap.org/search
    ?q=<rua, bairro, cidade, UF, Brasil>
    &format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR
→ [{lat, lon}] → {lat:+lat, lng:+lon}  | []/erro → null
```
Best-effort: falha → null → mapa abre pra marcar manual.

### 7. Editar (`frontend/app/venues/[id]/edit/page.tsx`)
- `EditForm` + estado ganham `neighborhood`, `complement` (carregados do venue).
- Form ganha os inputs bairro e complemento.
- `save()` envia `neighborhood`/`complement` no update.
- **Mantém o `MapPicker` inline atual** (mostra o salvo; clique ajusta — comportamento atual). Sem `LocateOnMap` aqui.

## Erros & estados
- Geocode sem resultado/erro → não trava; mapa abre e a pessoa marca manual.
- Coordenada opcional (backend já aceita nullable).
- `MapPicker` inalterado (reuso por wizard e editar).

## Testes
- Pouca lógica pura (form + fetch) → **smoke**:
  1. Criar venue via API com todos os campos → `GET /venues/:id` retorna
     address/neighborhood/city/state/complement/lat/lng.
  2. `PUT` editando os campos → reflete.
  3. Geocoding: `GET nominatim …/search?q=<endereço conhecido>` devolve coords (conferência pontual).
- Testes existentes verdes (campos additivos). Gates: `go test`/`build`, `npm typecheck`/`build`.

## Fora de escopo (anotado)
Autocomplete por CEP (ViaCEP), validação de CEP, escolher entre múltiplos
resultados do Nominatim, geocoding automático no editar.
