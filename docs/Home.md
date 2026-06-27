# 🏛️ Espaços — Vault do Projeto

MVP de aluguel de espaços para festas/eventos (modelo Airbnb).
Esta nota é o índice (MOC). O Claude lê estas notas pra ter contexto rápido.

## Mapa
- [[architecture]] — camadas, seam (`server.Deps`), rotas, fluxos críticos
- [[structure]] — mapa do repo (back+front), por feature, fluxo de request
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

## Histórico (specs → planos)
Cada feature tem spec (design) e plano (execução TDD) em `docs/superpowers/`:
busca/filtros · cache Redis · ciclo de reserva · notificações (e-mail) ·
retry/DLQ · notificações in-app + sino. São o registro de **o quê** e **porquê**
de cada entrega — leia antes de mexer numa feature.

## Próximo passo
MVP completo + extras (cache, retry/DLQ, sino in-app). Pendências anotadas como
futuro: tempo real (SSE) no sino, testes de frontend, reset de senha,
paginação/ordenação na busca. Ver [[mvp-checklist]].
