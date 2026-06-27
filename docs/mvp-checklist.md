# Checklist do MVP

Status: ⬜ não começado · 🟡 parcial (fundação) · ✅ pronto

| # | Item | Status | Notas |
| --- | --- | --- | --- |
| 1 | Auth + roles (GUEST/HOST) | ✅ | register/login/logout/me + sessão Redis (cookie httpOnly) + bcrypt + `PATCH /me/role` (GUEST→HOST). CORS p/ o front. Páginas `/login` e `/signup`. |
| 2 | CRUD de Venues + upload de fotos | ✅ | CRUD completo + galeria MinIO (public-read), wizard multi-step (`/venues/new`), rascunho→publicar, comodidades (`text[]`), lat/lng, promoção GUEST→HOST ao anunciar. `/venues/mine` e edição. |
| 3 | Listagem + busca + cache Redis | ✅ | **Busca/filtros**: `GET /public/venues` aceita `city` (case-insensitive), `min_capacity`, `max_price`, `q` (ILIKE título/descrição) e `amenities` (`@>`), combinando via AND; barra de filtros na home com estado na URL; índices em `0004`. **Cache Redis**: listagem sem filtros via cache-aside (chave `venues:public:list`, TTL 5min) + invalidação em publish/update/delete/foto; read-model `PublicVenue`. Buscas filtradas vão direto ao Postgres. |
| 4 | Fluxo de reserva (UI seleção de datas) | ✅ | Tela `/venues/:id/reservar` com **Stepper (React Bits)**, datas nativas, total calculado, `/reservas` (minhas reservas). Detalhe público + booked ranges. **Ciclo completo:** host confirma/recusa e vê as recebidas em `/reservas/recebidas`; host e convidado cancelam (PENDING/CONFIRMED), cancelar libera as datas. Endpoints `received`/`confirm`/`cancel` com autorização (404/403/409). Notificações por e-mail: próxima spec. |
| 5 | **Concorrência (crítico)** | ✅ | Tx pgx: `LockVenueForBooking` (FOR UPDATE) → `HasOverlappingBooking` → `CreateBooking`. **Provado:** 2 reservas paralelas → 1×201, 1×409. + EXCLUDE constraint como backstop. |

## Fundação já pronta (não é item de checklist, mas habilita tudo)
- Infra completa no compose ([[stack]])
- Conexões Go + `/health` + graceful shutdown ([[architecture]])
- Schema das 3 tabelas + trava anti-overbooking

## Próximo
Reserva (tx pgx) **ou** auth+sessão. Pendente de escolha.
