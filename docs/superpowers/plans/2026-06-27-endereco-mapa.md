# Endereço completo + etapa de mapa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar a localização do cadastro em dois passos — formulário de endereço completo (rua, bairro, cidade, estado, complemento) e um passo de mapa que aponta o local automaticamente a partir do endereço, com ajuste manual.

**Architecture:** Colunas `neighborhood`/`complement` no `venues`. O passo "Mapa" (novo componente `LocateOnMap`) faz geocoding direto (Nominatim `/search`) e passa as coords ao `MapPicker` (inalterado). A tela de editar ganha os campos e mantém o mapa atual.

**Tech Stack:** Go + Gin, pgx/sqlc, Next.js 15 + React 19 + TS, Leaflet/Nominatim.

## Global Constraints

- **Colunas novas:** `neighborhood`, `complement` (TEXT NOT NULL DEFAULT '') — `address` = rua+número.
- **Migration initdb:** `0006` aplicado **manual** no DB de QA (sem `down -v`).
- **Geocoding só no criar** (passo Mapa, auto ao entrar se sem coords + botão); editar mantém o mapa atual sem auto-geocode.
- **Clique no mapa do wizard só move o pino** (não reescreve o endereço).
- **Bairro/complemento opcionais**; rua/cidade/estado obrigatórios (como hoje).
- **`MapPicker` inalterado.** Coordenada continua opcional (lat/lng nullable).
- **Gates:** `cd backend && go test ./... && go build ./...`; `cd frontend && npm run typecheck && npm run build`.

---

## File Structure
- Create: `backend/migrations/0006_venue_address.sql`
- Modify: `backend/internal/db/queries/venues.sql` (+ regenerate)
- Modify: `backend/internal/venues/service.go` (`VenueInput`, Create/Update)
- Modify: `backend/internal/venues/handler.go` (`venueReq`, `toInput`, `venueResponse`, `venueDTO`)
- Modify: `frontend/app/venues/lib.ts` (`Venue`, `VenuePayload`)
- Create: `frontend/app/venues/locate-on-map.tsx`
- Modify: `frontend/app/venues/new/page.tsx` (6 passos + campos)
- Modify: `frontend/app/venues/[id]/edit/page.tsx` (campos)

---

## Task 1: Schema + queries (sqlc)

**Files:**
- Create: `backend/migrations/0006_venue_address.sql`
- Modify: `backend/internal/db/queries/venues.sql`
- Regenerate: `backend/internal/db/sqlc/venues.sql.go` + `models.go`

**Interfaces:**
- Produces: `sqlc.Venue` ganha `Neighborhood string`, `Complement string`; `CreateVenueParams`/`UpdateVenueParams` ganham `Neighborhood`, `Complement`.

- [ ] **Step 1: Migração** — `backend/migrations/0006_venue_address.sql`:
```sql
ALTER TABLE venues
    ADD COLUMN neighborhood TEXT NOT NULL DEFAULT '',
    ADD COLUMN complement   TEXT NOT NULL DEFAULT '';
```

- [ ] **Step 2: Atualizar `CreateVenue` e `UpdateVenue` em `venues.sql`**

`CreateVenue` — adicione as colunas e os params:
```sql
-- name: CreateVenue :one
-- Nasce como DRAFT (default da coluna status).
INSERT INTO venues (
    host_id, title, description, capacity, price_per_day,
    address, neighborhood, city, state, complement, latitude, longitude, amenities, features
) VALUES (
    @host_id, @title, @description, @capacity, @price_per_day,
    @address, @neighborhood, @city, @state, @complement, @latitude, @longitude, @amenities, @features
)
RETURNING *;
```
`UpdateVenue` — adicione `neighborhood` e `complement` ao SET:
```sql
-- name: UpdateVenue :one
UPDATE venues SET
    title         = @title,
    description   = @description,
    capacity      = @capacity,
    price_per_day = @price_per_day,
    address       = @address,
    neighborhood  = @neighborhood,
    city          = @city,
    state         = @state,
    complement    = @complement,
    latitude      = @latitude,
    longitude     = @longitude,
    amenities     = @amenities,
    features      = @features
WHERE id = @id
RETURNING *;
```

- [ ] **Step 3: Gerar + verificar**

Run: `cd backend && sqlc generate`
Run: `grep -nE "Neighborhood|Complement" internal/db/sqlc/models.go internal/db/sqlc/venues.sql.go | head`
Expected: `Venue.Neighborhood`/`Complement`; `CreateVenueParams`/`UpdateVenueParams` com os dois campos.

