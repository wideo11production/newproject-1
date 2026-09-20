package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"newproject/services/royalty-service/src/model"
	"newproject/services/royalty-service/src/repository"
	"newproject/services/royalty-service/src/service"
)

type Handler struct {
	svc *service.RoyaltyService
}

func NewHandler(svc *service.RoyaltyService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	tiers := r.Group("/rate-tiers")
	{
		tiers.POST("", h.CreateRateTier)
		tiers.GET("", h.ListRateTiers)
		tiers.GET("/:id", h.GetRateTier)
		tiers.PUT("/:id", h.UpdateRateTier)
	}

	fees := r.Group("/platform-fees")
	{
		fees.POST("", h.CreatePlatformFee)
		fees.GET("", h.GetPlatformFee)
		fees.PUT("/:id", h.UpdatePlatformFee)
	}

	royalties := r.Group("/royalties")
	{
		royalties.POST("/calculate", h.CalculateRoyalty)
		royalties.GET("/user/:user_id", h.ListRoyalties)
		royalties.GET("/:id", h.GetRoyalty)
		royalties.GET("/uuid/:uuid", h.GetRoyaltyByUUID)
		royalties.GET("/user/:user_id/period/:start/:end", h.GetRoyaltiesByPeriod)
		royalties.GET("/pending", h.GetPendingRoyalties)
		royalties.PUT("/:id/pay", h.MarkAsPaid)
		royalties.GET("/user/:user_id/period/:start/:end/sum", h.SumRoyalties)
	}
}

func (h *Handler) CreateRateTier(c *gin.Context) {
	var req struct {
		Currency    model.Currency        `json:"currency" binding:"required"`
		MinRevenue  string                `json:"min_revenue" binding:"required"`
		MaxRevenue  string                `json:"max_revenue"`
		Rate        string                `json:"rate" binding:"required"`
		Source      model.RevenueSource   `json:"source"`
		Name        string                `json:"name"`
		Description string                `json:"description"`
		IsDefault   bool                  `json:"is_default"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	tier, err := h.svc.CreateRateTier(c.Request.Context(), req.Currency, req.MinRevenue, req.MaxRevenue, req.Rate, req.Source, req.Name, req.Description, req.IsDefault)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"rate_tier": tier})
}

func (h *Handler) GetRateTier(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tier ID"})
		return
	}
	tier, err := h.svc.GetRateTier(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrRateTierNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "rate tier not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rate_tier": tier})
}

func (h *Handler) ListRateTiers(c *gin.Context) {
	currency := model.Currency(c.Query("currency"))
	if currency == "" {
		currency = model.CurrencyINR
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	tiers, err := h.svc.ListRateTiers(c.Request.Context(), currency, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rate_tiers": tiers})
}

func (h *Handler) UpdateRateTier(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tier ID"})
		return
	}
	var req model.RateTier
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdateRateTier(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rate_tier": req})
}

func (h *Handler) CreatePlatformFee(c *gin.Context) {
	var req struct {
		Currency    model.Currency      `json:"currency" binding:"required"`
		Rate        string              `json:"rate" binding:"required"`
		MinFee      string              `json:"min_fee"`
		MaxFee      string              `json:"max_fee"`
		Source      model.RevenueSource `json:"source" binding:"required"`
		Description string              `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	fee, err := h.svc.CreatePlatformFee(c.Request.Context(), req.Currency, req.Rate, req.MinFee, req.MaxFee, req.Source, req.Description)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"platform_fee": fee})
}

func (h *Handler) GetPlatformFee(c *gin.Context) {
	currency := model.Currency(c.Query("currency"))
	if currency == "" {
		currency = model.CurrencyINR
	}
	fee, err := h.svc.GetPlatformFee(c.Request.Context(), currency)
	if err != nil {
		if err == repository.ErrPlatformFeeNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "platform fee not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"platform_fee": fee})
}

func (h *Handler) UpdatePlatformFee(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid fee ID"})
		return
	}
	var req model.PlatformFee
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdatePlatformFee(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"platform_fee": req})
}

func (h *Handler) CalculateRoyalty(c *gin.Context) {
	var req struct {
		UserID       uint                `json:"user_id" binding:"required"`
		Currency     model.Currency      `json:"currency" binding:"required"`
		GrossRevenue string              `json:"gross_revenue" binding:"required"`
		Source       model.RevenueSource `json:"source"`
		PeriodStart  string              `json:"period_start" binding:"required"`
		PeriodEnd    string              `json:"period_end" binding:"required"`
		ReferenceID  string              `json:"reference_id"`
		Description  string              `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	start, err := time.Parse("2006-01-02", req.PeriodStart)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid period_start"})
		return
	}
	end, err := time.Parse("2006-01-02", req.PeriodEnd)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid period_end"})
		return
	}
	record, err := h.svc.CalculateRoyalty(c.Request.Context(), req.UserID, req.Currency, req.GrossRevenue, req.Source, start, end, req.ReferenceID, req.Description)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"royalty_record": record})
}

func (h *Handler) GetRoyalty(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid royalty ID"})
		return
	}
	record, err := h.svc.GetRoyaltyRecord(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrRoyaltyNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "royalty record not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"royalty_record": record})
}

func (h *Handler) GetRoyaltyByUUID(c *gin.Context) {
	record, err := h.svc.GetRoyaltyRecordByUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		if err == repository.ErrRoyaltyNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "royalty record not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"royalty_record": record})
}

func (h *Handler) ListRoyalties(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	records, err := h.svc.ListRoyaltyRecords(c.Request.Context(), uint(userID), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"royalty_records": records})
}

func (h *Handler) GetRoyaltiesByPeriod(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	start, err := time.Parse("2006-01-02", c.Param("start"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start date"})
		return
	}
	end, err := time.Parse("2006-01-02", c.Param("end"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end date"})
		return
	}
	records, err := h.svc.GetRoyaltiesByPeriod(c.Request.Context(), uint(userID), start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"royalty_records": records})
}

func (h *Handler) GetPendingRoyalties(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	records, err := h.svc.GetPendingRoyalties(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"royalty_records": records})
}

func (h *Handler) MarkAsPaid(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid royalty ID"})
		return
	}
	record, err := h.svc.MarkAsPaid(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"royalty_record": record})
}

func (h *Handler) SumRoyalties(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	start, err := time.Parse("2006-01-02", c.Param("start"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start date"})
		return
	}
	end, err := time.Parse("2006-01-02", c.Param("end"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end date"})
		return
	}
	total, err := h.svc.SumRoyaltiesByPeriod(c.Request.Context(), uint(userID), start, end)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"total": total, "currency": c.Query("currency")})
}
