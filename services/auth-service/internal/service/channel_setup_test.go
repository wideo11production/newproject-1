package service

// =============================================================================
// CHANNEL SETUP STEP 2 - the gate, and what it must refuse
// =============================================================================
//
// Needs a database; skipped without `TEST_DATABASE_DSN`, like the repo's other
// integration points.
//
// =============================================================================
// WHY THIS IS A GO TEST AND NOT ONLY THE BROWSER CHECK
// =============================================================================
//
// `tools/check-channel-setup.mjs` found a bug here, and it could not explain it.
//
// The gate endpoint returned 500 for every creator. The handler translated any
// error into a flat `setup_status_unavailable` and DISCARDED the cause, so the
// request log showed a 500 with an empty `error` field and nothing else. The
// browser check knew something was broken; it had no way to say which of four
// calls inside the handler had failed.
//
// The cause turned out to be `ChannelNeedingSetup` handing GORM's `Scan` a bare
// `*uuid.UUID`, which GORM does not support. A one-line function, a 500 on every
// request, and nothing in any log.
//
// =============================================================================
// THE PROPERTIES THAT MATTER, AND WHY EACH IS ASSERTED
// =============================================================================
//
//  1. The gate is SERVER-DERIVED. `setup_step2_at` is the only input. A client that
//     skips the step must be caught, and a client cannot forge a timestamp it
//     never wrote.
//
//  2. An UNFINISHED channel that has been fully filled is still unfinished.
//     Otherwise "compulsory" means "you filled in the fields", and the timestamp
//     stops meaning anything.
//
//  3. FINISHING is a separate, explicit act. It is the only thing that stamps the
//     column.
//
//  4. The stamp is SERVER-SIDE. A client-supplied `setup_step2_at` would be a lie
//     waiting to be told, and the only consumers are a gate and a report.
//
//  5. Ownership is enforced on every write. Not-yours is 404, never 403 - a 403
//     confirms the channel exists, which turns the endpoint into a way to
//     enumerate other people's channel ids.
//
//  6. An out-of-range hue is refused. That value reaches an inline style.
//  7. A hue the palette does not offer is refused, even though it is in range.
//
// =============================================================================

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/wideo11/auth-service/internal/model"
)

// setupFixture creates a user and an unfinished channel, and cleans both up.
func setupFixture(t *testing.T, svc *AuthService, label string) (userID, channelID uuid.UUID) {
	t.Helper()
	ctx := context.Background()

	userID = uuid.New()
	email := label + "-" + strings.ReplaceAll(uuid.NewString(), "-", "") + "@wideo11.test"
	if err := svc.db.WithContext(ctx).Exec(
		`INSERT INTO users (id, email, username, password_hash, is_verified, biometric_capable, created_at, updated_at)
		 VALUES (?, ?, ?, 'x', true, false, now(), now())`,
		userID, email, strings.ToLower(label+"_"+strings.ReplaceAll(uuid.NewString(), "-", "")[:10]),
	).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	created, err := svc.CreateChannel(ctx, userID, handleRequest(uniqueHandle("setup"), "Setup Probe"))
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}

	t.Cleanup(func() {
		// Order matters only for tidiness; both tables cascade from users.
		svc.db.Where("id = ?", created.ID).Delete(&model.Channel{})
		svc.db.Exec("DELETE FROM users WHERE id = ?", userID)
	})
	return userID, created.ID
}

