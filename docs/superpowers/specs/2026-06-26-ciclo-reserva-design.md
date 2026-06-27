# Design — Ciclo de vida da reserva (host aprova)

**Data:** 2026-06-26
**Contexto MVP:** completa o item #4 (fluxo de reserva), que hoje só cria a
reserva. Fecha o loop que faltava: o host **vê, confirma e recusa**; host e
convidado **cancelam**.
**Escopo desta spec:** APENAS a máquina de estados + endpoints + UI.
**Notificações por e-mail ficam para uma spec separada** (decisão do brainstorming).

## Objetivo

Hoje uma reserva nasce `PENDING` e segura as datas, mas **nada a transiciona** —
o enum `booking_status` (PENDING/CONFIRMED/CANCELLED) é código morto, o host não
enxerga as reservas recebidas e ninguém confirma/cancela. Esta iteração entrega:

- **Host aprova:** o convidado solicita (PENDING); o host **confirma** ou **recusa**.
- **Cancelamento:** host **e** convidado podem cancelar (uma PENDING ou CONFIRMED).
- **Visão do host:** página com as reservas recebidas nos seus espaços.

## Contexto (código atual)

- `backend/internal/bookings/`: `Create` roda o fluxo crítico numa tx pgx
  (lock no venue → checa overlap → insere PENDING). `ListByGuest` e
  `BookedRanges` existem. Rotas: `POST /venues/:id/bookings`, `GET /bookings`,
  `GET /public/venues/:id/booked`.
- Erros-sentinela mapeados para HTTP no handler; DTOs por papel; lógica pura
  (`validateStay`) com unit test (`bookings/service_test.go`).
- Schema: `bookings(id, venue_id, guest_id, start_date, end_date, total_price,
  status, created_at)`; overlap/`EXCLUDE` ignoram `CANCELLED`.
- sqlc: `sqlc.BookingStatusPENDING/CONFIRMED/CANCELLED`, struct `sqlc.Booking`.
- Frontend: `/reservas` (convidado) lista as próprias reservas; `lib.ts` tem
  `BookingsAPI`. Sem nenhuma visão de host das reservas.

## Máquina de estados

```
PENDING ──confirm (host)──▶ CONFIRMED
   │                            │
   └──cancel (host/guest)──▶ CANCELLED ◀──cancel (host/guest)──┘
```

| De → Para | Quem | Ação |
| --- | --- | --- |
| PENDING → CONFIRMED | **só host** | confirmar |
| PENDING → CANCELLED | host ou convidado | recusar / retirar |
| CONFIRMED → CANCELLED | host ou convidado | cancelar |
| CANCELLED | — | terminal |

**Datas:** PENDING e CONFIRMED seguram as datas (o overlap e o `EXCLUDE`
constraint ignoram `CANCELLED`); cancelar libera. Mantém o comportamento atual
de "primeira PENDING segura o slot" — pedido concorrente nas mesmas datas → 409.

## Decisões desta feature

| Decisão | Escolha | Por quê |
| --- | --- | --- |
| Aplicação da transição | **Buscar → autorizar no Go → UPDATE guardado por status** (Abordagem A) | Erros HTTP precisos (404/403/409); transição atômica pela cláusula `WHERE status=...`; sem tx/lock explícito; autorização vira função pura testável. |
| Quem confirma | **Só o host** | Modelo "host aprova" escolhido no brainstorming. |
| Quem cancela | **Host e convidado**, em PENDING ou CONFIRMED | Imprevistos acontecem; cancelar libera as datas. |
| Concorrência | **UPDATE condicional guardado por status** (sem lock de venue) | Transição numa única linha de booking; cancelar só libera (sem overlap), confirmar não cria overlap. Lock seria exagero. |
| Notificações | **Fora de escopo** | Próxima spec (publish + worker + SMTP). |

## Arquitetura

### 1. SQL (`backend/internal/db/queries/bookings.sql`)

