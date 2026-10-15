package service

// Behavioral tests for the identity adapter and the
// subscription flow that depends on it.
//
// The repository interfaces are the seams: every fake below
// implements the real one, so the test exercises the REAL
// `BillingService` and `Subscribe` logic - only the storage
// is faked. A test that faked the service would be testing
// the test.

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
)

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type fakePlanRepo struct {
	plan *model.SubscriptionPlan
	err  error
}

func (f *fakePlanRepo) Create(context.Context, *model.SubscriptionPlan) error {
	return nil
}
func (f *fakePlanRepo) GetByID(context.Context, uint) (*model.SubscriptionPlan, error) {
	return nil, repository.ErrSubscriptionPlanNotFound
}
func (f *fakePlanRepo) GetByCode(_ context.Context, code string) (*model.SubscriptionPlan, error) {
	if f.err != nil {
		return nil, f.err
	}
	if f.plan == nil || f.plan.Code != code {
		return nil, repository.ErrSubscriptionPlanNotFound
	}
	return f.plan, nil
}
func (f *fakePlanRepo) List(context.Context, bool, int, int) ([]*model.SubscriptionPlan, error) {
	return nil, nil
}
func (f *fakePlanRepo) Update(context.Context, *model.SubscriptionPlan) error { return nil }
func (f *fakePlanRepo) Delete(context.Context, uint) error                    { return nil }

type fakeSubRepo struct {
	created *model.Subscription
}

func (f *fakeSubRepo) Create(_ context.Context, sub *model.Subscription) error {
	f.created = sub
	return nil
}
func (f *fakeSubRepo) GetByID(context.Context, uint) (*model.Subscription, error) {
	return nil, repository.ErrSubscriptionNotFound
}
func (f *fakeSubRepo) GetByUserID(context.Context, uint) (*model.Subscription, error) {
	return nil, repository.ErrSubscriptionNotFound
}
func (f *fakeSubRepo) Cancel(context.Context, uint, string) error {
	return repository.ErrSubscriptionNotFound
}
func (f *fakeSubRepo) GetExpiring(context.Context, int) ([]*model.Subscription, error) {
	return nil, nil
}
func (f *fakeSubRepo) Update(context.Context, *model.Subscription) error { return nil }
func (f *fakeSubRepo) List(context.Context, model.SubscriptionStatus, int, int) ([]*model.Subscription, error) {
	return nil, nil
}

type fakeIdentityRepo struct {
	calls    int
	lastUUID uuid.UUID
	billing  uint
	// lookupUUID is what Lookup returns. Zero means "no row".
	lookupUUID uuid.UUID
}

func (f *fakeIdentityRepo) Resolve(_ context.Context, authUUID uuid.UUID) (uint, error) {
	f.calls++
	f.lastUUID = authUUID
	return f.billing, nil
}

// Lookup is the reverse mapping, added with the activation hook.
//
// It exists on the fake because an interface that grows is the one case where a
// fake MUST grow with it, and the compiler tells us which fakes are now
// incomplete. The fake returns the id it was given rather than erroring so
// existing tests, which never call it, keep passing for the right reason.
func (f *fakeIdentityRepo) Lookup(_ context.Context, billingID uint) (uuid.UUID, error) {
	if f.lookupUUID == uuid.Nil {
		return uuid.Nil, fmt.Errorf("billing user %d has no identity row", billingID)
	}
	return f.lookupUUID, nil
}

type fireCall struct {
	user  string
	plan  string
	start time.Time
	end   time.Time
}

type fakeFirer struct {
	calls []fireCall
	err   error
}

func (f *fakeFirer) GrantSubscription(_ context.Context, authUserID, planCode string, periodStart, periodEnd time.Time) error {
	f.calls = append(f.calls, fireCall{user: authUserID, plan: planCode, start: periodStart, end: periodEnd})
	return f.err
}

