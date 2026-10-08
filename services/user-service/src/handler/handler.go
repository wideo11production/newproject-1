package handler

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"newproject/services/user-service/src/model"
	"newproject/services/user-service/src/service"
)

type Handler struct {
	svc      *service.UserService
	student  *service.StudentVerificationEngine
}

func NewHandler(svc *service.UserService, student *service.StudentVerificationEngine) *Handler {
	return &Handler{svc: svc, student: student}
}

func (h *Handler) RegisterRoutes(r *gin.Engine) {
	users := r.Group("/users")
	{
		users.POST("", h.CreateUser)
		users.GET("", h.ListUsers)
		users.GET("/:id", h.GetUserByID)
		users.PUT("/:id", h.UpdateUser)
		users.DELETE("/:id", h.DeleteUser)
		users.GET("/uuid/:uuid", h.GetUserByUUID)
		users.GET("/email/:email", h.GetUserByEmail)
		users.GET("/username/:username", h.GetUserByUsername)
	}

	// AURA Student Gate routes (dual-gate verification)
	students := r.Group("/students")
	{
		// Gate A: instant domain-based verification (auto for academic emails)
		students.POST("/gate-a/:id", h.GateAVerification)
		// Gate B: ID card document upload + 365-day token
		students.POST("/gate-b/:id", h.SubmitIDDocument)
		// Admin/manual review
		students.POST("/approve/:id", h.ApproveDocumentVerification)
		students.POST("/reject/:id", h.RejectDocumentVerification)
		// Status check (used by billing-service & upload-service)
		students.GET("/:id/status", h.CheckStudentStatus)
	}

	auth := r.Group("/auth")
	{
		auth.POST("/login", h.Login)
		auth.POST("/change-password", h.ChangePassword)
	}
}

