package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/billing-service/src/middleware"
	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
	"newproject/services/billing-service/src/service"
)

// mintServiceToken returns a service-to-service JWT with `service: "auth"`.
//
// This mirrors the BillingClient mint in auth-service's billing_client.go.
// It shares the same JWT_SECRET_KEY but carries a `service` claim instead
// of a `user_id`/`role` claim — the middleware discriminator.
func mintServiceToken(t *testing.T, svc string) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, &middleware.ServiceTokenClaims{
		Service: svc,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	})
	signed, err := token.SignedString([]byte(testJWTSecret))
	if err != nil {
		t.Fatalf("mint service token: %v", err)
	}
	return signed
}

// ---- Fake repositories for the student violation test ----

// recordingIdentityRepo records Resolve calls + returns configured billing ID.
type recordingIdentityRepo struct {
	resolved    uint
	resolveErr  error
	resolveCall bool
}

func (r *recordingIdentityRepo) Resolve(_ context.Context, _ uuid.UUID) (uint, error) {
	r.resolveCall = true
	if r.resolveErr != nil {
		return 0, r.resolveErr
	}
	return r.resolved, nil
}

func (r *recordingIdentityRepo) Lookup(_ context.Context, _ uint) (uuid.UUID, error) {
	return uuid.New(), nil
}

// recordingStudentRepo records revoke calls.
type recordingStudentRepo struct {
	revoked    bool
	revokedErr error
}

func (r *recordingStudentRepo) GetByUserID(_ context.Context, _ uint) (*model.StudentIdentity, error) {
	return &model.StudentIdentity{IsVerifiedStudent: true, Status: "verified"}, nil
}

func (r *recordingStudentRepo) Upsert(_ context.Context, _ *model.StudentIdentity) error { return nil }

func (r *recordingStudentRepo) RevokeByUserID(_ context.Context, _ uint) error {
	r.revoked = true
	return r.revokedErr
}

func (r *recordingStudentRepo) IsVerified(_ context.Context, _ uint) bool { return true }

// fakePlanRepo returns a plan with the given price.
type fakePlanRepo struct {
	price decimal.Decimal
}

func (f *fakePlanRepo) Create(context.Context, *model.SubscriptionPlan) error { return nil }
func (f *fakePlanRepo) GetByID(_ context.Context, _ uint) (*model.SubscriptionPlan, error) {
	return &model.SubscriptionPlan{ID: 1, Code: "student-trial", Price: f.price}, nil
}
func (f *fakePlanRepo) GetByCode(context.Context, string) (*model.SubscriptionPlan, error) {
	return nil, repository.ErrSubscriptionPlanNotFound
}
func (f *fakePlanRepo) List(context.Context, bool, int, int) ([]*model.SubscriptionPlan, error) {
	return nil, nil
}
func (f *fakePlanRepo) Update(context.Context, *model.SubscriptionPlan) error { return nil }
func (f *fakePlanRepo) Delete(context.Context, uint) error                  { return nil }

// fakeSubRepo returns a subscription for the user.
type fakeSubRepo struct{}

func (f *fakeSubRepo) Create(context.Context, *model.Subscription) error { return nil }
func (f *fakeSubRepo) GetByID(context.Context, uint) (*model.Subscription, error) {
	return nil, repository.ErrSubscriptionNotFound
}
func (f *fakeSubRepo) GetByUserID(_ context.Context, _ uint) (*model.Subscription, error) {
	return &model.Subscription{ID: 1, UserID: 1, PlanID: 1}, nil
}
func (f *fakeSubRepo) Cancel(context.Context, uint, string) error { return nil }
func (f *fakeSubRepo) GetExpiring(context.Context, int) ([]*model.Subscription, error) {
	return nil, nil
}
func (f *fakeSubRepo) Update(context.Context, *model.Subscription) error { return nil }
func (f *fakeSubRepo) List(context.Context, model.SubscriptionStatus, int, int) ([]*model.Subscription, error) {
	return nil, nil
}

// fakeViolationRepo records violations + returns configured counts.
type fakeViolationRepo struct {
	created           *model.ComplianceViolation
	prevWarnings      int64
	prevSuspensions  int64
	existingViolation *model.ComplianceViolation
}

func (f *fakeViolationRepo) Create(_ context.Context, v *model.ComplianceViolation) error {
	f.created = v
	return nil
}
func (f *fakeViolationRepo) GetByUserID(_ context.Context, _ uint) (*model.ComplianceViolation, error) {
	if f.existingViolation != nil {
		return f.existingViolation, nil
	}
	return nil, repository.ErrComplianceViolationNotFound
}
func (f *fakeViolationRepo) ListByUserID(_ context.Context, _ uint) ([]*model.ComplianceViolation, error) {
	if f.created != nil {
		return []*model.ComplianceViolation{f.created}, nil
	}
	return nil, nil
}
func (f *fakeViolationRepo) UpdateStatus(_ context.Context, _ uint, _ string, _ map[string]any) error {
	return nil
}
func (f *fakeViolationRepo) CountByUserIDAndStatus(_ context.Context, _ uint, status string) (int64, error) {
	if status == model.ViolationStatusWarning {
		return f.prevWarnings, nil
	}
	if status == model.ViolationStatusSuspended {
		return f.prevSuspensions, nil
	}
	return 0, nil
}

// fakeSystemLogRepo records log entries.
type fakeSystemLogRepo struct {
	created []*model.SystemLog
}

