# Checklist do MVP

Status: ⬜ não começado · 🟡 parcial (fundação) · ✅ pronto

| # | Item | Status | Notas |
| --- | --- | --- | --- |
| 1 | Auth + roles (GUEST/HOST) | ✅ | register/login/logout/me + sessão Redis (cookie httpOnly) + bcrypt + `PATCH /me/role` (GUEST→HOST). CORS p/ o front. Páginas `/login` e `/signup`. |
| 2 | CRUD de Venues + upload de fotos | ✅ | CRUD completo + galeria MinIO (public-read), wizard multi-step (`/venues/new`), rascunho→publicar, comodidades (`text[]`), lat/lng, promoção GUEST→HOST ao anunciar. `/venues/mine` e edição. |
| 3 | Listagem + busca + cache Redis | ✅ | **Busca/filtros**: `GET /public/venues` aceita `city`, `state`, `min_capacity`, `max_price`, `min_price`, `q`, `amenities` e **disponibilidade por datas** (`start`/`end` → exclui reservas não-canceladas sobrepostas), tudo AND. **Barra reformulada** (Localização cidade/UF · Data entrada/saída · Valor faixa mín–máx com **ElasticSlider** portado do React Bits pra TS+CSS). **Cache Redis**: listagem sem filtros via cache-aside (TTL 5min) + invalidação; buscas filtradas vão ao Postgres. |
| 4 | Fluxo de reserva (UI seleção de datas) | ✅ | Tela `/venues/:id/reservar` com **Stepper (React Bits)**, datas nativas, total calculado, `/reservas` (minhas reservas). Detalhe público + booked ranges. **Ciclo completo:** host confirma/recusa e vê as recebidas em `/reservas/recebidas`; host e convidado cancelam (PENDING/CONFIRMED), cancelar libera as datas. Endpoints `received`/`confirm`/`cancel` com autorização (404/403/409). Notificações por e-mail: próxima spec. |
| 5 | **Concorrência (crítico)** | ✅ | Tx pgx: `LockVenueForBooking` (FOR UPDATE) → `HasOverlappingBooking` → `CreateBooking`. **Provado:** 2 reservas paralelas → 1×201, 1×409. + EXCLUDE constraint como backstop. |

## Fundação já pronta (não é item de checklist, mas habilita tudo)
- Infra completa no compose ([[stack]])
- Conexões Go + `/health` + graceful shutdown ([[architecture]])
- Schema das 3 tabelas + trava anti-overbooking

## Pós-MVP entregue (extras)
- ✅ **Migração TypeScript** do frontend (strict) + `CLAUDE.md` e fluxo superpowers
- ✅ **Ciclo de reserva completo** — host confirma/recusa, ambos cancelam, `/reservas/recebidas`
- ✅ **Notificações por e-mail** (RabbitMQ → worker → Mailpit) com **retry 3× + DLQ**
- ✅ **Notificações in-app** — sino no Dock (badge, painel animado, limpar tudo)
- ✅ **Cache Redis** da listagem (cache-aside + invalidação)
- ✅ **Seed de QA** (`scripts/seed-qa.sh`) com contas, espaços, reservas e capas
- ✅ **Endereço + mapa** no anúncio (rua/bairro/cidade/UF/complemento + Leaflet) e **busca por CEP** (ViaCEP autofill)
- ✅ **Perfil & conta (Fase A)** — `/perfil` no Dock: cabeçalho (avatar/role/membro-desde/bio), editar conta (nome/bio, upload de foto, trocar senha) e preview dos anúncios. Backend: `bio`/`avatar_url` + `PATCH /me`, `POST /me/avatar`, `POST /me/password`
- ✅ **Dashboard financeiro (Fase B)** — resumo do host no `/perfil`: cards de KPI (receita confirmada/pendente, reservas, ticket médio, espaços) com count-up + gráfico de receita por mês (SVG/CSS animado). Backend: `GET /host/metrics` (agregação SQL)
- ✅ **Perfil com sidebar** — `/perfil` reorganizado em menu lateral (Bio · Dashboard · Anúncios · Conta), aba sincronizada com o hash da URL, troca de seção animada + responsivo (abas horizontais no mobile)
- ✅ **Carrossel hero na home** — banner no topo passando as capas dos anúncios publicados (autoplay 5s/crossfade, pausa no hover, dots/setas, chip clicável → reservar), com fallback pro hero de texto e respeito a `prefers-reduced-motion`
- ✅ **Landing imersiva (intro)** — experiência mostrada **sempre** pra quem está deslogado (gate por login via `/auth/me`; logado vai direto pro `AppHome`). Botão "Ver anúncios" pula a animação rolando até os anúncios. **F1**: landing full-bleed com carrossel de fundo + Dock escondido. **F2**: endpoint `GET /public/photos`, **HeroParallax portado pra CSS puro** (fotos dos espaços), 3 cenas "como funciona". **F3**: app (busca/grid) **inline** no fim; ao rolar até ele o **Dock cai do topo** (`useInView` → `DockReveal`), grava `intro_seen` e o app funciona normal. Logado/retornante vai direto pro `AppHome`. Tudo respeita `prefers-reduced-motion`.

Cada um tem spec+plano em `docs/superpowers/`.

## Futuro (anotado, fora de escopo até aqui)
Tempo real (SSE) no sino · testes de frontend · reset de senha/verificação de
e-mail · paginação/ordenação na busca · cache de buscas filtradas · re-drive da DLQ.