- [ ] **Step 4: Build (additivo)**

Run: `cd backend && go build ./...`
Expected: sem erros (o service usa literais parciais de params → campos novos ficam `""`, compila).

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/0006_venue_address.sql backend/internal/db/queries/venues.sql backend/internal/db/sqlc/
git commit -m "feat(venues): colunas neighborhood/complement (0006, sqlc)"
```

---

## Task 2: Service & Handler passam os campos

**Files:**
- Modify: `backend/internal/venues/service.go`
- Modify: `backend/internal/venues/handler.go`

**Interfaces:**
- Consumes: `CreateVenueParams`/`UpdateVenueParams`, `sqlc.Venue` (Task 1).
- Produces: `VenueInput` + `venueReq` + `venueResponse` com `Neighborhood`/`Complement`.

- [ ] **Step 1: `VenueInput` + Create/Update (`service.go`)**

No `type VenueInput struct`, após `State string`:
```go
	Neighborhood string
	Complement   string
```
No `Create`, dentro de `sqlc.CreateVenueParams{...}` (após `State: in.State,`):
```go
		Neighborhood: in.Neighborhood,
		Complement:   in.Complement,
```
No `Update`, dentro de `sqlc.UpdateVenueParams{...}` (após `State: in.State,`):
```go
		Neighborhood: in.Neighborhood,
		Complement:   in.Complement,
```

- [ ] **Step 2: `venueReq` + `toInput` + DTO (`handler.go`)**

No `type venueReq struct`, após `State string ...`:
```go
	Neighborhood string   `json:"neighborhood"`
	Complement   string   `json:"complement"`
```
Em `toInput()`, adicione ao literal `VenueInput{...}`:
```go
		Neighborhood: r.Neighborhood, Complement: r.Complement,
```
No `type venueResponse struct`, após `State string ...`:
```go
	Neighborhood string      `json:"neighborhood"`
	Complement   string      `json:"complement"`
```
Em `venueDTO`, no literal `venueResponse{...}` (após `City: v.City, State: v.State,`):
```go
		Neighborhood: v.Neighborhood, Complement: v.Complement,
```

- [ ] **Step 3: Build + suíte**

Run: `cd backend && go build ./... && go test ./...`
Expected: sem erros; verde.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/venues/service.go backend/internal/venues/handler.go
git commit -m "feat(venues): bairro/complemento no input, payload e DTO"
```

---

## Task 3: Tipos do front

**Files:**
- Modify: `frontend/app/venues/lib.ts`

**Interfaces:**
- Produces: `Venue` e `VenuePayload` com `neighborhood?: string`, `complement?: string`.

- [ ] **Step 1: Adicionar os campos**

Em `export interface Venue`, após `state: string;`:
```ts
  neighborhood?: string;
  complement?: string;
```
Em `export interface VenuePayload`, após `state: string;`:
```ts
  neighborhood?: string;
  complement?: string;
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/venues/lib.ts
git commit -m "feat(front): neighborhood/complement nos tipos Venue/VenuePayload"
```

---

## Task 4: Componente `LocateOnMap` (geocoding direto)

**Files:**
- Create: `frontend/app/venues/locate-on-map.tsx`

**Interfaces:**
- Consumes: `MapPicker` (`../components/MapPicker`).
- Produces: `default LocateOnMap({ address, neighborhood, city, state, lat, lng, onPick }: { address, neighborhood, city, state, lat, lng: string; onPick: (lat: number, lng: number) => void })`.

- [ ] **Step 1: Criar o componente**

```tsx
'use client';

import { useEffect, useState } from 'react';
import MapPicker from '../components/MapPicker';

interface LocateOnMapProps {
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  lat: string;
  lng: string;
  onPick: (lat: number, lng: number) => void;
}

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR`;
    const res = await fetch(url);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
    }
  } catch {
    /* sem geocode */
  }
  return null;
}

