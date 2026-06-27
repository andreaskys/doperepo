# Arquitetura

Backend Go em **arquitetura limpa**: `cmd` fino → `internal/platform` conecta a
infra → `internal/server` monta o HTTP e injeta as deps nas features. Cada
feature (`auth`, `venues`, `bookings`, `notifications`) é um pacote com
handler + service + queries sqlc. Frontend Next.js (App Router, TypeScript
strict) consome a API por cookie de sessão.

## Árvore (backend)
```
backend/
├─ cmd/api/main.go                    # bootstrap, graceful shutdown, sobe o worker de notif
├─ internal/
│  ├─ config/                         # env 12-factor (DB/Redis/Rabbit/S3/SMTP/CORS)
│  ├─ platform/{postgres,redis,rabbitmq,storage}/  # conexões de infra
│  ├─ db/queries/*.sql + db/sqlc/     # SQL → código gerado (sqlc)
│  ├─ server/                         # gin engine, CORS, /health, wiring das deps
│  ├─ auth/                           # register/login/logout/me, sessão Redis (cookie httpOnly)
│  ├─ venues/                         # CRUD + fotos (MinIO) + busca/filtros + cache Redis
│  ├─ bookings/                       # criar/listar + ciclo (confirm/cancel) + concorrência
│  └─ notifications/                  # Notifier (in-app + e-mail), worker SMTP, retry/DLQ, API do sino
└─ migrations/0001..0005              # schema incremental (initdb)
```

## Seam (injeção de dependências)
`server.Deps{ Cfg, DB, Redis, Broker, Storage }` carrega a infra conectada.
`server.New` cria `sqlc.New(DB)` e monta cada feature:
- `auth.NewService(queries, Redis)`
- `venues.NewService(queries, Storage, Redis)`
- `bookings.NewService(DB, queries, notifications.NewNotifier(Broker, queries))`
- `notifications.NewHandler(queries)`

`Broker` e `Storage` podem ser **nil** (mensageria/fotos degradam sem derrubar a API).

## Rotas (`/api/v1`)
| Grupo | Rotas |
| --- | --- |
| auth | `POST /auth/{register,login,logout}` · `GET /auth/me` |
| venues (público) | `GET /public/venues` (busca/filtros) · `GET /public/venues/:id` · `GET /public/venues/:id/booked` |
| venues (auth) | `GET/POST /venues` · `GET/PUT/DELETE /venues/:id` · `POST /venues/:id/{publish,photos}` · `DELETE /venues/:id/photos/:photoID` |
| bookings (auth) | `POST /venues/:id/bookings` · `GET /bookings` · `GET /bookings/received` · `POST /bookings/:id/{confirm,cancel}` |
| notifications (auth) | `GET /notifications` · `GET /notifications/unread-count` · `POST /notifications/read` · `DELETE /notifications` |

## Fluxos críticos
- **Concorrência de reserva** (anti-overbooking, duas camadas — ver [[decisions]]):
  `SELECT FOR UPDATE` na linha do venue dentro da tx pgx serializa o
  check-then-insert; `EXCLUDE USING gist` no Postgres é a rede de segurança.
  **Provado:** 2 reservas paralelas → 1×201, 1×409.
- **Ciclo de reserva:** PENDING→CONFIRMED (host) / →CANCELLED (host ou convidado);
  transições atômicas via `UPDATE ... WHERE status=...`; autorização pura testável.
- **Busca pública:** `SearchPublishedVenues` (sqlc, filtros opcionais via guarda
  sentinela); listagem sem filtros usa **cache-aside no Redis** (`venues:public:list`,
  TTL 5min) invalidado nas escritas.
- **Notificações:** o `Notifier` grava a notificação **in-app** (durável, p/ o sino)
  e publica um evento no **RabbitMQ**; o **worker** consome → renderiza → envia por
  **SMTP** (Mailpit), com **retry (3× backoff) + DLQ** (`notifications.dlq`).

## Migrations
`0001` schema base + trava anti-overbooking · `0002/0003` colunas de venue +
features · `0004` índices de busca · `0005` tabela `notifications`. São initdb
(rodam em volume novo); em DB existente, aplicar manualmente.

Ver também: [[stack]] · [[structure]] · [[decisions]] · [[mvp-checklist]]
