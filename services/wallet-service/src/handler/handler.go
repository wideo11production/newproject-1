package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"newproject/services/wallet-service/src/model"
	"newproject/services/wallet-service/src/repository"
	"newproject/services/wallet-service/src/service"
)

type Handler struct {
	svc *service.WalletService
}

func NewHandler(svc *service.WalletService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	wallets := r.Group("/wallets")
	{
		wallets.POST("", h.CreateOrGetWallet)
		wallets.GET("", h.GetWallet)
		wallets.GET("/:id", h.GetWalletByID)
		wallets.POST("/credit", h.Credit)
		wallets.POST("/debit", h.Debit)
		wallets.POST("/hold", h.Hold)
		wallets.POST("/release", h.ReleaseHold)
		wallets.GET("/:user_id/transactions", h.ListTransactions)
		wallets.GET("/transactions/:id", h.GetTransaction)
	}

	withdrawals := r.Group("/withdrawals")
	{
		withdrawals.POST("", h.RequestWithdrawal)
		withdrawals.GET("", h.ListWithdrawals)
		withdrawals.GET("/:id", h.GetWithdrawal)
		withdrawals.PUT("/:id/approve", h.ApproveWithdrawal)
		withdrawals.PUT("/:id/reject", h.RejectWithdrawal)
	}

	banks := r.Group("/bank-accounts")
	{
		banks.POST("", h.AddBankAccount)
		banks.GET("", h.ListBankAccounts)
		banks.GET("/default", h.GetDefaultBankAccount)
		banks.PUT("/:id", h.UpdateBankAccount)
		banks.DELETE("/:id", h.DeleteBankAccount)
		banks.PUT("/default", h.SetDefaultBankAccount)
	}
}

func (h *Handler) CreateOrGetWallet(c *gin.Context) {
	var req struct {
		UserID   uint   `json:"user_id" binding:"required"`
		Currency string `json:"currency"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "INR"
	}
	wallet, err := h.svc.GetOrCreateWallet(c.Request.Context(), req.UserID, req.Currency)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"wallet": wallet})
}

func (h *Handler) GetWallet(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Query("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id required"})
		return
	}
	currency := c.Query("currency")
	if currency == "" {
		currency = "INR"
	}
	wallet, err := h.svc.GetWallet(c.Request.Context(), uint(userID), currency)
	if err != nil {
		if err == repository.ErrWalletNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "wallet not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"wallet": wallet})
}

func (h *Handler) GetWalletByID(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid wallet ID"})
		return
	}
	wallet, err := h.svc.GetWalletByID(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrWalletNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "wallet not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"wallet": wallet})
}

func (h *Handler) Credit(c *gin.Context) {
	var req struct {
		UserID      uint            `json:"user_id" binding:"required"`
		Currency    string          `json:"currency"`
		Amount      decimal.Decimal `json:"amount" binding:"required"`
		ReferenceID string          `json:"reference_id"`
		Description string          `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "INR"
	}
	txn, err := h.svc.Credit(c.Request.Context(), req.UserID, req.Currency, req.Amount, "external", req.ReferenceID, req.Description)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"transaction": txn})
}

