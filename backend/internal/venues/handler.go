package venues

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/doperepo/backend/internal/db/sqlc"
)

const maxPhotoBytes = 5 << 20 // 5MB

// content-type permitido -> extensão do objeto.
var allowedImageTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Routes registra as rotas de venues atrás do middleware de auth informado.
func (h *Handler) Routes(rg *gin.RouterGroup, requireAuth gin.HandlerFunc) {
	rg.GET("/public/venues", h.listPublic) // público, sem auth (home)

	g := rg.Group("/venues", requireAuth)
	g.GET("", h.listMine)
	g.POST("", h.create)
	g.GET("/:id", h.get)
	g.PUT("/:id", h.update)
	g.DELETE("/:id", h.delete)
	g.POST("/:id/publish", h.publish)
	g.POST("/:id/photos", h.addPhoto)
	g.DELETE("/:id/photos/:photoID", h.deletePhoto)
}

type venueReq struct {
	Title       string   `json:"title" binding:"required,min=3"`
	Description string   `json:"description"`
	Capacity    int32    `json:"capacity" binding:"required,gt=0"`
	Price       string   `json:"price_per_day" binding:"required"`
	Address     string   `json:"address" binding:"required"`
	City        string   `json:"city" binding:"required"`
	State       string   `json:"state" binding:"required"`
	Latitude    *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
	Amenities   []string `json:"amenities"`
}

func (r venueReq) toInput() VenueInput {
	return VenueInput{
		Title: r.Title, Description: r.Description, Capacity: r.Capacity,
		Price: r.Price, Address: r.Address, City: r.City, State: r.State,
		Latitude: r.Latitude, Longitude: r.Longitude, Amenities: r.Amenities,
	}
}

func (h *Handler) create(c *gin.Context) {
	var req venueReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := currentUser(c)
	v, err := h.svc.Create(c.Request.Context(), user.ID, req.toInput())
	if err != nil {
		writeServiceErr(c, err)
		return
	}
	if user.Role == sqlc.UserRoleGUEST { // anunciar promove a HOST
		_ = h.svc.EnsureHost(c.Request.Context(), user.ID)
	}
	c.JSON(http.StatusCreated, venueDTO(v, nil))
}

func (h *Handler) listPublic(c *gin.Context) {
	vs, err := h.svc.ListPublished(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao listar"})
		return
	}
	out := make([]publicVenueResp, 0, len(vs))
	for _, v := range vs {
		out = append(out, publicVenueResp{
			ID: v.ID, Title: v.Title, Description: v.Description, Capacity: v.Capacity,
			PricePerDay: priceString(v.PricePerDay), City: v.City, State: v.State, CoverURL: v.CoverUrl,
		})
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) listMine(c *gin.Context) {
	vs, err := h.svc.ListByHost(c.Request.Context(), currentUser(c).ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao listar"})
		return
	}
	out := make([]venueResponse, 0, len(vs))
	for _, v := range vs {
		out = append(out, venueDTO(v, nil))
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) get(c *gin.Context) {
	v, ok := h.ownedVenue(c)
	if !ok {
		return
	}
	photos, _ := h.svc.Photos(c.Request.Context(), v.ID)
	c.JSON(http.StatusOK, venueDTO(v, photos))
}

func (h *Handler) update(c *gin.Context) {
	v, ok := h.ownedVenue(c)
	if !ok {
		return
	}
	var req venueReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updated, err := h.svc.Update(c.Request.Context(), v.ID, req.toInput())
	if err != nil {
		writeServiceErr(c, err)
		return
	}
	c.JSON(http.StatusOK, venueDTO(updated, nil))
}

func (h *Handler) delete(c *gin.Context) {
	v, ok := h.ownedVenue(c)
	if !ok {
		return
	}
	if err := h.svc.Delete(c.Request.Context(), v.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao excluir"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) publish(c *gin.Context) {
	v, ok := h.ownedVenue(c)
	if !ok {
		return
	}
	pub, err := h.svc.Publish(c.Request.Context(), v.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao publicar"})
		return
	}
	c.JSON(http.StatusOK, venueDTO(pub, nil))
}

func (h *Handler) addPhoto(c *gin.Context) {
	v, ok := h.ownedVenue(c)
	if !ok {
		return
	}
	fh, err := c.FormFile("photo")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "envie o arquivo no campo 'photo'"})
		return
	}
	if fh.Size > maxPhotoBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "foto acima de 5MB"})
		return
	}
	ct := fh.Header.Get("Content-Type")
	ext, ok := allowedImageTypes[ct]
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

	key := fmt.Sprintf("venues/%d/%s%s", v.ID, randHex(), ext)
	photo, err := h.svc.AddPhoto(c.Request.Context(), v.ID, key, ct, f, fh.Size)
	if err != nil {
		writeServiceErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, photoDTO(photo))
}