// TestChannelNeedingSetupReturnsAUUIDNotAnError is the regression for the 500.
//
// It looks trivial, and that is the point: `ChannelNeedingSetup` returning a
// usable id used to require a `[]struct{ID uuid.UUID}` destination, and passing a
// bare `*uuid.UUID` compiled fine, type-checked fine, and failed at runtime on
// every single call.
func TestChannelNeedingSetupReturnsAUUIDNotAnError(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	userID, channelID := setupFixture(t, svc, "gate")

	got, err := svc.ChannelNeedingSetup(context.Background(), userID)
	if err != nil {
		t.Fatalf("ChannelNeedingSetup returned an error for a user with one unfinished "+
			"channel: %v.\n  This is the bug that made GET /channels/setup/pending answer "+
			"500 for every creator - GORM's Scan does not accept a bare *uuid.UUID.",
			err)
	}
	if got != channelID {
		t.Errorf("ChannelNeedingSetup = %v, want %v", got, channelID)
	}

	needs, err := svc.ChannelNeedsSetup(context.Background(), userID, channelID)
	if err != nil {
		t.Fatalf("ChannelNeedsSetup: %v", err)
	}
	if !needs {
		t.Error("a channel with setup_step2_at NULL must report that it needs setup")
	}

	// A user with nothing unfinished must get uuid.Nil and NO error. A zero value
	// paired with an error is how "you have nothing to do" and "the database is
	// unreachable" get confused.
	empty, err := svc.ChannelNeedingSetup(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("ChannelNeedingSetup for a user with no channels: %v", err)
	}
	if empty != uuid.Nil {
		t.Errorf("ChannelNeedingSetup for a user with no channels = %v, want uuid.Nil", empty)
	}
}

// TestFillingEveryFieldIsNotFinishing is the whole point of a separate flag.
//
// Without this, "compulsory" would quietly mean "filled in the form", and the
// timestamp would be decoration.
func TestFillingEveryFieldIsNotFinishing(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	ctx := context.Background()
	userID, channelID := setupFixture(t, svc, "fill")

	tagline := "Bread, and the patience it needs"
	keywords := "baking, sourdough"
	visibility := model.VisibilityUnlisted
	hue := BrandColors[len(BrandColors)-1].Hue

	_, err := svc.UpdateChannelSetup(ctx, userID, channelID, &model.UpdateChannelSetupRequest{
		Tagline:  &tagline,
		Keywords: &keywords,
		// BrandHue is a *int so that "unset" and "hue 0" stay different answers.
		BrandHue:      &hue,
		Visibility:    &visibility,
		CommentPolicy: setupStrPtr(model.CommentSubscribers),
	})
	if err != nil {
		t.Fatalf("UpdateChannelSetup: %v", err)
	}

	needs, err := svc.ChannelNeedsSetup(ctx, userID, channelID)
	if err != nil {
		t.Fatalf("ChannelNeedsSetup: %v", err)
	}
	if !needs {
		t.Error("filling every field marked the channel as FINISHED. `setup_step2_at` " +
			"must only be stamped by finish_step2 - otherwise the gate is a formality " +
			"and a creator can skip it by typing into every box")
	}

	// Now finish it explicitly.
	if _, err := svc.UpdateChannelSetup(ctx, userID, channelID, &model.UpdateChannelSetupRequest{
		FinishStep2: true,
	}); err != nil {
		t.Fatalf("finishing setup: %v", err)
	}

	needs, err = svc.ChannelNeedsSetup(ctx, userID, channelID)
	if err != nil {
		t.Fatalf("ChannelNeedsSetup after finish: %v", err)
	}
	if needs {
		t.Error("the channel is still reported as needing setup after finish_step2")
	}

	id, err := svc.ChannelNeedingSetup(ctx, userID)
	if err != nil {
		t.Fatalf("ChannelNeedingSetup after finish: %v", err)
	}
	if id != uuid.Nil {
		t.Errorf("ChannelNeedingSetup after finish = %v, want uuid.Nil", id)
	}

	// The stamp must be close to now and stamped by the SERVER.
	var ch model.Channel
	if err := db.First(&ch, "id = ?", channelID).Error; err != nil {
		t.Fatalf("reload channel: %v", err)
	}
	if ch.SetupStep2At == nil {
		t.Fatal("setup_step2_at is still NULL after finish_step2")
	}
	if delta := time.Since(*ch.SetupStep2At); delta > time.Minute || delta < -time.Minute {
		t.Errorf("setup_step2_at is %v away from now - it should be stamped by the "+
			"server clock at the moment of finishing", delta)
	}
}

