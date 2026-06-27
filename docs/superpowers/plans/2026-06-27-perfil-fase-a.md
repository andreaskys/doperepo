# Perfil & conta (Fase A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma tela de Perfil (`/perfil`, item no Dock) onde o usuário vê seus dados, edita a conta (nome, bio, foto, senha) e vê um preview dos seus anúncios.

**Architecture:** Backend Go estende o pacote `auth` (mesma identidade/sessão): nova migration adiciona `bio`/`avatar_url` em `users`; `auth.Service` ganha `storage` injetado e métodos de perfil; 3 rotas novas atrás de `RequireAuth`. Frontend: tipo `User` + `ProfileAPI` em `lib.ts`, página `/perfil` (client), item no Dock que alterna Perfil↔Entrar conforme login.

**Tech Stack:** Go + Gin + sqlc + pgx, MinIO (storage), bcrypt; Next.js 15 + React 19 + TypeScript strict, `motion/react`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-27-perfil-fase-a-design.md` (fonte da verdade).
- **Escopo editável:** nome, bio, foto, **senha** (atual+nova). E-mail é só-leitura. Sem trocar e-mail, sem excluir conta, sem remover avatar (Fase B+/futuro).
- **Avatar:** reusa `storage.Client` e a validação das fotos de venue — content-type em `{image/jpeg→.jpg, image/png→.png, image/webp→.webp}`, máximo **5MB**. Bucket é public-read: `avatar_url` guarda a **URL pública completa** (igual fotos de venue), usada direto em `<img src>`.
- **Migration:** arquivos em `backend/migrations/` rodam só no initdb. Para **não recriar o DB de QA**, aplicar a 0008 **manualmente** no Postgres em execução (psql), além de versionar o arquivo.
- **sqlc:** após editar `.sql`, rodar `sqlc generate` a partir de `./backend` (binário em `$(go env GOPATH)/bin/sqlc`) e **`git add internal/db/sqlc/`** (models.go, db.go, users.sql.go).
- **Design/animação (`docs/design.md`):** paleta `--brand-gradient` (roxo→azul); durações <300ms, só `transform`/`opacity`, nunca `transition: all` nem `ease-in`; respeitar `prefers-reduced-motion` (via `useReducedMotion`).
- **Regra de navegação (memória do usuário):** toda opção de menu vive **dentro do Dock** do topo — nada flutuante. `.site-nav` tem `pointer-events:none`; painéis precisam de `pointer-events:auto`.
- **Gates:** backend `docker compose exec -T backend go test ./...`; frontend (em `frontend/`) `npm run typecheck` e `npm run build`. Nunca afirmar "pronto" sem rodar o gate e ver a saída.

---

### Task 1: Schema + queries + sqlc regen

**Files:**
- Create: `backend/migrations/0008_user_profile.sql`
- Modify: `backend/internal/db/queries/users.sql`
- Regenerate: `backend/internal/db/sqlc/{models.go,users.sql.go}` (via `sqlc generate`)

**Interfaces:**
- Produces (consumido pela Task 2): `sqlc.User` ganha campos `Bio string`, `AvatarUrl string`; e os métodos:
  - `q.UpdateUserProfile(ctx, sqlc.UpdateUserProfileParams{ID int64, Name string, Bio string}) (sqlc.User, error)`
  - `q.UpdateUserAvatar(ctx, sqlc.UpdateUserAvatarParams{ID int64, AvatarUrl string}) (sqlc.User, error)`
  - `q.UpdateUserPassword(ctx, sqlc.UpdateUserPasswordParams{ID int64, PasswordHash string}) error`

- [ ] **Step 1: Criar a migration**

`backend/migrations/0008_user_profile.sql`:
```sql
ALTER TABLE users
    ADD COLUMN bio        TEXT NOT NULL DEFAULT '',
    ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
```

- [ ] **Step 2: Aplicar a migration no DB de QA em execução (preserva os dados)**

Run (na raiz, com o compose no ar):
```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';"
```
Expected: `ALTER TABLE`. (Se `$POSTGRES_USER`/`$POSTGRES_DB` não estiverem no shell, leia-os do `.env`.)

- [ ] **Step 3: Adicionar as queries**

Acrescentar ao final de `backend/internal/db/queries/users.sql`:
```sql
-- name: UpdateUserProfile :one
UPDATE users SET name = @name, bio = @bio WHERE id = @id RETURNING *;