```sql
-- name: GetBookingWithOwner :one
-- Autorização + estado: traz o host_id do venue junto.
SELECT b.id, b.venue_id, b.guest_id, b.status, v.host_id
FROM bookings b
JOIN venues v ON v.id = b.venue_id
WHERE b.id = $1;

-- name: ConfirmBooking :one
UPDATE bookings SET status = 'CONFIRMED'
WHERE id = $1 AND status = 'PENDING'
RETURNING *;

-- name: CancelBooking :one
UPDATE bookings SET status = 'CANCELLED'
WHERE id = $1 AND status <> 'CANCELLED'
RETURNING *;

-- name: ListBookingsByHost :many
SELECT b.id, b.venue_id, b.guest_id, b.start_date, b.end_date, b.total_price,
       b.status, b.created_at,
       v.title AS venue_title, v.city AS venue_city, v.state AS venue_state,
       u.name AS guest_name, u.email AS guest_email
FROM bookings b
JOIN venues v ON v.id = b.venue_id
JOIN users u ON u.id = b.guest_id
WHERE v.host_id = $1
ORDER BY b.created_at DESC;
```

Requer `sqlc generate` a partir de `./backend`. As transições são `:one` com
`RETURNING *`; **0 linhas** (estado mudou na corrida) vira `pgx.ErrNoRows` →
`ErrInvalidTransition` no service.

### 2. Service (`backend/internal/bookings/service.go`)

Erros-sentinela novos:
```go
ErrBookingNotFound   = errors.New("reserva não encontrada")
ErrNotAuthorized     = errors.New("ação não permitida")
ErrInvalidTransition = errors.New("transição de estado inválida")
```

Lógica de autorização **pura** (sem DB, unit-testável):
```go
type bookingAuth struct {
	hostID  int64
	guestID int64
	status  sqlc.BookingStatus
}

func canConfirm(b bookingAuth, userID int64) error {
	if userID != b.hostID {
		return ErrNotAuthorized
	}
	if b.status != sqlc.BookingStatusPENDING {
		return ErrInvalidTransition
	}
	return nil
}

func canCancel(b bookingAuth, userID int64) error {
	if userID != b.hostID && userID != b.guestID {
		return ErrNotAuthorized
	}
	if b.status == sqlc.BookingStatusCANCELLED {
		return ErrInvalidTransition
	}
	return nil
}
```

Métodos:
- `ListByHost(ctx, hostID int64) ([]sqlc.ListBookingsByHostRow, error)`
- `Confirm(ctx, bookingID, userID int64) (sqlc.Booking, error)`:
  `GetBookingWithOwner` → `pgx.ErrNoRows`? → `ErrBookingNotFound`;
  `canConfirm(...)`; `ConfirmBooking(id)`; se `pgx.ErrNoRows` → `ErrInvalidTransition`.
- `Cancel(ctx, bookingID, userID int64) (sqlc.Booking, error)`:
  análogo com `canCancel` e `CancelBooking`.

### 3. Handler & rotas (`backend/internal/bookings/handler.go`)

Rotas novas (todas atrás de `requireAuth`):

| Método/rota | Handler | Ação |
| --- | --- | --- |
| `GET /bookings/received` | `listReceived` | reservas recebidas do host |
| `POST /bookings/:id/confirm` | `confirm` | host confirma |
| `POST /bookings/:id/cancel` | `cancel` | host ou convidado cancela |

Sem conflito de roteamento: árvore GET tem `/bookings` e `/bookings/received`;
`:id` só aparece nas POST.

Mapeamento de erro: `ErrBookingNotFound`→404, `ErrNotAuthorized`→403,
`ErrInvalidTransition`→409, demais→500. `confirm`/`cancel` retornam a reserva
atualizada (DTO existente `bookingDTO`/`myBookingResp`).

DTO novo `receivedBookingResp`: campos de `myBookingResp` + `guest_name`,
`guest_email`.

### 4. Frontend

