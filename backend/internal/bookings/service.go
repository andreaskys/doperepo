package bookings

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/doperepo/backend/internal/db/sqlc"
)

var (
	ErrVenueNotFound    = errors.New("espaço não encontrado")
	ErrNotBookable      = errors.New("espaço não está publicado para reserva")
	ErrInvalidDates     = errors.New("datas inválidas")
	ErrDatesUnavailable = errors.New("datas indisponíveis para este espaço")

	ErrBookingNotFound   = errors.New("reserva não encontrada")
	ErrNotAuthorized     = errors.New("ação não permitida")
	ErrInvalidTransition = errors.New("transição de estado inválida")
)

// Notifier é a porta best-effort de notificação (impl em internal/notifications).
type Notifier interface {
	BookingRequested(ctx context.Context, bookingID, recipientID int64)
	BookingConfirmed(ctx context.Context, bookingID, recipientID int64)
	BookingCancelled(ctx context.Context, bookingID, recipientID int64)
}

type Service struct {
	pool     *pgxpool.Pool
	q        *sqlc.Queries
	notifier Notifier
}

func NewService(pool *pgxpool.Pool, q *sqlc.Queries, notifier Notifier) *Service {
	return &Service{pool: pool, q: q, notifier: notifier}
}

// Create executa o fluxo CRÍTICO numa única transação com pessimistic lock:
// lock no espaço → checa overlap → insere. Duas reservas simultâneas para as
// mesmas datas: a 2ª espera o lock, vê a 1ª e é rejeitada (409).
func (s *Service) Create(ctx context.Context, venueID, guestID int64, start, end time.Time) (sqlc.Booking, error) {
	nights, err := validateStay(start, end, today())
	if err != nil {
		return sqlc.Booking{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return sqlc.Booking{}, err
	}
	defer tx.Rollback(ctx) // no-op após Commit

	q := s.q.WithTx(tx)

	// 1) trava a linha do espaço — serializa concorrentes neste venue
	venue, err := q.LockVenueForBooking(ctx, venueID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Booking{}, ErrVenueNotFound
	}
	if err != nil {
		return sqlc.Booking{}, err
	}
	if venue.Status != sqlc.VenueStatusPUBLISHED {
		return sqlc.Booking{}, ErrNotBookable
	}

	// 2) checa disponibilidade JÁ com o lock segurado
	overlaps, err := q.HasOverlappingBooking(ctx, sqlc.HasOverlappingBookingParams{
		VenueID:   venueID,
		StartDate: toDate(start),
		EndDate:   toDate(end),
	})
	if err != nil {
		return sqlc.Booking{}, err
	}
	if overlaps {
		return sqlc.Booking{}, ErrDatesUnavailable
	}

	// 3) insere — a EXCLUDE constraint (bookings_no_overlap) é a rede de segurança
	booking, err := q.CreateBooking(ctx, sqlc.CreateBookingParams{
		VenueID:   venueID,
		GuestID:   guestID,
		StartDate: toDate(start),
		EndDate:   toDate(end),
		Nights:    numeric(nights),
	})
	if err != nil {
		if isExclusionViolation(err) {
			return sqlc.Booking{}, ErrDatesUnavailable
		}
		return sqlc.Booking{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return sqlc.Booking{}, err
	}
	s.notifier.BookingRequested(ctx, booking.ID, venue.HostID)
	return booking, nil
}

func (s *Service) ListByGuest(ctx context.Context, guestID int64) ([]sqlc.ListBookingsByGuestRow, error) {
	return s.q.ListBookingsByGuest(ctx, guestID)
}

func (s *Service) BookedRanges(ctx context.Context, venueID int64) ([]sqlc.ListVenueBookedRangesRow, error) {
	return s.q.ListVenueBookedRanges(ctx, venueID)
}

// bookingAuth carrega só o necessário p/ decidir transições (puro/testável).
type bookingAuth struct {
	hostID  int64
	guestID int64
	status  sqlc.BookingStatus
}

func canConfirm(b bookingAuth, userID int64) error {
	if userID != b.hostID {
		return ErrNotAuthorized
	}
	if b.status != sqlc.BookingStatusPENDING {
		return ErrInvalidTransition
	}
	return nil
}

func canCancel(b bookingAuth, userID int64) error {
	if userID != b.hostID && userID != b.guestID {
		return ErrNotAuthorized
	}
	if b.status == sqlc.BookingStatusCANCELLED {
		return ErrInvalidTransition
	}
	return nil
}

// ListByHost: reservas recebidas nos espaços do host.
func (s *Service) ListByHost(ctx context.Context, hostID int64) ([]sqlc.ListBookingsByHostRow, error) {
	return s.q.ListBookingsByHost(ctx, hostID)
}

// Confirm: host confirma uma reserva PENDING.
func (s *Service) Confirm(ctx context.Context, bookingID, userID int64) (sqlc.Booking, error) {
	row, err := s.q.GetBookingWithOwner(ctx, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Booking{}, ErrBookingNotFound
	}
	if err != nil {
		return sqlc.Booking{}, err
	}
	if err := canConfirm(bookingAuth{hostID: row.HostID, guestID: row.GuestID, status: row.Status}, userID); err != nil {
		return sqlc.Booking{}, err
	}
	b, err := s.q.ConfirmBooking(ctx, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Booking{}, ErrInvalidTransition // estado mudou na corrida
	}
	if err != nil {
		return sqlc.Booking{}, err
	}
	s.notifier.BookingConfirmed(ctx, b.ID, row.GuestID)
	return b, nil
}

// Cancel: host ou convidado cancela (PENDING ou CONFIRMED).
func (s *Service) Cancel(ctx context.Context, bookingID, userID int64) (sqlc.Booking, error) {
	row, err := s.q.GetBookingWithOwner(ctx, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Booking{}, ErrBookingNotFound
	}
	if err != nil {
		return sqlc.Booking{}, err
	}
	if err := canCancel(bookingAuth{hostID: row.HostID, guestID: row.GuestID, status: row.Status}, userID); err != nil {
		return sqlc.Booking{}, err
	}
	b, err := s.q.CancelBooking(ctx, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Booking{}, ErrInvalidTransition
	}
	if err != nil {
		return sqlc.Booking{}, err
	}
	recipient := row.GuestID // host cancelou → avisa convidado
	if userID == row.GuestID {
		recipient = row.HostID // convidado cancelou → avisa host
	}
	s.notifier.BookingCancelled(ctx, b.ID, recipient)
	return b, nil
}

// validateStay valida o período e devolve o nº de diárias (puro/testável).
func validateStay(start, end, now time.Time) (int, error) {
	nights := int(end.Sub(start).Hours() / 24)
	if !end.After(start) || nights < 1 {
		return 0, ErrInvalidDates
	}
	if start.Before(now) {
		return 0, ErrInvalidDates
	}
	return nights, nil
}

func today() time.Time {
	n := time.Now().UTC()
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
}

func toDate(t time.Time) pgtype.Date { return pgtype.Date{Time: t, Valid: true} }

func numeric(n int) pgtype.Numeric {
	var v pgtype.Numeric
	_ = v.Scan(strconv.Itoa(n))
	return v
}

func isExclusionViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23P01" // exclusion_violation
}
