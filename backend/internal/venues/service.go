package venues

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/doperepo/backend/internal/db/sqlc"
	"github.com/doperepo/backend/internal/platform/storage"
)

const maxPhotos = 10

var (
	ErrNotFound           = errors.New("anúncio não encontrado")
	ErrStorageUnavailable = errors.New("storage de fotos indisponível")
	ErrInvalidAmenity     = errors.New("comodidade inválida")
	ErrInvalidPrice       = errors.New("preço inválido")
	ErrTooManyPhotos      = errors.New("limite de fotos atingido")
)

// allowedAmenities espelha a lista do front. ponytail: lista fixa em código,
// sem tabelas de catálogo até existir metadado por comodidade.
var allowedAmenities = map[string]bool{
	"wifi": true, "estacionamento": true, "som": true, "cozinha": true,
	"piscina": true, "ar_condicionado": true, "acessibilidade": true,
	"mesas_cadeiras": true, "banheiros": true, "gerador": true,
	"churrasqueira": true, "palco": true,
}

type Service struct {
	q     *sqlc.Queries
	store *storage.Client // pode ser nil se o MinIO não subiu
}

func NewService(q *sqlc.Queries, store *storage.Client) *Service {
	return &Service{q: q, store: store}
}

type VenueInput struct {
	Title       string
	Description string
	Capacity    int32
	Price       string
	Address     string
	City        string
	State       string
	Latitude    *float64
	Longitude   *float64
	Amenities   []string
}

func (s *Service) Create(ctx context.Context, hostID int64, in VenueInput) (sqlc.Venue, error) {
	price, err := parsePrice(in.Price)
	if err != nil {
		return sqlc.Venue{}, err
	}
	if err := validateAmenities(in.Amenities); err != nil {
		return sqlc.Venue{}, err
	}
	return s.q.CreateVenue(ctx, sqlc.CreateVenueParams{
		HostID:      hostID,
		Title:       in.Title,
		Description: in.Description,
		Capacity:    in.Capacity,
		PricePerDay: price,
		Address:     in.Address,
		City:        in.City,
		State:       in.State,
		Latitude:    in.Latitude,
		Longitude:   in.Longitude,
		Amenities:   orEmpty(in.Amenities),
	})
}

func (s *Service) Update(ctx context.Context, id int64, in VenueInput) (sqlc.Venue, error) {
	price, err := parsePrice(in.Price)
	if err != nil {
		return sqlc.Venue{}, err
	}
	if err := validateAmenities(in.Amenities); err != nil {
		return sqlc.Venue{}, err
	}
	return s.q.UpdateVenue(ctx, sqlc.UpdateVenueParams{
		ID:          id,
		Title:       in.Title,
		Description: in.Description,
		Capacity:    in.Capacity,
		PricePerDay: price,
		Address:     in.Address,
		City:        in.City,
		State:       in.State,
		Latitude:    in.Latitude,
		Longitude:   in.Longitude,
		Amenities:   orEmpty(in.Amenities),
	})
}

func (s *Service) Get(ctx context.Context, id int64) (sqlc.Venue, error) {
	v, err := s.q.GetVenueByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, ErrNotFound
	}
	return v, err
}

func (s *Service) ListByHost(ctx context.Context, hostID int64) ([]sqlc.Venue, error) {
	return s.q.ListVenuesByHost(ctx, hostID)
}

// ListPublished é a listagem pública da home (apenas publicados).
// ponytail: sem cache ainda. O cache Redis do item #3 entra quando o tráfego pedir.
func (s *Service) ListPublished(ctx context.Context) ([]sqlc.ListPublishedVenuesRow, error) {
	return s.q.ListPublishedVenues(ctx)
}

func (s *Service) Publish(ctx context.Context, id int64) (sqlc.Venue, error) {
	return s.q.PublishVenue(ctx, id)
}

func (s *Service) Photos(ctx context.Context, venueID int64) ([]sqlc.VenuePhoto, error) {
	return s.q.ListVenuePhotos(ctx, venueID)
}

// EnsureHost promove o usuário a HOST (idempotente) — chamado ao criar o 1º anúncio.
func (s *Service) EnsureHost(ctx context.Context, userID int64) error {
	_, err := s.q.UpdateUserRole(ctx, sqlc.UpdateUserRoleParams{ID: userID, Role: sqlc.UserRoleHOST})
	return err
}

// Delete remove o anúncio e as fotos do MinIO (best-effort; as linhas caem por cascade).
func (s *Service) Delete(ctx context.Context, id int64) error {
	if s.store != nil {
		if keys, err := s.q.ListVenuePhotoKeys(ctx, id); err == nil {
			for _, k := range keys {
				_ = s.store.Delete(ctx, k)
			}
		}
	}
	return s.q.DeleteVenue(ctx, id)
}

// AddPhoto sobe o arquivo no MinIO e registra a linha (posição = nº atual de fotos).
func (s *Service) AddPhoto(ctx context.Context, venueID int64, key, contentType string, r io.Reader, size int64) (sqlc.VenuePhoto, error) {
	if s.store == nil {
		return sqlc.VenuePhoto{}, ErrStorageUnavailable
	}
	existing, err := s.q.ListVenuePhotos(ctx, venueID)
	if err != nil {
		return sqlc.VenuePhoto{}, err
	}
	if len(existing) >= maxPhotos {
		return sqlc.VenuePhoto{}, ErrTooManyPhotos
	}
	url, err := s.store.Upload(ctx, key, contentType, r, size)
	if err != nil {
		return sqlc.VenuePhoto{}, err
	}
	return s.q.AddVenuePhoto(ctx, sqlc.AddVenuePhotoParams{
		VenueID:   venueID,
		ObjectKey: key,
		Url:       url,
		Position:  int32(len(existing)),
	})
}

// DeletePhoto remove a foto (verifica que pertence à venue informada).
func (s *Service) DeletePhoto(ctx context.Context, venueID, photoID int64) error {
	photo, err := s.q.GetVenuePhoto(ctx, photoID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && photo.VenueID != venueID) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if s.store != nil {
		_ = s.store.Delete(ctx, photo.ObjectKey)
	}
	return s.q.DeleteVenuePhoto(ctx, photoID)
}

func parsePrice(s string) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	if f, err := strconv.ParseFloat(s, 64); err != nil || f < 0 {
		return n, ErrInvalidPrice
	}
	if err := n.Scan(s); err != nil {
		return n, fmt.Errorf("%w: %v", ErrInvalidPrice, err)
	}
	return n, nil
}

func validateAmenities(a []string) error {
	for _, x := range a {
		if !allowedAmenities[x] {
			return fmt.Errorf("%w: %s", ErrInvalidAmenity, x)
		}
	}
	return nil
}

func orEmpty(a []string) []string {
	if a == nil {
		return []string{} // coluna é NOT NULL DEFAULT '{}'
	}
	return a
}
