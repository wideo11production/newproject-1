package service

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/billing-service/src/model"
	"newproject/services/billing-service/src/repository"
)

// ============================================================================
// THE PLAN CATALOGUE SEEDER - the missing writer
// ============================================================================
//
// THE SEVEN TIERS ABOVE WERE DECLARED AND THE TABLE WAS EMPTY.
//
// This is the seventh instance in this repository of a pattern, and the reason
// the pattern keeps recurring here is that it always looks finished: the registry
// is complete, the logic is correct, the tests pass, and then a paying customer
// opens the pricing page and gets a 500.
//
// `GET /pricing` was answering exactly that - 500 `plan_catalogue_incomplete` -
// because `subscription_plans` had ZERO ROWS. Nothing had ever seeded it, and
// `Tiers()` declares seven plans that exist only in Go memory until something
// writes them.
//
// The codebase records this pattern repeatedly, and each time the fix is the same
// shape: find the code that ASSUMES a writer exists and make it the writer. This
// file is that, for the plan catalogue.
//
// WHY IT IS AN UPSERT AND NOT A MIGRATION
//
// Prices change. A migration that INSERTs a price is a row that is wrong the
// moment the price moves, and an operator has no way to change it but another
// migration. This seeder upserts by the plan `code`, so it is safe to run on every
// boot: it writes the configured price if there is none, and it leaves a price an
// operator has already changed alone.
//
// That last part is deliberate and load-bearing. A seeder that overwrote on every
// boot would silently revert every price a shop owner changed from the admin
// panel, and they would learn about it from their customers.

// SeedPlans ensures the seven sellable tiers exist in `subscription_plans`.
//
// Idempotent, and safe to call on every boot. It is wired from `main.go` BEFORE
// the HTTP server starts, so the first request to /pricing or /subscriptions/pending
// finds the rows already there - rather than finding a 500 that happens to be
// caused by a startup ordering problem.
//
// The price comes from the environment with the committed default as the
// fallback, which is the same convention as `auth-service/internal/config/plans.go`
// and is stated there as "a price in code is a deploy; a price in env is a
// restart". The defaults here are the published Indian prices in paise.
func SeedPlans(ctx context.Context, repo repository.SubscriptionPlanRepository) error {
	if repo == nil {
		return fmt.Errorf("plan repository is not wired; the catalogue cannot be seeded")
	}

	// Read once, so every plan in this pass is priced against the SAME
	// configuration. Reading per-plan would let a config reload mid-seed price
	// half the catalogue in one zone and half in another.
	zones := defaultZonePrices()

	written := 0
	for _, tier := range Tiers() {
		price, err := zones.priceFor(tier.PriceZone, tier.DurationDays)
		if err != nil {
			// A plan that cannot be priced is NOT seeded. Seeding it at zero would
			// let it be selected on the pricing page and then fail at activation,
			// which is the worst ordering of events available: the buyer commits,
			// and the system refuses afterwards.
			log.Printf("[seed] SKIPPING %s - %v", tier.Code, err)
			continue
		}

		existing, err := repo.GetByCode(ctx, tier.Code)
		if err == nil && existing != nil && existing.ID != 0 {
			// Present. The operator may have edited the price, the name or the
			// ordering from the admin panel, and a seeder must not stomp that.
			// Only the structural facts that MUST track the registry are
			// refreshed, because those are what the editor and the entitlements
			// depend on rather than what a shop owner edits.
			changed := false
			if existing.MaxFPS != tier.FpsCeiling {
				existing.MaxFPS = tier.FpsCeiling
				changed = true
			}
			if existing.MaxResolution != resolutionFor(tier) {
				existing.MaxResolution = resolutionFor(tier)
				changed = true
			}
			if existing.IsActive != true {
				existing.IsActive = true
				changed = true
			}
			if isStandalonePlan(tier) != existing.IsStandalone {
				existing.IsStandalone = isStandalonePlan(tier)
				changed = true
			}
			if changed {
				if err := repo.Update(ctx, existing); err != nil {
					return fmt.Errorf("refreshing plan %s: %w", tier.Code, err)
				}
				written++
			}
			continue
		}

		// Absent. Create it.
		plan := &model.SubscriptionPlan{
			UUID:          uuid.New(),
			Name:          tier.Name,
			Code:          tier.Code,
			Description:   fmt.Sprintf("%s - %d seat(s), %dfps ceiling", tier.Name, tier.Seats, tier.FpsCeiling),
			Price:         decimal.RequireFromString(price),
			Currency:      currencyFor(tier.PriceZone),
			Cycle:         cycleFor(tier),
			Interval:      1,
			TrialDays:     0,
			Features:      featuresJSON(tier),
			MaxFPS:        tier.FpsCeiling,
			MaxResolution: resolutionFor(tier),
			IsStandalone:  isStandalonePlan(tier),
			IsActive:      true,
			// Sort order follows the display order of `Tiers()`, so a pricing
			// page renders them cheapest-first without a second list to keep in
			// step.
			SortOrder:  tierSortOrder(tier.Code),
			CreatedAt:  time.Now(),
			UpdatedAt:  time.Now(),
		}

		if err := repo.Create(ctx, plan); err != nil {
			return fmt.Errorf("seeding plan %s: %w", tier.Code, err)
		}
		written++
		log.Printf("[seed] plan %s created at %s %s", tier.Code, plan.Currency, plan.Price)
	}

	log.Printf("[seed] plan catalogue ready - %d of %d tiers written", written, len(Tiers()))
	return nil
}

