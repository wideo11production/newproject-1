package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/accounting-service/src/model"
	"newproject/services/accounting-service/src/repository"
	"newproject/services/accounting-service/src/service"
)

type Handler struct {
	svc *service.AccountingService
}

func NewHandler(svc *service.AccountingService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	accounts := r.Group("/accounts")
	{
		accounts.POST("", h.CreateAccount)
		accounts.GET("", h.ListAccounts)
		accounts.GET("/:id", h.GetAccount)
		accounts.PUT("/:id", h.UpdateAccount)
		accounts.GET("/type/:type", h.ListAccountsByType)
	}

	journals := r.Group("/journals")
	{
		journals.GET("/:id", h.GetJournal)
		journals.PUT("/:id/post", h.PostJournal)
		journals.PUT("/:id/void", h.VoidJournal)
		journals.GET("/:id/entries", h.GetJournalEntries)
	}

	transactions := r.Group("/transactions")
	{
		transactions.POST("", h.CreateTransaction)
		transactions.GET("/:id", h.GetTransaction)
		transactions.GET("/uuid/:uuid", h.GetTransactionByUUID)
		transactions.GET("/ref/:ref_type/:ref_id", h.GetTransactionByReference)
		transactions.PUT("/:id/post", h.PostTransaction)
		transactions.GET("/:id/entries", h.GetTransactionEntries)
	}

	balances := r.Group("/balances")
	{
		balances.GET("/:account_id", h.GetAccountBalance)
		balances.GET("/trial", h.GetTrialBalance)
	}
}

func (h *Handler) CreateAccount(c *gin.Context) {
	var req struct {
		Code        string          `json:"code" binding:"required"`
		Name        string          `json:"name" binding:"required"`
		Type        model.AccountType `json:"type" binding:"required"`
		Description string          `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	account, err := h.svc.CreateAccount(c.Request.Context(), req.Code, req.Name, req.Type, req.Description)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"account": account})
}

func (h *Handler) GetAccount(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid account ID"})
		return
	}
	account, err := h.svc.GetAccount(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrAccountNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"account": account})
}

func (h *Handler) ListAccounts(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	accounts, err := h.svc.ListAccounts(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"accounts": accounts})
}

func (h *Handler) ListAccountsByType(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	accounts, err := h.svc.ListAccountsByType(c.Request.Context(), model.AccountType(c.Param("type")), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"accounts": accounts})
}

func (h *Handler) UpdateAccount(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid account ID"})
		return
	}
	var req model.Account
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdateAccount(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"account": req})
}

func (h *Handler) GetJournal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid journal ID"})
		return
	}
	journal, err := h.svc.GetJournal(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrJournalNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "journal not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"journal": journal})
}

func (h *Handler) PostJournal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid journal ID"})
		return
	}
	if err := h.svc.PostJournal(c.Request.Context(), uint(id)); err != nil {
		if err == repository.ErrUnbalancedJournal {
			c.JSON(http.StatusBadRequest, gin.H{"error": "journal is not balanced"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "journal posted"})
}

func (h *Handler) VoidJournal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid journal ID"})
		return
	}
	if err := h.svc.VoidJournal(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "journal voided"})
}

func (h *Handler) GetJournalEntries(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid journal ID"})
		return
	}
	entries, err := h.svc.GetJournalEntries(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries})
}

func (h *Handler) CreateTransaction(c *gin.Context) {
	var req service.CreateJournalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	txn, err := h.svc.CreateTransaction(c.Request.Context(), req)
	if err != nil {
		if err == repository.ErrUnbalancedJournal {
			c.JSON(http.StatusBadRequest, gin.H{"error": "journal is not balanced: debits must equal credits"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"transaction": txn})
}

func (h *Handler) GetTransaction(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transaction ID"})
		return
	}
	txn, err := h.svc.GetTransaction(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrTransactionNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"transaction": txn})
}

func (h *Handler) GetTransactionByUUID(c *gin.Context) {
	txn, err := h.svc.GetTransactionByUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		if err == repository.ErrTransactionNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"transaction": txn})
}

func (h *Handler) GetTransactionByReference(c *gin.Context) {
	txn, err := h.svc.GetTransactionByReference(c.Request.Context(), c.Param("ref_type"), c.Param("ref_id"))
	if err != nil {
		if err == repository.ErrTransactionNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"transaction": txn})
}

func (h *Handler) PostTransaction(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transaction ID"})
		return
	}
	txn, err := h.svc.PostTransaction(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"transaction": txn})
}

func (h *Handler) GetTransactionEntries(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transaction ID"})
		return
	}
	entries, err := h.svc.GetTransactionEntries(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries})
}

func (h *Handler) GetAccountBalance(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("account_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid account ID"})
		return
	}
	balance, err := h.svc.GetAccountBalance(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"account_id": id, "balance": balance})
}

func (h *Handler) GetTrialBalance(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	balances, err := h.svc.GetTrialBalance(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"balances": balances})
}
