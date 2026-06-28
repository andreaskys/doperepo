package venues

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

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
	rg.GET("/public/venues", h.listPublic)      // listagem da home
	rg.GET("/public/venues/:id", h.getPublic)   // detalhe (tela de reserva)
	rg.GET("/public/photos", h.listShowcasePhotos) // vitrine da landing (parallax)

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
	Address      string   `json:"address" binding:"required"`
	Neighborhood string   `json:"neighborhood"`
	City         string   `json:"city" binding:"required"`
	State        string   `json:"state" binding:"required"`
	Complement   string   `json:"complement"`
	Cep          string   `json:"cep"`
	Latitude     *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
	Amenities   []string `json:"amenities"`
	Features    []string `json:"features"`
}

func (r venueReq) toInput() VenueInput {
	return VenueInput{
		Title: r.Title, Description: r.Description, Capacity: r.Capacity,
		Price: r.Price, Address: r.Address, City: r.City, State: r.State,
		Neighborhood: r.Neighborhood, Complement: r.Complement, Cep: r.Cep,
		Latitude: r.Latitude, Longitude: r.Longitude, Amenities: r.Amenities, Features: r.Features,
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

// parseSearchFilters lê os filtros da query string. Valores inválidos viram
// sentinela (a listagem pública nunca retorna 400 por causa de filtro).
func parseSearchFilters(q url.Values) SearchFilters {
	f := SearchFilters{
		City:  q.Get("city"),
		Query: q.Get("q"),
	}
	if n, err := strconv.Atoi(strings.TrimSpace(q.Get("min_capacity"))); err == nil && n > 0 {
		f.MinCapacity = int32(n)
	}
	if mp := strings.TrimSpace(q.Get("max_price")); mp != "" {
		// Só aceita preço finito e positivo; o resto vira sentinela (sem filtro),
		// para nunca dar 500 no Numeric.Scan nem esvaziar a lista com valor negativo.
		if v, err := strconv.ParseFloat(mp, 64); err == nil && !math.IsInf(v, 0) && !math.IsNaN(v) && v > 0 {
			f.MaxPrice = mp
		}
	}
	if a := strings.TrimSpace(q.Get("amenities")); a != "" {
		for _, part := range strings.Split(a, ",") {
			if p := strings.TrimSpace(part); p != "" {
				f.Amenities = append(f.Amenities, p)
			}
		}
	}
	f.State = q.Get("state")
	if mp := strings.TrimSpace(q.Get("min_price")); mp != "" {
		if v, err := strconv.ParseFloat(mp, 64); err == nil && !math.IsInf(v, 0) && !math.IsNaN(v) && v > 0 {
			f.MinPrice = mp
		}
	}
	if s, err := time.Parse("2006-01-02", strings.TrimSpace(q.Get("start"))); err == nil {
		f.Start = &s
	}
	if e, err := time.Parse("2006-01-02", strings.TrimSpace(q.Get("end"))); err == nil {
		f.End = &e
	}
	return f
}

func (h *Handler) listPublic(c *gin.Context) {
	list, err := h.svc.Search(c.Request.Context(), parseSearchFilters(c.Request.URL.Query()))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao listar"})
		return
	}
	c.JSON(http.StatusOK, list)
}

type showcasePhotoDTO struct {
	VenueID int64  `json:"venue_id"`
	Title   string `json:"title"`
	URL     string `json:"url"`
}

// listShowcasePhotos: fotos dos espaços publicados (vitrine parallax da landing).
func (h *Handler) listShowcasePhotos(c *gin.Context) {
	rows, err := h.svc.PublishedPhotos(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao listar fotos"})
		return
	}
	out := make([]showcasePhotoDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, showcasePhotoDTO{VenueID: r.VenueID, Title: r.VenueTitle, URL: r.Url})
	}
	c.JSON(http.StatusOK, out)
}

// getPublic devolve o detalhe de um anúncio PUBLICADO (tela de reserva, sem auth).
func (h *Handler) getPublic(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return
	}
	v, err := h.svc.Get(c.Request.Context(), id)
	if err != nil || v.Status != sqlc.VenueStatusPUBLISHED {
		c.JSON(http.StatusNotFound, gin.H{"error": "anúncio não encontrado"})
		return
	}
	photos, _ := h.svc.Photos(c.Request.Context(), v.ID)
	c.JSON(http.StatusOK, venueDTO(v, photos))
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
	Address      string      `json:"address"`
	Neighborhood string      `json:"neighborhood"`
	City         string      `json:"city"`
	State        string      `json:"state"`
	Complement   string      `json:"complement"`
	Cep          string      `json:"cep"`
	Latitude     *float64    `json:"latitude"`
	Longitude   *float64    `json:"longitude"`
	Amenities   []string    `json:"amenities"`
	Features    []string    `json:"features"`
	Status      string      `json:"status"`
	Photos      []photoResp `json:"photos"`
}

type photoResp struct {
	ID       int64  `json:"id"`
	URL      string `json:"url"`
	Position int32  `json:"position"`
}

func venueDTO(v sqlc.Venue, photos []sqlc.VenuePhoto) venueResponse {
	out := venueResponse{
		ID: v.ID, HostID: v.HostID, Title: v.Title, Description: v.Description,
		Capacity: v.Capacity, PricePerDay: priceString(v.PricePerDay), Address: v.Address,
		Neighborhood: v.Neighborhood, Complement: v.Complement, Cep: v.Cep,
		City: v.City, State: v.State, Latitude: v.Latitude, Longitude: v.Longitude,
		Amenities: v.Amenities, Features: v.Features, Status: string(v.Status), Photos: []photoResp{},
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
