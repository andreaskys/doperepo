-- Fluxo crítico de reserva. O service roda os 3 primeiros DENTRO de uma única
-- transação pgx:
--   1) LockVenueForBooking (FOR UPDATE) — serializa concorrentes no mesmo espaço
--   2) HasOverlappingBooking — checa disponibilidade já com o lock segurado
--   3) CreateBooking — insere (total no SQL; a EXCLUDE constraint é a rede de segurança)

-- name: LockVenueForBooking :one
-- Pessimistic lock: trava a linha do espaço até o fim da tx.
SELECT id, status FROM venues WHERE id = $1 FOR UPDATE;

-- name: HasOverlappingBooking :one
SELECT EXISTS (
    SELECT 1 FROM bookings
    WHERE venue_id = @venue_id
      AND status <> 'CANCELLED'
      AND daterange(start_date, end_date, '[)') && daterange(@start_date::date, @end_date::date, '[)')
) AS overlaps;

-- name: CreateBooking :one
-- total = preço/dia × nº de diárias (@nights, calculado no Go).
INSERT INTO bookings (venue_id, guest_id, start_date, end_date, total_price, status)
VALUES (
    @venue_id, @guest_id, @start_date, @end_date,
    (SELECT price_per_day FROM venues WHERE id = @venue_id) * @nights,
    'PENDING'
)
RETURNING *;

-- name: ListBookingsByGuest :many
SELECT b.id, b.venue_id, b.guest_id, b.start_date, b.end_date, b.total_price, b.status, b.created_at,
       v.title AS venue_title, v.city AS venue_city, v.state AS venue_state
FROM bookings b
JOIN venues v ON v.id = b.venue_id
WHERE b.guest_id = $1
ORDER BY b.created_at DESC;

-- name: ListVenueBookedRanges :many
SELECT start_date, end_date FROM bookings
WHERE venue_id = $1 AND status <> 'CANCELLED'
ORDER BY start_date;
