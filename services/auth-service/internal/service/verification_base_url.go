package service

// ============================================================================
// VERIFICATION BASE URL  -  Phase A / gap #5
// ============================================================================
//
// PROBLEM: verification email ka link `VERIFICATION_BASE_URL` se banta hai.
// Ye value `http://localhost:3000` rehti hai, to link PHONE par kholne par
// dead ho jata hai (`localhost` ka matlab us phone ka khud ka device).
// User ko "invalid link" milta hai aur wo samajhta hai ki signup toota hua
// hai.
//
// Ye problem DEAD SILENT thi: koi error nahi, koi log nahi, bas ek link jo
// kisi aur device par kaam nahi karta. Isi liye ye file bani hai.
//
// ---- DESIGN RULE 1: NEVER derive this from the request ----
//
// Ek "smart" fix yeh hota ki link banate waqt `r.Host` ya `X-Forwarded-Host`
// use kar lo - to link AUTOMATICALLY sahi ban jayega. YE GALAT HAI, aur yeh
// ek well-known vulnerability hai: Host header injection.
//
// Agar base URL request se aata hai, to attacker apne domain wala Host header
// bhej kar victim ko verification link bhejwa sakta hai jo ATTACKER ke
// server par jaata hai. Token attacker's server par leak ho jata hai, aur
// attacker usse use karke victim ka account verify kar sakta hai. Isi tarah
// password-reset flows me ye account takeover ka seedha rasta hai.
//
// Isliye ye value SIRF configuration se aati hai, kabhi request se nahi.
// Bellow ka `VerificationBaseURL()` jaan-boojh kar sirf config padhta hai.
//
// ---- DESIGN RULE 2: fail loudly at startup, not silently per-email ----
//
// Galat value ka asar pehle user ko pata chalta hai jab wo phone par link
// kholta hai - tab tak 2-3 users signup chhod chuke hote hain. Isliye hum
// startup par hi validate karte hain aur console par clear instruction
// print karte hain. `docker compose logs auth-service` se turant dikhta hai.
//
// Hinglish: link ka base config se, request se KABHI nahi

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// DefaultVerificationBaseURL - config missing ho to ye use hota hai.
const DefaultVerificationBaseURL = "http://localhost:3000"

// VerificationBaseURL - normalized base URL (trailing slash hata ke).
//
// Ye SINGLE SOURCE OF TRUTH hai. Pehle ye logic `BuildVerificationURL`,
// `BuildVerificationURLWithEmail` aur `SendVerificationEmail` teeno jagah
// duplicate tha - aur teeno me trailing-slash trim alag-alag likha tha.
// Jahan ek jagah trim hua aur doosri par nahi, to email ka link aur template
// ka base ALAG-ALAG ho sakte the (ek me `//auth/verify`, doosri me normal).
// Ab sab ek hi function se aata hai.
//
// Empty config -> default. Kabhi bhi khaali string nahi jayegi, warna URL
// banega `"/auth/verify?token=..."` jo relative hai aur email me useless hoga.
func (s *AuthService) VerificationBaseURL() string {
	base := ""
	if s != nil && s.cfg != nil {
		base = s.cfg.Verification.BaseURL
	}
	if strings.TrimSpace(base) == "" {
		base = DefaultVerificationBaseURL
	}
	return strings.TrimRight(strings.TrimSpace(base), "/")
}

// VerificationReachability - startup validation ka result.
//
// Ye startup par ek baar evaluate hota hai aur warning/error decide karta
// hai. Iske baad har email par nahi - email path CHALTE hue sirf ek line
// log hoti hai jo `BaseURL()` print karti hai.
type VerificationReachability struct {
	// BaseURL - jo actually use hoga.
	BaseURL string
	// Loopback - true agar base localhost/127.0.0.1/::1 hai.
	Loopback bool
	// HTTPS - false agar link plain HTTP par jayega.
	HTTPS bool
	// Message - human readable diagnosis + fix.
	Message string
	// Fatal - true agar ye state production me hai aur account signup
	// practically unusable hai.
	Fatal bool
}

