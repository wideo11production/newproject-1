package service

import "testing"

// The declared country must win. It is the buyer's own statement about where
// they live and the only one that does not move when they open a VPN.
func TestDeclaredCountryWinsOverIP(t *testing.T) {
	d := ResolveGeo(GeoInput{DeclaredCountry: "IN", IPCountry: "US"})

	if d.Country != "IN" || d.Zone != ZoneMid {
		t.Fatalf("declared IN with IP US gave %s/%s, want IN/mid", d.Country, d.Zone)
	}
	if !d.Mismatch {
		t.Error("IN vs US is a mismatch and must be reported as one")
	}
	if d.Source != "declared_country" {
		t.Errorf("source = %q, want declared_country", d.Source)
	}
}

// A VPN into a LOW band from a HIGH-band account must not get the low price.
// This is the arbitrage case the whole file exists to stop.
func TestVPNIntoALowBandDoesNotGetTheLowPrice(t *testing.T) {
	// Account says United States, connecting through a low-band exit.
	d := ResolveGeo(GeoInput{DeclaredCountry: "US", IPCountry: "PK"})

	if d.Zone != ZoneHigh {
		t.Errorf("zone = %s, want high - an account claiming the US must not be priced on a Pakistan exit", d.Zone)
	}
	if !d.Mismatch {
		t.Error("the mismatch must be recorded")
	}
	if d.ClampedFrom != string(ZoneLow) {
		t.Errorf("ClampedFrom = %q, want %q - the cheaper rate that was REFUSED must be recorded", d.ClampedFrom, ZoneLow)
	}
}

// The reverse mismatch: a low-band account travelling through a high-band exit
// keeps their cheap price. Being abroad is not a reason to be charged more.
func TestTravellerKeepsTheirOwnPrice(t *testing.T) {
	d := ResolveGeo(GeoInput{DeclaredCountry: "IN", IPCountry: "US"})

	if d.Zone != ZoneMid {
		t.Errorf("zone = %s, want mid - an Indian account in New York is still an Indian account", d.Zone)
	}
	if d.ClampedFrom != string(ZoneHigh) {
		t.Errorf("ClampedFrom = %q, want %q", d.ClampedFrom, ZoneHigh)
	}
	// The note must not read as a refusal. A traveller is a paying customer.
	if d.MismatchNote == "" {
		t.Error("a priced-up traveller deserves an explanation")
	}
}

// Same country, no mismatch, no note. The common case must be silent.
func TestSameCountryIsSilent(t *testing.T) {
	d := ResolveGeo(GeoInput{DeclaredCountry: "IN", IPCountry: "IN"})

	if d.Mismatch || d.MismatchNote != "" || d.ClampedFrom != "" {
		t.Errorf("IN vs IN reported a mismatch: %+v", d)
	}
}

// A signed-out visitor has no declared country, so the IP is all there is.
func TestIPOnlyUsesTheIP(t *testing.T) {
	d := ResolveGeo(GeoInput{IPCountry: "DE"})

	if d.Zone != ZoneHigh || d.Country != "DE" {
		t.Fatalf("IP-only DE gave %s/%s, want DE/high", d.Country, d.Zone)
	}
	if d.Source != "ip_country" {
		t.Errorf("source = %q, want ip_country", d.Source)
	}
}

// Unknown country, no IP at all. The default must be the CONSERVATIVE one.
func TestNothingKnownDefaultsToHigh(t *testing.T) {
	d := ResolveGeo(GeoInput{})

	if d.Zone != ZoneHigh {
		t.Errorf("zone = %s, want high - an unknown buyer must never be priced at the low rate", d.Zone)
	}
	if d.Source != "default" {
		t.Errorf("source = %q, want default", d.Source)
	}
}

// An unmapped country is also high, not low. The bias is stated once, here.
func TestUnmappedCountryIsHighNotLow(t *testing.T) {
	d := ResolveGeo(GeoInput{DeclaredCountry: "ZZ"})

	if d.Zone != ZoneHigh {
		t.Errorf("zone = %s, want high - an unmapped country must default conservatively", d.Zone)
	}
}

// Malformed country codes must be discarded, not truncated. "IND" is not "IN"
// and pricing a whole market off a 3-letter string is exactly the kind of silent
// error that is impossible to see afterwards.
func TestMalformedCountryCodesAreDiscardedNotTruncated(t *testing.T) {
	// Padded codes are VALID - trimming is the point. `"in "` belongs in the
	// good list below, not here: a browser sending a country field with a stray
	// trailing space should still price India correctly.
	for _, bad := range []string{"IND", "I", "", "  ", "1N", "I5", "i n", "USA"} {
		got := normaliseCountry(bad)
		if got != "" {
			t.Errorf("normaliseCountry(%q) = %q, want empty", bad, got)
		}
	}

	// But a clean code with surrounding whitespace and lowercase is normalised.
	for good, want := range map[string]string{
		"in": "IN", " in ": "IN", "us": "US", "\tUS\n": "US",
	} {
		if got := normaliseCountry(good); got != want {
			t.Errorf("normaliseCountry(%q) = %q, want %q", good, got, want)
		}
	}
}

// Every band in the table must be a known band. A typo in the table would
// silently price a country out of every lookup.
func TestCountryTableHasOnlyKnownBands(t *testing.T) {
	for code, gz := range countryZones {
		if _, ok := zoneRank[gz.zone]; !ok {
			t.Errorf("country %s has band %q which is not low/mid/high", code, gz.zone)
		}
		if gz.name == "" {
			t.Errorf("country %s has no human name for the mismatch notice", code)
		}
	}
}

// The tier's own zone is used when it declares one, and the buyer's band when it
// does not. A tier with no zone must not fail a checkout.
func TestZoneForTier(t *testing.T) {
	starter, _ := TierByCode("starter") // declares "low"
	aura, _ := TierByCode("lifetime_aura") // declares "high"

	if got := ZoneForTier(starter, GeoDecision{Zone: ZoneHigh}); got != ZoneLow {
		t.Errorf("starter zone = %s, want low (the tier declares it)", got)
	}
	if got := ZoneForTier(aura, GeoDecision{Zone: ZoneMid}); got != ZoneHigh {
		t.Errorf("aura zone = %s, want high (the tier declares it)", got)
	}

	// A tier with no declared band inherits the buyer's.
	blank := Tier{Code: "blank", Kind: TierQuarterly, PriceZone: ""}
	if got := ZoneForTier(blank, GeoDecision{Zone: ZoneMid}); got != ZoneMid {
		t.Errorf("zone-less tier resolved to %s, want mid (the buyer's band)", got)
	}
}
