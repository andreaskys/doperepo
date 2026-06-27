# Planos

Planos de implementação executáveis, um arquivo `.md` por feature. Escritos com a
skill `writing-plans` e executados com `executing-plans` — assim um plano
sobrevive entre sessões e tem checkpoints de review.

## Convenção

- Nome: `NNN-slug.md` (ex.: `001-busca-filtros-cache-redis.md`)
- Cada plano: objetivo, contexto/links pro vault, passos verificáveis, critérios
  de aceite (com os comandos de verificação do `CLAUDE.md`).
- Decisões de **porquê** continuam indo para `docs/decisions.md`, não aqui.

## Status

_Nenhum plano ainda._ Candidato natural ao primeiro: **item 3 do MVP** —
busca/filtros + cache Redis na listagem pública (ver `docs/mvp-checklist.md`).
