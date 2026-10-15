package service

import (
	"fmt"
	"strings"
)

// ============================================================================
// GEO PRICING AND THE COUNTRY MISMATCH
// ============================================================================
//
// The 7 tiers above each declare a `PriceZone`: low, mid or high. Those are
// purchasing-power bands, and the band is chosen from COUNTRY, not currency - the
// price table in `pricing_rules.go` has an explicit price per currency, and this
// file answers "which band does this buyer get".
//
// WHY THERE ARE TWO COUNTRIES AND NOT ONE
//
// There is always at least the declared one (the account's stored country) and
// usually a second from the request's IP. A VPN makes them disagree, and that
// disagreement is the whole point of this file.
//
// The regressive failure this exists to prevent: without a check, a buyer
// connecting through a VPN exit in a `high` country to buy a `low` price would
// get the developed-world price charged to a developing-world allowance. The
// platform would bleed on the cheapest plans, and nobody would notice because
// the sale would complete and look successful.
//
// So the buyer's OWN stored country wins, and the IP country is only ever used
// to flag a mismatch and to decide what to do about it. It is never used to
// downgrade a buyer who legitimately lives where they live - the stored value is
// the one the buyer typed about themselves, and it is the one they can be held
// to.
//
// WHY THE MISMATCH IS NOT SIMPLY REJECTED
//
// A VPN is not fraud. It is a corporate tunnel, an expat staying on their home
// connection, and a traveller. Refusing the sale for every mismatch would turn
// away legitimate paying customers to catch a handful of arbitrageurs, and the
// product would be worse for it.
//
// So the mismatch is RECORDED and PRICED CONSERVATIVELY: the LOW price is never
// given on the basis of an IP in a low country when the account says otherwise,
// and the sale proceeds. That is the balance this file draws.

// PriceZone is the purchasing-power band a country sits in.
//
// The three values match the `Region` constants in `ad-economics.go`
// (`RegionLow`, `RegionIndia`, `RegionHigh`) so the two files cannot drift into
// two different names for one band.
type PriceZone = Region

const (
	// ZoneLow - the low purchasing-power band.
	ZoneLow = RegionLow
	// ZoneMid - the middle band. India's band.
	ZoneMid = RegionIndia
	// ZoneHigh - the high purchasing-power band, priced in USD terms.
	ZoneHigh = RegionHigh
)

// geoZone is a country's band, as this file knows it.
type geoZone struct {
	zone   PriceZone
	// name is for humans in the log and in the mismatch notice.
	name string
}

// countryZones is the band table.
//
// Deliberately explicit per country and deliberately not derived from GDP or
// any other statistic. A statistic would move, and a price band that moves under
// a customer is a price change nobody decided to make. An operator edits this
// list and the change is visible in the diff.
//
// Countries absent here fall to ZoneHigh. The bias is deliberate and is
// explained at the call site.
var countryZones = map[string]geoZone{
	"IN": {zone: ZoneMid, name: "India"},
	"PK": {zone: ZoneLow, name: "Pakistan"},
	"BD": {zone: ZoneLow, name: "Bangladesh"},
	"NP": {zone: ZoneLow, name: "Nepal"},
	"LK": {zone: ZoneLow, name: "Sri Lanka"},
	"ID": {zone: ZoneLow, name: "Indonesia"},
	"PH": {zone: ZoneLow, name: "Philippines"},
	"VN": {zone: ZoneLow, name: "Vietnam"},
	"NG": {zone: ZoneLow, name: "Nigeria"},
	"KE": {zone: ZoneLow, name: "Kenya"},
	"BR": {zone: ZoneMid, name: "Brazil"},
	"MX": {zone: ZoneMid, name: "Mexico"},
	"ZA": {zone: ZoneMid, name: "South Africa"},
	"TR": {zone: ZoneMid, name: "Turkey"},
	"RU": {zone: ZoneMid, name: "Russia"},
	"US": {zone: ZoneHigh, name: "United States"},
	"CA": {zone: ZoneHigh, name: "Canada"},
	"GB": {zone: ZoneHigh, name: "United Kingdom"},
	"DE": {zone: ZoneHigh, name: "Germany"},
	"FR": {zone: ZoneHigh, name: "France"},
	"AU": {zone: ZoneHigh, name: "Australia"},
	"JP": {zone: ZoneHigh, name: "Japan"},
	"SG": {zone: ZoneHigh, name: "Singapore"},
	"AE": {zone: ZoneHigh, name: "United Arab Emirates"},
}

