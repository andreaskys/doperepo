package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/doperepo/backend/internal/db/sqlc"
)

const cookieName = "session"

type Handler struct {
	svc    *Service
	secure bool // cookie Secure em produção
}

func NewHandler(svc *Service, secure bool) *Handler {
	return &Handler{svc: svc, secure: secure}
}

// Routes registra as rotas de auth no grupo informado.
func (h *Handler) Routes(rg *gin.RouterGroup) {
	rg.POST("/auth/register", h.register)
	rg.POST("/auth/login", h.login)
	rg.POST("/auth/logout", h.logout)
	rg.GET("/auth/me", h.RequireAuth(), h.me)
	rg.PATCH("/me/role", h.RequireAuth(), h.setRole)
	rg.PATCH("/me", h.RequireAuth(), h.updateProfile)
	rg.POST("/me/avatar", h.RequireAuth(), h.uploadAvatar)
	rg.POST("/me/password", h.RequireAuth(), h.changePassword)
}

type registerReq struct {
	Name     string `json:"name" binding:"required,min=2"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
}

func (h *Handler) register(c *gin.Context) {
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user, token, err := h.svc.Register(c.Request.Context(), req.Name, req.Email, req.Password)
	switch {
	case errors.Is(err, ErrEmailTaken):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao cadastrar"})
		return
	}
	h.setCookie(c, token)
	c.JSON(http.StatusCreated, publicUser(user))
}

type loginReq struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

func (h *Handler) login(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user, token, err := h.svc.Login(c.Request.Context(), req.Email, req.Password)
	switch {
	case errors.Is(err, ErrInvalidLogin):
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao entrar"})
		return
	}
	h.setCookie(c, token)
	c.JSON(http.StatusOK, publicUser(user))
}

func (h *Handler) logout(c *gin.Context) {
	if token, err := c.Cookie(cookieName); err == nil {
		_ = h.svc.Logout(c.Request.Context(), token)
	}
	h.clearCookie(c)
	c.Status(http.StatusNoContent)
}

func (h *Handler) me(c *gin.Context) {
	c.JSON(http.StatusOK, publicUser(currentUser(c)))
}

type setRoleReq struct {
	Role string `json:"role" binding:"required,oneof=GUEST HOST"`
}

func (h *Handler) setRole(c *gin.Context) {
	var req setRoleReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user, err := h.svc.SetRole(c.Request.Context(), currentUser(c).ID, sqlc.UserRole(req.Role))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao atualizar papel"})
		return
	}
	c.JSON(http.StatusOK, publicUser(user))
}

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

// RequireAuth carrega o usuário da sessão; 401 se não houver/for inválida.
func (h *Handler) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(cookieName)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "não autenticado"})
			return
		}
		user, err := h.svc.UserFromSession(c.Request.Context(), token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "sessão inválida"})
			return
		}
		c.Set("user", user)
		c.Next()
	}
}

func currentUser(c *gin.Context) sqlc.User {
	return c.MustGet("user").(sqlc.User)
}

func (h *Handler) setCookie(c *gin.Context, token string) {
	// httpOnly; Secure só em prod; SameSite Lax (front e API são same-site em localhost).
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(cookieName, token, int(sessionTTL.Seconds()), "/", "", h.secure, true)
}

func (h *Handler) clearCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(cookieName, "", -1, "/", "", h.secure, true)
}

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
