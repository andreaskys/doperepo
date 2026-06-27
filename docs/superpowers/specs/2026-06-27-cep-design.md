# Design — Busca por CEP (preenche os campos + guarda)

**Data:** 2026-06-27
**Objetivo:** no cadastro/edição de espaço, um campo de CEP que, ao ser
preenchido, consulta o **ViaCEP** e preenche rua/bairro/cidade/estado
automaticamente; o CEP é **guardado** no venue.
**Contexto:** continua a feature de endereço (`2026-06-27-endereco-mapa-design`).
O passo "Endereço" hoje tem rua/bairro/cidade/estado/complemento; `venues` não
tem coluna de CEP.

## Decisões (do brainstorming)
| Tema | Escolha |
| --- | --- |
| CEP | **Guardado** no venue (coluna `cep`, texto só-dígitos) + usado pra autofill. |
| Provedor | **ViaCEP** (`https://viacep.com.br/ws/<cep>/json/`). |
| Autofill | preenche rua (`logradouro`), bairro (`bairro`), cidade (`localidade`), estado (`uf`). **Não** mexe no complemento nem no número. |
| Disparo | automático ao completar **8 dígitos** (sem botão). |
| Onde | criar (passo Endereço) **e** editar. |

## Arquitetura

### 1. Schema (`backend/migrations/0007_venue_cep.sql`)
```sql
ALTER TABLE venues ADD COLUMN cep TEXT NOT NULL DEFAULT '';
```
Initdb — aplicar **manual** no DB de QA (sem `down -v`).

### 2. Backend (`venues`)
- `venues.sql`: `CreateVenue` e `UpdateVenue` incluem a coluna/param `cep`
  (`Get`/`ListByHost` são `SELECT *`). `sqlc generate` → `Venue.Cep`,
  `CreateVenueParams.Cep`, `UpdateVenueParams.Cep`.
- `VenueInput` (service): + `Cep string`; Create/Update passam `Cep: in.Cep`.
- `venueReq` (handler): + `Cep string json:"cep"` (sem `required`); `toInput`
  mapeia. `venueResponse`: + `Cep string json:"cep"`; `venueDTO`: `Cep: v.Cep`.

### 3. Frontend — tipos (`lib.ts`)
`Venue` e `VenuePayload` ganham `cep?: string`.

### 4. Componente `CepInput` (`frontend/app/venues/cep-input.tsx`)
```tsx
interface Resolved { address: string; neighborhood: string; city: string; state: string }
interface CepInputProps {
  cep: string;
  onCepChange: (cep: string) => void;
  onResolve: (r: Resolved) => void;
}
```
- `onChange`: limpa não-dígitos, corta em 8, chama `onCepChange`. Ao atingir 8
  dígitos, consulta o ViaCEP:
  `GET https://viacep.com.br/ws/<8digits>/json/` →
  - `{erro:true}` → status "CEP não encontrado — preencha manualmente."
  - ok → `onResolve({ address: d.logradouro, neighborhood: d.bairro, city: d.localidade, state: d.uf })` (campos vazios viram `''`), status "Endereço preenchido — confira e complete o número."
  - falha de rede → status "Não consegui buscar o CEP — preencha manualmente."
- Renderiza `<label>CEP <input inputMode="numeric" maxLength={8} .../>` + `<span className="muted">{status}</span>`.

### 5. Wizard de criação (`new/page.tsx`)
- `VenueForm` ganha `cep: string`.
- Passo **Endereço** começa com `<CepInput cep={f.cep} onCepChange={(c)=>setF(s=>({...s,cep:c}))} onResolve={(r)=>setF(s=>({...s, address:r.address, neighborhood:r.neighborhood, city:r.city, state:r.state}))} />`, depois os campos existentes (rua, bairro, cidade, estado, complemento).
- `payload()` envia `cep: f.cep`.

### 6. Editar (`[id]/edit/page.tsx`)
- `EditForm` ganha `cep`; carrega `v.cep ?? ''`.
- `CepInput` no topo do form (mesma fiação). `save()` envia `cep: f.cep`.

## Erros & degradação
CEP inválido/não encontrado/erro de rede → não trava; status avisa e a pessoa
preenche manual. CEP é **opcional** (coluna default `''`).

## Testes
- Frontend (form + fetch) → **smoke**:
  1. Criar venue via API com `cep` → `GET /venues/:id` retorna o `cep`.
  2. ViaCEP devolve endereço pra um CEP conhecido: `GET viacep.com.br/ws/01310100/json/` → `logradouro` contém "Paulista".
- Testes existentes verdes (campo additivo). Gates: `go test`/`build`, `npm typecheck`/`build`.

## Fora de escopo (anotado)
Máscara visual `00000-000`; validação de dígito; busca reversa (endereço→CEP);
provedor alternativo (BrasilAPI) se o ViaCEP cair.
