package auth

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

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
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

func publicUser(u sqlc.User) publicUserDTO {
	return publicUserDTO{ID: u.ID, Name: u.Name, Email: u.Email, Role: string(u.Role)}
}
