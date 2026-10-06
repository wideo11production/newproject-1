package handler

// THE crash fix, proven over HTTP.
//
// Before the identity adapter, `POST /subscriptions`
// cast the token's UUID with `strconv.ParseUint`, which
// fails for every real user: every legitimate subscriber
// got 400 `user_id_not_resolvable`. These tests send
// real requests through the real `AuthRequired` guard
// and the real `Subscribe` handler with the REAL
// service behind them - only the storage is faked.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"newproject/services/billing-service/src/middleware"
	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
	"newproject/services/billing-service/src/service"
)

// The UUID of the user the test token will carry.
const testUserUUID = "11111111-2222-3333-4444-555555555555"

// subscribeRouter builds the ONE route under test with the
// same guard the real registration applies.
func subscribeRouter(t *testing.T, svc *service.BillingService) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	r := gin.New()
	personal := r.Group("/")
	personal.Use(middleware.AuthRequired())
	{
		personal.POST("/subscriptions", NewHandler(svc).Subscribe)
	}
	return r
}

// Fakes for the three repositories `Subscribe` touches.
// The other four are nil and would panic if reached.

type uuidPlanRepo struct{}

func (uuidPlanRepo) Create(context.Context, *model.SubscriptionPlan) error { return nil }
func (uuidPlanRepo) GetByID(context.Context, uint) (*model.SubscriptionPlan, error) {
	return nil, repository.ErrSubscriptionPlanNotFound
}
func (uuidPlanRepo) GetByCode(_ context.Context, code string) (*model.SubscriptionPlan, error) {
	if code != "pro-monthly" {
		return nil, repository.ErrSubscriptionPlanNotFound
	}
	return &model.SubscriptionPlan{ID: 1, Code: code, Cycle: model.BillingCycleMonthly}, nil
}
func (uuidPlanRepo) List(context.Context, bool, int, int) ([]*model.SubscriptionPlan, error) {
	return nil, nil
}
func (uuidPlanRepo) Update(context.Context, *model.SubscriptionPlan) error { return nil }
func (uuidPlanRepo) Delete(context.Context, uint) error                    { return nil }

type uuidSubRepo struct{ created *model.Subscription }

func (r *uuidSubRepo) Create(_ context.Context, sub *model.Subscription) error {
	r.created = sub
	return nil
}
func (r *uuidSubRepo) GetByID(context.Context, uint) (*model.Subscription, error) {
	return nil, repository.ErrSubscriptionNotFound
}
func (r *uuidSubRepo) GetByUserID(context.Context, uint) (*model.Subscription, error) {
	return nil, repository.ErrSubscriptionNotFound
}
func (r *uuidSubRepo) Cancel(context.Context, uint, string) error {
	return repository.ErrSubscriptionNotFound
}
func (r *uuidSubRepo) GetExpiring(context.Context, int) ([]*model.Subscription, error) {
	return nil, nil
}
func (r *uuidSubRepo) Update(context.Context, *model.Subscription) error { return nil }
func (r *uuidSubRepo) List(context.Context, model.SubscriptionStatus, int, int) ([]*model.Subscription, error) {
	return nil, nil
}

type uuidIdentityRepo struct{ billing uint }

func (r *uuidIdentityRepo) Resolve(_ context.Context, _ uuid.UUID) (uint, error) {
	return r.billing, nil
}

type recordingFirer struct {
	user string
	plan string
}

func (f *recordingFirer) GrantSubscription(_ context.Context, authUserID, planCode string, _, _ time.Time) error {
	f.user = authUserID
	f.plan = planCode
	return nil
}

// A real subscriber: a UUID in the token, the id space
// auth-service actually issues. Must be 201 - the crash
// was 400 `user_id_not_resolvable`.
func TestSubscribeAcceptsTheAuthUUIDToken(t *testing.T) {
	// `middleware.jwtSecret()` reads JWT_SECRET_KEY; without
	// it every request 500s and the test would pass for the
	// wrong reason. Same pattern as the authz tests.
	t.Setenv("JWT_SECRET_KEY", testJWTSecret)

	subs := &uuidSubRepo{}
	firer := &recordingFirer{}
	svc := service.NewBillingService(uuidPlanRepo{}, subs,
		nil, nil, nil, nil, nil, &uuidIdentityRepo{billing: 42})
	svc.SetEntitlementFirer(firer)

	r := subscribeRouter(t, svc)
	token := mintTestToken(t, testUserUUID, "user")

	req := httptest.NewRequest(http.MethodPost, "/subscriptions",
		strings.NewReader(`{"plan_code":"pro-monthly","auto_renew":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("POST /subscriptions with a UUID token = %d, want 201.\n"+
			"  body: %s\n"+
			"  Before the identity adapter this was 400 user_id_not_resolvable\n"+
			"  for EVERY real user, because a UUID is not a uint.",
			w.Code, strings.TrimSpace(w.Body.String()))
	}
	if subs.created == nil {
		t.Fatal("no subscription row was written")
	}
	if subs.created.UserID != 42 {
		t.Errorf("row user_id = %d, want 42 (the adapter's billing id)", subs.created.UserID)
	}
	if firer.user != testUserUUID {
		t.Errorf("entitlement fire carried %q, want the auth UUID", firer.user)
	}
	if firer.plan != "pro-monthly" {
		t.Errorf("entitlement fire carried plan %q, want pro-monthly", firer.plan)
	}
}

// The old billing id space: a bare uint in the token's
// user_id claim. Not a user. Must stay a 400 - but now
// because the adapter says so, not because a cast failed.
func TestSubscribeStillRejectsABareUintToken(t *testing.T) {
	t.Setenv("JWT_SECRET_KEY", testJWTSecret)

	subs := &uuidSubRepo{}
	svc := service.NewBillingService(uuidPlanRepo{}, subs,
		nil, nil, nil, nil, nil, &uuidIdentityRepo{billing: 42})

	r := subscribeRouter(t, svc)
	token := mintTestToken(t, "9999", "user")

	req := httptest.NewRequest(http.MethodPost, "/subscriptions",
		strings.NewReader(`{"plan_code":"pro-monthly"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("bare-uint token = %d, want 400", w.Code)
	}
	if !strings.Contains(w.Body.String(), "user_id_not_resolvable") {
		t.Errorf("body does not name the error: %s", strings.TrimSpace(w.Body.String()))
	}
	if subs.created != nil {
		t.Error("a row was written for a caller that is not a user")
	}
}
