# 🏛️ Espaços — Vault do Projeto

MVP de aluguel de espaços para festas/eventos (modelo Airbnb).
Esta nota é o índice (MOC). O Claude lê estas notas pra ter contexto rápido.

## Mapa
- [[architecture]] — camadas, seam (`server.Deps`), árvore de pastas
- [[stack]] — serviços, portas, como rodar
- [[decisions]] — log de decisões técnicas (o porquê)
- [[mvp-checklist]] — escopo e status do MVP
- [[design]] — diretrizes de UI/animação
- [[plans/README|plans]] — planos de implementação executáveis (`writing-plans`/`executing-plans`)

## Estado atual
MVP funcional. Infra + auth/sessão Redis, CRUD de espaços com fotos (MinIO),
listagem pública com **busca/filtros**, **ciclo de reserva completo** (host
aprova/recusa, ambos cancelam), **notificações por e-mail** (RabbitMQ → worker
→ Mailpit, com retry/DLQ) e **notificações in-app** (sino no Dock com badge +
dropdown). Stack em TypeScript no front. Ver [[mvp-checklist]].

## Próximo passo
Pendências menores: cache Redis na listagem; e melhorias de robustez das
notificações (retry/DLQ). Ver [[mvp-checklist]].
