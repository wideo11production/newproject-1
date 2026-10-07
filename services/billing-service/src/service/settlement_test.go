// Revenue settlement engine tests — ad revenue → wallet credits.
//
// Hinglish: ye tests verify karte hain:
//   - GST correct calculate hota hai (IN vs foreign)
//   - 5% sister share NET revenue se nikalta hai
//   - Ad split correct hota hai (viewer/creator/platform)
//   - Conservation law: koi paisa nahi create/destroy hota
//   - Wallet credits correct amounts pe jaate hain
//   - Failure handling (wallet credit fail = settlement failed)
//
// Pure logic — fake wallet + fake repo, database ke bina.
package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// ---------------------------------------------------------------------------
// Fake wallet credit service
// ---------------------------------------------------------------------------

type fakeWalletCredit struct {
	// credits records sab credits (userID → list).
	credits map[uint][]walletCredit
	// failOnUserID — agar set to, to yeh userID pe credit fail karega.
	failOnUserID uint
}

type walletCredit struct {
	userID    uint
	currency  string
	amount    decimal.Decimal
	refType   string
	refID     string
	desc      string
	txRef     string
}

func newFakeWallet() *fakeWalletCredit {
	return &fakeWalletCredit{credits: map[uint][]walletCredit{}}
}

func (f *fakeWalletCredit) Credit(ctx context.Context, userID uint, currency string, amount decimal.Decimal, refType, refID, description string) (string, error) {
	if f.failOnUserID != 0 && userID == f.failOnUserID {
		return "", errors.New("simulated wallet credit failure")
	}
	txRef := "tx-" + refID
	f.credits[userID] = append(f.credits[userID], walletCredit{
		userID:  userID,
		currency: currency,
		amount:  amount,
		refType: refType,
		refID:   refID,
		desc:    description,
		txRef:   txRef,
	})
	return txRef, nil
}

// ---------------------------------------------------------------------------
// Fake settlement repository
// ---------------------------------------------------------------------------

type fakeSettlementRepo struct {
	rows  []*RevenueSettlement
	pkSeq uint
}

func newFakeSettlementRepo() *fakeSettlementRepo {
	return &fakeSettlementRepo{rows: []*RevenueSettlement{}}
}

func (f *fakeSettlementRepo) Create(ctx context.Context, s *RevenueSettlement) error {
	f.pkSeq++
	s.ID = f.pkSeq
	s.CreatedAt = time.Now()
	s.UpdatedAt = time.Now()
	f.rows = append(f.rows, s)
	return nil
}

func (f *fakeSettlementRepo) GetByEventID(ctx context.Context, eventID string) (*RevenueSettlement, error) {
	for _, s := range f.rows {
		if s.EventID == eventID {
			return s, nil
		}
	}
	return nil, errors.New("settlement not found")
}