func (h *Handler) Debit(c *gin.Context) {
	var req struct {
		UserID      uint            `json:"user_id" binding:"required"`
		Currency    string          `json:"currency"`
		Amount      decimal.Decimal `json:"amount" binding:"required"`
		ReferenceID string          `json:"reference_id"`
		Description string          `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "INR"
	}
	txn, err := h.svc.Debit(c.Request.Context(), req.UserID, req.Currency, req.Amount, "external", req.ReferenceID, req.Description)
	if err != nil {
		if err == repository.ErrInsufficientFunds {
			c.JSON(http.StatusBadRequest, gin.H{"error": "insufficient funds"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"transaction": txn})
}

func (h *Handler) Hold(c *gin.Context) {
	var req struct {
		UserID      uint            `json:"user_id" binding:"required"`
		Currency    string          `json:"currency"`
		Amount      decimal.Decimal `json:"amount" binding:"required"`
		ReferenceID string          `json:"reference_id"`
		Description string          `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "INR"
	}
	txn, err := h.svc.Hold(c.Request.Context(), req.UserID, req.Currency, req.Amount, "external", req.ReferenceID, req.Description)
	if err != nil {
		if err == repository.ErrInsufficientFunds {
			c.JSON(http.StatusBadRequest, gin.H{"error": "insufficient funds"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"transaction": txn})
}

func (h *Handler) ReleaseHold(c *gin.Context) {
	var req struct {
		UserID      uint            `json:"user_id" binding:"required"`
		Currency    string          `json:"currency"`
		Amount      decimal.Decimal `json:"amount" binding:"required"`
		ReferenceID string          `json:"reference_id"`
		Description string          `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "INR"
	}
	txn, err := h.svc.ReleaseHold(c.Request.Context(), req.UserID, req.Currency, req.Amount, "external", req.ReferenceID, req.Description)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"transaction": txn})
}

func (h *Handler) ListTransactions(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	currency := c.Query("currency")
	if currency == "" {
		currency = "INR"
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	txns, err := h.svc.GetTransactions(c.Request.Context(), uint(userID), currency, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"transactions": txns})
}

func (h *Handler) GetTransaction(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transaction ID"})
		return
	}
	txn, err := h.svc.GetTransaction(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"transaction": txn})
}

func (h *Handler) RequestWithdrawal(c *gin.Context) {
	var req struct {
		UserID       uint            `json:"user_id" binding:"required"`
		Currency     string          `json:"currency"`
		Amount       decimal.Decimal `json:"amount" binding:"required"`
		BankAccountID *uint          `json:"bank_account_id,omitempty"`
		UpiID        string          `json:"upi_id,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "INR"
	}
	w, err := h.svc.RequestWithdrawal(c.Request.Context(), req.UserID, req.Currency, req.Amount, req.BankAccountID, req.UpiID)
	if err != nil {
		if err == repository.ErrInsufficientFunds {
			c.JSON(http.StatusBadRequest, gin.H{"error": "insufficient withdrawable balance"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"withdrawal": w})
}

func (h *Handler) ListWithdrawals(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Query("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id required"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	withdrawals, err := h.svc.GetWithdrawals(c.Request.Context(), uint(userID), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawals": withdrawals})
}

func (h *Handler) GetWithdrawal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid withdrawal ID"})
		return
	}
	w, err := h.svc.GetWithdrawal(c.Request.Context(), uint(id))
	if err != nil {
		if err == repository.ErrWithdrawalNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "withdrawal not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawal": w})
}

func (h *Handler) ApproveWithdrawal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid withdrawal ID"})
		return
	}
	var req struct {
		ProcessorID uint `json:"processor_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ApproveWithdrawal(c.Request.Context(), uint(id), req.ProcessorID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "withdrawal approved"})
}

func (h *Handler) RejectWithdrawal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid withdrawal ID"})
		return
	}
	var req struct {
		ProcessorID uint   `json:"processor_id" binding:"required"`
		Reason      string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RejectWithdrawal(c.Request.Context(), uint(id), req.ProcessorID, req.Reason); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "withdrawal rejected"})
}

func (h *Handler) AddBankAccount(c *gin.Context) {
	var req model.BankAccount
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.AddBankAccount(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"bank_account": req})
}

func (h *Handler) ListBankAccounts(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Query("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id required"})
		return
	}
	accounts, err := h.svc.GetBankAccounts(c.Request.Context(), uint(userID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"bank_accounts": accounts})
}

func (h *Handler) GetDefaultBankAccount(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Query("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id required"})
		return
	}
	account, err := h.svc.GetDefaultBankAccount(c.Request.Context(), uint(userID))
	if err != nil {
		if err == repository.ErrBankAccountNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "no default bank account"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"bank_account": account})
}

func (h *Handler) UpdateBankAccount(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid bank account ID"})
		return
	}
	var req model.BankAccount
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.ID = uint(id)
	if err := h.svc.UpdateBankAccount(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"bank_account": req})
}

func (h *Handler) DeleteBankAccount(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid bank account ID"})
		return
	}
	if err := h.svc.DeleteBankAccount(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) SetDefaultBankAccount(c *gin.Context) {
	var req struct {
		UserID       uint `json:"user_id" binding:"required"`
		BankAccountID uint `json:"bank_account_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetDefaultBankAccount(c.Request.Context(), req.UserID, req.BankAccountID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "default bank account set"})
}
