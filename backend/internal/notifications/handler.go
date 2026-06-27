package notifications

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/doperepo/backend/internal/db/sqlc"
)

type Handler struct{ q *sqlc.Queries }

func NewHandler(q *sqlc.Queries) *Handler { return &Handler{q: q} }

func (h *Handler) Routes(rg *gin.RouterGroup, requireAuth gin.HandlerFunc) {
	g := rg.Group("/notifications", requireAuth)
	g.GET("", h.list)
	g.GET("/unread-count", h.unreadCount)
	g.POST("/read", h.markRead)
	g.DELETE("", h.clearAll)
}

type notificationResp struct {
	ID         int64  `json:"id"`
	Type       string `json:"type"`
	Read       bool   `json:"read"`
	CreatedAt  string `json:"created_at"`
	BookingID  int64  `json:"booking_id"`
	VenueTitle string `json:"venue_title"`
	StartDate  string `json:"start_date"`
	EndDate    string `json:"end_date"`
}

func (h *Handler) list(c *gin.Context) {
	user := c.MustGet("user").(sqlc.User)
	rows, err := h.q.ListNotificationsByUser(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao listar"})
		return
	}
	out := make([]notificationResp, 0, len(rows))
	for _, n := range rows {
		out = append(out, notificationResp{
			ID: n.ID, Type: n.Type, Read: n.Read, CreatedAt: tsStr(n.CreatedAt),
			BookingID: n.BookingID, VenueTitle: n.VenueTitle,
			StartDate: dateStr(n.StartDate), EndDate: dateStr(n.EndDate),
		})
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) unreadCount(c *gin.Context) {
	user := c.MustGet("user").(sqlc.User)
	count, err := h.q.CountUnreadNotifications(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"count": count})
}

func (h *Handler) markRead(c *gin.Context) {
	user := c.MustGet("user").(sqlc.User)
	if err := h.q.MarkNotificationsRead(c.Request.Context(), user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) clearAll(c *gin.Context) {
	user := c.MustGet("user").(sqlc.User)
	if err := h.q.DeleteNotificationsByUser(c.Request.Context(), user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro"})
		return
	}
	c.Status(http.StatusNoContent)
}

func tsStr(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.Format(time.RFC3339)
}
