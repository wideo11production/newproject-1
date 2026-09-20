package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/withdrawal-service/src/model"
	"newproject/services/withdrawal-service/src/repository"
	"newproject/services/withdrawal-service/src/service"
)

type Handler struct {
	svc *service.WithdrawalService
}

func NewHandler(svc *service.WithdrawalService) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	kyc := r.Group("/kyc")
	{
		kyc.POST("", h.SubmitKYC)
		kyc.PUT("/:id/verify", h.VerifyKYC)
		kyc.GET("/user/:user_id", h.GetKYC)
	}

	withdrawals := r.Group("/withdrawals")
	{
		withdrawals.POST("", h.RequestWithdrawal)
		withdrawals.GET("/user/:user_id", h.ListWithdrawals)
		withdrawals.GET("/:id", h.GetWithdrawal)
		withdrawals.GET("/uuid/:uuid", h.GetWithdrawalByUUID)
		withdrawals.GET("/status/:status", h.ListWithdrawalsByStatus)
		withdrawals.PUT("/:id/approve", h.ApproveWithdrawal)
		withdrawals.PUT("/:id/reject", h.RejectWithdrawal)
		withdrawals.PUT("/:id/process", h.ProcessWithdrawal)
		withdrawals.PUT("/:id/complete", h.CompleteWithdrawal)
		withdrawals.PUT("/:id/fail", h.FailWithdrawal)
		withdrawals.PUT("/:id/cancel", h.CancelWithdrawal)
	}

	banks := r.Group("/bank-accounts")
	{
		banks.POST("", h.AddBankAccount)
		banks.GET("/user/:user_id", h.ListBankAccounts)
		banks.GET("/user/:user_id/default", h.GetDefaultBankAccount)
		banks.PUT("/:id", h.UpdateBankAccount)
		banks.DELETE("/:id", h.DeleteBankAccount)
		banks.PUT("/:id/default", h.SetDefaultBankAccount)
	}

	config := r.Group("/config")
	{
		config.GET("", h.GetConfig)
		config.PUT("", h.UpdateConfig)
	}

	rules := r.Group("/approval-rules")
	{
		rules.POST("", h.CreateApprovalRule)
		rules.GET("", h.GetApprovalRules)
	}
}

