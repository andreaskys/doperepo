# Estrutura do Projeto (mapa)

Orientação rápida do código para próximas sessões. Detalhe de camadas em
[[architecture]]; como rodar em [[stack]].

## Backend (`backend/internal/<feature>`)
Cada feature segue o mesmo padrão: `handler.go` (HTTP/gin) → `service.go`
(regra) → `*.sql` (sqlc). Lógica pura fica testável (unit tests sem DB).

| Pacote | Responsabilidade | Arquivos-chave |
| --- | --- | --- |
| `auth` | sessão Redis, register/login/logout/me, roles GUEST/HOST, **perfil/conta** (bio/avatar via MinIO, trocar senha) | `auth.go`, `handler.go`, `profile_test.go` |
| `venues` | CRUD, fotos (MinIO), **busca/filtros**, **cache** | `service.go`, `handler.go`, `cache.go` |
| `bookings` | criar (tx + lock), listar, **ciclo** (confirm/cancel), porta `Notifier` | `service.go`, `lifecycle_test.go` |
| `notifications` | `Notifier` (in-app+e-mail), `Consumer` (worker SMTP+retry/DLQ), `Handler` (API do sino), `render` | `notifier.go`, `consumer.go`, `handler.go`, `render.go` |
| `platform/*` | conexões: postgres (pgxpool), redis, rabbitmq (Publisher+Consume), storage (MinIO) | — |
| `server` | gin, CORS, `/health`, wiring (`Deps`) | `server.go` |
| `db/queries` + `db/sqlc` | SQL → código gerado. Rodar `sqlc generate` após editar `.sql` | `*.sql` |

## Frontend (`frontend/app`, Next.js App Router)
- **Tipos + API:** `venues/lib.ts` — `req()` (com 401→/login), `VenuesAPI`,
  `BookingsAPI`, `PublicAPI`, `NotificationsAPI`, tipos de domínio.
- **Nav:** `components/site-nav.tsx` (Dock React Bits + sino com painel) —
  **toda opção de menu vive no Dock** (ver memória do projeto).
- **Componentes:** `Dock`, `Stepper`, `Iridescence`, `MapPicker`, `venue-grid`,
  `venue-filters`, `photo-manager`, `footer`, `auth-split`.
- **Páginas:** `/` (home+busca), `/login` `/signup` (`auth-split`),
  `/venues/{new,mine,[id]/edit,[id]/reservar}`, `/reservas` (convidado),
  `/reservas/recebidas` (host).
- **Estilo:** `globals.css` (tokens `--brand-*`, easing custom); diretrizes em [[design]].

## Fluxo de uma request (ex.: confirmar reserva)
```
UI (host) → POST /bookings/:id/confirm (cookie sessão)
  → auth middleware (Redis) → bookings.handler.confirm
  → bookings.Service.Confirm (autoriza + UPDATE guardado)
  → notifications.Notifier: grava in-app + publica evento
       → worker consome → e-mail (Mailpit)   [async]
  → 200 → UI recarrega; sino (poll) mostra badge
```

## Convenções
- Backend type-safe via **sqlc**; erros-sentinela → HTTP no handler.
- Frontend **TypeScript strict**; tipos centralizados em `lib.ts`.
- Best-effort em notificação/cache: nunca derrubam a operação principal.
- Verificação: `go test ./...`, `go build`, `npm run typecheck`, `npm run build`.
- Dados de QA: `scripts/seed-qa.sh` (contas + espaços + reservas + capas).

Ver também: [[architecture]] · [[stack]] · [[mvp-checklist]] · [[Home]]