// newTestService builds a BillingService whose touched
// dependencies are fakes. The repositories Subscribe never
// reaches are nil - and would panic loudly if it tried.
func newTestService(plan *model.SubscriptionPlan, identity *fakeIdentityRepo, subs *fakeSubRepo) (*BillingService, *fakeFirer) {
	svc := NewBillingService(
		&fakePlanRepo{plan: plan},
		subs,
		nil, // taxRepo - not on the Subscribe path
		nil, // invoiceRepo
		nil, // itemRepo
		nil, // paymentRepo
		nil, // expenseRepo
		identity,
		nil, // pushAllocRepo - not on the Subscribe path
	)
	firer := &fakeFirer{}
	svc.SetEntitlementFirer(firer)
	return svc, firer
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

func TestResolveBillingUserIDDelegatesTheParsedUUID(t *testing.T) {
	identity := &fakeIdentityRepo{billing: 42}
	svc, _ := newTestService(nil, identity, &fakeSubRepo{})

	theUUID := "11111111-2222-3333-4444-555555555555"
	got, err := svc.ResolveBillingUserID(context.Background(), theUUID)
	if err != nil {
		t.Fatalf("ResolveBillingUserID(%q): %v", theUUID, err)
	}
	if got != 42 {
		t.Errorf("billing id = %d, want the adapter's 42", got)
	}
	if identity.calls != 1 {
		t.Fatalf("repository Resolve called %d times, want 1", identity.calls)
	}
	if identity.lastUUID.String() != theUUID {
		t.Errorf("repository got UUID %s, want %s", identity.lastUUID, theUUID)
	}
}

// The old billing id space was bare uints. A token carrying
// one is not a user - it is the exact claim shape that used
// to crash Subscribe, and it must fail BEFORE any storage.
func TestResolveBillingUserIDRejectsTheOldUintSpace(t *testing.T) {
	identity := &fakeIdentityRepo{}
	svc, _ := newTestService(nil, identity, &fakeSubRepo{})

	for _, bad := range []string{"12345", "not-a-uuid", "", "  ", "******-****-****-****-************"} {
		_, err := svc.ResolveBillingUserID(context.Background(), bad)
		if !errors.Is(err, ErrIdentityNotResolvable) {
			t.Errorf("ResolveBillingUserID(%q) error = %v, want ErrIdentityNotResolvable", bad, err)
		}
	}
	if identity.calls != 0 {
		t.Errorf("repository Resolve called %d times for unparseable ids, want 0 - a malformed claim must not touch storage", identity.calls)
	}
}

func TestResolveBillingUserIDTrimsTheClaim(t *testing.T) {
	identity := &fakeIdentityRepo{billing: 7}
	svc, _ := newTestService(nil, identity, &fakeSubRepo{})

	// Tokens arrive with surrounding whitespace more often than
	// anybody expects; the adapter must not reject one over it.
	if _, err := svc.ResolveBillingUserID(context.Background(),
		"  11111111-2222-3333-4444-555555555555  "); err != nil {
		t.Fatalf("padded UUID rejected: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Subscribe: resolve, write, fire
// ---------------------------------------------------------------------------

func testPlan() *model.SubscriptionPlan {
	return &model.SubscriptionPlan{
		ID:     1,
		Code:   "pro-monthly",
		Name:   "Pro Monthly",
		Cycle:  model.BillingCycleMonthly,
		IsActive: true,
	}
}

func TestSubscribeResolvesTheUUIDOntoTheBillingID(t *testing.T) {
	identity := &fakeIdentityRepo{billing: 42}
	subs := &fakeSubRepo{}
	svc, firer := newTestService(testPlan(), identity, subs)

	theUUID := "11111111-2222-3333-4444-555555555555"
	sub, err := svc.Subscribe(context.Background(), theUUID, "pro-monthly", true)
	if err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	// The ROW keys by the billing uint the adapter produced,
	// never by the UUID string.
	if sub.UserID != 42 {
		t.Errorf("subscription.UserID = %d, want 42 (the adapter's billing id)", sub.UserID)
	}
	if !sub.AutoRenew {
		t.Error("AutoRenew not carried onto the row")
	}

	// The FIRE carries the AUTH UUID - auth's entitlement
	// endpoint resolves users by it.
	if len(firer.calls) != 1 {
		t.Fatalf("entitlement fired %d times, want 1", len(firer.calls))
	}
	call := firer.calls[0]
	if call.user != theUUID {
		t.Errorf("fire carried user %q, want the auth UUID %q", call.user, theUUID)
	}
	if call.plan != "pro-monthly" {
		t.Errorf("fire carried plan %q, want pro-monthly", call.plan)
	}
	if !call.end.After(call.start) {
		t.Errorf("fire carried period [%s, %s]: the end must be after the start", call.start, call.end)
	}
}

func TestSubscribeRejectsAnUnresolvableUserBeforeAnyWrite(t *testing.T) {
	identity := &fakeIdentityRepo{}
	subs := &fakeSubRepo{}
	svc, firer := newTestService(testPlan(), identity, subs)

	// "9999" is a bare uint - the id space billing used to
	// carry. It names no user, so nothing may be written.
	_, err := svc.Subscribe(context.Background(), "9999", "pro-monthly", false)
	if !errors.Is(err, ErrIdentityNotResolvable) {
		t.Fatalf("Subscribe(9999) error = %v, want ErrIdentityNotResolvable", err)
	}
	if subs.created != nil {
		t.Error("a subscription row was created for an unresolvable user")
	}
	if len(firer.calls) != 0 {
		t.Error("an entitlement grant was fired for an unresolvable user")
	}
}

// THE failure-semantics decision: the payment already happened
// by the time the fire runs. A refused grant must not take the
// subscription down with it - the operator reconciles the grant,
// the user keeps what they paid for.
func TestSubscribeSurvivesAFiredGrantFailure(t *testing.T) {
	identity := &fakeIdentityRepo{billing: 42}
	subs := &fakeSubRepo{}
	svc, firer := newTestService(testPlan(), identity, subs)
	firer.err = errors.New("auth-service unreachable")

	sub, err := svc.Subscribe(context.Background(),
		"11111111-2222-3333-4444-555555555555", "pro-monthly", false)
	if err != nil {
		t.Fatalf("Subscribe returned the fire's error (%v) - a completed sale must not roll back", err)
	}
	if sub == nil || sub.UserID != 42 {
		t.Fatal("the subscription itself was lost")
	}
}

// No firer wired (the state tests may leave, and the state
// main.go never enters): the flow still completes.
func TestSubscribeWithoutAFirerStillSubscribes(t *testing.T) {
	identity := &fakeIdentityRepo{billing: 42}
	subs := &fakeSubRepo{}
	svc := NewBillingService(&fakePlanRepo{plan: testPlan()}, subs,
		nil, nil, nil, nil, nil, identity, nil)

	if _, err := svc.Subscribe(context.Background(),
		"11111111-2222-3333-4444-555555555555", "pro-monthly", false); err != nil {
		t.Fatalf("Subscribe without a firer: %v", err)
	}
	if subs.created == nil {
		t.Fatal("no subscription row was written")
	}
}