export default function LocateOnMap({ address, neighborhood, city, state, lat, lng, onPick }: LocateOnMapProps) {
  const hasInitial = lat !== '' && lng !== '';
  const [status, setStatus] = useState<'loading' | 'ready'>(hasInitial ? 'ready' : 'loading');

  const query = [address, neighborhood, city, state, 'Brasil'].filter(Boolean).join(', ');

  async function locate() {
    setStatus('loading');
    const r = await geocode(query);
    if (r) onPick(r.lat, r.lng);
    setStatus('ready');
  }

  // Geocoda ao montar se ainda não há coords (renderiza o mapa só depois,
  // pq o MapPicker lê as coords iniciais só no mount).
  useEffect(() => {
    if (!hasInitial) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'loading') {
    return (
      <div>
        <p className="field-label">Confirme o local no mapa</p>
        <p className="muted">Localizando pelo endereço…</p>
      </div>
    );
  }

  const has = lat !== '' && lng !== '';
  return (
    <div>
      <p className="field-label">Confirme o local no mapa</p>
      <p className="muted">
        {has
          ? `📍 ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)} — clique no mapa para ajustar`
          : 'Não encontrei automaticamente — clique no mapa para marcar.'}
      </p>
      <MapPicker
        lat={has ? Number(lat) : null}
        lng={has ? Number(lng) : null}
        onSelect={({ lat: la, lng: ln }) => onPick(la, ln)}
      />
      <button type="button" className="button ghost" onClick={locate} style={{ marginTop: 10 }}>
        Apontar pelo endereço
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/venues/locate-on-map.tsx
git commit -m "feat(front): LocateOnMap — geocoding direto do endereço + ajuste manual"
```

---

## Task 5: Wizard de criação (6 passos + campos)

**Files:**
- Modify: `frontend/app/venues/new/page.tsx`

**Interfaces:**
- Consumes: `LocateOnMap` (Task 4), `VenuePayload` com os campos novos (Task 3).

- [ ] **Step 1: Reescrever `new/page.tsx`** (substitua o arquivo inteiro):

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VenuesAPI, AMENITIES, type VenuePayload, type Photo } from '../lib';
import PhotoManager from '../photo-manager';
import LocateOnMap from '../locate-on-map';

const STEPS = ['Básico', 'Endereço', 'Mapa', 'Preço', 'Fotos', 'Revisão'];
const splitFeatures = (s: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

interface VenueForm {
  title: string;
  description: string;
  capacity: string;
  price_per_day: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  complement: string;
  latitude: string;
  longitude: string;
  amenities: string[];
  featuresText: string;
}

type StringField = Exclude<keyof VenueForm, 'amenities'>;

export default function NewVenuePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<VenueForm>({
    title: '', description: '', capacity: '', price_per_day: '',
    address: '', neighborhood: '', city: '', state: '', complement: '',
    latitude: '', longitude: '', amenities: [], featuresText: '',
  });

  const set = (k: StringField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const toggleAmenity = (k: string) =>
    setF((s) => ({
      ...s,
      amenities: s.amenities.includes(k) ? s.amenities.filter((a) => a !== k) : [...s.amenities, k],
    }));

  const canNext = () => {
    if (step === 0) return f.title.trim().length >= 3 && Number(f.capacity) > 0;
    if (step === 1) return !!(f.address && f.city && f.state);
    if (step === 3) return Number(f.price_per_day) > 0;
    return true;
  };

  const payload = (): VenuePayload => ({
    title: f.title,
    description: f.description,
    capacity: Number(f.capacity),
    price_per_day: f.price_per_day,
    address: f.address,
    neighborhood: f.neighborhood,
    city: f.city,
    state: f.state,
    complement: f.complement,
    amenities: f.amenities,
    features: splitFeatures(f.featuresText),
    latitude: f.latitude ? Number(f.latitude) : null,
    longitude: f.longitude ? Number(f.longitude) : null,
  });

  async function next() {
    setError('');
    // ao sair do passo Preço (3), cria/atualiza o rascunho (precisa do id pras fotos)
    if (step === 3) {
      setBusy(true);
      try {
        if (!venueId) {
          const v = await VenuesAPI.create(payload());
          setVenueId(v.id);
        } else {
          await VenuesAPI.update(venueId, payload());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao salvar');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  const back = () => {
    setError('');
    setStep((s) => Math.max(s - 1, 0));
  };

  async function finish(publish: boolean) {
    setBusy(true);
    setError('');
    try {
      if (publish && venueId) await VenuesAPI.publish(venueId);
      router.push('/venues/mine');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao finalizar');
      setBusy(false);
    }
  }

  return (
    <main className="container wizard">
      <h1>Anunciar espaço</h1>
      <div className="wizard-card">
      <ol className="steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'on' : i < step ? 'done' : ''}>{label}</li>
        ))}
      </ol>

      <div key={step} className="step">
        {step === 0 && (
          <>
            <label>Título<input value={f.title} onChange={set('title')} placeholder="Ex: Salão Vista Verde" /></label>
            <label>Descrição<textarea value={f.description} onChange={set('description')} rows={4} placeholder="Conte como é o espaço" /></label>
            <label>Capacidade (pessoas)<input type="number" min={1} value={f.capacity} onChange={set('capacity')} /></label>
          </>
        )}
        {step === 1 && (
          <>
            <label>Rua e número<input value={f.address} onChange={set('address')} placeholder="Ex: Av. das Flores, 100" /></label>
            <label>Bairro<input value={f.neighborhood} onChange={set('neighborhood')} placeholder="Ex: Centro" /></label>
            <div className="row">
              <label>Cidade<input value={f.city} onChange={set('city')} /></label>
              <label>Estado<input value={f.state} onChange={set('state')} maxLength={2} placeholder="UF" /></label>
            </div>
            <label>Complemento<input value={f.complement} onChange={set('complement')} placeholder="Ex: bloco B, sala 2 (opcional)" /></label>
          </>
        )}
        {step === 2 && (
          <LocateOnMap
            address={f.address}
            neighborhood={f.neighborhood}
            city={f.city}
            state={f.state}
            lat={f.latitude}
            lng={f.longitude}
            onPick={(la, ln) => setF((s) => ({ ...s, latitude: String(la), longitude: String(ln) }))}
          />
        )}
        {step === 3 && (
          <>
            <label>Preço por dia (R$)<input type="number" min={0} step="0.01" value={f.price_per_day} onChange={set('price_per_day')} /></label>
            <p className="field-label">Comodidades</p>
            <div className="chips">
              {AMENITIES.map((a) => (
                <button type="button" key={a.key} className={'chip' + (f.amenities.includes(a.key) ? ' on' : '')} onClick={() => toggleAmenity(a.key)}>
                  {a.label}
                </button>
              ))}
            </div>
            <p className="field-label">O que tem no espaço? (separe por vírgula)</p>
            <input value={f.featuresText} onChange={set('featuresText')} placeholder="Ex: piscina aquecida, 3 quartos, churrasqueira" />
            {splitFeatures(f.featuresText).length > 0 && (
              <div className="tags">
                {splitFeatures(f.featuresText).map((x, i) => <span key={i} className="tag">{x}</span>)}
              </div>
            )}
          </>
        )}
        {step === 4 && (
          <>
            <p className="field-label">Fotos do espaço</p>
            <PhotoManager venueId={venueId!} photos={photos} setPhotos={setPhotos} />
          </>
        )}
        {step === 5 && (
          <div className="review">
            <h2>{f.title}</h2>
            {f.description && <p>{f.description}</p>}
            <p><strong>{f.capacity}</strong> pessoas · <strong>R$ {f.price_per_day}</strong>/dia</p>
            <p>{[f.address, f.neighborhood, f.complement].filter(Boolean).join(' · ')}</p>
            <p>{f.city}/{f.state}</p>
            <p className="muted">{f.amenities.length} comodidades · {photos.length} fotos</p>
          </div>
        )}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="wizard-nav">
        {step > 0 && <button type="button" className="button ghost" onClick={back} disabled={busy}>Voltar</button>}
        {step < 5 && <button type="button" className="button" onClick={next} disabled={!canNext() || busy}>{busy ? '...' : 'Continuar'}</button>}
        {step === 5 && (
          <>
            <button type="button" className="button ghost" onClick={() => finish(false)} disabled={busy}>Salvar rascunho</button>
            <button type="button" className="button" onClick={() => finish(true)} disabled={busy}>{busy ? '...' : 'Publicar'}</button>
          </>
        )}
      </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/venues/new/page.tsx
git commit -m "feat(front): wizard com passo Endereço (forms) + passo Mapa (geocoding)"
```

---

## Task 6: Editar — campos novos

**Files:**
- Modify: `frontend/app/venues/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `Venue`/`VenuePayload` com os campos (Task 3).

- [ ] **Step 1: `EditForm` + carregamento**

No `interface EditForm`, após `state: string;`:
```ts
  neighborhood: string;
  complement: string;
```
No `useEffect` que faz `setF({...})` a partir de `v`, após `state: v.state,`:
```ts
          neighborhood: v.neighborhood ?? '',
          complement: v.complement ?? '',
```

- [ ] **Step 2: `StringField` + inputs no form**

Adicione `'neighborhood'` e `'complement'` à união `StringField`. No JSX do form, após o input de Endereço (e antes da `row` de Cidade/Estado), adicione:
```tsx
        <label>Bairro<input value={f.neighborhood} onChange={set('neighborhood')} /></label>
```
E após a `row` de Cidade/Estado:
```tsx
        <label>Complemento<input value={f.complement} onChange={set('complement')} placeholder="opcional" /></label>
```

- [ ] **Step 3: Incluir no `save()`**

No objeto passado a `VenuesAPI.update(id, {...})`, após `state: f.state,`:
```ts
        neighborhood: f.neighborhood,
        complement: f.complement,
```

- [ ] **Step 4: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/venues/[id]/edit/page.tsx
git commit -m "feat(front): bairro/complemento na edição de anúncio"
```

---

## Task 7: Verificação integrada (smoke)

**Files:** nenhum.

- [ ] **Step 1: Gates + aplicar 0006 + rebuild**

Run: `cd backend && go test ./... && go build ./...`
Run: `docker compose exec -T postgres psql -U app -d venues < backend/migrations/0006_venue_address.sql`
Run: `docker compose up -d --build backend frontend`
Expected: verde; colunas criadas; backend/health OK.

- [ ] **Step 2: Criar venue com todos os campos (API)**

```bash
B=http://localhost:8080/api/v1; O='-H Origin:http://localhost:3100'
curl -s $O -c /tmp/h.txt -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"host@dope.local","password":"dope12345"}' -o /dev/null
VID=$(curl -s $O -b /tmp/h.txt -X POST $B/venues -H 'Content-Type: application/json' -d '{"title":"Espaço Endereço","capacity":50,"price_per_day":"500","address":"Av. Paulista, 1000","neighborhood":"Bela Vista","city":"São Paulo","state":"SP","complement":"12º andar"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "venue=$VID"
curl -s $O -b /tmp/h.txt $B/venues/$VID | python3 -c "import sys,json; v=json.load(sys.stdin); print('campos:', v['address'],'|',v['neighborhood'],'|',v['city']+'/'+v['state'],'|',v['complement'])"
```
Expected: imprime `Av. Paulista, 1000 | Bela Vista | São Paulo/SP | 12º andar`.

- [ ] **Step 3: Editar os campos (PUT)**

```bash
B=http://localhost:8080/api/v1; O='-H Origin:http://localhost:3100'
curl -s $O -b /tmp/h.txt -X PUT $B/venues/$VID -H 'Content-Type: application/json' -d '{"title":"Espaço Endereço","capacity":50,"price_per_day":"500","address":"Rua Nova, 5","neighborhood":"Centro","city":"Campinas","state":"SP","complement":"casa"}' -o /dev/null -w 'PUT [%{http_code}]\n'
curl -s $O -b /tmp/h.txt $B/venues/$VID | python3 -c "import sys,json; v=json.load(sys.stdin); print('depois:', v['neighborhood'],'|',v['city'],'|',v['complement'])"
```
Expected: `PUT [200]`; `depois: Centro | Campinas | casa`.

- [ ] **Step 4: Geocoding direto (Nominatim)**

```bash
curl -s "https://nominatim.openstreetmap.org/search?q=Av.%20Paulista,%201000,%20S%C3%A3o%20Paulo,%20SP,%20Brasil&format=jsonv2&limit=1&countrycodes=br" | python3 -c "import sys,json; d=json.load(sys.stdin); print('coords:', d[0]['lat'], d[0]['lon']) if d else print('sem resultado')"
```
Expected: imprime coordenadas (lat/lon) — confirma que o geocoding direto funciona.

- [ ] **Step 5: Limpeza + UI**

```bash
curl -s -H "Origin: http://localhost:3100" -b /tmp/h.txt -X DELETE http://localhost:8080/api/v1/venues/$VID -o /dev/null -w 'delete [%{http_code}]\n'
rm -f /tmp/h.txt
```
UI: em http://localhost:3100, logado, **Anunciar** → preencha o passo **Endereço** → no passo **Mapa** o pino aparece pelo endereço; clique para ajustar. Editar um anúncio mostra bairro/complemento.

---

## Notas de execução
- **Subagentes sem Bash nesta sessão** → execução inline; sem lógica pura nova → validação por smoke.
- **`sqlc generate`** após a Task 1; **aplicar `0006` manual** no DB de QA (Task 7).
- **Rebuild do backend** (Go compila na imagem).
- Autocomplete por CEP, geocode no editar e múltiplos resultados ficam fora (anotados na spec).
