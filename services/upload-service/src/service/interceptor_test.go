// UploadInterceptor tests — educational content violation + frames check.
//
// Hinglish: ye tests interceptor ka poora logic lock karte hain:
//   - verified student + educational = OK
//   - verified student + non-educational = BLOCK
//   - non-student = koi restriction nahi
//   - frames check: content-type + extension validation
package service

import (
	"context"
	"testing"

	"newproject/services/upload-service/src/model"
)

// ---------------------------------------------------------------------------
// Fake student checker for tests
// ---------------------------------------------------------------------------

type fakeStudentChecker struct {
	verifiedUserID uint
	// callCount — kitni baar check hua (debugging ke liye)
	callCount int
}

func (f *fakeStudentChecker) IsVerifiedStudent(ctx context.Context, userID uint) bool {
	f.callCount++
	return userID == f.verifiedUserID
}

// ---------------------------------------------------------------------------
// Educational content check
// ---------------------------------------------------------------------------

func TestCheckEducationalContent_Student_Educational_OK(t *testing.T) {
	checker := &fakeStudentChecker{verifiedUserID: 1}
	interceptor := NewEducationalInterceptor(checker)

	session := &model.UploadSession{
		UserID:    1,
		Filename:  "lecture.mp4",
		Category:  string(model.CategoryEducational),
	}

	v, err := interceptor.CheckEducationalContent(context.Background(), session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v != nil {
		t.Errorf("verified student with educational content should have NO violation, got: %+v", v)
	}
}

func TestCheckEducationalContent_Student_NonEducational_Blocked(t *testing.T) {
	checker := &fakeStudentChecker{verifiedUserID: 1}
	interceptor := NewEducationalInterceptor(checker)

	session := &model.UploadSession{
		UserID:    1,
		Filename:  "gamingleory.mp4",
		Category:  string(model.CategoryGaming),
	}

	v, err := interceptor.CheckEducationalContent(context.Background(), session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v == nil {
		t.Fatal("verified student with non-educational content MUST get a violation")
	}
	if v.Type != ViolationNonEducationalStudent {
		t.Errorf("violation type: expected %s, got %s", ViolationNonEducationalStudent, v.Type)
	}
	if !v.ShouldBlock {
		t.Error("student non-educational violation MUST block upload")
	}
	if checker.callCount != 1 {
		t.Errorf("student checker call count: expected 1, got %d", checker.callCount)
	}
}

func TestCheckEducationalContent_Student_Entertainment_Blocked(t *testing.T) {
	checker := &fakeStudentChecker{verifiedUserID: 1}
	interceptor := NewEducationalInterceptor(checker)

	session := &model.UploadSession{
		UserID:    1,
		Filename:  "vlog.mp4",
		Category:  string(model.CategoryEntertainment),
	}

	v, err := interceptor.CheckEducationalContent(context.Background(), session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v == nil {
		t.Fatal("verified student with entertainment content MUST get a violation")
	}
	if v.Type != ViolationNonEducationalStudent {
		t.Errorf("violation type: expected %s, got %s", ViolationNonEducationalStudent, v.Type)
	}
	if !v.ShouldBlock {
		t.Error("must block")
	}
}

func TestCheckEducationalContent_Student_BlankCategory_Blocked(t *testing.T) {
	checker := &fakeStudentChecker{verifiedUserID: 1}
	interceptor := NewEducationalInterceptor(checker)

	session := &model.UploadSession{
		UserID:    1,
		Filename:  "mystery.mp4",
		Category:  "", // missing
	}

	v, err := interceptor.CheckEducationalContent(context.Background(), session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v == nil {
		t.Fatal("student with blank category should be blocked")
	}
	if v.Type != ViolationInvalidCategory {
		t.Errorf("violation type: expected %s, got %s", ViolationInvalidCategory, v.Type)
	}
}

func TestCheckEducationalContent_Student_OtherCategory_Blocked(t *testing.T) {
	checker := &fakeStudentChecker{verifiedUserID: 1}
	interceptor := NewEducationalInterceptor(checker)

	session := &model.UploadSession{
		UserID:    1,
		Filename:  "unknown.mp4",
		Category:  string(model.CategoryOther),
	}

	v, err := interceptor.CheckEducationalContent(context.Background(), session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v == nil {
		t.Fatal("student with 'other' category should be blocked")
	}
	if v.Type != ViolationInvalidCategory {
		t.Errorf("violation type: expected %s, got %s", ViolationInvalidCategory, v.Type)
	}
}

func TestCheckEducationalContent_NonStudent_AnyCategory_OK(t *testing.T) {
	// Non-verified student (userID 2, but verifiedUserID is 1).
	checker := &fakeStudentChecker{verifiedUserID: 1}
	interceptor := NewEducationalInterceptor(checker)

	for _, cat := range []string{"entertainment", "gaming", "other", "educational"} {
		t.Run(cat, func(t *testing.T) {
			session := &model.UploadSession{
				UserID:   2, // not verified
				Filename: "video.mp4",
				Category: cat,
			}
			v, err := interceptor.CheckEducationalContent(context.Background(), session)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if v != nil {
				t.Errorf("non-student with category %s should have NO violation, got: %+v", cat, v)
			}
		})
	}
}

func TestCheckEducationalContent_NoStudentChecker_OK(t *testing.T) {
	// Interceptor with nil studentChecker — checks disabled.
	interceptor := NewEducationalInterceptor(nil)
	session := &model.UploadSession{
		UserID:   1,
		Filename: "lecture.mp4",
		Category: string(model.CategoryEducational),
	}

	v, err := interceptor.CheckEducationalContent(context.Background(), session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v != nil {
		t.Errorf("nil checker should allow everything, got violation: %+v", v)
	}
}

func TestCheckEducationalContent_UnknownCategory_NonStudent_OK(t *testing.T) {
	checker := &fakeStudentChecker{verifiedUserID: 1}
	interceptor := NewEducationalInterceptor(checker)

	session := &model.UploadSession{
		// userID 2 = NOT a verified student.
		UserID:   2,
		Filename: "weird.mp4",
		Category: "quantum_physics_lecture", // unknown to enum but non-student
	}

	v, err := interceptor.CheckEducationalContent(context.Background(), session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Non-student: even unknown category is allowed (no restriction).
	if v != nil {
		t.Errorf("non-student with unknown category should have NO violation, got: %+v", v)
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Frames check (content-type + extension validation)
// ---------------------------------------------------------------------------

func TestValidateMediaContent_ValidMp4(t *testing.T) {
	checker := NewFramesChecker()
	session := &model.UploadSession{
		Filename:    "lecture.mp4",
		ContentType: "video/mp4",
		FileSize:    1024,
	}
	if err := checker.ValidateMediaContent(session); err != nil {
		t.Errorf("valid mp4 should pass: %v", err)
	}
}

func TestValidateMediaContent_ValidWebm(t *testing.T) {
	checker := NewFramesChecker()
	session := &model.UploadSession{
		Filename:    "clip.webm",
		ContentType: "video/webm",
		FileSize:    2048,
	}
	if err := checker.ValidateMediaContent(session); err != nil {
		t.Errorf("valid webm should pass: %v", err)
	}
}

func TestValidateMediaContent_ContentTypeWithCodecs(t *testing.T) {
	// "video/mp4; codecs=avc1.42c01e" — mime.ParseMediaType should strip params.
	checker := NewFramesChecker()
	session := &model.UploadSession{
		Filename:    "clip.mp4",
		ContentType: "video/mp4; codecs=avc1.42c01e",
		FileSize:    1024,
	}
	if err := checker.ValidateMediaContent(session); err != nil {
		t.Errorf("mp4 with codecs param should pass: %v", err)
	}
}

func TestValidateMediaContent_InvalidContentType(t *testing.T) {
	checker := NewFramesChecker()
	session := &model.UploadSession{
		Filename:    "image.png",
		ContentType: "image/png",
		FileSize:    1024,
	}
	if err := checker.ValidateMediaContent(session); err == nil {
		t.Error("image/png should fail content-type check")
	}
}

func TestValidateMediaContent_ExtensionMismatch(t *testing.T) {
	checker := NewFramesChecker()
	session := &model.UploadSession{
		Filename:    "audio.mp3",  // .mp3 extension
		ContentType: "video/mp4",  // but video/mp4 type
		FileSize:    1024,
	}
	if err := checker.ValidateMediaContent(session); err == nil {
		t.Error("extension + content-type mismatch should fail")
	}
}

func TestValidateMediaContent_MissingExtension(t *testing.T) {
	checker := NewFramesChecker()
	session := &model.UploadSession{
		Filename:    "noextension",
		ContentType: "video/mp4",
		FileSize:    1024,
	}
	if err := checker.ValidateMediaContent(session); err == nil {
		t.Error("missing extension should fail")
	}
}

func TestValidateMediaContent_ZeroFileSize(t *testing.T) {
	checker := NewFramesChecker()
	session := &model.UploadSession{
		Filename:    "empty.mp4",
		ContentType: "video/mp4",
		FileSize:    0,
	}
	if err := checker.ValidateMediaContent(session); err == nil {
		t.Error("zero file size should fail")
	}
}

func TestValidateMediaContent_UnsupportedExtension(t *testing.T) {
	checker := NewFramesChecker()
	session := &model.UploadSession{
		Filename:    "file.xyz",
		ContentType: "application/octet-stream",
		FileSize:    1024,
	}
	if err := checker.ValidateMediaContent(session); err == nil {
		t.Error("unsupported extension should fail")
	}
}

func TestValidateMediaContent_AudioMp3(t *testing.T) {
	// audio/mp3 maps to .mp3 in our table.
	checker := NewFramesChecker()
	session := &model.UploadSession{
		Filename:    "song.mp3",
		ContentType: "audio/mpeg",
		FileSize:    5000,
	}
	if err := checker.ValidateMediaContent(session); err != nil {
		t.Errorf("valid audio/mp3 should pass: %v", err)
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Composite CheckAll
// ---------------------------------------------------------------------------

func TestCheckAll_Student_Educational_ValidContent_NoViolations(t *testing.T) {
	checker := &fakeStudentChecker{verifiedUserID: 1}
	interceptor := NewEducationalInterceptor(checker)
	frames := NewFramesChecker()

	session := &model.UploadSession{
		UserID:    1,
		Filename:  "lecture.mp4",
		ContentType: "video/mp4",
		FileSize:  1024,
		Category:  string(model.CategoryEducational),
	}

	violations, err := interceptor.CheckAll(context.Background(), session, frames)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if violations != nil {
		t.Errorf("should have no violations, got %d", len(violations))
	}
}

func TestCheckAll_Student_NonEducational_ValidContent_Violation(t *testing.T) {
	checker := &fakeStudentChecker{verifiedUserID: 1}
	interceptor := NewEducationalInterceptor(checker)
	frames := NewFramesChecker()

	session := &model.UploadSession{
		UserID:      1,
		Filename:    "game.mp4",
		ContentType: "video/mp4",
		FileSize:    1024,
		Category:    string(model.CategoryGaming),
	}

	violations, err := interceptor.CheckAll(context.Background(), session, frames)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(violations) != 1 {
		t.Fatalf("expected 1 violation, got %d", len(violations))
	}
	if violations[0].Type != ViolationNonEducationalStudent {
		t.Errorf("expected %s, got %s", ViolationNonEducationalStudent, violations[0].Type)
	}
}

func TestCheckAll_BadContentType_EvenEducational_Violation(t *testing.T) {
	checker := &fakeStudentChecker{verifiedUserID: 1}
	interceptor := NewEducationalInterceptor(checker)
	frames := NewFramesChecker()

	session := &model.UploadSession{
		UserID:      1,
		Filename:    "lecture.mp4",
		ContentType: "image/png", // invalid for video
		FileSize:    1024,
		Category:    string(model.CategoryEducational),
	}

	violations, err := interceptor.CheckAll(context.Background(), session, frames)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Only frames check fails (educational is OK).
	if len(violations) != 1 {
		t.Fatalf("expected 1 violation, got %d", len(violations))
	}
	if violations[0].Type != ViolationInvalidContentType {
		t.Errorf("expected %s, got %s", ViolationInvalidContentType, violations[0].Type)
	}
}

func TestCheckAll_DisabledInterceptor_NoViolations(t *testing.T) {
	// Nil interceptor → no checks, no violations.
	session := &model.UploadSession{
		UserID:      1,
		Filename:    "anything.xyz",
		ContentType: "garbage",
		FileSize:    0,
		Category:    "unknown",
	}
	// Don't call CheckAll (interceptor is nil) — verify checkViolations handles nil.
	svc := &UploadService{}
	violations, err := svc.checkViolations(context.Background(), session)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if violations != nil {
		t.Errorf("nil interceptor should return no violations, got %v", violations)
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HasBlockingViolations helper
// ---------------------------------------------------------------------------

func TestHasBlockingViolations_None(t *testing.T) {
	if HasBlockingViolations(nil) {
		t.Error("nil violations should not block")
	}
	if HasBlockingViolations([]*UploadViolation{}) {
		t.Error("empty violations should not block")
	}
}

func TestHasBlockingViolations_WithBlock(t *testing.T) {
	vs := []*UploadViolation{
		{ShouldBlock: true, Type: ViolationNonEducationalStudent},
	}
	if !HasBlockingViolations(vs) {
		t.Error("blocking violation should return true")
	}
}

func TestHasBlockingViolations_WithNonBlock(t *testing.T) {
	vs := []*UploadViolation{
		{ShouldBlock: false, Type: ViolationInvalidContentType},
	}
	if HasBlockingViolations(vs) {
		t.Error("non-blocking violation should not block")
	}
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ContentCategory helper
// ---------------------------------------------------------------------------

func TestContentCategoryIsEducational(t *testing.T) {
	if !model.CategoryEducational.IsEducational() {
		t.Error("CategoryEducational.IsEducational() must be true")
	}
	if model.CategoryEntertainment.IsEducational() {
		t.Error("CategoryEntertainment.IsEducational() must be false")
	}
	if model.CategoryGaming.IsEducational() {
		t.Error("CategoryGaming.IsEducational() must be false")
	}
	if model.CategoryOther.IsEducational() {
		t.Error("CategoryOther.IsEducational() must be false")
	}
}