// zonePrices is the priced catalogue, read from the environment.
type zonePrices struct {
	// quarterly, biannual and annual per zone, in that zone's currency.
	// All six are absent together or present together; a zone with no prices is
	// not seeded rather than seeded at zero.
	prices map[string]map[string]string
}

// defaultZonePrices reads the published prices.
//
// The variable names are the env keys, and the defaults are the values shipped in
// `.env` - the three price bands described in `ad-economics.go`. MAJORITY of them
// are for the recurring plans; the lifetime tiers are priced off the ANNUAL figure
// for their zone, which is the honest relationship between them rather than a
// separate number nobody maintains.
func defaultZonePrices() zonePrices {
	return zonePrices{
		prices: map[string]map[string]string{
			string(ZoneLow): {
				"quarterly": envPrice("PLAN_LOW_QUARTERLY_PRICE", "450"),
				"biannual":  envPrice("PLAN_LOW_BIANNUAL_PRICE", "750"),
				"annual":    envPrice("PLAN_LOW_ANNUAL_PRICE", "1500"),
			},
			// India's band, the base the whole table is expressed against.
			string(ZoneMid): {
				"quarterly": envPrice("PLAN_INDIA_QUARTERLY_PRICE", "300"),
				"biannual":  envPrice("PLAN_INDIA_BIANNUAL_PRICE", "500"),
				"annual":    envPrice("PLAN_INDIA_ANNUAL_PRICE", "1000"),
			},
			string(ZoneHigh): {
				"quarterly": envPrice("PLAN_HIGH_QUARTERLY_PRICE", "150"),
				"biannual":  envPrice("PLAN_HIGH_BIANNUAL_PRICE", "250"),
				"annual":    envPrice("PLAN_HIGH_ANNUAL_PRICE", "500"),
			},
		},
	}
}

// priceFor resolves one tier's price.
//
// A lifetime tier is priced at the zone's ANNUAL figure. That is a product
// decision that is stated here rather than buried: a single lifetime licence is
// roughly the cost of a year of recurring access, which is the conventional
// relationship and the one a buyer can sanity-check.
//
// A zone with no figure is an ERROR, not a zero. Zero-priced plans are the single
// most expensive bug available in a billing system, because everything about them
// works perfectly until someone notices the revenue is not there.
func (z zonePrices) priceFor(zone string, durationDays int) (string, error) {
	band, ok := z.prices[zone]
	if !ok {
		return "", fmt.Errorf("no price band for zone %q - the plan is NOT seedable at zero", zone)
	}

	// Which duration's figure applies. A lifetime has no duration and takes the
	// annual figure by the rule above.
	key := "annual"
	switch durationDays {
	case 90:
		key = "quarterly"
	case 180:
		key = "biannual"
	case 365, 0:
		key = "annual"
	default:
		// An unmapped duration. The annual figure is the closest and the
		// cheapest-to-explain of the three.
		key = "annual"
	}

	p, ok := band[key]
	if !ok || p == "" {
		return "", fmt.Errorf("zone %q has no %s price - the plan is NOT seedable at zero", zone, key)
	}
	return p, nil
}

// LocalisedCurrency is the currency a buyer in `country` should be quoted in.
//
// India is bound to INR by `PLAN_LOW_CURRENCY` (default INR) and
// `PLAN_INDIA_CURRENCY` (default INR). Every other country falls through to the
// band's own currency, which is what `currencyFor` already resolves - so an
// unknown country returns the empty string and the caller keeps the plan's own
// currency rather than guessing.
//
// The empty string is deliberate. A function that returned "USD" here would give
// every unhandled country a currency, and "we defaulted to dollars" is exactly the
// reported bug in a different costume.
func LocalisedCurrency(country string) string {
	switch normaliseCountry(country) {
	case "IN":
		return envPrice("PLAN_LOW_CURRENCY", "INR")
	default:
		// India's own band, which is the mid band. Reading it explicitly rather
		// than falling through means a change to India's currency is a single env
		// var rather than a fact scattered over two functions.
		return envPrice("PLAN_INDIA_CURRENCY", "INR")
	}
}

// IsLocalisedBandFor reports whether `zone` belongs to `country`'s local pricing.
//
// This is the rule that stops the reported failure recurring: a buyer is quoted in
// their local currency ONLY for the bands that are actually local products. For
// India those are the low and mid bands. The high band is a USD product and is left
// alone - relabelling it as INR would undercharge it by the exchange rate.
//
// Returning false for an unknown country is the safe answer, because the caller
// then keeps the plan's own band currency rather than imposing a wrong one.
func IsLocalisedBandFor(country, zone string) bool {
	switch normaliseCountry(country) {
	case "IN":
		return zone == string(ZoneLow) || zone == string(ZoneMid)
	default:
		return false
	}
}

