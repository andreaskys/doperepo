# CLAUDE.md — Espaços (doperepo)

Guia que o Claude lê toda sessão. **Mantém curto e verdadeiro.** O conhecimento
profundo mora no vault Obsidian em `docs/` — este arquivo é o ponto de entrada e
as regras de trabalho.

## O que é o projeto

**Espaços** — marketplace estilo Airbnb para **aluguel de espaços para festas e
eventos**. Anfitrião (HOST) anuncia um espaço; convidado (GUEST) reserva por
diárias. Roda 100% local via Docker.

Índice do vault: **`docs/Home.md`** (MOC). Sempre comece por ele.
- `docs/architecture.md` — camadas Go, seam `server.Deps`, anti-overbooking
- `docs/stack.md` — serviços, portas, como rodar
- `docs/decisions.md` — **log do "porquê"** de cada escolha técnica
- `docs/mvp-checklist.md` — escopo e status **real** do MVP (fonte da verdade do status)
- `docs/design.md` — diretrizes de UI/animação

> ⚠️ `docs/Home.md` está desatualizado ("features não implementadas"). O status
> real está em `docs/mvp-checklist.md`: itens 1, 2, 4 e 5 estão ✅; **item 3
> (busca/filtros + cache Redis) é o que falta** (🟡).

## Stack

- **Frontend:** Next.js 15 + React 19 + **TypeScript (strict)** — `frontend/`
- **Backend:** Go + Gin, pgx/sqlc, arquitetura limpa — `backend/`
- **Infra:** PostgreSQL · Redis (sessões + cache) · RabbitMQ · MinIO (fotos) · Mailpit · Adminer

## Rodar

```bash
cp .env.example .env
docker compose up --build
```

## Comandos de verificação (use antes de afirmar que algo está pronto)

| Camada | Comando | Onde |
| --- | --- | --- |
| Backend — testes | `docker compose exec backend go test ./...` | raiz |
| Frontend — tipos | `npm run typecheck` | `frontend/` |
| Frontend — build | `npm run build` | `frontend/` |

Nunca diga "funciona/passa/pronto" sem ter rodado o gate correspondente e visto
a saída. Evidência antes de afirmação (skill `verification-before-completion`).

## Convenções

- **Backend:** arquitetura limpa. `cmd` fino → `internal/platform` (infra) →
  `internal/server` (HTTP). Features penduram no seam `server.Deps{ Cfg, DB,
  Redis, Broker }` nos grupos `/api/v1`. `Broker` pode ser `nil` (mensageria
  degrada graciosamente). SQL via **sqlc** em `internal/db/queries/`.
- **Concorrência (crítico):** reserva usa tx pgx — `SELECT FOR UPDATE` serializa
  o check-then-insert, e há `EXCLUDE USING gist` no banco como rede de segurança.
  Não mexa nesse fluxo sem ler `docs/architecture.md` + `docs/decisions.md`.
- **Frontend:** TypeScript **strict**. Tipos de domínio (`Venue`, `Booking`,
  `Photo`, payloads) centralizados em `app/venues/lib.ts` — reutilize, não
  redeclare. Toda chamada de API passa pelos objetos `VenuesAPI` / `BookingsAPI`.
- **Design/animação:** seguir a skill **emil-design-eng** (`.agents/skills/`).
  Regras-chave em `docs/design.md`: durações < 300ms, só `transform`/`opacity`,
  nunca `transition: all` nem `ease-in` em UI, respeitar `prefers-reduced-motion`.
  Paleta: gradiente roxo→azul (`--brand-purple #6b4fd0` → `--brand-blue #3b82f6`).

## Fluxo de trabalho com superpowers

1. **Antes de qualquer feature nova:** use `brainstorming` para alinhar intenção
   e requisitos antes de codar.
2. **Planos** ficam em `docs/plans/` (um `.md` por feature). Escreva com
   `writing-plans`; execute com `executing-plans` (sobrevive entre sessões, tem
   checkpoints de review).
3. **Implementação:** `test-driven-development` quando houver runner (backend já
   tem `go test`); `systematic-debugging` para qualquer bug antes de propor fix.
4. **Trabalho paralelo/isolado:** `using-git-worktrees` +
   `dispatching-parallel-agents` para features independentes.
5. **Decisões técnicas** (o "porquê") vão sempre para `docs/decisions.md`.
6. **Ao concluir:** `verification-before-completion` (rode os gates acima) e
   `requesting-code-review` antes de integrar.

## Gotchas

- **Hot-reload Windows + Docker:** bind-mount não propaga eventos de filesystem.
  Ao **adicionar arquivos novos** (rotas Next, código Go), rode
  `docker compose restart frontend` / `restart backend`. Editar arquivo
  existente o Next pega sozinho.
- `go.sum` / `package-lock.json` nascem no 1º build. Local: `go mod tidy` /
  `npm install`.
- Bucket MinIO é public-read (serve `<img>` direto); upload sempre via API
  (backend valida tipo/tamanho), browser nunca fala direto com o MinIO.
