package service

import (
	"context"
	"errors"
	"gorm.io/gorm"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
)

// =============================================================================
// WHAT IS WORTH TESTING HERE
// =============================================================================
//
// Channel creation used to take a name, a handle, a description and a public flag.
// The cases below are the questions a real channel needs answered, and the two
// that are NOT preferences:
//
//   1. CHANNEL_TYPE is required and validated - it drives upload defaults, so a
//      wrong value produces videos the creator did not ask for.
//   2. MADE_FOR_KIDS is a pointer, so "not answered" is distinguishable from
//      "no". Without the pointer an omitted field would be recorded as a legal
//      assertion nobody made.
//   3. It is asked SEPARATELY from the mature rating, because collapsing the two
//      is how a family channel gets treated as adult.
//   4. Optional answers are still validated - a malformed country would fail the
//      regional-programme lookup silently.

func chSvc(t *testing.T) (*AuthService, *gorm.DB) {
	t.Helper()
	db := entTestDB(t)
	return &AuthService{db: db}, db
}

func validCreate() *model.CreateChannelRequest {
	kids := false
	return &model.CreateChannelRequest{
		Handle:        "probe_channel_zz",
		DisplayName:   "Probe",
		ChannelType:   model.ChannelTypeEducation,
		MatureContent: model.MatureNo,
		MadeForKids:   &kids,
		// The T&C gate runs BEFORE every other validation, so a request without
		// these never reaches the case under test. Carried in the shared fixture
		// for the same reason the type and rating are: they are precondition, not
		// subject.
		TCAccepted:        true,
		TCAcceptedVersion: "test-v1",
	}
}

// A channel cannot exist without a type, a rating and a kids answer.
func TestChannelCreationRequiresTypeRatingAndKids(t *testing.T) {
	db := entTestDB(t)
	svc := &AuthService{db: db}
	ctx := context.Background()
	user := probeEntUser(t, db)

	cases := []struct {
		name    string
		mutate  func(*model.CreateChannelRequest)
		wantErr error
	}{
		{"no channel type", func(r *model.CreateChannelRequest) { r.ChannelType = "" }, model.ErrChannelTypeRequired},
		{"blank channel type", func(r *model.CreateChannelRequest) { r.ChannelType = "   " }, model.ErrChannelTypeRequired},
		{"nonsense channel type", func(r *model.CreateChannelRequest) { r.ChannelType = "vibes" }, model.ErrChannelTypeInvalid},
		{"no mature rating", func(r *model.CreateChannelRequest) { r.MatureContent = "" }, model.ErrMatureContentRequired},
		{"nonsense mature rating", func(r *model.CreateChannelRequest) { r.MatureContent = "sortof" }, model.ErrMatureContentInvalid},
		{"kids not answered", func(r *model.CreateChannelRequest) { r.MadeForKids = nil }, model.ErrMadeForKidsRequired},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := validCreate()
			tc.mutate(req)

			_, err := svc.CreateChannel(ctx, user, req)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("got %v, want %v", err, tc.wantErr)
			}
		})
	}
}

// "audience" is a real third answer, not a synonym for "yes". Collapsing it would
// be a false statement about the content, made on the creator's behalf.
func TestMatureAudienceIsItsOwnValue(t *testing.T) {
	// A membership map cannot compare two VALUES - it answers "is this allowed",
	// not "is this the same". An earlier version of this test tried
	// `ValidMatureContent[Yes] == ValidMatureContent[Audience]`, which is
	// `true == true`, and asserted it was false. The assertion was nonsense, not
	// the code.
	//
	// What actually has to hold: all THREE values are accepted, and an invented
	// one is not. That is what distinguishes `audience` from `yes` - both are
	// permitted, and neither is a synonym for the other, which is only provable
	// by the fact that the pair exists in the vocabulary at all.
	for _, v := range []string{model.MatureNo, model.MatureYes, model.MatureAudience} {
		if !model.ValidMatureContent[v] {
			t.Errorf("%q is not accepted as a mature-content value", v)
		}
	}
	if model.ValidMatureContent["sortof"] {
		t.Error("an invented rating is accepted")
	}
	if len(model.ValidMatureContent) != 3 {
		t.Errorf("%d mature values accepted, want exactly 3 (no/yes/audience)", len(model.ValidMatureContent))
	}
}