-- name: UpdateUserAvatar :one
UPDATE users SET avatar_url = @avatar_url WHERE id = @id RETURNING *;

-- name: UpdateUserPassword :exec
UPDATE users SET password_hash = @password_hash WHERE id = @id;
```

- [ ] **Step 4: Regerar o sqlc**

Run (a partir de `backend/`):
```bash
"$(go env GOPATH)/bin/sqlc" generate
```
Expected: sem erros; `git status` mostra `internal/db/sqlc/models.go` e `internal/db/sqlc/users.sql.go` modificados.

- [ ] **Step 5: Verificar que compila**

Run:
```bash
docker compose exec -T backend go build ./...
```
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/0008_user_profile.sql backend/internal/db/queries/users.sql backend/internal/db/sqlc/
git commit -m "feat(perfil): schema bio/avatar_url + queries de perfil"
```

---

### Task 2: `auth.Service` — métodos de perfil + validação de senha (unit)

**Files:**
- Modify: `backend/internal/auth/auth.go`
- Create: `backend/internal/auth/profile_test.go`

**Interfaces:**
- Consumes (da Task 1): `q.UpdateUserProfile`, `q.UpdateUserAvatar`, `q.UpdateUserPassword`, `sqlc.User{Bio,AvatarUrl}`.
- Consumes (existente): `storage.Client.Upload(ctx, key, contentType string, r io.Reader, size int64) (string, error)`; `s.q.GetUserByID(ctx, id) (sqlc.User, error)`; `bcrypt`.
- Produces (consumido pela Task 3):
  - `NewService(q *sqlc.Queries, r *goredis.Client, store *storage.Client) *Service` (assinatura nova — `store` pode ser nil)
  - `(s *Service) UpdateProfile(ctx, id int64, name, bio string) (sqlc.User, error)`
  - `(s *Service) UploadAvatar(ctx, id int64, key, contentType string, r io.Reader, size int64) (sqlc.User, error)`
  - `(s *Service) ChangePassword(ctx, id int64, current, next string) error`
  - errors exportados: `ErrWrongPassword`, `ErrWeakPassword`, `ErrStorageUnavailable`
  - helper puro: `validateNewPassword(s string) error`

- [ ] **Step 1: Escrever o teste que falha (validação da nova senha)**

`backend/internal/auth/profile_test.go`:
```go
package auth

import "testing"

func TestValidateNewPassword(t *testing.T) {
	if err := validateNewPassword("12345678"); err != nil {
		t.Fatalf("8 chars deveria passar, veio: %v", err)
	}
	if err := validateNewPassword("1234567"); err == nil {
		t.Fatal("7 chars deveria falhar")
	}
	if err := validateNewPassword(""); err == nil {
		t.Fatal("vazio deveria falhar")
	}
}
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run:
```bash
docker compose exec -T backend go test ./internal/auth/ -run TestValidateNewPassword -v
```
Expected: FAIL — `undefined: validateNewPassword`.

- [ ] **Step 3: Implementar os erros, o helper e os métodos**

Em `backend/internal/auth/auth.go`:

3a. Adicionar aos imports (bloco `import (...)`): `"io"` e o pacote de storage `"github.com/doperepo/backend/internal/platform/storage"`.

3b. Acrescentar aos `var (...)` de erros:
```go
	ErrWrongPassword      = errors.New("senha atual incorreta")
	ErrWeakPassword       = errors.New("a nova senha precisa ter ao menos 8 caracteres")
	ErrStorageUnavailable = errors.New("armazenamento indisponível")
```

3c. Trocar o struct e o construtor:
```go
type Service struct {
	q     *sqlc.Queries
	redis *goredis.Client
	store *storage.Client // pode ser nil se o MinIO não subiu
}

func NewService(q *sqlc.Queries, r *goredis.Client, store *storage.Client) *Service {
	return &Service{q: q, redis: r, store: store}
}
```

3d. Adicionar ao final do arquivo:
```go
func validateNewPassword(s string) error {
	if len(s) < 8 {
		return ErrWeakPassword
	}
	return nil
}

// UpdateProfile altera nome e bio do usuário.
func (s *Service) UpdateProfile(ctx context.Context, id int64, name, bio string) (sqlc.User, error) {
	return s.q.UpdateUserProfile(ctx, sqlc.UpdateUserProfileParams{ID: id, Name: name, Bio: bio})
}

