// AcademicDomains — Gate A seed list: email domains that grant INSTANT
// student verification (no ID card required).
//
// Hinglish: ye Indian (aur a few global) academic institutions ka
// domain list hai. User jo email pe sign-up karega, agar uska domain
// yahan se match kare to Gate A se instantly verified_by_domain ho jata
// hai — bina kisi ID card ke.
//
// User directive: "email to koi bhi kuch bhi rakh skta ha... mainly
// yeha notification jab user yah tutor ya educational institution
// jo bhi studies mein aata hai."
//
// Whitespace handling: extractDomain trims surrounding whitespace before
// lookup, so "iitd.ac.in " and " iitd.ac.in" both resolve correctly.
package model

// AcademicDomainSeedList — ordered map for O(1) lookup.
var AcademicDomainSeedList = map[string]bool{
	// IITs
	"iitd.ac.in":            true,
	"iitb.ac.in":            true,
	"iitkgp.ac.in":          true,
	"iitm.ac.in":            true,
	"iitp.ac.in":            true,
	"iitj.ac.in":            true,
	"iitr.ac.in":            true,
	"iitbhu.ac.in":          true,
	"iitgn.ac.in":           true,
	"iitrs.ac.in":           true,
	"iitmandi.ac.in":        true,
	"iittp.ac.in":           true,
	"iitgoa.ac.in":          true,
	"iitjammu.ac.in":        true,
	"iits.ac.in":            true,
	"iitbbs.ac.in":          true,

	// NITs
	"nitc.ac.in":            true,
	"nitk.ac.in":            true,
	"nitj.ac.in":            true,
	"nittrichy.ac.in":       true,
	"nitcgp.ac.in":          true,
	"nitdgp.ac.in":          true,
	"nitkkr.ac.in":          true,
	"nitdelhi.ac.in":        true,
	"nithamirpur.ac.in":     true,
	"nitjamshedpur.ac.in":   true,

	// IIITs
	"iiit.ac.in":            true,
	"iiitb.ac.in":           true,
	"iiitd.ac.in":           true,
	"iiita.ac.in":           true,
	"iiitk.ac.in":           true,
	"iiitvadodara.ac.in":    true,
	"iiitbh.ac.in":          true,
	"iiitmg.ac.in":          true,
	"iiitranchi.ac.in":      true,
	"iiitkalyani.ac.in":     true,
	"iiitv.edu.in":          true,
	"iiitjlle.ac.in":        true,

	// IIMs
	"iimahd.ac.in":          true,
	"iimbg.ac.in":           true,
	"iiml.ac.in":            true,
	"iimcal.ac.in":          true,
	"iimk.ac.in":            true,
	"iima.ac.in":            true,
	"iimn.ac.in":            true,
	"iimmd.ac.in":           true,
	"iimranchi.ac.in":       true,
	"iimvadodara.ac.in":     true,
	"iimtiruchirappalli.ac.in": true,

	// Central / State universities
	"du.ac.in":                true,
	"mu.ac.in":                true,
	"jnu.ac.in":               true,
	"bhu.ac.in":               true,
	"jmi.ac.in":               true,
	"uohyd.ac.in":             true,
	"uor.ac.in":               true,
	"uum.ac.in":               true,
	"cuj.ac.in":               true,
	"punjabiuniversity.ac.in": true,
	"wbnou.ac.in":             true,
	"vbs.ac.in":               true,

	// Distance / open education
	"ignou.ac.in":             true,
	"nios.ac.in":              true,
	"ncert.nic.in":            true,

	// Global generic academic TLDs (fallback for international users)
	"edu":                     true,
	"ac.uk":                   true,
	"edu.au":                  true,
	"ac.za":                   true,
	"ac.in":                   true,
	"edu.in":                  true,
}

// IsAcademicDomain — Gate A lookup helper.
// Returns true agar email ka domain seed list mein hai.
func IsAcademicDomain(email string) bool {
	domain := extractDomain(email)
	if domain == "" {
		return false
	}
	return AcademicDomainSeedList[domain]
}

// extractDomain — email se domain nikal kar lowercase + trimmed karta hai.
// Hinglish: @ ke baad ka part return karta hai, whitespace trim karta hai,
// aur lowercase karta hai. Agle 2 lines mein pura logic hai.
func extractDomain(email string) string {
	at := -1
	for i := len(email) - 1; i >= 0; i-- {
		if email[i] == '@' {
			at = i
			break
		}
	}
	if at == -1 {
		return ""
	}
	return lower(trimSpace(email[at+1:]))
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\r' || s[start] == '\n') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\r' || s[end-1] == '\n') {
		end--
	}
	return s[start:end]
}

func lower(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'A' && b[i] <= 'Z' {
			b[i] += 32
		}
	}
	return string(b)
}