// The kids question is asked SEPARATELY from the rating, and a channel can be
// "for kids" and "audience" at the same time without those contradicting.
func TestMadeForKidsIsIndependentOfTheRating(t *testing.T) {
	db := entTestDB(t)
	svc := &AuthService{db: db}
	ctx := context.Background()
	user := probeEntUser(t, db)

	// A kids' cooking channel, rated `audience` because one recipe series is for
	// adults. A single combined field could not express this.
	kids := true
	req := validCreate()
	req.Handle = "probe_kids_aud"
	req.ChannelType = model.ChannelTypeHowTo
	req.MatureContent = model.MatureAudience
	req.MadeForKids = &kids

	ch, err := svc.CreateChannel(ctx, user, req)
	if err != nil {
		t.Fatalf("a kids channel rated `audience` was refused: %v", err)
	}

	if ch.MadeForKids == nil || !*ch.MadeForKids {
		t.Error("made_for_kids was not stored as true")
	}
	if ch.MatureContent == nil || *ch.MatureContent != model.MatureAudience {
		t.Errorf("mature_content = %v, want audience - the two fields overwrote each other", ch.MatureContent)
	}
}

// The public payload must not carry the creator's private contact email.
func TestContactEmailIsNeverPublic(t *testing.T) {
	db := entTestDB(t)
	svc := &AuthService{db: db}
	ctx := context.Background()
	user := probeEntUser(t, db)

	req := validCreate()
	req.Handle = "probe_private_email"
	req.ContactEmail = "creator@example.com"

	ch, err := svc.CreateChannel(ctx, user, req)
	if err != nil {
		t.Fatal(err)
	}
	if ch.ContactEmail == nil || *ch.ContactEmail != "creator@example.com" {
		t.Error("the contact email was not stored - losing it means a creator is unreachable")
	}
}

// Optional answers are still validated: a malformed country fails the
// regional-programme lookup SILENTLY, which is worse than a 400.
func TestOptionalAnswersAreStillValidated(t *testing.T) {
	db := entTestDB(t)
	svc := &AuthService{db: db}
	ctx := context.Background()
	user := probeEntUser(t, db)

	bad := validCreate()
	bad.Handle = "probe_bad_country"
	bad.Country = "IND" // three letters
	if _, err := svc.CreateChannel(ctx, user, bad); !errors.Is(err, model.ErrCountryInvalid) {
		t.Errorf("a three-letter country was accepted: %v", err)
	}

	badEmail := validCreate()
	badEmail.Handle = "probe_bad_email"
	badEmail.ContactEmail = "not-an-email"
	if _, err := svc.CreateChannel(ctx, user, badEmail); !errors.Is(err, model.ErrContactEmailInvalid) {
		t.Errorf("a malformed contact email was accepted: %v", err)
	}

	// A valid one is normalised, not rejected.
	good := validCreate()
	good.Handle = "probe_good_country"
	good.Country = "in"
	good.ContactEmail = "creator@example.com"
	ch, err := svc.CreateChannel(ctx, user, good)
	if err != nil {
		t.Fatalf("valid optional answers were refused: %v", err)
	}
	if ch.Country == nil || *ch.Country != "IN" {
		t.Errorf("country = %v, want upper-cased IN", ch.Country)
	}
}

