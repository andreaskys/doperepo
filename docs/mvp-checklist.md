# Checklist do MVP

Status: ⬜ não começado · 🟡 parcial (fundação) · ✅ pronto

| # | Item | Status | Notas |
| --- | --- | --- | --- |
| 1 | Auth + roles (GUEST/HOST) | ✅ | register/login/logout/me + sessão Redis (cookie httpOnly) + bcrypt + `PATCH /me/role` (GUEST→HOST). CORS p/ o front. Páginas `/login` e `/signup`. |
| 2 | CRUD de Venues + upload de fotos | ✅ | CRUD completo + galeria MinIO (public-read), wizard multi-step (`/venues/new`), rascunho→publicar, comodidades (`text[]`), lat/lng, promoção GUEST→HOST ao anunciar. `/venues/mine` e edição. |
| 3 | Listagem + busca + cache Redis | 🟡 | Listagem pública pronta: `GET /public/venues` (publicados + foto de capa) + grid na home, Dock (React Bits) no topo, footer. Falta busca/filtros + cache Redis. |
| 4 | Fluxo de reserva (UI seleção de datas) | ⬜ | Front + endpoint. |
| 5 | **Concorrência (crítico)** | 🟡 | Schema + queries prontos: `bookings_no_overlap` + `LockVenueForBooking`. Falta a tx no use case. |

## Fundação já pronta (não é item de checklist, mas habilita tudo)
- Infra completa no compose ([[stack]])
- Conexões Go + `/health` + graceful shutdown ([[architecture]])
- Schema das 3 tabelas + trava anti-overbooking

## Próximo
Reserva (tx pgx) **ou** auth+sessão. Pendente de escolha.