func (h *Handler) SubmitKYC(c *gin.Context) {
	var req struct {
		UserID       uint                `json:"user_id" binding:"required"`
		DocumentType model.KYCDocumentType `json:"document_type" binding:"required"`
		DocumentNumber string            `json:"document_number" binding:"required"`
		DocumentImage  string            `json:"document_image" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	kyc, err := h.svc.SubmitKYC(c.Request.Context(), req.UserID, req.DocumentType, req.DocumentNumber, req.DocumentImage)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"kyc": kyc})
}

func (h *Handler) VerifyKYC(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid KYC ID"})
		return
	}
	var req struct {
		VerifiedBy uint   `json:"verified_by" binding:"required"`
		Approved   bool   `json:"approved"`
		Reason     string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	kyc, err := h.svc.VerifyKYC(c.Request.Context(), uint(id), req.VerifiedBy, req.Approved, req.Reason)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kyc": kyc})
}

func (h *Handler) GetKYC(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	kyc, err := h.svc.GetKYC(c.Request.Context(), uint(userID))
	if err != nil {
		if err == repository.ErrKYCNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "KYC not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kyc": kyc})
}

func (h *Handler) RequestWithdrawal(c *gin.Context) {
	var req struct {
		UserID         uint   `json:"user_id" binding:"required"`
		WalletID       uint   `json:"wallet_id" binding:"required"`
		Amount         string `json:"amount" binding:"required"`
		PaymentMethod  string `json:"payment_method" binding:"required"`
		BankAccountID  *uint  `json:"bank_account_id,omitempty"`
		UpiID          string `json:"upi_id,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	w, err := h.svc.RequestWithdrawal(c.Request.Context(), req.UserID, req.WalletID, req.Amount, req.PaymentMethod, req.BankAccountID, req.UpiID)
	if err != nil {
		if err == repository.ErrLimitExceeded {
			c.JSON(http.StatusBadRequest, gin.H{"error": "withdrawal limit exceeded"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"withdrawal": w})
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

func (h *Handler) GetWithdrawalByUUID(c *gin.Context) {
	w, err := h.svc.GetWithdrawalByUUID(c.Request.Context(), c.Param("uuid"))
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

func (h *Handler) ListWithdrawals(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	withdrawals, err := h.svc.ListWithdrawals(c.Request.Context(), uint(userID), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawals": withdrawals})
}

func (h *Handler) ListWithdrawalsByStatus(c *gin.Context) {
	status := model.WithdrawalStatus(c.Param("status"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	withdrawals, err := h.svc.ListWithdrawalsByStatus(c.Request.Context(), status, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawals": withdrawals})
}

func (h *Handler) ApproveWithdrawal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid withdrawal ID"})
		return
	}
	var req struct {
		ApprovedBy uint `json:"approved_by" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	w, err := h.svc.ApproveWithdrawal(c.Request.Context(), uint(id), req.ApprovedBy)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawal": w})
}

func (h *Handler) RejectWithdrawal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid withdrawal ID"})
		return
	}
	var req struct {
		ApprovedBy uint   `json:"approved_by" binding:"required"`
		Reason     string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	w, err := h.svc.RejectWithdrawal(c.Request.Context(), uint(id), req.ApprovedBy, req.Reason)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawal": w})
}

func (h *Handler) ProcessWithdrawal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid withdrawal ID"})
		return
	}
	var req struct {
		ProcessedBy uint `json:"processed_by" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	w, err := h.svc.ProcessWithdrawal(c.Request.Context(), uint(id), req.ProcessedBy)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawal": w})
}

func (h *Handler) CompleteWithdrawal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid withdrawal ID"})
		return
	}
	var req struct {
		ProviderRef string `json:"provider_ref"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	w, err := h.svc.CompleteWithdrawal(c.Request.Context(), uint(id), req.ProviderRef)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawal": w})
}

func (h *Handler) FailWithdrawal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid withdrawal ID"})
		return
	}
	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	w, err := h.svc.FailWithdrawal(c.Request.Context(), uint(id), req.Reason)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawal": w})
}

func (h *Handler) CancelWithdrawal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid withdrawal ID"})
		return
	}
	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	w, err := h.svc.CancelWithdrawal(c.Request.Context(), uint(id), req.Reason)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawal": w})
}

func (h *Handler) AddBankAccount(c *gin.Context) {
	var req struct {
		UserID        uint   `json:"user_id" binding:"required"`
		AccountHolder string `json:"account_holder" binding:"required"`
		AccountNumber string `json:"account_number" binding:"required"`
		IFSC          string `json:"ifsc" binding:"required"`
		BankName      string `json:"bank_name"`
		Branch        string `json:"branch"`
		AccountType   string `json:"account_type"`
		IsDefault     bool   `json:"is_default"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ba := &model.BankAccount{
		UserID:        req.UserID,
		AccountHolder: req.AccountHolder,
		AccountNumber: req.AccountNumber,
		IFSC:          req.IFSC,
		BankName:      req.BankName,
		Branch:        req.Branch,
		AccountType:   req.AccountType,
		IsDefault:     req.IsDefault,
	}
	if err := h.svc.AddBankAccount(c.Request.Context(), ba); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"bank_account": ba})
}

func (h *Handler) ListBankAccounts(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
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
	userID, err := strconv.ParseUint(c.Param("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
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
	bankAccountID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid bank account ID"})
		return
	}
	var req struct {
		UserID uint `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetDefaultBankAccount(c.Request.Context(), req.UserID, uint(bankAccountID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "default bank account set"})
}

func (h *Handler) GetConfig(c *gin.Context) {
	cfg, err := h.svc.GetConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": cfg})
}

func (h *Handler) UpdateConfig(c *gin.Context) {
	var req struct {
		MinAmount     string `json:"min_amount"`
		MaxAmount     string `json:"max_amount"`
		FeeRate       string `json:"fee_rate"`
		MinFee        string `json:"min_fee"`
		MaxFee        string `json:"max_fee"`
		KYCThreshold  string `json:"kyc_threshold"`
		DailyLimit    string `json:"daily_limit"`
		WeeklyLimit   string `json:"weekly_limit"`
		KYCRequired   bool   `json:"kyc_required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cfg, err := h.svc.UpdateConfig(c.Request.Context(), req.MinAmount, req.MaxAmount, req.FeeRate, req.MinFee, req.MaxFee, req.KYCThreshold, req.DailyLimit, req.WeeklyLimit, req.KYCRequired)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": cfg})
}

func (h *Handler) CreateApprovalRule(c *gin.Context) {
	var req struct {
		Level     int    `json:"level" binding:"required"`
		MinAmount string `json:"min_amount" binding:"required"`
		MaxAmount string `json:"max_amount" binding:"required"`
		Role      string `json:"role" binding:"required"`
		IsAuto    bool   `json:"is_auto"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rule, err := h.svc.CreateApprovalRule(c.Request.Context(), req.Level, req.MinAmount, req.MaxAmount, req.Role, req.IsAuto)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"approval_rule": rule})
}

func (h *Handler) GetApprovalRules(c *gin.Context) {
	rules, err := h.svc.GetApprovalRules(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"approval_rules": rules})
}
