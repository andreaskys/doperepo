-- Fluxo crítico de reserva. O service roda os 3 primeiros DENTRO de uma única
-- transação pgx:
--   1) LockVenueForBooking (FOR UPDATE) — serializa concorrentes no mesmo espaço
--   2) HasOverlappingBooking — checa disponibilidade já com o lock segurado
--   3) CreateBooking — insere (total no SQL; a EXCLUDE constraint é a rede de segurança)

-- name: LockVenueForBooking :one
-- Pessimistic lock: trava a linha do espaço até o fim da tx.
SELECT id, status, host_id FROM venues WHERE id = $1 FOR UPDATE;

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

-- name: GetBookingWithOwner :one
-- Autorização + estado: traz o host_id do venue junto.
SELECT b.id, b.venue_id, b.guest_id, b.status, v.host_id
FROM bookings b
JOIN venues v ON v.id = b.venue_id
WHERE b.id = $1;

-- name: ConfirmBooking :one
UPDATE bookings SET status = 'CONFIRMED'
WHERE id = $1 AND status = 'PENDING'
RETURNING *;

-- name: CancelBooking :one
UPDATE bookings SET status = 'CANCELLED'
WHERE id = $1 AND status <> 'CANCELLED'
RETURNING *;

-- name: ListBookingsByHost :many
SELECT b.id, b.venue_id, b.guest_id, b.start_date, b.end_date, b.total_price,
       b.status, b.created_at,
       v.title AS venue_title, v.city AS venue_city, v.state AS venue_state,
       u.name AS guest_name, u.email AS guest_email
FROM bookings b
JOIN venues v ON v.id = b.venue_id
JOIN users u ON u.id = b.guest_id
WHERE v.host_id = $1
ORDER BY b.created_at DESC;

-- name: GetBookingNotificationData :one
-- Fatos p/ montar o e-mail (parametrizado por reserva e destinatário).
SELECT v.title AS venue_title, b.start_date, b.end_date, b.total_price,
       u.name AS recipient_name, u.email AS recipient_email
FROM bookings b
JOIN venues v ON v.id = b.venue_id
JOIN users u ON u.id = @recipient_id
WHERE b.id = @booking_id;

-- name: HostRevenueSummary :one
SELECT
  COALESCE(SUM(b.total_price) FILTER (WHERE b.status = 'CONFIRMED'), 0)::numeric AS confirmed_revenue,
  COALESCE(SUM(b.total_price) FILTER (WHERE b.status = 'PENDING'),   0)::numeric AS pending_revenue,
  COUNT(*) FILTER (WHERE b.status = 'CONFIRMED') AS confirmed_count,
  COUNT(*) FILTER (WHERE b.status = 'PENDING')   AS pending_count,
  COUNT(*) FILTER (WHERE b.status = 'CANCELLED') AS cancelled_count,
  COUNT(*)                                       AS total_count
FROM bookings b
JOIN venues v ON v.id = b.venue_id
WHERE v.host_id = @host_id;

-- name: HostRevenueByMonth :many
SELECT
  date_trunc('month', b.start_date)::date AS month,
  COALESCE(SUM(b.total_price) FILTER (WHERE b.status = 'CONFIRMED'), 0)::numeric AS revenue
FROM bookings b
JOIN venues v ON v.id = b.venue_id
WHERE v.host_id = @host_id
  AND b.status <> 'CANCELLED'
  AND b.start_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
GROUP BY 1
ORDER BY 1;
