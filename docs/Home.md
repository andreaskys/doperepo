# 🏛️ Espaços — Vault do Projeto

MVP de aluguel de espaços para festas/eventos (modelo Airbnb).
Esta nota é o índice (MOC). O Claude lê estas notas pra ter contexto rápido.

## Mapa
- [[architecture]] — camadas, seam (`server.Deps`), árvore de pastas
- [[stack]] — serviços, portas, como rodar
- [[decisions]] — log de decisões técnicas (o porquê)
- [[mvp-checklist]] — escopo e status do MVP
- [[design]] — diretrizes de UI/animação

## Estado atual
Fundação no ar: infra (Postgres, Redis, RabbitMQ, MinIO, Mailpit, Adminer) +
conexões Go com arquitetura limpa. **Features ainda não implementadas.**

## Próximo passo
Escolher: **fluxo de reserva** (tx pgx: lock → check → insert) ou
**auth + sessão Redis**. Ver [[mvp-checklist]].