// CreateUser — registration handler with AUTOMATIC professional Gate A check.
//
// Hinglish: jab bhi user registration karta hai, to turant hi uska email
// domain professional seed list mein match karte hain. User ka professional
// role (student/tutor/advocate) determine karta hai ki kis domain list
// se match karenge. Agar match karta hai to instant Gate A verification
// (status = verified_by_domain). Agar match nahi karta to user "pending"
// state me jata hai, aur Gate B (document upload) ke liye tayar rehta hai.
//
// User directive: "Match the incoming registration payload instantly against
// our static global academic domain array grid."
func (h *Handler) CreateUser(c *gin.Context) {
	var req struct {
		Email            string  `json:"email" binding:"required,email"`
		Username         string  `json:"username" binding:"required,min=3,max=100"`
		Password         string  `json:"password" binding:"required,min=8"`
		ProfessionalRole *string `json:"professional_role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.svc.CreateUser(c.Request.Context(), req.Email, req.Username, req.Password)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Parse professional role from request
	var role model.ProfessionalRole
	if req.ProfessionalRole != nil {
		role = model.ProfessionalRole(*req.ProfessionalRole)
	}
	// Default to student if not specified
	if role == model.RoleUnset {
		role = model.RoleStudent
	}

	// ---- ProfessionaGate A AUTOMATIC TRIGGER ----
	//
	// Registration ke turant baad, email domain check karo. Agar professional
	// domain match kare to verification record turant create ho jayega
	// status = verified_by_domain ke saath. Agar domain match nahi kare to
	// user seedha pending state me rehta hai, aur jab zaroorat padegi tab
	// Gate B (document upload) pe switch karega.
	//
	// Error ko log karte hain lekin registration FAIL nahi karte:
	// domain check ek bonus feature hai, registration ka core kaam
	// (user banao) toh hoga hi, verification agar fail ho jaye to
	// user ke paas manual retry option rahega.
	var verification *model.StudentVerification
	if h.student != nil {
		sv, verr := h.student.VerifyProfessionalGateA(c.Request.Context(), user.ID, role)
		if verr != nil {
			verification = &model.StudentVerification{
				UserID:          user.ID,
				ProfessionalRole: role,
				Status:          model.VerificationPending,
			}
		} else {
			verification = sv
		}
	}

	response := gin.H{
		"user": user,
		"gate_a_result": gin.H{
			"status":             verification.Status,
			"auto_verified":      verification.Status == model.VerificationVerifiedByDomain,
			"token_expires_at":   verification.TokenExpiresAt,
			"email_domain":       verification.EmailDomain,
			"professional_role":  verification.ProfessionalRole,
		},
	}
	if verification.Status == model.VerificationVerifiedByDomain {
		response["message"] = "Registration successful — professional domain verified instantly (Gate A). Verification auto-approved."
	} else {
		response["message"] = "Registration successful. Professional domain not in seed list — Gate B document upload available."
	}

	c.JSON(http.StatusCreated, response)
}

func (h *Handler) GetUserByID(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	user, err := h.svc.GetUserByID(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (h *Handler) GetUserByUUID(c *gin.Context) {
	user, err := h.svc.GetUserByUUID(c.Request.Context(), c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (h *Handler) GetUserByEmail(c *gin.Context) {
	user, err := h.svc.GetUserByEmail(c.Request.Context(), c.Param("email"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (h *Handler) GetUserByUsername(c *gin.Context) {
	user, err := h.svc.GetUserByUsername(c.Request.Context(), c.Param("username"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (h *Handler) UpdateUser(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	user, err := h.svc.GetUserByID(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if email, ok := req["email"].(string); ok {
		user.Email = email
	}
	if username, ok := req["username"].(string); ok {
		user.Username = username
	}
	if status, ok := req["status"].(string); ok {
		user.Status = status
	}
	if verified, ok := req["verified"].(bool); ok {
		user.Verified = verified
	}

	if err := h.svc.UpdateUser(c.Request.Context(), user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (h *Handler) DeleteUser(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	if err := h.svc.DeleteUser(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) ListUsers(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	users, err := h.svc.ListUsers(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

func (h *Handler) Login(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user, err := h.svc.VerifyPassword(c.Request.Context(), req.Email, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "login successful",
		"user":    user,
	})
}

func (h *Handler) ChangePassword(c *gin.Context) {
	var req struct {
		UserID     uint   `json:"user_id" binding:"required"`
		OldPassword string `json:"old_password" binding:"required"`
		NewPassword string `json:"new_password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ChangePassword(c.Request.Context(), req.UserID, req.OldPassword, req.NewPassword); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "password changed"})
}

// ---------------------------------------------------------------------------
// AURA Student Gate handlers
// ---------------------------------------------------------------------------

// GateAVerification — instant academic domain check (Gate A).
// Hinglish: agar user ka email academic institution domain par hai to
// automatically verified_by_domain status milega. 365-day token mint hota hai.
func (h *Handler) GateAVerification(c *gin.Context) {
	userID, err := parseUserID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sv, err := h.student.VerifyStudentGateA(c.Request.Context(), userID)
	if err != nil {
		if err == service.ErrDomainNotAcademic {
			c.JSON(http.StatusForbidden, gin.H{"error": "email domain not in academic seed list"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": sv.Status, "token_expires_at": sv.TokenExpiresAt})
}

// SubmitIDDocument — Gate B: ID card upload fallback (365-day token).
// Hinglish: file upload MinIO/S3 pe parallel hoga — yaha sirf URL milta hai.
// Advocate ke liye Bar Association ID mandatory hota hai.
func (h *Handler) SubmitIDDocument(c *gin.Context) {
	userID, err := parseUserID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req struct {
		DocumentURL       string  `json:"document_url" binding:"required"`
		DocumentType      string  `json:"document_type"`
		ProfessionalRole  string  `json:"professional_role"`
		BarAssociationID  string  `json:"bar_association_id,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	role := model.ProfessionalRole(req.ProfessionalRole)
	if role == model.RoleUnset {
		role = model.RoleStudent
	}

	docType := model.DocumentType(req.DocumentType)
	if docType == "" {
		docType = model.DocTypeCollegeID
	}

	sv, err := h.student.SubmitIDDocument(c.Request.Context(), userID, req.DocumentURL, docType, role, req.BarAssociationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"status":            sv.Status,
		"token_expires_at":   sv.TokenExpiresAt,
		"professional_role":  sv.ProfessionalRole,
		"document_type":      sv.DocumentType,
		"bar_association_id": sv.BarAssociationID,
	})
}

// ApproveDocumentVerification — admin manual review approval.
func (h *Handler) ApproveDocumentVerification(c *gin.Context) {
	userID, err := parseUserID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req struct {
		ReviewedBy uint `json:"reviewed_by" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sv, err := h.student.ApproveDocumentVerification(c.Request.Context(), userID, req.ReviewedBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status":          sv.Status,
		"token_expires_at": sv.TokenExpiresAt,
	})
}

// RejectDocumentVerification — admin manual review rejection.
func (h *Handler) RejectDocumentVerification(c *gin.Context) {
	userID, err := parseUserID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req struct {
		ReviewedBy uint   `json:"reviewed_by" binding:"required"`
		Reason     string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sv, err := h.student.RejectDocumentVerification(c.Request.Context(), userID, req.ReviewedBy, req.Reason)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": sv.Status, "reason": sv.RejectionReason})
}

// CheckStudentStatus — verification status + token validity.
// Hinglish: billing-service aur upload-service is endpoint ko use karenge
// "kya ye student abhi verified hai?" puchne ke liye.
func (h *Handler) CheckStudentStatus(c *gin.Context) {
	userID, err := parseUserID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sv, ok := h.student.CheckStudentStatus(c.Request.Context(), userID)
	if sv == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "student verification record not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status":   sv.Status,
		"verified": ok,
		"token_expires_at": sv.TokenExpiresAt,
		"email_domain":     sv.EmailDomain,
	})
}

func parseUserID(s string) (uint, error) {
	id, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid user ID: %s", s)
	}
	return uint(id), nil
}
