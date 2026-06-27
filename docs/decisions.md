# Log de Decisões

Por que cada escolha — não o que (o código já mostra o quê).

| Decisão | Escolha | Por quê |
| --- | --- | --- |
| Framework HTTP Go | **Gin** | net/http padrão → compatível com todo o ecossistema (SDKs, middlewares). Sem surpresas no MVP. |
| Acesso ao DB | **pgx + sqlc** | Controle total e explícito de tx + `SELECT FOR UPDATE`. Type-safe. Melhor fit pro requisito de concorrência. |
| Auth | **Sessão server-side no Redis** | Casa com "Redis para sessões". Logout/revogação imediata é trivial. |
| Anti-overbooking | **Lock pessimista + EXCLUDE constraint** | Lock serializa o check-then-insert; constraint `gist` é a rede de segurança no banco. Duas camadas. |
| Migrations | **initdb scripts (dev)** | DB nativo > migration tool no MVP. `golang-migrate` quando precisar de versionamento em prod. |
| Storage de fotos | **MinIO (S3-compat)** | Local via Docker; troca por S3/R2 em prod sem mudar código. Fecha o gap do upload. |
| E-mail dev | **Mailpit** | Captura e-mails do fluxo de notificação RabbitMQ em UI web, sem SMTP real. |
| Fotos do anúncio | **API→MinIO (multipart)** | Backend valida (tipo/tamanho) e grava; browser não fala direto com o MinIO. Bucket public-read p/ `<img>`. |
| Comodidades | **Coluna `text[]`** | Lista fixa no front/back. Sem tabelas de join até existir catálogo dinâmico com metadados. |
| Virar HOST | **Anunciar promove** | Criar o 1º anúncio promove GUEST→HOST (estilo Airbnb), sem passo separado. |
| `minio-go` | **v7.0.66** | v7.2.0 exige Go 1.25; pinado numa versão compatível com a imagem Go 1.23. |
| Notificações de reserva | **Evento na fila + worker, best-effort** | `bookings` publica `{type, booking_id, recipient_id}`; worker no pacote `notifications` busca, renderiza e envia via `net/smtp` (Mailpit). Best-effort: a reserva nunca falha pelo e-mail. Retry/DLQ/outbox quando entrega virar garantia. Ver spec `2026-06-26-notificacoes-design`. |

Contexto: [[architecture]] · [[mvp-checklist]]