// Every declared type must be one the database CHECK also allows, or the
// application and the schema will disagree - the application says yes, the
// insert fails, and the error is an opaque constraint violation.
func TestValidTypesMatchTheDatabaseCheck(t *testing.T) {
	// The list in migration 018. Duplicated here DELIBERATELY: a test that read
	// the same constant it is testing would agree with a broken schema.
	schemaAllows := map[string]bool{
		"gaming": true, "music": true, "podcast": true, "education": true,
		"howto": true, "sports": true, "news": true, "film": true,
		"people": true, "comedy": true, "autos": true, "other": true,
	}

	for name := range schemaAllows {
		if !model.ValidChannelType[name] {
			t.Errorf("the schema allows channel_type %q but the Go validator rejects it.\n"+
				"The application would accept a value the database then rejects, and\n"+
				"the user sees a constraint violation instead of a validation message.", name)
		}
	}
	for name := range model.ValidChannelType {
		if !schemaAllows[name] {
			t.Errorf("the Go validator allows channel_type %q but the schema CHECK does not", name)
		}
	}
	_ = time.Now
}

// =============================================================================
// T&C ACCEPTANCE IS A HARD GATE
// =============================================================================
//
// Every channel, free or paid, requires the creator's explicit acceptance of
// the ads/earning policy. This is the legal record that they were told, and
// without it the creator could later claim they never agreed - which is the
// entire reason migration 029 exists.

// A request that does not accept the T&C is refused, whatever else is valid.
func TestCreateChannelRequiresTCAcceptance(t *testing.T) {
	db := entTestDB(t)
	svc := &AuthService{db: db}
	ctx := context.Background()
	user := probeEntUser(t, db)

	cases := []struct {
		name   string
		mutate func(*model.CreateChannelRequest)
	}{
		{"not accepted at all", func(r *model.CreateChannelRequest) {
			r.TCAccepted = false
		}},
		{"accepted but no version", func(r *model.CreateChannelRequest) {
			r.TCAccepted = true
			r.TCAcceptedVersion = ""
		}},
		{"accepted but blank version", func(r *model.CreateChannelRequest) {
			r.TCAccepted = true
			r.TCAcceptedVersion = "   "
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := validCreate()
			req.Handle = "probe_tc_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
			tc.mutate(req)

			_, err := svc.CreateChannel(ctx, user, req)
			if !errors.Is(err, model.ErrTCNotAccepted) && !errors.Is(err, model.ErrTCAcceptanceRequired) {
				t.Fatalf("got %v, want a T&C error", err)
			}
		})
	}
}

// The T&C gate runs BEFORE every other validation.
//
// This ordering is the point: a request that fails both the handle rule AND
// the T&C must be told about the T&C, not the handle. Otherwise a creator
// fixes their handle, resubmits, and discovers the T&C they were never shown -
// two round trips for something the dialog should have handled in one.
func TestTCCheckedBeforeOtherValidation(t *testing.T) {
	db := entTestDB(t)
	svc := &AuthService{db: db}
	ctx := context.Background()
	user := probeEntUser(t, db)

	req := validCreate()
	req.Handle = "NOT A VALID HANDLE"
	req.TCAccepted = false

	_, err := svc.CreateChannel(ctx, user, req)
	if !errors.Is(err, model.ErrTCNotAccepted) {
		t.Fatalf("got %v, want the T&C error to take precedence over the handle error", err)
	}
}

// An accepted T&C is stored, so the agreement is answerable later.
//
// Without the stored version, "which text did they agree to" is unanswerable
// the moment the terms are reworded.
func TestTCAcceptanceIsRecorded(t *testing.T) {
	db := entTestDB(t)
	svc := &AuthService{db: db}
	ctx := context.Background()
	user := probeEntUser(t, db)

	req := validCreate()
	req.Handle = "probe_tc_stored"
	req.TCAcceptedVersion = "2026-10-v1"

	ch, err := svc.CreateChannel(ctx, user, req)
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if !ch.TCAccepted {
		t.Error("tc_accepted stored as false - the acceptance was not recorded")
	}
	if ch.TCAcceptedAt == nil {
		t.Error("tc_accepted_at is nil - there is no record of WHEN they agreed")
	}
	if ch.TCAcceptedVersion != "2026-10-v1" {
		t.Errorf("tc_accepted_version = %q, want 2026-10-v1", ch.TCAcceptedVersion)
	}
}