// UploadAvatar envia a imagem ao storage e grava a URL pública no usuário.
func (s *Service) UploadAvatar(ctx context.Context, id int64, key, contentType string, r io.Reader, size int64) (sqlc.User, error) {
	if s.store == nil {
		return sqlc.User{}, ErrStorageUnavailable
	}
	url, err := s.store.Upload(ctx, key, contentType, r, size)
	if err != nil {
		return sqlc.User{}, err
	}
	return s.q.UpdateUserAvatar(ctx, sqlc.UpdateUserAvatarParams{ID: id, AvatarUrl: url})
}

// ChangePassword confere a senha atual via bcrypt e grava o novo hash.
func (s *Service) ChangePassword(ctx context.Context, id int64, current, next string) error {
	if err := validateNewPassword(next); err != nil {
		return err
	}
	user, err := s.q.GetUserByID(ctx, id)
	if err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(current)) != nil {
		return ErrWrongPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(next), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash senha: %w", err)
	}
	return s.q.UpdateUserPassword(ctx, sqlc.UpdateUserPasswordParams{ID: id, PasswordHash: string(hash)})
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run:
```bash
docker compose exec -T backend go test ./internal/auth/ -run TestValidateNewPassword -v
```
Expected: PASS. (O pacote `auth` ainda não compila no `server` — o construtor mudou; será corrigido na Task 3. `go test ./internal/auth/` compila o pacote isolado e passa.)

- [ ] **Step 5: Commit**

```bash
git add backend/internal/auth/auth.go backend/internal/auth/profile_test.go
git commit -m "feat(perfil): auth.Service ganha UpdateProfile/UploadAvatar/ChangePassword"
```

---

### Task 3: Handler — rotas + DTO + wiring no server

**Files:**
- Modify: `backend/internal/auth/handler.go`
- Modify: `backend/internal/server/server.go:42`

**Interfaces:**
- Consumes (da Task 2): `svc.UpdateProfile`, `svc.UploadAvatar`, `svc.ChangePassword`, `ErrWrongPassword`, `ErrWeakPassword`, `ErrStorageUnavailable`, `NewService(q, redis, store)`.
- Produces (HTTP): `PATCH /api/v1/me`, `POST /api/v1/me/avatar`, `POST /api/v1/me/password`; `GET /api/v1/auth/me` passa a retornar `bio`, `avatar_url`, `created_at`.

- [ ] **Step 1: Estender o DTO e adicionar formatação de timestamp**

Em `backend/internal/auth/handler.go`:

1a. Imports: adicionar `"time"` ao bloco `import (...)`. Para o upload, adicionar também `"crypto/rand"`, `"encoding/hex"` e `"fmt"`.

1b. Trocar o DTO e o `publicUser`:
```go
// publicUser nunca expõe o password_hash.
type publicUserDTO struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	Bio       string `json:"bio"`
	AvatarURL string `json:"avatar_url"`
	CreatedAt string `json:"created_at"`
}

func publicUser(u sqlc.User) publicUserDTO {
	return publicUserDTO{
		ID: u.ID, Name: u.Name, Email: u.Email, Role: string(u.Role),
		Bio: u.Bio, AvatarURL: u.AvatarUrl, CreatedAt: tsStr(u.CreatedAt),
	}
}

func tsStr(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.Format(time.RFC3339)
}
```

1c. Como `tsStr` usa `pgtype.Timestamptz`, adicionar ao import: `"github.com/jackc/pgx/v5/pgtype"`.

- [ ] **Step 2: Registrar as rotas**

No método `Routes`, após a linha `rg.PATCH("/me/role", h.RequireAuth(), h.setRole)`:
```go
	rg.PATCH("/me", h.RequireAuth(), h.updateProfile)
	rg.POST("/me/avatar", h.RequireAuth(), h.uploadAvatar)
	rg.POST("/me/password", h.RequireAuth(), h.changePassword)
```

- [ ] **Step 3: Implementar os 3 handlers**