// zoneRank orders the bands so a mismatch can be resolved by comparison rather
// than by a second if-ladder that says the same thing in different words.
var zoneRank = map[PriceZone]int{
	ZoneLow:  0,
	ZoneMid:  1,
	ZoneHigh: 2,
}

// GeoInput is everything this resolver is given.
//
// Both fields are optional and every combination is meaningful, because a caller
// with an IP and no account country (a signed-out visitor looking at prices) and
// a caller with an account country and no resolvable IP (a proxy that strips
// forwarding headers) are both ordinary.
type GeoInput struct {
	// DeclaredCountry is the buyer's own stored ISO country code.
	DeclaredCountry string
	// IPCountry is the country the request's IP resolved to.
	IPCountry string
}

// GeoDecision is the resolved answer.
type GeoDecision struct {
	// Zone is the band the price is taken from.
	Zone PriceZone
	// Country is the country that decided it.
	Country string
	// CountryName is the human-readable form of Country, for the mismatch notice.
	CountryName string
	// Mismatch is true when the two countries disagree.
	Mismatch bool
	// MismatchNote explains the mismatch in language a user can act on, and is
	// empty when there is none.
	MismatchNote string
	// ClampedFrom is the zone that would have applied had the IP been trusted.
	// Empty when there was nothing to clamp - i.e. no mismatch, or a mismatch
	// that would not have changed the price. It exists so the audit record can
	// say "this sale was priced UP because of a VPN", which is the fact an
	// operator needs when reviewing arbitrage.
	ClampedFrom string
	// Source says which country won, so the reason is recorded rather than
	// inferred.
	Source string
}