// TestSetupCannotBeFinishedOnSomebodyElsesChannel is the IDOR guard.
//
// 404 rather than 403, and the distinction is not pedantry: 403 confirms the
// channel EXISTS, and channel ids are the one identifier a caller can guess at
// scale if they can get a list of them from anywhere.
func TestSetupCannotBeFinishedOnSomebodyElsesChannel(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	ctx := context.Background()

	victimID, victimChannel := setupFixture(t, svc, "victim")
	attackerID, _ := setupFixture(t, svc, "attacker")

	_, err := svc.UpdateChannelSetup(ctx, attackerID, victimChannel, &model.UpdateChannelSetupRequest{
		FinishStep2: true,
	})
	if err == nil {
		t.Fatal("a user finished setup on somebody else's channel")
	}
	if !strings.Contains(err.Error(), model.ErrChannelNotFound.Error()) {
		t.Errorf("error = %v, want %v (404-class, NOT 403 - see the comment above)",
			err, model.ErrChannelNotFound)
	}

	var ch model.Channel
	if err := db.First(&ch, "id = ?", victimChannel).Error; err != nil {
		t.Fatalf("reload victim channel: %v", err)
	}
	if ch.SetupStep2At != nil {
		t.Error("the victim's channel was marked as set up by another user")
	}
	if ch.UserID != victimID {
		t.Error("the victim's channel row was modified at all")
	}
}

// TestBrandHueIsRefusedOutsideThePalette covers the value that reaches a style.
//
// Two separate checks, because they answer different questions:
//
//	range      - is this a number a style can use?        (SECURITY)
//	offered    - is this one of OUR reviewed colours?    (PRODUCT)
//
// A hue that is in range but not offered would render through the read-path
// fallback, which is a silent surprise rather than an error.
func TestBrandHueIsRefusedOutsideThePalette(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	ctx := context.Background()
	userID, channelID := setupFixture(t, svc, "hue")

	for _, hue := range []int{-1, 360, 4000} {
		if _, err := svc.UpdateChannelSetup(ctx, userID, channelID,
			&model.UpdateChannelSetupRequest{BrandHue: &hue}); err == nil {
			t.Errorf("brand_hue = %d was ACCEPTED. It reaches an inline style on every "+
				"visitor's page, so the range check is the security boundary", hue)
		}
	}

	// In range, not offered.
	inRangeNotOffered := 1
	if _, err := svc.UpdateChannelSetup(ctx, userID, channelID,
		&model.UpdateChannelSetupRequest{BrandHue: &inRangeNotOffered}); err == nil {
		t.Error("brand_hue = 1 is in range but is not a colour the palette offers, and " +
			"was accepted. It would render through the read-path fallback - a silent " +
			"wrong colour instead of an error at the point the mistake was made")
	}

	// Offered hues must still work, or the check is rejecting everything.
	for _, c := range BrandColors {
		hue := c.Hue
		if _, err := svc.UpdateChannelSetup(ctx, userID, channelID,
			&model.UpdateChannelSetupRequest{BrandHue: &hue}); err != nil {
			t.Errorf("brand_hue = %d (%s) is a palette colour and was rejected: %v",
				c.Hue, c.Name, err)
		}
	}

	// Clearing must be possible, and must be distinguishable from "leave alone".
	// Without `BrandHueIsNull` there is no way to return to the platform default,
	// and hue 0 can never be told apart from no answer.
	if _, err := svc.UpdateChannelSetup(ctx, userID, channelID,
		&model.UpdateChannelSetupRequest{BrandHueIsNull: true}); err != nil {
		t.Fatalf("clearing the brand hue: %v", err)
	}
	var ch model.Channel
	if err := db.First(&ch, "id = ?", channelID).Error; err != nil {
		t.Fatalf("reload channel: %v", err)
	}
	if ch.BrandHue != nil {
		t.Errorf("brand_hue = %v after clearing; want NULL", *ch.BrandHue)
	}
}

