// Password service unit tests - bcrypt hashing aur token hashing
//
// Ye tests wo SECURITY GUARANTEES verify karte hain jo business laws ko
// depend karti hain:
//   - Password kabhi plain text store nahi hona chahiye
//   - Hash cost 12 hona chahiye (security requirement)
//   - Token hashing SHA-256 hona chahiye (bcrypt 72-byte limit ki wajah se)
//
// Ye tests REAL logic test karte hain (koi mock nahi), isliye agar bcrypt
// cost galti se 10 ho jaye to ye FAIL ho jayenge - jo auth-service me
// actually ho chuka tha.
//
// Hinglish comments: har block ka arth

package password

import (
	"strings"
	"testing"
)

// TestHashProducesBcrypt verifies ki hash bcrypt format me banta hai
// aur cost DefaultCost (12) hota hai.
func TestHashProducesBcrypt(t *testing.T) {
	svc := DefaultPasswordService()

	hash, err := svc.Hash("Str0ng!Passw0rd#2026")
	if err != nil {
		t.Fatalf("Hash() returned error: %v", err)
	}

	// Bcrypt hash hamesha "$2a$12$" se start hota hai
	if !strings.HasPrefix(hash, "$2a$12$") {
		t.Errorf("expected bcrypt cost 12, got hash prefix: %s", hash[:7])
	}

	// Plain text password hash me nahi milna chahiye - SECURITY CHECK
	if strings.Contains(hash, "Str0ng") {
		t.Error("SECURITY: plain text password found inside hash")
	}
}

// TestVerifyCorrectPassword verifies sahi password verify hota hai
func TestVerifyCorrectPassword(t *testing.T) {
	svc := DefaultPasswordService()
	password := "Str0ng!Passw0rd#2026"

	hash, err := svc.Hash(password)
	if err != nil {
		t.Fatalf("Hash() error: %v", err)
	}

	if err := svc.Verify(password, hash); err != nil {
		t.Errorf("Verify() should succeed for correct password, got: %v", err)
	}
}

// TestVerifyWrongPassword verifies galat password REJECT hota hai
// Ye brute-force protection ka core test hai.
func TestVerifyWrongPassword(t *testing.T) {
	svc := DefaultPasswordService()

	hash, err := svc.Hash("CorrectPassword123")
	if err != nil {
		t.Fatalf("Hash() error: %v", err)
	}

	// Galat password verify nahi hona chahiye
	if err := svc.Verify("WrongPassword123", hash); err == nil {
		t.Error("SECURITY: wrong password was accepted")
	} else if err != ErrMismatch {
		t.Errorf("expected ErrMismatch, got: %v", err)
	}
}

// TestSamePasswordDifferentHashes verify karta hai ki salt kaam karta hai -
// same password ke do alag hashes banne chahiye.
func TestSamePasswordDifferentHashes(t *testing.T) {
	svc := DefaultPasswordService()
	password := "SamePassword123"

	hash1, _ := svc.Hash(password)
	hash2, _ := svc.Hash(password)

	if hash1 == hash2 {
		t.Error("SECURITY: two hashes of same password are identical (salt not working)")
	}

	// Dono hashes verify hone chahiye
	if err := svc.Verify(password, hash1); err != nil {
		t.Errorf("hash1 failed verification: %v", err)
	}
	if err := svc.Verify(password, hash2); err != nil {
		t.Errorf("hash2 failed verification: %v", err)
	}
}

// TestRejectEmptyPassword verifies empty password reject hota hai
func TestRejectEmptyPassword(t *testing.T) {
	svc := DefaultPasswordService()

	if _, err := svc.Hash(""); err == nil {
		t.Error("empty password should be rejected")
	}
}

// TestRejectOverlongPassword bcrypt ka 72-byte limit check karta hai
func TestRejectOverlongPassword(t *testing.T) {
	svc := DefaultPasswordService()

	// 72 bytes se lamba password reject hona chahiye
	longPassword := strings.Repeat("a", 73)

	if _, err := svc.Hash(longPassword); err == nil {
		t.Error("password over 72 bytes should be rejected by bcrypt")
	}
}

// TestHashTokenIsSHA256 verifies ki token hashing SHA-256 use karti hai
// aur 64 hex characters (32 bytes) ka output deti hai.
//
// YE TEST IMPORTANT HAI: pehle refresh token ko bcrypt se hash kiya gaya tha,
// jo 400+ character ke JWT par FAIL hota tha (72-byte limit) aur har
// registration ko 500 error deta tha. Ye test regression rokta hai.
func TestHashTokenIsSHA256(t *testing.T) {
	token := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMTIzIn0.very-long-signature-part-here"

	hash := HashToken(token)

	// SHA-256 = 32 bytes = 64 hex characters
	if len(hash) != 64 {
		t.Errorf("expected 64 hex chars from SHA-256, got %d", len(hash))
	}

	// Hex characters sirf hone chahiye
	for _, r := range hash {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			t.Errorf("hash contains non-hex character: %c", r)
			break
		}
	}

	// Deterministic hona chahiye - same token = same hash
	if HashToken(token) != hash {
		t.Error("HashToken should be deterministic")
	}

	// Alag token = alag hash
	if HashToken(token+"x") == hash {
		t.Error("different tokens must produce different hashes")
	}
}

// TestHashTokenLongJWT verifies 400+ character ka JWT bhi hash ho jata hai
// (bcrypt yahan fail karta - ye regression test hai)
func TestHashTokenLongJWT(t *testing.T) {
	// 1000 character ka fake JWT
	longJWT := "eyJ" + strings.Repeat("A", 994) + ".signature"

	hash := HashToken(longJWT)
	if len(hash) != 64 {
		t.Errorf("long JWT should still hash to 64 chars, got %d", len(hash))
	}
}