- **`app/venues/lib.ts`:**
  - `interface ReceivedBooking` = campos de `Booking` + `guest_name: string`, `guest_email: string`.
  - `BookingsAPI.received(): Promise<ReceivedBooking[]>` → `GET /bookings/received`.
  - `BookingsAPI.confirm(id): Promise<Booking>` → `POST /bookings/${id}/confirm`.
  - `BookingsAPI.cancel(id): Promise<Booking>` → `POST /bookings/${id}/cancel`.
- **`app/reservas/page.tsx`** (convidado): botão **Cancelar** nas reservas com
  status PENDING/CONFIRMED → `BookingsAPI.cancel(id)` → recarrega a lista.
  Botão desabilita durante a chamada; erro inline.
- **`app/reservas/recebidas/page.tsx`** (novo, host): lista de `received()` com
  nome do convidado, espaço, datas, total, status. Ações por estado:
  PENDING → **Confirmar** + **Recusar**; CONFIRMED → **Cancelar**; CANCELLED → sem ação.
- **Abas** no topo das duas páginas: **Minhas reservas** ⇄ **Reservas recebidas**
  (a pessoa pode ser convidado e host). Dock inalterado.
- Visual no padrão do site (`docs/design.md`): `.venue-list`/`.venue-card`,
  `.badge` (CONFIRMED→`pub` verde, PENDING→`draft`, CANCELLED→estilo cancelado
  novo), botões `.button` / `.button.ghost` / `.button.danger`. Durações <300ms,
  só `transform`/`opacity`, `prefers-reduced-motion` respeitado.

## Fluxo de dados (confirmar, exemplo)

```
host clica Confirmar → BookingsAPI.confirm(id)
  → POST /bookings/:id/confirm (cookie de sessão)
  → handler.confirm → svc.Confirm(id, hostID)
  → GetBookingWithOwner → canConfirm (host + PENDING)
  → ConfirmBooking (UPDATE ... WHERE status='PENDING')
  → 200 + reserva CONFIRMED → UI recarrega
```

## Tratamento de erros & estados vazios

- 404 (reserva inexistente), 403 (não é host/convidado da reserva), 409
  (transição inválida: confirmar não-PENDING, cancelar já-CANCELLED, ou corrida).
- Frontend: botão de ação desabilita durante a requisição; mensagem de erro
  inline; recarrega a lista no sucesso.
- Host sem recebidas → "Você ainda não recebeu reservas.". Convidado sem
  reservas → mensagem atual.

## Testes

- **Unit puros (sem DB)**, no padrão de `bookings/service_test.go`, em
  `bookings/lifecycle_test.go`: `canConfirm`/`canCancel` cobrindo —
  1. host confirma PENDING → ok;
  2. convidado tenta confirmar → `ErrNotAuthorized`;
  3. confirmar CONFIRMED/CANCELLED → `ErrInvalidTransition`;
  4. convidado cancela a própria (PENDING e CONFIRMED) → ok;
  5. host cancela → ok;
  6. terceiro (nem host nem convidado) cancela → `ErrNotAuthorized`;
  7. cancelar já-CANCELLED → `ErrInvalidTransition`.
- **Smoke da API** (dados semeados, ≥2 usuários: 1 host, 1 convidado): solicitar
  → `received` mostra pro host e não pro estranho → confirmar (200) → cancelar
  (200) → confirmar de novo → 409 → cancelar como terceiro → 403. Valida SQL +
  autorização ponta a ponta (mesmo espírito da busca).
- Gates: `cd backend && go test ./... && go build ./...`; `cd frontend && npm run typecheck && npm run build`.

## Fora de escopo (anotado para o futuro)

- **Notificações/e-mail** (RabbitMQ publish + worker consumidor + SMTP Mailpit) — próxima spec.
- Múltiplas reservas PENDING competindo pelas mesmas datas (hoje a 1ª segura).
- Políticas de cancelamento, reembolso, pagamento.
- Convidado editar datas de uma reserva existente.
- Paginação da lista de recebidas (sem `LIMIT` por ora; revisar se crescer).