// TestVisibilityAndIsPublicCannotDisagree is the constraint's application-side twin.
//
// Migration 022 has a CHECK forcing the two to agree. This asserts the service
// writes BOTH, so the CHECK is a backstop rather than the thing that catches
// every mistake.
//
// It also pins the interesting case: `unlisted` IS public in the sense of
// `is_public`, because it is reachable by link. Collapsing the two would hide
// every unlisted channel from its own owner.
func TestVisibilityAndIsPublicCannotDisagree(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	ctx := context.Background()
	userID, channelID := setupFixture(t, svc, "vis")

	for _, tc := range []struct {
		visibility string
		isPublic   bool
	}{
		{model.VisibilityPublic, true},
		{model.VisibilityUnlisted, true}, // reachable by link, not listed
		{model.VisibilityPrivate, false},
	} {
		v := tc.visibility
		if _, err := svc.UpdateChannelSetup(ctx, userID, channelID,
			&model.UpdateChannelSetupRequest{Visibility: &v}); err != nil {
			t.Fatalf("setting visibility %s: %v", v, err)
		}
		var ch model.Channel
		if err := db.First(&ch, "id = ?", channelID).Error; err != nil {
			t.Fatalf("reload: %v", err)
		}
		if ch.IsPublic != tc.isPublic {
			t.Errorf("visibility=%s wrote is_public=%v, want %v. The CHECK constraint "+
				"in migration 022 would reject this row outright, which is a 500 for a "+
				"perfectly ordinary creator action", v, ch.IsPublic, tc.isPublic)
		}
		if EffectiveVisibility(&ch) != v {
			t.Errorf("EffectiveVisibility = %s, want %s", EffectiveVisibility(&ch), v)
		}
		if got := IsChannelListed(&ch); got != (v == model.VisibilityPublic) {
			t.Errorf("IsChannelListed for %s = %v", v, got)
		}
		if got := IsChannelReachableByLink(&ch); got != (v != model.VisibilityPrivate) {
			t.Errorf("IsChannelReachableByLink for %s = %v", v, got)
		}
	}

	// An unknown visibility must be REFUSED, not defaulted.
	//
	// The natural default for an unrecognised value is either "public" - which
	// publishes a channel the creator meant to keep quiet - or "private" - which
	// hides one they are relying on. Both defaults are wrong in a way the creator
	// cannot see, so neither is used.
	bad := "publik"
	if _, err := svc.UpdateChannelSetup(ctx, userID, channelID,
		&model.UpdateChannelSetupRequest{Visibility: &bad}); err == nil {
		t.Error(`visibility = "publik" was ACCEPTED. An unrecognised value must be ` +
			"refused rather than defaulted to public or private")
	}
}