// ResolveGeo decides the price band and reports any mismatch.
//
// THE PRECEDENCE, AND WHY IT IS THIS WAY
//
//  1. The DECLARED country wins whenever there is one. It is the value the buyer
//     gave about themselves, it is what they can be held to, and it does not
//     move when they open a VPN.
//  2. The IP country is used only when there is no declared one - a signed-out
//     visitor has to see a price, and the IP is all there is.
//  3. An unknown country is ZoneHigh, NOT ZoneLow.
//
// Why high and not low: an unknown country priced at the developed-world rate
// undercharges nobody and overcharges some; priced at the developing-world rate
// it undercharges everyone who anonymises their connection, and the band is
// chosen once per sale rather than once per customer. A conservative default is
// the right way to be wrong here.
//
// THE MISMATCH RULE
//
// The declared country's zone is used, and the mismatch is recorded. But there
// is one asymmetry worth stating: when the IP sits in a HIGHER band than the
// account claims, the declared (lower) zone still applies - a traveller opening
// their laptop in New York must not be charged the US rate for their Indian plan
// by accident.
//
// When the IP sits in a LOWER band than the account claims, the declared (higher)
// zone applies. That is the arbitrage case, and the declared country wins because
// it is the account's own statement about where it lives.
//
// In both directions the declared country wins. What differs is only whether the
// resolution is worth recording, and `ClampedFrom` records the first direction
// specifically, because that is the one that looks like the platform making a
// mistake and needs the explanation attached to it.
func ResolveGeo(in GeoInput) GeoDecision {
	declared := normaliseCountry(in.DeclaredCountry)
	ip := normaliseCountry(in.IPCountry)

	switch {
	case declared != "":
		dz := countryZones[declared]
		if dz.zone == "" {
			dz = geoZone{zone: ZoneHigh, name: "Unknown"}
		}

		// No IP, or the same country: no mismatch possible.
		if ip == "" || ip == declared {
			return GeoDecision{
				Zone:        dz.zone,
				Country:     declared,
				CountryName: dz.name,
				Source:      "declared_country",
			}
		}

		iz := countryZones[ip]
		if iz.zone == "" {
			iz = geoZone{zone: ZoneHigh, name: "Unknown"}
		}

		// The declared country wins in both directions - see the note above.
		out := GeoDecision{
			Zone:        dz.zone,
			Country:     declared,
			CountryName: dz.name,
			Mismatch:    true,
			Source:      "declared_country",
		}

		if zoneRank[iz.zone] > zoneRank[dz.zone] {
			// IP is in a HIGHER band than the account claims. The account's
			// cheaper zone still applies, and this is recorded because it is the
			// direction that looks like an error to whoever reads the ledger:
			// a buyer in a cheap country paying the cheap price while apparently
			// sitting in an expensive one.
			out.ClampedFrom = string(iz.zone)
			out.MismatchNote = fmt.Sprintf(
				"You are connecting from %s. Your account is registered in %s, so %s pricing applies.",
				iz.name, dz.name, dz.name,
			)
		} else if zoneRank[iz.zone] < zoneRank[dz.zone] {
			// IP is in a LOWER band than the account claims - the arbitrage
			// shape. The account's own country is more expensive, so it wins,
			// and the buyer is told why they are NOT getting the cheaper rate.
			out.ClampedFrom = string(iz.zone)
			out.MismatchNote = fmt.Sprintf(
				"You are connecting from %s, but your account is registered in %s. Your account country decides your price.",
				iz.name, dz.name,
			)
		}

		return out

	case ip != "":
		iz := countryZones[ip]
		if iz.zone == "" {
			iz = geoZone{zone: ZoneHigh, name: "Unknown"}
		}
		return GeoDecision{
			Zone:        iz.zone,
			Country:     ip,
			CountryName: iz.name,
			Source:      "ip_country",
			Mismatch:    false,
		}

	default:
		// Nothing at all. The conservative answer, stated once.
		return GeoDecision{
			Zone:      ZoneHigh,
			Country:   "",
			Source:    "default",
			MismatchNote: "No country available, so the standard rate applies.",
		}
	}
}

// normaliseCountry uppercases and trims. Two-letter codes in, two-letter codes
// out; anything longer is not a country code and is discarded rather than
// truncated, because "India"[:2] would become "IN" by accident and silently
// price a whole market.
func normaliseCountry(raw string) string {
	c := strings.ToUpper(strings.TrimSpace(raw))
	if len(c) != 2 {
		return ""
	}
	for _, r := range c {
		if r < 'A' || r > 'Z' {
			return ""
		}
	}
	return c
}

// ZoneForTier resolves the band a specific tier should be priced in.
//
// This is the join between the two files: the tier declares a zone, and this
// resolves what the buyer actually pays. It is separate from `ResolveGeo` because
// the geo decision is the same for every tier in a basket and must be computed
// once - recomputing it per plan would let a VPN toggle mid-checkout price two
// plans from two different bands.
func ZoneForTier(tier Tier, decision GeoDecision) PriceZone {
	if tier.PriceZone == "" {
		// A tier with no declared zone is a registry error. It resolves to the
		// buyer's own zone rather than to a hardcoded one, so the sale still
		// completes at a sane price instead of failing on a missing field.
		return decision.Zone
	}
	return PriceZone(tier.PriceZone)
}

// ErrZoneUnknown is returned by callers that need a band and cannot get one.
//
// Declared here rather than at the call site so the failure is named once. It is
// not returned by this file, which always resolves to something defensible - it
// exists for the pricing-table lookup, which does have a genuine failure mode.
var ErrZoneUnknown = fmt.Errorf("no pricing band for country")
