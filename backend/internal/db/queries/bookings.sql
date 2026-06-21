-- Primitivos do fluxo crítico de reserva. O use case roda os três dentro de uma
-- única transação pgx:
--   1) LockVenueForBooking  (SELECT ... FOR UPDATE) — serializa concorrentes
--   2) HasOverlappingBooking — confere disponibilidade já com o lock segurado
--   3) CreateBooking — insere (a exclusion constraint é a rede de segurança)

-- name: LockVenueForBooking :one
-- Pessimistic lock: chame DENTRO de uma tx para serializar tentativas
-- concorrentes de reserva do mesmo espaço antes de checar disponibilidade.
SELECT id, price_per_day FROM venues WHERE id = $1 FOR UPDATE;

-- name: HasOverlappingBooking :one
SELECT EXISTS (
    SELECT 1 FROM bookings
    WHERE venue_id = @venue_id
      AND status <> 'CANCELLED'
      AND daterange(start_date, end_date, '[)') && daterange(@start_date::date, @end_date::date, '[)')
) AS overlaps;

-- name: CreateBooking :one
INSERT INTO bookings (venue_id, guest_id, start_date, end_date, total_price, status)
VALUES ($1, $2, $3, $4, $5, 'PENDING')
RETURNING *;
