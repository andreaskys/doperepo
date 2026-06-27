# Design — Perfil & conta (Fase A)

**Data:** 2026-06-27
**Objetivo:** uma página de perfil (`/perfil`, item no Dock) com os dados do
usuário, edição de conta (nome, bio, foto, senha) e preview dos anúncios.
**Escopo:** Fase A de 2 (a Fase B = dashboard de métricas + painel financeiro,
fica para outra spec). Decomposição decidida no brainstorming.

## Decisões (do brainstorming)
| Tema | Escolha |
| --- | --- |
| Editável | nome, bio, foto, **senha** (atual + nova). E-mail só-leitura. |
| Item no Dock | slot de conta = **Perfil (logado)** / **Entrar/Registrar (deslogado)**. |
| Avatar | reusa o MinIO (`storage.Client`) + validação das fotos de venue (jpg/png/webp, ≤5MB). |

## Arquitetura

### 1. Schema (`backend/migrations/0008_user_profile.sql`)
```sql
ALTER TABLE users
    ADD COLUMN bio        TEXT NOT NULL DEFAULT '',
    ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
```
Initdb — aplicar **manual** no DB de QA.

### 2. Queries (`backend/internal/db/queries/users.sql`)
```sql
-- name: UpdateUserProfile :one
UPDATE users SET name = @name, bio = @bio WHERE id = @id RETURNING *;

-- name: UpdateUserAvatar :one
UPDATE users SET avatar_url = @avatar_url WHERE id = @id RETURNING *;

-- name: UpdateUserPassword :exec
UPDATE users SET password_hash = @password_hash WHERE id = @id;
```
`sqlc.User` ganha `Bio`, `AvatarUrl`. Requer `sqlc generate`.

### 3. `auth.Service` (`internal/auth/auth.go`)
- Ganha `store *storage.Client` (nilável); `NewService(q, r, store)`.
- Erros: `ErrWrongPassword = errors.New("senha atual incorreta")`,
  `ErrStorageUnavailable`, `ErrWeakPassword`.
- `UpdateProfile(ctx, id int64, name, bio string) (sqlc.User, error)` → `UpdateUserProfile`.
- `UploadAvatar(ctx, id int64, key, ct string, r io.Reader, size int64) (sqlc.User, error)`
  → `store.Upload(...)` (se `store==nil` → `ErrStorageUnavailable`) → `UpdateUserAvatar`.
- `ChangePassword(ctx, id int64, current, next string) error`:
  `GetUserByID` → `bcrypt.CompareHashAndPassword(hash, current)` falhou → `ErrWrongPassword`;
  `len(next) < 8` → `ErrWeakPassword`; `bcrypt.GenerateFromPassword(next)` → `UpdateUserPassword`.

### 4. Handler (`internal/auth/handler.go`) — rotas atrás de `requireAuth`
| Rota | Ação |
| --- | --- |
| `PATCH /me` | atualiza nome + bio (`{name, bio}`) → `publicUser` |
| `POST /me/avatar` | upload multipart `avatar` (jpg/png/webp ≤5MB) → `publicUser` |
| `POST /me/password` | `{current_password, new_password}` → 204 |

- Reusa o padrão de upload do `venues.handler` (allowlist de content-type, 5MB,
  `randHex` p/ a key `avatars/<userID>/<hex>.<ext>`).
- `publicUserDTO` ganha `Bio string json:"bio"`, `AvatarURL string json:"avatar_url"`,
  `CreatedAt string json:"created_at"` (RFC3339). Mapeamento em `publicUser`.
- Erros → HTTP: `ErrWrongPassword`/`ErrWeakPassword`→400/401, `ErrStorageUnavailable`→503.

### 5. Wiring (`server.go`)
`auth.NewHandler(auth.NewService(queries, deps.Redis, deps.Storage), secure)`.

### 6. Frontend — `lib.ts`
- `interface User { id: number; name: string; email: string; role: string; bio?: string; avatar_url?: string; created_at?: string }`.
- `ProfileAPI`: `me()` (`GET /auth/me`), `updateProfile({name,bio})` (`PATCH /me`),
  `uploadAvatar(file)` (`POST /me/avatar` multipart), `changePassword({current_password,new_password})` (`POST /me/password`). Via `req()` (401→/login) exceto onde precisar de multipart (usa fetch direto com credenciais).

### 7. Frontend — página `/perfil` (`app/perfil/page.tsx`, client)
Busca `ProfileAPI.me()` + `VenuesAPI.listMine()`. Seções:
- **Cabeçalho:** avatar (foto ou inicial no círculo com gradiente da marca), nome,
  e-mail (só-leitura), badge de papel, "Membro desde {created_at}", bio.
- **Editar conta:** form com nome, bio (textarea), **upload de avatar** (preview
  imediato via `URL.createObjectURL`), e **trocar senha** (atual + nova). Botões
  salvam por seção, com feedback ("Salvo", erros inline).
- **Meus anúncios (preview):** grid de cards (reusa estilo `.vcard`/`.venue-card`)
  com badge publicado/rascunho; link "Gerenciar" → `/venues/mine`. Vazio →
  "Você ainda não anunciou. Anunciar.".

### 8. Frontend — Dock (`site-nav.tsx`)
O slot de conta passa a ser: `loggedIn ? Perfil(→/perfil) : Entrar/Registrar(→/login)`. Ícone de Perfil próprio (pessoa/id). O sino segue como item adicional quando logado.

## Design & animações (padrão do site, `docs/design.md`)
Tokens `--brand-*`, cards com raio 14px + sombra suave. Entrada com `motion`:
cabeçalho fade-up; cards do grid em **stagger**; avatar leve `scale` no hover.
Durações <300ms, só `transform`/`opacity`; `prefers-reduced-motion` respeitado.
Avatar placeholder = inicial do nome num círculo `--brand-gradient`.

## Erros & estados
- Sem sessão (401) → `req()` redireciona pra `/login`.
- Senha atual incorreta → 401/mensagem inline. Nova senha fraca → 400/mensagem.
- Upload inválido/grande → mensagem; storage off → 503 "indisponível".
- Tudo com feedback inline; nada quebra a página.

## Testes
- **Unit puro:** helper de validação da nova senha (`len < 8` → erro) — testável
  sem DB. (A comparação bcrypt e o fluxo completo vão no smoke.)
- **Smoke:** `PATCH /me` muda nome/bio (GET reflete); `POST /me/password`
  (atual+nova) → 204, e **login com a nova senha** funciona; senha atual errada
  → erro; `POST /me/avatar` → `avatar_url` preenchido e a imagem é servida.
- Gates: `go test`/`build`, `npm typecheck`/`build`.

## Fora desta fase (Fase B)
Dashboard de métricas (nº de anúncios/reservas por status, viagens) + **painel
financeiro** (receita das reservas confirmadas) + animações dos cards — próxima spec.
Também futuro: trocar e-mail, excluir conta, remover avatar.