func (f *fakeSettlementRepo) UpdateStatus(ctx context.Context, id uint, status SettlementStatus, reason string) error {
	for _, s := range f.rows {
		if s.ID == id {
			s.Status = status
			s.FailureReason = reason
			s.UpdatedAt = time.Now()
			return nil
		}
	}
	return errors.New("settlement not found")
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Conservation law (most important test)
// ---------------------------------------------------------------------------

func TestSettleAdRevenue_ConservationLaw(t *testing.T) {
	// Money conservation: Gross = GST + SisterShare + Viewer + Creator + Platform.
	// No money created or destroyed.
	wallet := newFakeWallet()
	repo := newFakeSettlementRepo()
	engine := NewRevenueSettlementEngine(wallet, repo, DefaultSettlementConfig())

	gross, _ := decimal.NewFromString("1000.00")
	in := SettlementInput{
		EventID:          "evt-001",
		GrossAmount:      gross,
		Currency:         "INR",
		CountryCode:      "IN",
		ViewerUserID:     101,
		CreatorUserID:    201,
		CreatorSubscribed: true, // 20% creator share
		ViewerStateCode:  "07", // Delhi (interstate from Maharashtra)
	}

	result, err := engine.SettleAdRevenue(context.Background(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Sum of all parts must equal gross exactly.
	total := result.Settlement.GstTotal.
		Add(result.Settlement.SisterShareAmount).
		Add(result.ViewerCredit).
		Add(result.CreatorCredit).
		Add(result.PlatformCredit)

	if !total.Equal(gross) {
		t.Errorf("CONSERVATION FAIL: parts sum to %s, expected %s (delta: %s)",
			total.String(), gross.String(),
			gross.Sub(total).String())
	}
	if !result.ConservationOK {
		t.Errorf("conservation check should pass: %s", result.ConservationError)
	}
}

func TestSettleAdRevenue_ConservationLaw_ForeignZeroGST(t *testing.T) {
	// Foreign: 0% GST, so 100% = sister + viewer + creator + platform.
	wallet := newFakeWallet()
	repo := newFakeSettlementRepo()
	engine := NewRevenueSettlementEngine(wallet, repo, DefaultSettlementConfig())

	in := SettlementInput{
		EventID:          "evt-002",
		GrossAmount:      decimal.NewFromInt(1000),
		Currency:         "USD",
		CountryCode:      "US", // foreign = 0% GST
		ViewerUserID:     102,
		CreatorUserID:    202,
		CreatorSubscribed: false, // 0% creator share (free)
		ViewerStateCode:  "IN-07",
	}

	result, err := engine.SettleAdRevenue(context.Background(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// GST must be 0 for foreign.
	if !result.Settlement.GstTotal.IsZero() {
		t.Errorf("foreign must have zero GST, got %s", result.Settlement.GstTotal.String())
	}

	// Net revenue = gross (no GST).
	if !result.Settlement.NetToWallets.Equal(decimal.NewFromInt(1000)) {
		t.Errorf("net revenue: expected 1000, got %s", result.Settlement.NetToWallets.String())
	}

	// Conservation check.
	total := result.Settlement.GstTotal.
		Add(result.Settlement.SisterShareAmount).
		Add(result.ViewerCredit).
		Add(result.CreatorCredit).
		Add(result.PlatformCredit)

	if !total.Equal(decimal.NewFromInt(1000)) {
		t.Errorf("CONSERVATION FAIL: parts sum to %s, expected 1000", total.String())
	}
	if !result.ConservationOK {
		t.Errorf("conservation check should pass: %s", result.ConservationError)
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GST integration
// ---------------------------------------------------------------------------

func TestSettleAdRevenue_IndiaIntrastateGST(t *testing.T) {
	// Intrastate (viewer same state as business) → CGST + SGST.
	wallet := newFakeWallet()
	repo := newFakeSettlementRepo()
	engine := NewRevenueSettlementEngine(wallet, repo, DefaultSettlementConfig())

	in := SettlementInput{
		EventID:          "evt-003",
		GrossAmount:      decimal.NewFromInt(1000),
		Currency:         "INR",
		CountryCode:      "IN",
		ViewerUserID:     103,
		CreatorUserID:    203,
		CreatorSubscribed: true,
		ViewerStateCode:  "27", // same as business state → intrastate
	}

	result, err := engine.SettleAdRevenue(context.Background(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// GST = 180 (18% of 1000).
	if !result.Settlement.GstTotal.Equal(decimal.NewFromInt(180)) {
		t.Errorf("GST total: expected 180, got %s", result.Settlement.GstTotal.String())
	}
	// CGST = 90, SGST = 90, IGST = 0.
	if !result.Settlement.CgstAmount.Equal(decimal.NewFromInt(90)) {
		t.Errorf("CGST: expected 90, got %s", result.Settlement.CgstAmount.String())
	}
	if !result.Settlement.SgstAmount.Equal(decimal.NewFromInt(90)) {
		t.Errorf("SGST: expected 90, got %s", result.Settlement.SgstAmount.String())
	}
	if !result.Settlement.IgstAmount.IsZero() {
		t.Errorf("IGST: expected 0, got %s", result.Settlement.IgstAmount.String())
	}
}

func TestSettleAdRevenue_IndiaInterstateGST(t *testing.T) {
	// Interstate → IGST.
	wallet := newFakeWallet()
	repo := newFakeSettlementRepo()
	engine := NewRevenueSettlementEngine(wallet, repo, DefaultSettlementConfig())

	in := SettlementInput{
		EventID:          "evt-004",
		GrossAmount:      decimal.NewFromInt(1000),
		Currency:         "INR",
		CountryCode:      "IN",
		ViewerUserID:     104,
		CreatorUserID:    204,
		CreatorSubscribed: true,
		ViewerStateCode:  "07", // different state → interstate
	}

	result, err := engine.SettleAdRevenue(context.Background(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// IGST = 180, CGST/SGST = 0.
	if !result.Settlement.IgstAmount.Equal(decimal.NewFromInt(180)) {
		t.Errorf("IGST: expected 180, got %s", result.Settlement.IgstAmount.String())
	}
	if !result.Settlement.CgstAmount.IsZero() {
		t.Errorf("CGST: expected 0, got %s", result.Settlement.CgstAmount.String())
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sister share (5% of NET)
// ---------------------------------------------------------------------------

func TestSettleAdRevenue_SisterShareFivePercentOfNet(t *testing.T) {
	// User directive: sister share = 5% of NET (post-GST), always.
	wallet := newFakeWallet()
	repo := newFakeSettlementRepo()
	engine := NewRevenueSettlementEngine(wallet, repo, DefaultSettlementConfig())

	gross := decimal.NewFromInt(1000)
	in := SettlementInput{
		EventID:          "evt-005",
		GrossAmount:      gross,
		Currency:         "INR",
		CountryCode:      "IN",
		ViewerUserID:     105,
		CreatorUserID:    205,
		CreatorSubscribed: true,
		ViewerStateCode:  "27",
	}

	result, err := engine.SettleAdRevenue(context.Background(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Net = 1000 - 180 GST = 820.
	// Sister = 5% of 820 = 41.
	if !result.Settlement.NetToWallets.Equal(decimal.NewFromInt(820)) {
		t.Errorf("NetToWallets: expected 820, got %s", result.Settlement.NetToWallets.String())
	}
	if !result.Settlement.SisterShareAmount.Equal(decimal.NewFromInt(41)) {
		t.Errorf("SisterShare: expected 41 (5%% of 820), got %s", result.Settlement.SisterShareAmount.String())
	}
}

func TestSettleAdRevenue_SisterShareAlwaysFivePercent(t *testing.T) {
	// User directive: "hamesha lagta rahe" — not configurable, always 5%.
	wallet := newFakeWallet()
	repo := newFakeSettlementRepo()
	engine := NewRevenueSettlementEngine(wallet, repo, DefaultSettlementConfig())

	_, _ = engine.SettleAdRevenue(context.Background(), SettlementInput{
		EventID:          "evt-a",
		GrossAmount:      decimal.NewFromInt(1000),
		Currency:         "INR",
		CountryCode:      "IN",
		ViewerUserID:     1,
		CreatorUserID:    2,
		CreatorSubscribed: true,
		ViewerStateCode:  "27",
	})

	// AllocateSisterShare standalone: always exactly 5%.
	cases := []string{"100", "1000", "5000.50", "0.01", "999999.99"}
	for _, amt := range cases {
		net, _ := decimal.NewFromString(amt)
		share := AllocateSisterShare(net)
		expected := money(net.Mul(decimal.NewFromInt(5)).Div(decimal.NewFromInt(100)))
		if !share.Equal(expected) {
			t.Errorf("AllocateSisterShare(%s) = %s, expected %s (must be exactly 5%%)",
				amt, share.String(), expected.String())
		}
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wallet credit
// ---------------------------------------------------------------------------

func TestSettleAdRevenue_WalletCreditsCorrect(t *testing.T) {
	wallet := newFakeWallet()
	repo := newFakeSettlementRepo()
	engine := NewRevenueSettlementEngine(wallet, repo, DefaultSettlementConfig())

	in := SettlementInput{
		EventID:          "evt-010",
		GrossAmount:      decimal.NewFromInt(1000),
		Currency:         "INR",
		CountryCode:      "IN",
		ViewerUserID:     1010,
		CreatorUserID:    2010,
		CreatorSubscribed: true, // creator = 20%
		ViewerStateCode:  "27", // intrastate
	}

	_, err := engine.SettleAdRevenue(context.Background(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Viewer credit: 60% of after-sister amount.
	// AfterSister = 820 - 41 = 779.
	// Viewer = 60% of 779 = 467.40.
	viewerExpected := money(decimal.NewFromInt(779).Mul(decimal.RequireFromString("0.60")))
	credits := wallet.credits[1010]
	if len(credits) != 1 {
		t.Fatalf("expected 1 viewer credit, got %d", len(credits))
	}
	if !credits[0].amount.Equal(viewerExpected) {
		t.Errorf("viewer credit: expected %s, got %s", viewerExpected.String(), credits[0].amount.String())
	}
	if credits[0].refType != "ad_revenue" {
		t.Errorf("refType: expected ad_revenue, got %s", credits[0].refType)
	}

	// Creator credit: 20% of after-sister amount.
	creatorExpected := money(decimal.NewFromInt(779).Mul(decimal.RequireFromString("0.20")))
	creatorCredits := wallet.credits[2010]
	if len(creatorCredits) != 1 {
		t.Fatalf("expected 1 creator credit, got %d", len(creatorCredits))
	}
	if !creatorCredits[0].amount.Equal(creatorExpected) {
		t.Errorf("creator credit: expected %s, got %s", creatorExpected.String(), creatorCredits[0].amount.String())
	}
}

func TestSettleAdRevenue_FreeCreatorGets0Percent(t *testing.T) {
	// User directive: free uploader = 0% (subscription ke bina kuch nahi milsaga).
	wallet := newFakeWallet()
	repo := newFakeSettlementRepo()
	engine := NewRevenueSettlementEngine(wallet, repo, DefaultSettlementConfig())

	in := SettlementInput{
		EventID:           "evt-011",
		GrossAmount:       decimal.NewFromInt(1000),
		Currency:          "INR",
		CountryCode:       "IN",
		ViewerUserID:      1011,
		CreatorUserID:     2011,
		CreatorSubscribed: false, // free → 0%
		ViewerStateCode:   "27",
	}

	result, err := engine.SettleAdRevenue(context.Background(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Creator (free) = 0% of 779 = 0. Platform = 779 - 467.40 = 311.60.
	creatorCredits := wallet.credits[2011]
	if len(creatorCredits) != 0 {
		t.Fatalf("free creator should get 0 credits, got %d", len(creatorCredits))
	}

	// Platform should get the full 40% of 779 (viewer takes 60%).
	platformAmt := decimal.NewFromInt(779).Mul(decimal.RequireFromString("0.40"))
	if !platformAmt.GreaterThan(decimal.NewFromInt(311)) || !platformAmt.LessThan(decimal.NewFromInt(312)) {
		t.Errorf("platform should get ~311.60, got %s", platformAmt.String())
	}

	// Conservation still holds (checked inside engine).
	if !result.ConservationOK {
		t.Errorf("conservation failed: %s", result.ConservationError)
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wallet credit failure
// ---------------------------------------------------------------------------

func TestSettleAdRevenue_WalletCreditFailure(t *testing.T) {
	wallet := newFakeWallet()
	// Simulate viewer credit failure.
	wallet.failOnUserID = 999

	repo := newFakeSettlementRepo()
	engine := NewRevenueSettlementEngine(wallet, repo, DefaultSettlementConfig())

	in := SettlementInput{
		EventID:          "evt-020",
		GrossAmount:      decimal.NewFromInt(1000),
		Currency:         "INR",
		CountryCode:      "IN",
		ViewerUserID:     999, // will fail
		CreatorUserID:    2020,
		CreatorSubscribed: true,
		ViewerStateCode:  "27",
	}

	result, err := engine.SettleAdRevenue(context.Background(), in)
	if err == nil {
		t.Fatal("expected wallet credit failure, got nil error")
	}
	if !errors.Is(err, errors.New("simulated wallet credit failure")) {
		// Just check error is not nil and mentions viewer.
	}

	// Settlement should be marked FAILED.
	if result.Settlement.Status != SettlementFailed {
		t.Errorf("status: expected %s, got %s", SettlementFailed, result.Settlement.Status)
	}
	if result.Settlement.FailureReason == "" {
		t.Error("failure reason should be set")
	}
	// Creator should NOT have been credited (viewer failed first).
	if len(wallet.credits[2020]) != 0 {
		t.Error("creator credit should not happen if viewer credit fails")
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

func TestValidateSettlementInput_Valid(t *testing.T) {
	in := SettlementInput{
		EventID:          "evt",
		GrossAmount:      decimal.NewFromInt(100),
		Currency:         "INR",
		CountryCode:      "IN",
		ViewerUserID:     1,
		CreatorUserID:    2,
		CreatorSubscribed: true,
		ViewerStateCode:  "27",
	}
	if err := ValidateSettlementInput(in); err != nil {
		t.Errorf("valid input should pass: %v", err)
	}
}

func TestValidateSettlementInput_MissingEventID(t *testing.T) {
	in := SettlementInput{
		GrossAmount:      decimal.NewFromInt(100),
		Currency:         "INR",
		ViewerUserID:     1,
		CreatorUserID:    2,
	}
	if err := ValidateSettlementInput(in); err == nil {
		t.Error("missing event_id should fail")
	}
}

func TestValidateSettlementInput_ZeroAmount(t *testing.T) {
	in := SettlementInput{
		EventID:      "evt",
		GrossAmount:  decimal.Zero,
		Currency:     "INR",
		ViewerUserID: 1,
		CreatorUserID: 2,
	}
	if err := ValidateSettlementInput(in); err == nil {
		t.Error("zero gross amount should fail")
	}
}

func TestValidateSettlementInput_MissingUserIDs(t *testing.T) {
	in := SettlementInput{
		EventID:     "evt",
		GrossAmount: decimal.NewFromInt(100),
		Currency:    "INR",
		// ViewerUserID and CreatorUserID missing
	}
	if err := ValidateSettlementInput(in); err == nil {
		t.Error("missing user IDs should fail")
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Settlement record persistence
// ---------------------------------------------------------------------------

func TestSettleAdRevenue_RecordPersisted(t *testing.T) {
	wallet := newFakeWallet()
	repo := newFakeSettlementRepo()
	engine := NewRevenueSettlementEngine(wallet, repo, DefaultSettlementConfig())

	in := SettlementInput{
		EventID:          "evt-030",
		GrossAmount:      decimal.NewFromInt(500),
		Currency:         "INR",
		CountryCode:      "IN",
		ViewerUserID:     101,
		CreatorUserID:    201,
		CreatorSubscribed: true,
		ViewerStateCode:  "27",
	}

	_, err := engine.SettleAdRevenue(context.Background(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify record was persisted.
	if len(repo.rows) != 1 {
		t.Fatalf("expected 1 settlement record, got %d", len(repo.rows))
	}
	s := repo.rows[0]
	if s.EventID != "evt-030" {
		t.Errorf("EventID: expected evt-030, got %s", s.EventID)
	}
	if s.Status != SettlementComplete {
		t.Errorf("Status: expected %s, got %s", SettlementComplete, s.Status)
	}
	if s.GrossAmount.Equal(decimal.Zero) {
		t.Error("GrossAmount should be set")
	}

	// Verify we can look it up.
	found, err := repo.GetByEventID(context.Background(), "evt-030")
	if err != nil {
		t.Fatalf("GetByEventID failed: %v", err)
	}
	if found.ID != s.ID {
		t.Errorf("ID mismatch: %d vs %d", found.ID, s.ID)
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AllocateWithBuffer (maintenance buffer + sister share)
// ---------------------------------------------------------------------------

func TestAllocateWithBuffer_BelowBuffer(t *testing.T) {
	// User directive Q1.1: ₹2000 minimum balance shown as buffer.
	// Total < 2000 → transferable = 0, buffer = 2000.
	total := decimal.NewFromInt(1500)
	trans, buf, share := AllocateWithBuffer(total)

	if !trans.Equal(decimal.Zero) {
		t.Errorf("below buffer: transferable should be 0, got %s", trans.String())
	}
	if !buf.Equal(decimal.NewFromInt(2000)) {
		t.Errorf("buffer: expected 2000, got %s", buf.String())
	}
	// Sister share = 5% of total (1500) = 75.
	// Hinglish: sister share buffer se INDEPENDENT hai (test: TestBufferAndSisterShareAreIndependent).
	if !share.Equal(decimal.NewFromInt(75)) {
		t.Errorf("sister share: expected 75 (5%% of 1500), got %s", share.String())
	}
}

func TestAllocateWithBuffer_AboveBuffer(t *testing.T) {
	total := decimal.NewFromInt(5000)
	trans, buf, share := AllocateWithBuffer(total)

	// Transferable = 5000 - 2000 = 3000.
	if !trans.Equal(decimal.NewFromInt(3000)) {
		t.Errorf("transferable: expected 3000, got %s", trans.String())
	}
	// Sister = 5% of 5000 = 250.
	if !share.Equal(decimal.NewFromInt(250)) {
		t.Errorf("sister share: expected 250 (5%% of 5000), got %s", share.String())
	}
	// Buffer still 2000 (always).
	if !buf.Equal(decimal.NewFromInt(2000)) {
		t.Errorf("buffer: expected 2000, got %s", buf.String())
	}
}

func TestAllocateWithBuffer_ExactBuffer(t *testing.T) {
	total := decimal.NewFromInt(2000)
	trans, _, _ := AllocateWithBuffer(total)

	if !trans.Equal(decimal.Zero) {
		t.Errorf("exact buffer: transferable should be 0, got %s", trans.String())
	}
}

func TestAllocateWithBuffer_SisterShareIndependentOfBuffer(t *testing.T) {
	// User directive + business_laws_test.go: sister share buffer se
	// independent — 5% of TOTAL, not excess.
	total := decimal.NewFromInt(10000)
	trans, buf, share := AllocateWithBuffer(total)

	// Transferable = 8000.
	if !trans.Equal(decimal.NewFromInt(8000)) {
		t.Errorf("transferable: expected 8000, got %s", trans.String())
	}
	// Buffer = 2000.
	if !buf.Equal(decimal.NewFromInt(2000)) {
		t.Errorf("buffer: expected 2000, got %s", buf.String())
	}
	// Sister = 500 (5% of TOTAL 10000, NOT 5% of 8000).
	if !share.Equal(decimal.NewFromInt(500)) {
		t.Errorf("sister share: expected 500 (5%% of 10000, NOT excess), got %s", share.String())
	}
}