// TestAnUnfinishedChannelIsPrivateUntilSaidOtherwise is the default that matters.
//
// An UNSET visibility on an UNFINISHED channel resolves to PRIVATE, not public.
//
// "I have not decided yet" is not "everyone may look". Defaulting the other way
// would publish a channel mid-setup - before the creator has chosen an audience,
// and before the compulsory step they are halfway through has finished - and the
// channel would be visible to the world at exactly the moment its owner has said
// nothing about who should see it.
func TestAnUnfinishedChannelIsPrivateUntilSaidOtherwise(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	_, channelID := setupFixture(t, svc, "default")

	var ch model.Channel
	if err := db.First(&ch, "id = ?", channelID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if ch.SetupStep2At != nil {
		t.Fatal("fixture is not unfinished")
	}
	if ch.Visibility != nil {
		t.Skipf("CreateChannel now sets visibility at creation (%v); this test is about "+
			"the NULL case and no longer applies", *ch.Visibility)
	}

	if got := EffectiveVisibility(&ch); got != model.VisibilityPrivate {
		t.Errorf("an unfinished channel with no visibility resolves to %q, want %q.\n"+
			"  Defaulting to public would expose a channel at the moment its creator "+
			"has said nothing about who should see it", got, model.VisibilityPrivate)
	}
	if IsChannelListed(&ch) {
		t.Error("an unfinished channel must not be listed")
	}
	if IsChannelReachableByLink(&ch) {
		t.Error("an unfinished channel must not be reachable by link")
	}
}

// TestKeywordNormalisationIsDeterministic covers the rule, not just the rule's
// outcome.
//
// Keywords are de-duplicated case-insensitively because the search is
// case-insensitive - "cooking, Cooking, COOKING" is one keyword that arrived three
// times. The first spelling wins, so the creator's own casing survives.
func TestKeywordNormalisationIsDeterministic(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"baking, sourdough, bread", "baking, sourdough, bread"},
		{"Baking, baking, BAKING", "Baking"},
		{"a,,b", "a, b"},
		{"  spaced  ,  out  ", "spaced, out"},
		// A NEWLINE IS A SEPARATOR, not a space. Somebody pasting a list out of a
		// spreadsheet gets one keyword per line, and treating the line break as
		// part of the keyword stores "line break" as a single term that matches
		// nothing anybody searches for.
		//
		// The first version of this test expected "line break, comma" - it assumed
		// the newline was whitespace. The implementation was right and the
		// expectation was wrong, which is the useful direction for a test to fail
		// in: it means the test was asserting an intention nobody had.
		{"line\nbreak, comma", "line, break, comma"},
		// And `\r` explicitly, because a Windows clipboard carries one and it
		// would otherwise end up in the MIDDLE of a keyword.
		{"carriage\r\nreturn", "carriage, return"},
		{"", ""},
		{",,,", ""},
	}
	for _, tc := range cases {
		got, err := model.NormaliseKeywords(tc.in)
		if err != nil {
			t.Errorf("NormaliseKeywords(%q): %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("NormaliseKeywords(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}

	// Over the limit must be refused, not truncated.
	var many []string
	for i := 0; i < model.MaxKeywords+5; i++ {
		many = append(many, "k"+strings.Repeat("x", i%3)+string(rune('a'+i%26))+itoa(i))
	}
	if _, err := model.NormaliseKeywords(strings.Join(many, ", ")); err == nil {
		t.Errorf("%d keywords was accepted; the cap is %d.\n  Truncating silently would "+
			"leave a creator believing every term they typed is being used",
			len(many), model.MaxKeywords)
	}

	// One over-long term must be refused by name.
	if _, err := model.NormaliseKeywords(strings.Repeat("x", model.MaxKeywordLen+1)); err == nil {
		t.Error("an over-long keyword was accepted")
	}
}

// TestLogoURLMustBeOurOwnStorage is the stored-XSS guard on a value that becomes
// an `img src`.
//
// Rejected outright: `javascript:`, `data:`, `vbscript:`, `file:`,
// protocol-relative `//evil.example`, and anything with whitespace or a quote.
//
// The allowlist is scheme-and-host shape rather than a tight pattern, because
// MinIO keys are UUID-ish and unpredictable - a strict regex would reject valid
// ones. What matters is that the scheme is http or https, and that the server
// mints the object key itself rather than accepting one from the client.
func TestLogoURLMustBeOurOwnStorage(t *testing.T) {
	for _, bad := range []string{
		"javascript:alert(1)",
		"data:image/svg+xml,<svg onload=alert(1)>",
		"vbscript:msgbox(1)",
		"file:///etc/passwd",
		"//evil.example/x.png",
		"http://ok.example/x.png\" onerror=\"alert(1)",
		"https://ok.example/x.png onerror=alert(1)",
		"/relative/path.png",
	} {
		if err := model.ValidateLogoURL(bad); err == nil {
			t.Errorf("ValidateLogoURL(%q) = nil; it must be REFUSED.\n"+
				"  This value is stored and rendered as an <img src> on a public page",
				bad)
		}
	}

	for _, good := range []string{
		"http://localhost:9000/covers/abc/def.png",
		"https://storage.example.com/avatars/abc.png",
		"",
	} {
		if err := model.ValidateLogoURL(good); err != nil {
			t.Errorf("ValidateLogoURL(%q) = %v; it should be accepted", good, err)
		}
	}
}

// TestTaglineCapIsEnforced is a one-line check with a reason behind it.
//
// 120 characters, because this is a tagline and `description` already exists for
// prose. A 500-character tagline is a description that learned to shout.
func TestTaglineCapIsEnforced(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	ctx := context.Background()
	userID, channelID := setupFixture(t, svc, "tag")

	tooLong := strings.Repeat("x", model.TaglineMaxLen+1)
	if _, err := svc.UpdateChannelSetup(ctx, userID, channelID,
		&model.UpdateChannelSetupRequest{Tagline: &tooLong}); err == nil {
		t.Errorf("a %d-character tagline was accepted; the cap is %d",
			len(tooLong), model.TaglineMaxLen)
	}

	exactly := strings.Repeat("y", model.TaglineMaxLen)
	if _, err := svc.UpdateChannelSetup(ctx, userID, channelID,
		&model.UpdateChannelSetupRequest{Tagline: &exactly}); err != nil {
		t.Errorf("a tagline of exactly %d characters was rejected: %v", model.TaglineMaxLen, err)
	}
}

// setupStrPtr is named for this file rather than reusing a shared helper.
//
// `boolPtr` already exists in this package's tests, and reaching for it would be
// fine - but a test that needs a `*string` in two places is not evidence that a
// shared helper should exist, and adding one to a shared test file for a single
// file's use is how shared helpers acquire eleven callers. If a second file needs
// it, promote it then.
// TestTheGateFollowsTheNewestChannelAndCannotTrapACreator is the regression for a
// design flaw the browser check found with real data.
//
// The gate originally asked for "the newest channel WHERE setup_step2_at IS NULL".
// With 26 half-finished channels left over from earlier test runs, the gate sent
// the creator to one, they finished it, and it immediately sent them to the NEXT
// unfinished one - possibly one they abandoned weeks earlier.
//
//	needs_setup: true, forever
//
// The dashboard became unreachable through the front door. The only escape was to
// finish every channel you had ever started, oldest first. Abandoned channels are
// the NORMAL state of a channel list, so "compulsory" had quietly become "you may
// never return to your dashboard again".
//
// The rule now: take the newest channel, whatever its state. Unfinished -> step 2
// is next. Finished -> the gate releases and the older ones are tidying, not a
// wall.
func TestTheGateFollowsTheNewestChannelAndCannotTrapACreator(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	ctx := context.Background()
	userID, _ := setupFixture(t, svc, "trap")

	// Three channels, all UNFINISHED, oldest first. `created_at` is what the gate
	// orders by, so they have to be separated in time or the ordering is arbitrary.
	var ids []uuid.UUID
	for i := 0; i < 3; i++ {
		c, err := svc.CreateChannel(ctx, userID, handleRequest(uniqueHandle("trap"), "Trap Probe"))
		if err != nil {
			t.Fatalf("create channel %d: %v", i, err)
		}
		ids = append(ids, c.ID)
		if err := db.Exec("UPDATE channels SET created_at = ? WHERE id = ?",
			time.Now().Add(time.Duration(i)*time.Hour), c.ID).Error; err != nil {
			t.Fatalf("stamp created_at: %v", err)
		}
		t.Cleanup(func() {
			db.Where("id = ?", c.ID).Delete(&model.Channel{})
		})
	}

	newest := ids[len(ids)-1]

	got, err := svc.ChannelNeedingSetup(ctx, userID)
	if err != nil {
		t.Fatalf("ChannelNeedingSetup: %v", err)
	}
	if got != newest {
		t.Fatalf("the gate points at %v, want the NEWEST channel %v.\n"+
			"  Pointing at an older unfinished channel means the creator is sent to tidy "+
			"something they abandoned, before the channel they just made", got, newest)
	}

	// Finish the newest one. The gate must now RELEASE, even though the two older
	// channels are still unfinished - this is the assertion that was impossible to
	// write before, because the answer was always "keep going".
	if _, err := svc.UpdateChannelSetup(ctx, userID, newest, &model.UpdateChannelSetupRequest{
		FinishStep2: true,
	}); err != nil {
		t.Fatalf("finish the newest channel: %v", err)
	}

	got, err = svc.ChannelNeedingSetup(ctx, userID)
	if err != nil {
		t.Fatalf("ChannelNeedingSetup after finish: %v", err)
	}
	if got != uuid.Nil {
		t.Errorf("the gate still points at %v after the newest channel was finished, "+
			"with %d older unfinished channels remaining.\n"+
			"  This is the trap: the creator can never leave the dashboard until every "+
			"channel they ever abandoned is also finished, oldest first",
			got, len(ids)-1)
	}

	// And the count is still honest, so the dashboard can offer to tidy the rest.
	pending, err := svc.CountChannelsNeedingSetup(ctx, userID)
	if err != nil {
		t.Fatalf("CountChannelsNeedingSetup: %v", err)
	}
	if pending < 2 {
		t.Errorf("pending = %d, want at least 2 (the two older unfinished channels).\n"+
			"  The gate may release, but the dashboard still needs to be able to say "+
			"'%d channels are not finished yet'", pending, 2)
	}
}

// TestSuperadminComesFromTheDatabaseNotTheToken is the branch that decides whether
// the privilege registry is readable, and it had no coverage.
//
// The handler answers 403 by calling `IsSuperAdmin`, and that is the ONLY thing
// standing between an ordinary account and a complete map of who holds what across
// the platform - including the accounts that could read that map. It was untested,
// because verifying it against a real superadmin account needs a real
// superadmin's password, and no test should have one of those.
//
// So the test creates a throwaway user, inserts a `superadmin_accounts` row, and
// watches the answer change. Then it DEACTIVATES the slot and watches it change
// back.
//
// The second half is the part that matters. `superadmin_accounts.is_active` is
// read per request rather than baked into a token claim, so an administrator can
// revoke a compromised admin account and the access stops immediately - rather
// than persisting until that person's token expires.
func TestSuperadminComesFromTheDatabaseNotTheToken(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	ctx := context.Background()

	userID, _ := setupFixture(t, svc, "sa")

	access := NewServiceAccess(db)

	// The slot table's email is a separate copy of the user's, so it gets its own
	// value rather than being joined back.
	target := "sa-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8]

	// ---- Before: not a superadmin ----
	isSuper, err := access.IsSuperAdmin(ctx, userID)
	if err != nil {
		t.Fatalf("IsSuperAdmin: %v", err)
	}
	if isSuper {
		t.Fatal("a brand-new account is a superadmin. Nothing created a slot for it, " +
			"so this means IsSuperAdmin is not actually reading anything")
	}

	// ---- Claim a slot ----
	// `email` and `role` are both NOT NULL on this table, and the first two
	// attempts at this insert left them out, producing
	//
	//	ERROR: null value in column "email" of relation "superadmin_accounts"
	//	ERROR: null value in column "role"  of relation "superadmin_accounts"
	//
	// Two constraint failures in a test about AUTHORIZATION, which read like
	// problems with the thing under test rather than with the fixture. The fix is
	// to read `\d superadmin_accounts` first, which is where this comment comes
	// from.
	slot := 90
	if err := db.Exec(
		`INSERT INTO superadmin_accounts (user_id, email, role, slot, is_active, created_at)
		 VALUES (?, ?, 'superadmin', ?, true, now())`,
		userID, target+"@wideo11.test", slot).Error; err != nil {
		t.Fatalf("claim a superadmin slot: %v", err)
	}
	t.Cleanup(func() {
		db.Exec("DELETE FROM superadmin_accounts WHERE user_id = ?", userID)
	})

	isSuper, err = access.IsSuperAdmin(ctx, userID)
	if err != nil {
		t.Fatalf("IsSuperAdmin after claiming: %v", err)
	}
	if !isSuper {
		t.Error("an active superadmin_accounts slot did not grant superadmin. The " +
			"registry endpoint would answer 403 to the one person allowed to read it")
	}

	// ---- The part that matters: revocation is immediate ----
	if err := db.Exec(
		`UPDATE superadmin_accounts SET is_active = false WHERE user_id = ?`, userID,
	).Error; err != nil {
		t.Fatalf("deactivate the slot: %v", err)
	}

	isSuper, err = access.IsSuperAdmin(ctx, userID)
	if err != nil {
		t.Fatalf("IsSuperAdmin after deactivating: %v", err)
	}
	if isSuper {
		t.Error("a DEACTIVATED slot still grants superadmin.\n" +
			"  This is the property that makes revocation worth having: the rule is read " +
			"from the database on every request, so revoking a compromised admin takes " +
			"effect at once rather than at token expiry.")
	}
}

// TestAServiceGrantIsRequiredToUseAService is the other half of migration 017, and
// the reason the layer exists at all.
//
// Before this, "which apps may this person open" had nowhere to live: the answer
// was whatever the client decided to show. Now it is a row, and `CanUse` refuses
// without one.
func TestAServiceGrantIsRequiredToUseAService(t *testing.T) {
	db := handleDB(t)
	svc := newHandleTestService(t, db)
	ctx := context.Background()
	access := NewServiceAccess(db)
	userID, _ := setupFixture(t, svc, "svc")
	slotEmail := "svc-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8] + "@wideo11.test"

	// ---- Refused by default ----
	//
	// The default has to be NO. Defaulting to allow would mean every account could
	// open billing and admin the moment those apps shipped.
	if err := access.CanUse(ctx, userID, ServiceBilling); err == nil {
		t.Fatal("CanUse allowed a service nobody granted")
	}

	// ---- An unknown slug is refused, not allowed ----
	//
	// The slug list is a CHECK constraint, so an unrecognised value is a caller
	// bug. Answering "allowed" for one would turn a typo into an open door, and
	// would fail closed in the database and open in the application at the same
	// time.
	if err := access.CanUse(ctx, userID, "not_a_real_service"); err == nil {
		t.Error(`CanUse allowed "not_a_real_service". An unrecognised slug must be ` +
			"refused - it is a caller bug, not a grant")
	}

	// ---- Grant, then it works ----
	granter := userID
	if err := access.Grant(ctx, userID, ServiceBilling, &granter, "test grant"); err != nil {
		t.Fatalf("Grant: %v", err)
	}
	if err := access.CanUse(ctx, userID, ServiceBilling); err != nil {
		t.Errorf("CanUse refused a service that WAS granted: %v", err)
	}

	// ---- Revoke, and it stops working again ----
	//
	// Checked BEFORE the superadmin case below, and that ordering is load-bearing.
	//
	// An earlier version of this test claimed the slot first and then asserted
	// that a revoked grant stops working - and it failed, reporting:
	//
	//     a REVOKED service grant still works
	//
	// which reads as a serious authorization bug. It is not. `CanUse` returns early
	// for a superadmin, which is correct: a superadmin holds every service without a
	// grant, so revoking one of their grants cannot remove access.
	//
	// The test was wrong about the code, and the assertion was measuring the wrong
	// thing. Ordering it before the superadmin slot is what makes it measure
	// revocation.
	if err := access.Revoke(ctx, userID, ServiceBilling, "test revoke"); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if err := access.CanUse(ctx, userID, ServiceBilling); err == nil {
		t.Error("a REVOKED service grant still works")
	}

	// ---- A superadmin holds every service, with no grant at all ----
	//
	// This is what stops an administrator being locked out of the very tools they
	// need in order to grant themselves access. It only ever shows up in
	// production: an admin locked out of the grant UI, with no way back in.
	if err := db.Exec(
		`INSERT INTO superadmin_accounts (user_id, email, role, slot, is_active, created_at)
		 VALUES (?, ?, 'superadmin', 91, true, now())`, userID, slotEmail).Error; err != nil {
		t.Fatalf("claim a slot: %v", err)
	}
	t.Cleanup(func() {
		db.Exec("DELETE FROM superadmin_accounts WHERE user_id = ?", userID)
	})
	if err := access.CanUse(ctx, userID, ServiceMonitor); err != nil {
		t.Errorf("a superadmin could not use %s without an explicit grant: %v\n"+
			"  That deadlock only shows up in production: an administrator locked out "+
			"of the tools they need in order to grant themselves access.", ServiceMonitor, err)
	}
}

func setupStrPtr(s string) *string { return &s }

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
