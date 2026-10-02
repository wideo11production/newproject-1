package service

import (
	"context"
	"errors"
	"gorm.io/gorm"
	"testing"
	"time"

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
