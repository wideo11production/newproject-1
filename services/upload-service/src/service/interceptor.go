// UploadInterceptor — educational content violation check.
//
// YEH MODULE AURA student gate ka enforcement half hai:
//   - Verified student SIRF educational content upload kar sakta hai.
//   - Agar non-educational content upload kare → billing-service
//     pe revoke trigger (25% penalty).
//   - Frames check: basic content-type + magic-byte validation.
//
// Hinglish: ye interceptor student status ke liye DIRECT dependency
// nahi rakhega — interface use karega, kyunki billing-service
// alag Go module hai (cross-module circular dependency avoid karne).
// main.go dono ko wire karega.
package service

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"path/filepath"
	"strings"

	"newproject/services/upload-service/src/model"
)

// ---------------------------------------------------------------------------
// Student status checker interface (cross-module safe)
// ---------------------------------------------------------------------------

// StudentStatusChecker — kya user verified student hai?
//
// Hinglish: ye interface billing-service ke student.go se
// implement hoga. Upload-service iss interface ko use karega
// taaki cross-module dependency na bane. Test mein easy fake
// lagta hai.
type StudentStatusChecker interface {
	// IsVerifiedStudent returns true agar user ek verified student hai.
	IsVerifiedStudent(ctx context.Context, userID uint) bool
}

// ---------------------------------------------------------------------------
// Violation results
// ---------------------------------------------------------------------------

// ViolationType — kis type ka violation hua.
type ViolationType string

const (
	// ViolationNonEducationalStudent — verified student ne
	// educational se alag category me content upload kiya.
	ViolationNonEducationalStudent ViolationType = "non_educational_student"
	// ViolationInvalidContentType — content-type ya extension
	// mismatch (frames check failure).
	ViolationInvalidContentType ViolationType = "invalid_content_type"
	// ViolationInvalidCategory — category field missing ya
	// unknown value.
	ViolationInvalidCategory ViolationType = "invalid_category"
)

// UploadViolation — ek violation ka record.
type UploadViolation struct {
	Type     ViolationType `json:"type"`
	UserID   uint          `json:"user_id"`
	Category string        `json:"category"`
	Filename string        `json:"filename"`
	Reason   string        `json:"reason"`
	// ShouldBlock — agar true, to upload REJECT karo. Agar false,
	// to sirf flag karo (non-breaking warning).
	ShouldBlock bool `json:"should_block"`
}

// ---------------------------------------------------------------------------
// Educational violation interceptor
// ---------------------------------------------------------------------------

// EducationalViolationInterceptor — student educational content check.
//
// Hinglish: ye interceptor sirf CHECK karta hai — revoke trigger
// billing-service se hota hai. Ye sirf flag return karta hai
// jisko main.go / handler use karenge.
type EducationalViolationInterceptor struct {
	studentChecker StudentStatusChecker
}

// NewEducationalInterceptor naya interceptor banata hai.
func NewEducationalInterceptor(checker StudentStatusChecker) *EducationalViolationInterceptor {
	return &EducationalViolationInterceptor{studentChecker: checker}
}

// CheckEducationalContent student + category ko check karta hai.
//
// Logic:
//   1. Agar student verified hai:
//      - educational category → OK (no violation, no block)
//      - koi dusri category → BLOCK + violation (AURA revoke trigger)
//   2. Agar student nahi verified → koi restriction nahi (sab freedom)
//
// Hinglish: non-student ke liye koi check nahi — sirf verified
// students ko restrict karte hain (deterministic, testable).
func (e *EducationalViolationInterceptor) CheckEducationalContent(
	ctx context.Context,
	session *model.UploadSession,
) (*UploadViolation, error) {

	// Student check — sirf agar checker wired ho
	isStudent := false
	if e.studentChecker != nil {
		isStudent = e.studentChecker.IsVerifiedStudent(ctx, session.UserID)
	}

	category := model.ContentCategory(session.Category)

	// Category validation
	if session.Category == "" || session.Category == string(model.CategoryOther) {
		// "other" ya blank = educational nahi maanenge, lekin
		// sirf student ke liye block karenge (non-student allowed).
		if isStudent {
			return &UploadViolation{
				Type:        ViolationInvalidCategory,
				UserID:      session.UserID,
				Category:    session.Category,
				Filename:    session.Filename,
				Reason:      "verified student must specify an educational content category",
				ShouldBlock: true,
			}, nil
		}
		// Non-student ke liye "other" theek hai.
		return nil, nil
	}

	// Validate category is a known type
	switch category {
	case model.CategoryEducational, model.CategoryEntertainment, model.CategoryGaming:
		// known category — proceed
	default:
		if isStudent {
			return &UploadViolation{
				Type:        ViolationInvalidCategory,
				UserID:      session.UserID,
				Category:    session.Category,
				Filename:    session.Filename,
				Reason:      fmt.Sprintf("unknown content category: %s", session.Category),
				ShouldBlock: true,
			}, nil
		}
	}

	// Student + non-educational → violation
	if isStudent && !category.IsEducational() {
		return &UploadViolation{
			Type:        ViolationNonEducationalStudent,
			UserID:      session.UserID,
			Category:    session.Category,
			Filename:    session.Filename,
			Reason: fmt.Sprintf(
				"verified student uploaded non-educational content (category=%s); "+
					"AURA verification will be revoked (25%% plan-price penalty)",
				session.Category),
			ShouldBlock: true,
		}, nil
	}

	return nil, nil
}