func (h *Handler) deletePhoto(c *gin.Context) {
	v, ok := h.ownedVenue(c)
	if !ok {
		return
	}
	pid, err := strconv.ParseInt(c.Param("photoID"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}
	if err := h.svc.DeletePhoto(c.Request.Context(), v.ID, pid); err != nil {
		writeServiceErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ownedVenue carrega a venue do :id e exige que pertença ao usuário logado.
func (h *Handler) ownedVenue(c *gin.Context) (sqlc.Venue, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return sqlc.Venue{}, false
	}
	v, err := h.svc.Get(c.Request.Context(), id)
	if err != nil || v.HostID != currentUser(c).ID {
		c.JSON(http.StatusNotFound, gin.H{"error": "anúncio não encontrado"})
		return sqlc.Venue{}, false
	}
	return v, true
}

func currentUser(c *gin.Context) sqlc.User {
	return c.MustGet("user").(sqlc.User) // setado pelo middleware de auth
}

func writeServiceErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrStorageUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
	case errors.Is(err, ErrTooManyPhotos), errors.Is(err, ErrInvalidAmenity), errors.Is(err, ErrInvalidPrice):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro interno"})
	}
}

// --- DTOs (nunca expõem object_key nem host interno) ---

type venueResponse struct {
	ID          int64       `json:"id"`
	HostID      int64       `json:"host_id"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Capacity    int32       `json:"capacity"`
	PricePerDay string      `json:"price_per_day"`
	Address     string      `json:"address"`
	City        string      `json:"city"`
	State       string      `json:"state"`
	Latitude    *float64    `json:"latitude"`
	Longitude   *float64    `json:"longitude"`
	Amenities   []string    `json:"amenities"`
	Status      string      `json:"status"`
	Photos      []photoResp `json:"photos"`
}

type photoResp struct {
	ID       int64  `json:"id"`
	URL      string `json:"url"`
	Position int32  `json:"position"`
}

// publicVenueResp é o card da home (sem dados sensíveis do host).
type publicVenueResp struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Capacity    int32  `json:"capacity"`
	PricePerDay string `json:"price_per_day"`
	City        string `json:"city"`
	State       string `json:"state"`
	CoverURL    string `json:"cover_url"`
}

func venueDTO(v sqlc.Venue, photos []sqlc.VenuePhoto) venueResponse {
	out := venueResponse{
		ID: v.ID, HostID: v.HostID, Title: v.Title, Description: v.Description,
		Capacity: v.Capacity, PricePerDay: priceString(v.PricePerDay), Address: v.Address,
		City: v.City, State: v.State, Latitude: v.Latitude, Longitude: v.Longitude,
		Amenities: v.Amenities, Status: string(v.Status), Photos: []photoResp{},
	}
	for _, p := range photos {
		out.Photos = append(out.Photos, photoDTO(p))
	}
	return out
}

func photoDTO(p sqlc.VenuePhoto) photoResp {
	return photoResp{ID: p.ID, URL: p.Url, Position: p.Position}
}

func priceString(n pgtype.Numeric) string {
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
	return fmt.Sprintf("%v", v)
}

func randHex() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