func (f *fakeSystemLogRepo) Create(_ context.Context, l *model.SystemLog) error {
	f.created = append(f.created, l)
	return nil
}
func (f *fakeSystemLogRepo) ListByUserID(_ context.Context, _ uint) ([]*model.SystemLog, error) {
	return f.created, nil
}

// studentViolationRouter builds the test router with service-token guard.
func studentViolationRouter(t *testing.T, svc *service.BillingService) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	r := gin.New()
	protected := r.Group("/internal")
	protected.Use(middleware.RequireServiceToken([]byte(testJWTSecret), "auth"))
	{
		protected.POST("/student/violation", NewStudentHandler(svc).RevokeForViolation)
	}
	return r
}

// TestStudentViolation_FirstViolationIssuesWarning verifies the first
// violation for a student user: identity revoked + warning logged (Step 1).
func TestStudentViolation_FirstViolationIssuesWarning(t *testing.T) {
	t.Setenv("JWT_SECRET_KEY", testJWTSecret)

	ident := &recordingIdentityRepo{resolved: 42}
	studRepo := &recordingStudentRepo{}
	planRepo := &fakePlanRepo{price: decimal.RequireFromString("100.00")}
	subRepo := &fakeSubRepo{}
	violRepo := &fakeViolationRepo{} // no previous violations
	logRepo := &fakeSystemLogRepo{}

	studentSvc := service.NewStudentService(studRepo, subRepo, planRepo)
	eng := service.NewComplianceEnforcementEngine(violRepo, logRepo, subRepo, planRepo)

	billingSvc := service.NewBillingService(nil, planRepo, subRepo,
		nil, nil, nil, nil, nil, ident, nil, nil, nil)
	billingSvc.SetStudentService(studentSvc)
	billingSvc.SetComplianceEnforcement(eng)

	r := studentViolationRouter(t, billingSvc)
	token := mintServiceToken(t, "auth")

	req := httptest.NewRequest(http.MethodPost, "/internal/student/violation",
		strings.NewReader(`{"user_id":"11111111-2222-3333-4444-555555555555","reason":"non_educational_content"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200\n body: %s", w.Code, w.Body.String())
	}

	// Identity must have been resolved.
	if !ident.resolveCall {
		t.Error("identity adapter was never called")
	}

	// Student identity must have been revoked.
	if !studRepo.revoked {
		t.Error("student identity was not revoked")
	}

	// Enforcement step must be "warning" (first violation).
	if violRepo.created == nil || violRepo.created.Status != model.ViolationStatusWarning {
		t.Errorf("violation not recorded as warning; created=%v", violRepo.created)
	}

	// A warning system log must have been emitted.
	if len(logRepo.created) == 0 {
		t.Error("no warning system log was emitted")
	}
}

// TestStudentViolation_RejectsNonServiceToken verifies that a regular
// user JWT (no `service` claim) is rejected by the service-token guard.
func TestStudentViolation_RejectsNonServiceToken(t *testing.T) {
	t.Setenv("JWT_SECRET_KEY", testJWTSecret)

	billingSvc := service.NewBillingService(nil,
		&fakePlanRepo{price: decimal.Decimal{}}, &fakeSubRepo{},
		nil, nil, nil, nil, nil, &recordingIdentityRepo{resolved: 1}, nil, nil, nil)

	r := studentViolationRouter(t, billingSvc)
	userToken := mintTestToken(t, "11111111-2222-3333-4444-555555555555", "user")

	req := httptest.NewRequest(http.MethodPost, "/internal/student/violation",
		strings.NewReader(`{"user_id":"11111111-2222-3333-4444-555555555555"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+userToken)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("user JWT status = %d, want 401 (service token required)", w.Code)
	}
}

// TestStudentViolation_RejectsWrongService verifies that a service token
// minted for a different service ("billing") is rejected.
func TestStudentViolation_RejectsWrongService(t *testing.T) {
	t.Setenv("JWT_SECRET_KEY", testJWTSecret)

	billingSvc := service.NewBillingService(nil,
		&fakePlanRepo{price: decimal.Decimal{}}, &fakeSubRepo{},
		nil, nil, nil, nil, nil, &recordingIdentityRepo{resolved: 1}, nil, nil, nil)

	r := studentViolationRouter(t, billingSvc)
	badToken := mintServiceToken(t, "billing") // wrong service

	req := httptest.NewRequest(http.MethodPost, "/internal/student/violation",
		strings.NewReader(`{"user_id":"11111111-2222-3333-4444-555555555555"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+badToken)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong-service token status = %d, want 401", w.Code)
	}
}

// TestStudentViolation_RejectsBadUUID verifies invalid UUID returns 400.
func TestStudentViolation_RejectsBadUUID(t *testing.T) {
	t.Setenv("JWT_SECRET_KEY", testJWTSecret)

	billingSvc := service.NewBillingService(nil,
		&fakePlanRepo{price: decimal.Decimal{}}, &fakeSubRepo{},
		nil, nil, nil, nil, nil, &recordingIdentityRepo{resolved: 1}, nil, nil, nil)

	r := studentViolationRouter(t, billingSvc)
	token := mintServiceToken(t, "auth")

	req := httptest.NewRequest(http.MethodPost, "/internal/student/violation",
		strings.NewReader(`{"user_id":"not-a-uuid"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad UUID status = %d, want 400", w.Code)
	}
}