// CheckVerificationReachability base URL ko diagnose karta hai.
//
// KYUN LOOPBACK CHECK ZAROORI HAI:
// `localhost` ka matlab "is DEVICE ka khud ka loopback". Email jab PHONE
// par kholi jaati hai to `localhost:3000` us phone ko point karta hai, jahan
// na frontend chal raha hai na koi server. Link dead. Ye wahi bug hai jo
// todo me "broken on phone" likha gaya tha - bas ab use DETECT karte hain.
func (s *AuthService) CheckVerificationReachability() VerificationReachability {
	base := s.VerificationBaseURL()

	result := VerificationReachability{BaseURL: base, HTTPS: true}

	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" {
		result.Message = fmt.Sprintf(
			"VERIFICATION_BASE_URL %q is not a valid absolute URL. "+
				"Set it to your frontend's real origin, e.g. http://192.168.1.5:3000 "+
				"or https://app.wideo11.com",
			base,
		)
		result.Fatal = true
		return result
	}

	result.HTTPS = strings.EqualFold(parsed.Scheme, "https")

	// Hostname se loopback detect karo. `url.Hostname()` port hata deta hai
	// aur brackets hata deta hai IPv6 ke, isliye `::1` bhi sahi pakda jata hai.
	//
	// NOTE: `url.Parse` scheme ko lowercase karta hai par HOST ko nahi -
	// `http://LOCALHOST:3000` ka Hostname() literally "LOCALHOST" deta hai.
	// DNS case-insensitive hai, isliye ye bhi loopback hi hai. Isliye
	// compare karne se pehle lowercase karna zaroori hai, warna ek
	// attacker `http://LoCaLhOsT` likhkar check se nikal sakta hai.
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" {
		result.Loopback = true
	} else if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		result.Loopback = true
	}

	switch {
	case result.Loopback && !result.HTTPS:
		result.Message = fmt.Sprintf(
			"VERIFICATION_BASE_URL is %q (localhost over plain HTTP). "+
				"Verification links WILL work on this PC but are DEAD on any other "+
				"device - a phone opening the link resolves localhost to the phone "+
				"itself. To test on another device: set VERIFICATION_BASE_URL to this "+
				"machine's network address (e.g. http://%s:3000), and add that same "+
				"origin to SECURITY_ALLOWED_ORIGINS, or the browser will block the "+
				"API calls. Note the verification token travels in the URL, so only "+
				"do this on a network you trust.",
			base, lanHint(),
		)
		result.Fatal = true

	case result.Loopback && result.HTTPS:
		result.Message = fmt.Sprintf(
			"VERIFICATION_BASE_URL is %q (localhost over HTTPS). Links still break "+
				"on any other device - localhost always means 'this device'. Set a "+
				"real domain or LAN address for anything beyond single-machine dev.",
			base,
		)
		result.Fatal = true

	case !result.HTTPS:
		result.Message = fmt.Sprintf(
			"VERIFICATION_BASE_URL is %q, which is plain HTTP. Verification tokens "+
				"travel in the URL query string, so over plain HTTP anyone on the "+
				"network path can read them from a proxy log. Use https:// in production.",
			base,
		)
		// Non-fatal: local LAN testing over http is a legitimate choice.
		result.Fatal = false

	default:
		result.Message = fmt.Sprintf(
			"VERIFICATION_BASE_URL is %q - reachable from other devices.", base,
		)
	}

	return result
}

// virtualInterfacePrefixes - adapter names jo REAL LAN nahi hote.
//
// WHY THIS EXISTS: pehla version `net.InterfaceAddrs()` se pehla non-loopback
// IPv4 le raha tha. Usne consistently DOCKER BRIDGE IP (`172.19.0.15`) suggest
// kiya - jo kisi bhi phone par reachable nahi hai. Yaani warning "aap ye karo"
// bol rahi thi jabki wo value kaam hi nahi karti.
//
// Virtual adapters pehle skip karne se ab ye WINDOWS/WIRED ya WIFI ka asli
// address deta hai, jo wahi hai jo phone par type karna hota hai.
var virtualInterfacePrefixes = []string{
	"docker", "br-", "veth", "vmnet", "vboxnet", "vEthernet",
	"hyper-v", "tailscale", "utun", "cni", "flannel", "kube",
	"loopback", "npcap", "teredo",
}

// lanHint - is machine ka LAN IP nikalta hai, sirf warning message ke liye.
//
// BEST EFFORT hai: agar guess fail ho to localhost hi dikh jaata hai, jo
// galat guidance se behtar hai (koi bhi IP guess karna galat hoga).
func lanHint() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "<your-lan-ip>"
	}

	var fallback string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		name := strings.ToLower(iface.Name)

		virtual := false
		for _, p := range virtualInterfacePrefixes {
			if strings.HasPrefix(name, p) {
				virtual = true
				break
			}
		}
		if virtual {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipNet.IP
			// Sirf IPv4 - phone par IPv6 link-local address type karna
			// bekaar hai (wo har device same hota hai).
			if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.To4() == nil {
				continue
			}
			if fallback == "" {
				fallback = ip.String()
			}
			// Global routable address sabse useful hota hai.
			if ip.IsGlobalUnicast() && !ip.IsPrivate() {
				return ip.String()
			}
		}
	}
	if fallback != "" {
		return fallback
	}
	return "<your-lan-ip>"
}
