package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	goredis "github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/doperepo/backend/internal/db/sqlc"
)

// ponytail: TTL fixo de sessão e prefixo de chave. Vira config quando alguém
// precisar de TTLs diferentes por papel/dispositivo.
const (
	sessionTTL    = 7 * 24 * time.Hour
	sessionPrefix = "session:"
)

var (
	ErrEmailTaken   = errors.New("e-mail já cadastrado")
	ErrInvalidLogin = errors.New("credenciais inválidas")
)

type Service struct {
	q     *sqlc.Queries
	redis *goredis.Client
}

func NewService(q *sqlc.Queries, r *goredis.Client) *Service {
	return &Service{q: q, redis: r}
}

// Register cria um GUEST, abre sessão e retorna (user, token de sessão).
func (s *Service) Register(ctx context.Context, name, email, password string) (sqlc.User, string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return sqlc.User{}, "", fmt.Errorf("hash senha: %w", err)
	}
	user, err := s.q.CreateUser(ctx, sqlc.CreateUserParams{
		Name:         name,
		Email:        email,
		PasswordHash: string(hash),
		Role:         sqlc.UserRoleGUEST,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return sqlc.User{}, "", ErrEmailTaken
		}
		return sqlc.User{}, "", err
	}
	token, err := s.newSession(ctx, user.ID)
	return user, token, err
}

// Login verifica credenciais (mensagem genérica — não revela se o e-mail existe).
func (s *Service) Login(ctx context.Context, email, password string) (sqlc.User, string, error) {
	user, err := s.q.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlc.User{}, "", ErrInvalidLogin
		}
		return sqlc.User{}, "", err
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return sqlc.User{}, "", ErrInvalidLogin
	}
	token, err := s.newSession(ctx, user.ID)
	return user, token, err
}

func (s *Service) Logout(ctx context.Context, token string) error {
	return s.redis.Del(ctx, sessionPrefix+token).Err()
}

// UserFromSession resolve o token no usuário atual (redis.Nil = sessão inválida).
func (s *Service) UserFromSession(ctx context.Context, token string) (sqlc.User, error) {
	id, err := s.redis.Get(ctx, sessionPrefix+token).Int64()
	if err != nil {
		return sqlc.User{}, err
	}
	return s.q.GetUserByID(ctx, id)
}

func (s *Service) SetRole(ctx context.Context, id int64, role sqlc.UserRole) (sqlc.User, error) {
	return s.q.UpdateUserRole(ctx, sqlc.UpdateUserRoleParams{ID: id, Role: role})
}

func (s *Service) newSession(ctx context.Context, userID int64) (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	if err := s.redis.Set(ctx, sessionPrefix+token, userID, sessionTTL).Err(); err != nil {
		return "", err
	}
	return token, nil
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
