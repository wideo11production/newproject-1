package config

// `DEFAULT_FREE_TRIAL_DAYS` is the preferred name; `PLANS_TRIAL_TRIAL_DAYS` still works.
//
// -----------------------------------------------------------------------------
// WHY THIS NEEDS A TEST AT ALL
// -----------------------------------------------------------------------------
//
// Because the failure it prevents is INVISIBLE.
//
// `envInt64` returns a built-in default for a missing key. So the moment this
// feature shipped, every deployment whose `.env` held only the legacy name would
// have come up on a 3-day trial — no error, no log line, and nothing visibly
// wrong. Somebody would set `PLANS_TRIAL_TRIAL_DAYS=30`, watch the trial stay at
// three days, and have no reason to suspect the variable was being ignored.
//
// That is the same failure as the published `JWT_SECRET_KEY` defaults this
// repository already removed: a configuration key that is accepted, documented,
// and not read. Those are now refused outright rather than defaulted, and this one
// is the same shape in a smaller place.
//
// The ORDER is half the feature. Legacy-first would mean anybody who happened to
// set the old name could never override it with the new one — and the new name
// would be decorative.

import (
	"testing"

	"github.com/spf13/viper"
)

func TestDefaultFreeTrialDaysPreferredOverLegacy(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)

	// BOTH set. The preferred name must win, because that is what somebody who
	// deliberately added it expects.
	viper.Set("DEFAULT_FREE_TRIAL_DAYS", 45)
	viper.Set("plans_trial_trial_days", 7)

	got := trialDaysFor("trial", 3)
	if got != 45 {
		t.Errorf("trial days = %d, want 45.\n"+
			"  DEFAULT_FREE_TRIAL_DAYS is the PREFERRED name and must win when both\n"+
			"  are set. Legacy-first would make the new name un-overridable by\n"+
			"  anybody who happened to set the old one.", got)
	}
}

func TestLegacyTrialDaysStillHonoured(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)

	// Only the legacy name. This is every deployment that exists today, and the
	// whole point of the fallback is that it keeps working untouched.
	//
	// The key is `planKey("trial", "trial_days")` = "plans.trial.trial_days", NOT
	// the flat `plans_trial_trial_days` that the ENV VAR uses. Viper nests the one
	// and does not bridge it to the other, so a test has to set the nested form even
	// though `.env` spells it flat. Asserted through `planKey` rather than written
	// out, so a change to the prefix cannot make this test quietly vacuous.
	viper.Set(planKey("trial", "trial_days"), 30)

	got := trialDaysFor("trial", 3)
	if got != 30 {
		t.Errorf("trial days = %d, want 30.\n"+
			"  The legacy key must still be honoured. Renaming without a fallback is\n"+
			"  a silent break: envInt64 returns the DEFAULT for a missing key, so\n"+
			"  every existing deployment would quietly drop to 3 days with no error.",
			got)
	}
}

func TestNeitherKeyFallsBackToTheSpecDefault(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)

	got := trialDaysFor("trial", 3)
	if got != 3 {
		t.Errorf("trial days = %d, want the spec default 3", got)
	}
}

// TestAZeroValueIsHonouredNotTreatedAsMissing is the case `envInt64` gets wrong
// and this one exists to catch.
//
// `envInt64Present` exists for exactly this: `envInt64` cannot tell "not set"
// from "set to 0", so a legitimate `DEFAULT_FREE_TRIAL_DAYS=0` — a product that
// has switched trials off entirely — would be silently overridden by the legacy key
// or by the default.
func TestAZeroValueIsHonouredNotTreatedAsMissing(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)

	viper.Set("DEFAULT_FREE_TRIAL_DAYS", 0)
	viper.Set(planKey("trial", "trial_days"), 30)

	if got := trialDaysFor("trial", 3); got != 0 {
		t.Errorf("trial days = %d, want 0.\n"+
			"  Switching trials OFF must be expressible. A zero that reads as 'unset'\n"+
			"  means the one configuration an operator most deliberately makes is the\n"+
			"  one that gets ignored.", got)
	}
}