Adicionar em `handler.go` (perto do `setRole`):
```go
const maxAvatarBytes = 5 << 20 // 5MB

var allowedAvatarTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

type updateProfileReq struct {
	Name string `json:"name" binding:"required,min=2"`
	Bio  string `json:"bio"`
}

func (h *Handler) updateProfile(c *gin.Context) {
	var req updateProfileReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user, err := h.svc.UpdateProfile(c.Request.Context(), currentUser(c).ID, req.Name, req.Bio)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao salvar perfil"})
		return
	}
	c.JSON(http.StatusOK, publicUser(user))
}

func (h *Handler) uploadAvatar(c *gin.Context) {
	fh, err := c.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "envie o arquivo no campo 'avatar'"})
		return
	}
	if fh.Size > maxAvatarBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "imagem acima de 5MB"})
		return
	}
	ct := fh.Header.Get("Content-Type")
	ext, ok := allowedAvatarTypes[ct]
	if !ok {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "use jpg, png ou webp"})
		return
	}
	f, err := fh.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao ler arquivo"})
		return
	}
	defer f.Close()

	id := currentUser(c).ID
	key := fmt.Sprintf("avatars/%d/%s%s", id, randHex(), ext)
	user, err := h.svc.UploadAvatar(c.Request.Context(), id, key, ct, f, fh.Size)
	switch {
	case errors.Is(err, ErrStorageUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao enviar imagem"})
		return
	}
	c.JSON(http.StatusOK, publicUser(user))
}

type changePasswordReq struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=8"`
}

func (h *Handler) changePassword(c *gin.Context) {
	var req changePasswordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	err := h.svc.ChangePassword(c.Request.Context(), currentUser(c).ID, req.CurrentPassword, req.NewPassword)
	switch {
	case errors.Is(err, ErrWrongPassword):
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	case errors.Is(err, ErrWeakPassword):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao trocar senha"})
		return
	}
	c.Status(http.StatusNoContent)
}

func randHex() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
```

- [ ] **Step 4: Atualizar o wiring no server**

Em `backend/internal/server/server.go:42`, trocar:
```go
	authH := auth.NewHandler(auth.NewService(queries, deps.Redis), secure)
```
por:
```go
	authH := auth.NewHandler(auth.NewService(queries, deps.Redis, deps.Storage), secure)
```

- [ ] **Step 5: Build + testes do backend**

Run:
```bash
docker compose exec -T backend go build ./... && docker compose exec -T backend go test ./...
```
Expected: build ok; testes passam (inclui `TestValidateNewPassword`).

- [ ] **Step 6: Smoke das 3 rotas (preserva QA)**

Reinicia o backend pra carregar o novo binário e roda o fluxo com o login de QA:
```bash
docker compose restart backend
sleep 3
J=/tmp/perfil.cookies
B=http://localhost:8080/api/v1
# login
curl -s -c $J -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"host@dope.local","password":"dope12345"}' >/dev/null
# GET /me deve trazer bio/avatar_url/created_at
curl -s -b $J $B/auth/me
echo
# PATCH /me (nome+bio)
curl -s -b $J -X PATCH $B/me -H 'Content-Type: application/json' \
  -d '{"name":"Host QA","bio":"Anfitrião de teste"}'
echo
# trocar senha (atual->nova) e logar com a nova; depois reverter
curl -s -o /dev/null -w "troca: %{http_code}\n" -b $J -X POST $B/me/password \
  -H 'Content-Type: application/json' -d '{"current_password":"dope12345","new_password":"dope123456"}'
curl -s -o /dev/null -w "login nova: %{http_code}\n" -c $J -X POST $B/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"host@dope.local","password":"dope123456"}'
curl -s -o /dev/null -w "reverte: %{http_code}\n" -b $J -X POST $B/me/password \
  -H 'Content-Type: application/json' -d '{"current_password":"dope123456","new_password":"dope12345"}'
```
Expected: `/auth/me` mostra `"bio"`, `"avatar_url":""`, `"created_at"` (RFC3339); PATCH retorna `name":"Host QA","bio":"Anfitrião de teste"`; `troca: 204`, `login nova: 200`, `reverte: 204`.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/auth/handler.go backend/internal/server/server.go
git commit -m "feat(perfil): rotas PATCH /me, POST /me/avatar e /me/password"
```

---

### Task 4: Frontend — tipo `User` + `ProfileAPI`

**Files:**
- Modify: `frontend/app/venues/lib.ts`

**Interfaces:**
- Produces (consumido pelas Tasks 5–7): `interface User`; `ProfileAPI.me()`, `ProfileAPI.updateProfile()`, `ProfileAPI.uploadAvatar()`, `ProfileAPI.changePassword()`.

- [ ] **Step 1: Adicionar o tipo e a API**

Acrescentar em `frontend/app/venues/lib.ts` (após o objeto `BookingsAPI`, antes do bloco `AMENITIES`):
```ts
export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  bio: string;
  avatar_url: string;
  created_at: string;
}

