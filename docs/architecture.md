# Arquitetura

Backend Go em arquitetura limpa: `cmd` fino, `internal/platform` conecta infra,
`internal/server` expõe HTTP. Repositórios e use cases penduram no seam abaixo.

## Árvore
```
backend/
├─ cmd/api/main.go              # bootstrap + graceful shutdown
├─ internal/
│  ├─ config/                   # env (12-factor) + test
│  ├─ platform/{postgres,redis,rabbitmq}/   # conexões de infra
│  ├─ server/                   # gin engine + /health (+ grupos /api/v1)
│  └─ db/queries/               # SQL p/ sqlc (users, bookings)
└─ migrations/0001_init.sql     # schema + trava anti-overbooking
```

## Seam (ponto de injeção)
`server.Deps{ Cfg, DB, Redis, Broker }` carrega a infra conectada. Handlers de
**auth / venues / bookings** entram nos grupos `/api/v1`. `Broker` pode ser nil
(mensageria degrada graciosamente, não derruba a API).

## Anti-overbooking (requisito crítico)
Duas camadas — detalhe em [[decisions]]:
1. `SELECT FOR UPDATE` dentro da tx pgx → serializa o check-then-insert.
2. `EXCLUDE USING gist` no Postgres → rede de segurança no nível do banco.

Primitivos prontos em `backend/internal/db/queries/bookings.sql`.

Ver também: [[stack]] · [[mvp-checklist]]
