# Stack & Como Rodar

## Rodar
```bash
cp .env.example .env
docker compose up --build
```

## Serviços (portas no host)
| Serviço   | Porta(s)      | URL / uso                          |
| --------- | ------------- | ---------------------------------- |
| backend   | 8080          | http://localhost:8080/health       |
| frontend  | 3000          | http://localhost:3000              |
| postgres  | 5432          | DB principal                       |
| redis     | 6379          | sessões + cache de disponibilidade |
| rabbitmq  | 5672 / 15672  | broker / UI em :15672              |
| minio     | 9000 / 9001   | storage S3 de fotos / console :9001|
| mailpit   | 1025 / 8025   | SMTP dev / inbox web em :8025      |
| adminer   | 8081          | UI do Postgres                     |

## Tech
- **Front:** Next.js + React + **TypeScript** (strict) — design em [[design]]
- **Back:** Go + Gin, pgx/sqlc — ver [[architecture]]
- **DB:** PostgreSQL · **Cache:** Redis · **Fila:** RabbitMQ

`go.sum`/`package-lock.json` nascem no 1º build. Local: `go mod tidy` /
`npm install`. Decisões de stack em [[decisions]].

> ⚠️ **Hot-reload no Windows+Docker:** o bind-mount não propaga eventos de
> filesystem (inotify). Ao **adicionar arquivos novos** (rotas Next, código Go),
> rode `docker compose restart frontend` / `restart backend` pra serem vistos.
> Edição de arquivo existente o Next pega; arquivo novo não.