export interface ProfileUpdate {
  name: string;
  bio: string;
}

export interface PasswordChange {
  current_password: string;
  new_password: string;
}

export const ProfileAPI = {
  me: () => req<User>('/auth/me'),
  updateProfile: (body: ProfileUpdate) => req<User>('/me', { method: 'PATCH', ...json(body) }),
  changePassword: (body: PasswordChange) => req<null>('/me/password', { method: 'POST', ...json(body) }),
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return req<User>('/me/avatar', { method: 'POST', body: fd });
  },
};
```

- [ ] **Step 2: Typecheck**

Run (em `frontend/`):
```bash
npm run typecheck
```
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/venues/lib.ts
git commit -m "feat(perfil): tipo User e ProfileAPI no lib.ts"
```

---

### Task 5: Frontend — item "Perfil" no Dock

**Files:**
- Modify: `frontend/app/components/site-nav.tsx:131`

**Interfaces:**
- Consumes: `loggedIn` (estado já existente no componente).
- Produces: o slot de conta navega pra `/perfil` quando logado, `/login` quando não.

- [ ] **Step 1: Tornar o item de conta dependente de login**

Em `frontend/app/components/site-nav.tsx`, trocar a linha do item de usuário (atualmente):
```tsx
    { icon: <UserIcon />, label: 'Entrar / Registrar', onClick: () => router.push('/login') },
```
por:
```tsx
    {
      icon: <UserIcon />,
      label: loggedIn ? 'Perfil' : 'Entrar / Registrar',
      onClick: () => router.push(loggedIn ? '/perfil' : '/login'),
    },
```

- [ ] **Step 2: Typecheck**

Run (em `frontend/`):
```bash
npm run typecheck
```
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/site-nav.tsx
git commit -m "feat(perfil): Dock alterna Perfil/Entrar conforme login"
```

---

### Task 6: Frontend — página `/perfil` (cabeçalho + preview de anúncios) + CSS

**Files:**
- Create: `frontend/app/perfil/page.tsx`
- Modify: `frontend/app/globals.css` (append)

**Interfaces:**
- Consumes (da Task 4): `ProfileAPI.me()`, tipo `User`; (existente) `VenuesAPI.listMine()`, tipo `Venue`.
- Produces (consumido pela Task 7): o componente `ProfilePage` com estado `user`/`setUser` e a seção de edição (placeholder até a Task 7).

- [ ] **Step 1: Criar a página com cabeçalho + preview**

`frontend/app/perfil/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ProfileAPI, VenuesAPI, type User, type Venue } from '../venues/lib';

const initial = (name: string) => (name.trim()[0] || '?').toUpperCase();
const memberSince = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