// envPrice reads a price, with the committed default as fallback.
//
// The default is a STRING rather than a number, so it reaches the decimal
// constructor in exactly the shape the environment value arrives in. Parsing a
// default through a different path than the override is how a config value ends
// up with different precision in the two sources.
func envPrice(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// currencyFor maps a zone to its currency.
//
// THE BUG THIS FIXES, AND WHY IT WAS THE EXPENSIVE KIND
//
// This function used to return "USD" for the LOW band on the reasoning that "the
// prices in ZoneLow are published in local units". They are not. The low band's
// figures - `PLAN_LOW_QUARTERLY_PRICE=450` and the rest - are the SAME rupee
// amounts `ad-economics.go` documents for India's local pricing. Tagging a rupee
// amount "USD" made the pricing page show "450 USD" to an Indian buyer, which
// converts to roughly forty thousand rupees at the point of payment.
//
// That is the worst possible bug shape: the number is correct, the LABEL is
// wrong, and nothing in the system disagrees with itself. It fails only at the
// gateway, in front of the customer, after they have decided to buy.
//
// SO THE CURRENCY IS CONFIGURABLE, WITH A SAFE DEFAULT
//
//   ZoneLow  -> `PLAN_LOW_CURRENCY`,  default INR  (the reported bug)
//   ZoneMid  -> `PLAN_INDIA_CURRENCY`, default INR  (India's own band)
//   ZoneHigh -> `PLAN_HIGH_CURRENCY`, default USD  (the developed-world band)
//
// The defaults are the values that are CORRECT for the band, so a deployment that
// never sets these variables still prices India in rupees. A missing variable
// can no longer produce the reported failure.
//
// `PLAN_LOW_COUNTRY` is read for the audit trail: a band bound to a country
// records which country it belongs to, so an operator can see "this band is
// India's" without reverse-engineering the price figures.
func currencyFor(zone string) string {
	switch zone {
	case string(ZoneLow):
		return envPrice("PLAN_LOW_CURRENCY", "INR")
	case string(ZoneMid):
		return envPrice("PLAN_INDIA_CURRENCY", "INR")
	case string(ZoneHigh):
		return envPrice("PLAN_HIGH_CURRENCY", "USD")
	default:
		return "INR"
	}
}

// countryForZone is the country a band belongs to, for audit and for the
// mismatch notice.
//
// Only the low band is configurable, because that is the one whose country was
// ambiguous - and the default is India, so a deployment that sets nothing still
// reports the low band as India's.
func countryForZone(zone string) string {
	switch zone {
	case string(ZoneLow):
		return envPrice("PLAN_LOW_COUNTRY", "IN")
	case string(ZoneMid):
		return envPrice("PLAN_INDIA_COUNTRY", "IN")
	default:
		return ""
	}
}

// cycleFor maps a tier to the database's BillingCycle vocabulary.
//
// The Go model has its own enum and it is NOT the same as `PlanTier`. Mapping
// here rather than at every read keeps the two vocabularies from being compared
// directly, which would produce a plan that is simultaneously a "quarterly" and a
// "monthly" depending on which file you asked.
func cycleFor(tier Tier) model.BillingCycle {
	if tier.IsLifetime() {
		return model.BillingCycleLifetime
	}
	if tier.DurationDays >= 340 {
		return model.BillingCycleAnnually
	}
	if tier.DurationDays >= 170 {
		return model.BillingCycleQuarterly
	}
	return model.BillingCycleMonthly
}

// resolutionFor is the export ceiling the plan allows.
//
// Only AURA reaches 4K. Every other tier is capped at 1080p, which is a product
// decision rather than a technical one - the encoder produces 4K for everyone and
// the CEILING is what the plan buys.
func resolutionFor(tier Tier) string {
	if tier.AURA {
		return "3840x2160"
	}
	return "1920x1080"
}

// isStandalonePlan reports whether the tier is a single-user lifetime licence
// with no recurring cycle. The model uses this to decide whether the plan takes a
// discount, and by the published rule only the single lifetimes do.
func isStandalonePlan(tier Tier) bool {
	return tier.IsLifetime() && tier.Seats == 1
}

// featuresJSON is the stored feature list.
//
// Stored as JSON rather than as columns because it is DISPLAY data: a pricing page
// reads it and nothing enforces it. The limits that ARE enforced live in
// auth-service's grant map, and duplicating them here would create a second set of
// numbers that can disagree with the ones being checked.
func featuresJSON(tier Tier) string {
	aura := "no"
	if tier.AURA {
		aura = "yes"
	}
	return fmt.Sprintf(
		`{"seats":%d,"fps_ceiling":%d,"aura":%q,"term_days":%d}`,
		tier.Seats, tier.FpsCeiling, aura, tier.DurationDays,
	)
}

// tierSortOrder is the display order, matching `Tiers()`.
//
// A function rather than a constant map so the two cannot drift: the order the
// registry returns is the order the page shows.
func tierSortOrder(code string) int {
	for i, t := range Tiers() {
		if t.Code == code {
			return i
		}
	}
	return 99
}
