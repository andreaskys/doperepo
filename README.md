# doperepo

Aplicação full-stack que roda localmente via Docker.

## Stack
Next.js (TypeScript) · Go · PostgreSQL · Redis · RabbitMQ · MinIO

## Pré-requisitos
- Docker e Docker Compose

## Como rodar
```bash
cp .env.example .env
docker compose up --build
```
Sobe banco, cache, fila, storage, API e front numa só tacada.

## Acessos (portas padrão)
| O quê | URL |
| --- | --- |
| App (front) | http://localhost:3000 |
| API | http://localhost:8080/health |
| Adminer (banco) | http://localhost:8081 |
| Mailpit (e-mails dev) | http://localhost:8025 |
| RabbitMQ | http://localhost:15672 |
| MinIO (console) | http://localhost:9001 |

Credenciais e nomes ficam no `.env` (ver `.env.example`).
Porta ocupada? Descomente/ajuste as variáveis `*_PORT` no `.env`.

## Testes (back-end)
```bash
docker compose exec backend go test ./...
```

## Notas
- As migrations rodam no primeiro start do Postgres.
- `go.sum` e `package-lock.json` nascem no primeiro build.
- Windows + Docker: ao adicionar arquivos novos, reinicie o container
  (`docker compose restart frontend` / `backend`).