export default function ProfilePage() {
  const reduce = useReducedMotion();
  const [user, setUser] = useState<User | null>(null);
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    ProfileAPI.me()
      .then(setUser)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Erro ao carregar perfil'));
    VenuesAPI.listMine()
      .then(setVenues)
      .catch(() => setVenues([]));
  }, []);

  if (error) return <main className="container"><p className="error">{error}</p></main>;
  if (!user) return <main className="container"><p className="muted">Carregando…</p></main>;

  const fade = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.28 } };

  return (
    <main className="container profile">
      <motion.header className="profile-head" {...fade}>
        <div className="profile-avatar">
          {user.avatar_url ? <img src={user.avatar_url} alt={user.name} /> : <span>{initial(user.name)}</span>}
        </div>
        <div className="profile-id">
          <h1>{user.name}</h1>
          <p className="muted">{user.email}</p>
          <div className="profile-meta">
            <span className="badge pub">{user.role === 'HOST' ? 'Anfitrião' : 'Convidado'}</span>
            {user.created_at && <span className="muted">Membro desde {memberSince(user.created_at)}</span>}
          </div>
          {user.bio && <p className="profile-bio">{user.bio}</p>}
        </div>
      </motion.header>

      {/* A seção "Editar conta" é adicionada na Task 7, aqui. */}

      <section className="profile-section">
        <div className="list-head">
          <h2>Meus anúncios</h2>
          <a className="button ghost" href="/venues/mine">Gerenciar</a>
        </div>
        {!venues ? (
          <p className="muted">Carregando…</p>
        ) : venues.length === 0 ? (
          <p className="muted">Você ainda não anunciou. <a href="/venues/new">Criar o primeiro</a>.</p>
        ) : (
          <div className="profile-venues">
            {venues.map((v, i) => (
              <motion.a
                key={v.id}
                href={`/venues/${v.id}/edit`}
                className="vcard"
                initial={reduce ? undefined : { opacity: 0, y: 10 }}
                animate={reduce ? undefined : { opacity: 1, y: 0 }}
                transition={reduce ? undefined : { duration: 0.24, delay: Math.min(i * 0.05, 0.3) }}
              >
                <div className="vcard-cover">
                  {v.cover_url ? <img src={v.cover_url} alt={v.title} /> : <div className="vcard-cover-ph" />}
                </div>
                <div className="vcard-body">
                  <strong>{v.title}</strong>
                  <span className={'badge ' + (v.status === 'PUBLISHED' ? 'pub' : 'draft')}>
                    {v.status === 'PUBLISHED' ? 'Publicado' : 'Rascunho'}
                  </span>
                  <span className="muted">{v.city}/{v.state} · R$ {v.price_per_day}/dia</span>
                </div>
              </motion.a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Adicionar os estilos**

Append em `frontend/app/globals.css`:
```css
/* ===== Perfil ===== */
.profile { display: flex; flex-direction: column; gap: 28px; }
.profile-head { display: flex; gap: 20px; align-items: center; }
.profile-avatar {
  width: 88px; height: 88px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
  display: grid; place-items: center; color: #fff; font-size: 32px; font-weight: 700;
  background: var(--brand-gradient);
}
.profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
.profile-id h1 { margin: 0 0 2px; }
.profile-meta { display: flex; gap: 10px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
.profile-bio { margin: 10px 0 0; max-width: 60ch; }
.profile-section { display: flex; flex-direction: column; gap: 14px; }
.profile-venues {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px;
}
.profile-venues .vcard { text-decoration: none; color: inherit; }
@media (max-width: 640px) {
  .profile-head { flex-direction: column; text-align: center; }
}
```

- [ ] **Step 3: Reiniciar o frontend (arquivo novo) + typecheck + build**

Run (em `frontend/`):
```bash
docker compose restart frontend
npm run typecheck && npm run build
```
Expected: typecheck e build sem erros.

- [ ] **Step 4: Smoke visual**

Abrir `http://localhost:3100/perfil` logado como `host@dope.local`. Esperado: avatar com inicial, nome, e-mail, badge "Anfitrião", "Membro desde …", e o grid de anúncios. Clicar no Dock (slot de conta) leva a `/perfil`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/perfil/page.tsx frontend/app/globals.css
git commit -m "feat(perfil): página /perfil com cabeçalho e preview de anúncios"
```

---

### Task 7: Frontend — editar conta (nome/bio + avatar + senha)

**Files:**
- Modify: `frontend/app/perfil/page.tsx`
- Modify: `frontend/app/globals.css` (append)

**Interfaces:**
- Consumes (da Task 4): `ProfileAPI.updateProfile()`, `ProfileAPI.uploadAvatar()`, `ProfileAPI.changePassword()`.
- Consumes (da Task 6): estado `user`/`setUser` da `ProfilePage`.

- [ ] **Step 1: Adicionar o subcomponente de edição**

Em `frontend/app/perfil/page.tsx`, adicionar este componente abaixo do `ProfilePage` (mesmo arquivo):
```tsx
function EditAccount({ user, onUser }: { user: User; onUser: (u: User) => void }) {
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMsg, setInfoMsg] = useState('');

  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');

  const [avatarMsg, setAvatarMsg] = useState('');

  async function saveInfo() {
    setSavingInfo(true);
    setInfoMsg('');
    try {
      const u = await ProfileAPI.updateProfile({ name, bio });
      onUser(u);
      setInfoMsg('Salvo.');
    } catch (e) {
      setInfoMsg(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSavingInfo(false);
    }
  }

  async function onAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarMsg('Enviando…');
    try {
      const u = await ProfileAPI.uploadAvatar(file);
      onUser(u);
      setAvatarMsg('Foto atualizada.');
    } catch (err) {
      setAvatarMsg(err instanceof Error ? err.message : 'Erro ao enviar');
    }
  }

  async function savePwd() {
    setSavingPwd(true);
    setPwdMsg('');
    try {
      await ProfileAPI.changePassword({ current_password: cur, new_password: next });
      setCur('');
      setNext('');
      setPwdMsg('Senha alterada.');
    } catch (e) {
      setPwdMsg(e instanceof Error ? e.message : 'Erro ao trocar senha');
    } finally {
      setSavingPwd(false);
    }
  }

  return (
    <section className="profile-section profile-edit">
      <h2>Editar conta</h2>
      <div className="form">
        <label className="avatar-upload">
          Foto de perfil
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatar} />
        </label>
        {avatarMsg && <span className="muted">{avatarMsg}</span>}
        <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Bio<textarea value={bio} rows={3} onChange={(e) => setBio(e.target.value)} placeholder="Fale um pouco sobre você (opcional)" /></label>
        <label>E-mail<input value={user.email} disabled /></label>
        <button className="button" onClick={saveInfo} disabled={savingInfo || name.trim().length < 2}>
          {savingInfo ? '...' : 'Salvar'}
        </button>
        {infoMsg && <span className="muted">{infoMsg}</span>}
      </div>

      <div className="form">
        <h3>Trocar senha</h3>
        <label>Senha atual<input type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <label>Nova senha<input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Ao menos 8 caracteres" /></label>
        <button className="button" onClick={savePwd} disabled={savingPwd || !cur || next.length < 8}>
          {savingPwd ? '...' : 'Trocar senha'}
        </button>
        {pwdMsg && <span className="muted">{pwdMsg}</span>}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Renderizar o subcomponente na página**

Em `ProfilePage`, substituir o comentário `{/* A seção "Editar conta" é adicionada na Task 7, aqui. */}` por:
```tsx
      <EditAccount user={user} onUser={setUser} />
```

- [ ] **Step 3: Estilos da edição**

Append em `frontend/app/globals.css`:
```css
.profile-edit .form { max-width: 460px; }
.profile-edit .form + .form { margin-top: 20px; }
.profile-edit h3 { margin: 0 0 4px; }
.avatar-upload input { margin-top: 6px; }
.profile-edit input:disabled { opacity: 0.6; cursor: not-allowed; }
```

- [ ] **Step 4: Typecheck + build**

Run (em `frontend/`):
```bash
npm run typecheck && npm run build
```
Expected: sem erros.

- [ ] **Step 5: Smoke do fluxo completo**

Em `http://localhost:3100/perfil` (logado): trocar nome/bio → "Salvo." e o cabeçalho reflete; enviar uma imagem jpg/png → "Foto atualizada." e o avatar troca; trocar senha com a atual errada → mensagem de erro; com a atual certa → "Senha alterada." (reverter depois para `dope12345`). E-mail aparece desabilitado.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/perfil/page.tsx frontend/app/globals.css
git commit -m "feat(perfil): editar conta (nome/bio, avatar e troca de senha)"
```

---

## Self-Review

- **Cobertura da spec:** schema (T1) · queries (T1) · auth.Service storage+métodos (T2) · erros (T2) · rotas PATCH /me, POST /me/avatar, /me/password (T3) · DTO com bio/avatar_url/created_at (T3) · wiring server (T3) · lib User+ProfileAPI (T4) · Dock Perfil/Entrar (T5) · cabeçalho+preview (T6) · editar conta+avatar+senha (T7) · animações/`prefers-reduced-motion` (T6/T7) · testes unit+smoke (T2/T3/T6/T7). Fase B (dashboard/financeiro) fora de escopo. ✔
- **Consistência de tipos:** `NewService(q, redis, store)` definido em T2 e usado em T3; `UpdateUserProfileParams{ID,Name,Bio}` / `UpdateUserAvatarParams{ID,AvatarUrl}` / `UpdateUserPasswordParams{ID,PasswordHash}` da T1 usados na T2; `sqlc.User.AvatarUrl` (camelCase do sqlc) usado no DTO (T3) e em `UploadAvatar` (T2); `ProfileAPI`/`User` da T4 consumidos em T6/T7. ✔
- **Sem placeholders:** todo passo de código traz o código real; comandos com saída esperada. ✔
- **Risco conhecido:** `sqlc` pode mapear `avatar_url` como `AvatarUrl` (confirmar no `models.go` gerado na T1 e ajustar referências em T2/T3 se o sqlc usar outra capitalização). A T1 Step 5 (build) pega qualquer divergência cedo.
