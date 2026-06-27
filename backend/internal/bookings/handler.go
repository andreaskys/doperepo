package bookings

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/doperepo/backend/internal/db/sqlc"
)

const dateLayout = "2006-01-02"

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(rg *gin.RouterGroup, requireAuth gin.HandlerFunc) {
	rg.GET("/public/venues/:id/booked", h.bookedRanges) // público (date picker)
	rg.POST("/venues/:id/bookings", requireAuth, h.create)
	rg.GET("/bookings", requireAuth, h.listMine)
	rg.GET("/bookings/received", requireAuth, h.listReceived)
	rg.POST("/bookings/:id/confirm", requireAuth, h.confirm)
	rg.POST("/bookings/:id/cancel", requireAuth, h.cancel)
}

type bookingReq struct {
	StartDate string `json:"start_date" binding:"required"`
	EndDate   string `json:"end_date" binding:"required"`
}

func (h *Handler) create(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}
	var req bookingReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	start, e1 := time.Parse(dateLayout, req.StartDate)
	end, e2 := time.Parse(dateLayout, req.EndDate)
	if e1 != nil || e2 != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "datas devem ser YYYY-MM-DD"})
		return
	}

	user := c.MustGet("user").(sqlc.User)
	booking, err := h.svc.Create(c.Request.Context(), id, user.ID, start, end)
	switch {
	case errors.Is(err, ErrVenueNotFound), errors.Is(err, ErrNotBookable):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidDates):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrDatesUnavailable):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()}) // 409
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao reservar"})
	default:
		c.JSON(http.StatusCreated, bookingDTO(booking))
	}
}

func (h *Handler) listMine(c *gin.Context) {
	user := c.MustGet("user").(sqlc.User)
	rows, err := h.svc.ListByGuest(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao listar"})
		return
	}
	out := make([]myBookingResp, 0, len(rows))
	for _, b := range rows {
		out = append(out, myBookingResp{
			ID: b.ID, VenueID: b.VenueID, VenueTitle: b.VenueTitle,
			VenueCity: b.VenueCity, VenueState: b.VenueState,
			StartDate: dateStr(b.StartDate), EndDate: dateStr(b.EndDate),
			TotalPrice: priceStr(b.TotalPrice), Status: string(b.Status),
		})
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) bookedRanges(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}
	rows, err := h.svc.BookedRanges(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro"})
		return
	}
	out := make([]rangeResp, 0, len(rows))
	for _, r := range rows {
		out = append(out, rangeResp{Start: dateStr(r.StartDate), End: dateStr(r.EndDate)})
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) listReceived(c *gin.Context) {
	user := c.MustGet("user").(sqlc.User)
	rows, err := h.svc.ListByHost(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao listar"})
		return
	}
	out := make([]receivedBookingResp, 0, len(rows))
	for _, b := range rows {
		out = append(out, receivedBookingResp{
			ID: b.ID, VenueID: b.VenueID, VenueTitle: b.VenueTitle,
			VenueCity: b.VenueCity, VenueState: b.VenueState,
			GuestName: b.GuestName, GuestEmail: b.GuestEmail,
			StartDate: dateStr(b.StartDate), EndDate: dateStr(b.EndDate),
			TotalPrice: priceStr(b.TotalPrice), Status: string(b.Status),
		})
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) confirm(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}
	user := c.MustGet("user").(sqlc.User)
	b, err := h.svc.Confirm(c.Request.Context(), id, user.ID)
	if err != nil {
		writeBookingErr(c, err)
		return
	}
	c.JSON(http.StatusOK, bookingDTO(b))
}

func (h *Handler) cancel(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}
	user := c.MustGet("user").(sqlc.User)
	b, err := h.svc.Cancel(c.Request.Context(), id, user.ID)
	if err != nil {
		writeBookingErr(c, err)
		return
	}
	c.JSON(http.StatusOK, bookingDTO(b))
}

func writeBookingErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrBookingNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotAuthorized):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidTransition):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro interno"})
	}
}

// --- DTOs ---

type receivedBookingResp struct {
	ID         int64  `json:"id"`
	VenueID    int64  `json:"venue_id"`
	VenueTitle string `json:"venue_title"`
	VenueCity  string `json:"venue_city"`
	VenueState string `json:"venue_state"`
	GuestName  string `json:"guest_name"`
	GuestEmail string `json:"guest_email"`
	StartDate  string `json:"start_date"`
	EndDate    string `json:"end_date"`
	TotalPrice string `json:"total_price"`
	Status     string `json:"status"`
}

type bookingResp struct {
	ID         int64  `json:"id"`
	VenueID    int64  `json:"venue_id"`
	StartDate  string `json:"start_date"`
	EndDate    string `json:"end_date"`
	TotalPrice string `json:"total_price"`
	Status     string `json:"status"`
}

type myBookingResp struct {
	ID         int64  `json:"id"`
	VenueID    int64  `json:"venue_id"`
	VenueTitle string `json:"venue_title"`
	VenueCity  string `json:"venue_city"`
	VenueState string `json:"venue_state"`
	StartDate  string `json:"start_date"`
	EndDate    string `json:"end_date"`
	TotalPrice string `json:"total_price"`
	Status     string `json:"status"`
}

type rangeResp struct {
	Start string `json:"start_date"`
	End   string `json:"end_date"`
}

func bookingDTO(b sqlc.Booking) bookingResp {
	return bookingResp{
		ID: b.ID, VenueID: b.VenueID,
		StartDate: dateStr(b.StartDate), EndDate: dateStr(b.EndDate),
		TotalPrice: priceStr(b.TotalPrice), Status: string(b.Status),
	}
}

func dateStr(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format(dateLayout)
}

func priceStr(n pgtype.Numeric) string {
	if !n.Valid {
		return "0"
	}
	v, err := n.Value()
	if err != nil || v == nil {
		return "0"
	}
	if s, ok := v.(string); ok {
		return s
	}
	return "0"
}