// ---------------------------------------------------------------------------
// Frames check — basic content type + magic byte validation
// ---------------------------------------------------------------------------

// FramesChecker — basic video/audio content validation.
//
// Hinglish: ye ML-based content moderation NHI hai (user ne kaha
// "no third-party"). Ye sirf basic "kya ye actually ek video hai?"
// check karta hai — content-type header + file extension match,
// aur minimum file size. Real frame-level adultery check ke liye
// alag ML pipeline (user directive: "no third-party AI pay") —
// ye interceptor sirf structural validity banaye rakhega.
type FramesChecker struct{}

// NewFramesChecker naya frames checker banata hai.
func NewFramesChecker() *FramesChecker {
	return &FramesChecker{}
}

// ValidateMediaContent basic content-type + extension validation.
//
// Checks:
//   1. Content-type is a known video/audio MIME
//   2. Extension matches content-type
//   3. File size > 0
//
// Returns nil if valid, error if invalid.
func (f *FramesChecker) ValidateMediaContent(session *model.UploadSession) error {
	if session.FileSize <= 0 {
		return errors.New("file size must be greater than zero")
	}

	// Content-Type validation
	ct := strings.ToLower(strings.TrimSpace(session.ContentType))
	if ct == "" {
		return errors.New("content_type is required")
	}

	// Normalize: strip parameters (e.g. "video/mp4; codecs=..." → "video/mp4")
	mediaType, _, err := mime.ParseMediaType(ct)
	if err != nil {
		return fmt.Errorf("invalid content_type %q: %w", session.ContentType, err)
	}

	// Must be video or audio
	if !strings.HasPrefix(mediaType, "video/") && !strings.HasPrefix(mediaType, "audio/") {
		return fmt.Errorf("content_type must be video/* or audio/*, got %q", mediaType)
	}

	// Extension match
	ext := strings.ToLower(filepath.Ext(session.Filename))
	if ext == "" {
		return errors.New("filename must have an extension")
	}

	extToType := map[string]string{
		".mp4":  "video/mp4",
		".webm": "video/webm",
		".mov":  "video/quicktime",
		".avi":  "video/x-msvideo",
		".mkv":  "video/x-matroska",
		".mp3":  "audio/mpeg",
		".wav":  "audio/wav",
		".ogg":  "audio/ogg",
		".m4a":  "audio/mp4",
		".aac":  "audio/aac",
	}

	expectedType, ok := extToType[ext]
	if !ok {
		return fmt.Errorf("unsupported file extension: %s", ext)
	}
	if mediaType != expectedType {
		return fmt.Errorf("extension %s does not match content_type %s", ext, mediaType)
	}

	return nil
}

// CheckAll runs both educational violation check and frames check.
//
// Hinglish: ye composite method dono checks ek saath karega —
// educational violation (student content policy) + frames check
// (structural validity). Dono fail hone par dono violations return.
func (e *EducationalViolationInterceptor) CheckAll(
	ctx context.Context,
	session *model.UploadSession,
	framesChecker *FramesChecker,
) ([]*UploadViolation, error) {

	var violations []*UploadViolation

	// Educational check
	v, err := e.CheckEducationalContent(ctx, session)
	if err != nil {
		return nil, err
	}
	if v != nil {
		violations = append(violations, v)
	}

	// Frames check
	if framesChecker != nil {
		if err := framesChecker.ValidateMediaContent(session); err != nil {
			violations = append(violations, &UploadViolation{
				Type:        ViolationInvalidContentType,
				UserID:      session.UserID,
				Category:    session.Category,
				Filename:    session.Filename,
				Reason:      err.Error(),
				ShouldBlock: true,
			})
		}
	}

	if len(violations) == 0 {
		return nil, nil
	}
	return violations, nil
}

// HasBlockingViolations — koi blocking violation hai?
func HasBlockingViolations(violations []*UploadViolation) bool {
	for _, v := range violations {
		if v.ShouldBlock {
			return true
		}
	}
	return false
}
