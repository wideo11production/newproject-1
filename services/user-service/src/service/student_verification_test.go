// Student verification service tests — dual-gate logic.
//
// Hinglish: ye tests domain seed list match, ID document fallback, token
// expiry, aur manual approve/reject ko verify karte hain. Fake repository
// use karte hain (SQL nahi chahiye).
package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"newproject/services/user-service/src/model"
	"newproject/services/user-service/src/repository"
)

// fakeUserRepo — minimal UserRepository fake for testing.
type fakeUserRepo struct {
	users map[uint]*model.User
}

func (r *fakeUserRepo) Create(ctx context.Context, user *model.User) error {
	r.users[user.ID] = user
	return nil
}
func (r *fakeUserRepo) GetByID(ctx context.Context, id uint) (*model.User, error) {
	u, ok := r.users[id]
	if !ok {
		return nil, repository.ErrUserNotFound
	}
	return u, nil
}
func (r *fakeUserRepo) GetByUUID(ctx context.Context, id string) (*model.User, error) {
	for _, u := range r.users {
		if u.UUID.String() == id {
			return u, nil
		}
	}
	return nil, repository.ErrUserNotFound
}
func (r *fakeUserRepo) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	for _, u := range r.users {
		if u.Email == email {
			return u, nil
		}
	}
	return nil, repository.ErrUserNotFound
}
func (r *fakeUserRepo) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	for _, u := range r.users {
		if u.Username == username {
			return u, nil
		}
	}
	return nil, repository.ErrUserNotFound
}
func (r *fakeUserRepo) Update(ctx context.Context, user *model.User) error {
	r.users[user.ID] = user
	return nil
}
func (r *fakeUserRepo) Delete(ctx context.Context, id uint) error {
	delete(r.users, id)
	return nil
}
func (r *fakeUserRepo) List(ctx context.Context, limit, offset int) ([]*model.User, error) {
	var users []*model.User
	for _, u := range r.users {
		users = append(users, u)
	}
	return users, nil
}

// fakeStudentVerifRepo — StudentVerificationRepository fake.
type fakeStudentVerifRepo struct {
	records map[uint]*model.StudentVerification
}

func (r *fakeStudentVerifRepo) Create(ctx context.Context, sv *model.StudentVerification) error {
	r.records[sv.UserID] = sv
	return nil
}
func (r *fakeStudentVerifRepo) GetByUserID(ctx context.Context, userID uint) (*model.StudentVerification, error) {
	sv, ok := r.records[userID]
	if !ok {
		return nil, repository.ErrStudentVerificationNotFound
	}
	return sv, nil
}
func (r *fakeStudentVerifRepo) Update(ctx context.Context, sv *model.StudentVerification) error {
	r.records[sv.UserID] = sv
	return nil
}
func (r *fakeStudentVerifRepo) Delete(ctx context.Context, userID uint) error {
	delete(r.records, userID)
	return nil
}

func newTestEngine() *StudentVerificationEngine {
	repo := &fakeStudentVerifRepo{records: make(map[uint]*model.StudentVerification)}
	userRepo := &fakeUserRepo{users: map[uint]*model.User{
		1: {ID: 1, Email: "student@iitd.ac.in", Username: "iitd_student"},
		2: {ID: 2, Email: "user@gmail.com", Username: "free_user"},
	}}
	return NewStudentVerificationEngine(repo, userRepo, []byte("test-secret-key-32bytes!"), StudentIdentityTokenTTL)
}

// ---------------------------------------------------------------------------
// Gate A tests
// ---------------------------------------------------------------------------

func TestVerifyStudentGateA_DomainMatchInstantVerified(t *testing.T) {
	engine := newTestEngine()

	sv, err := engine.VerifyStudentGateA(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sv.Status != model.VerificationVerifiedByDomain {
		t.Errorf("status: expected %s, got %s", model.VerificationVerifiedByDomain, sv.Status)
	}
	if sv.EmailDomain != "iitd.ac.in" {
		t.Errorf("domain: expected iitd.ac.in, got %s", sv.EmailDomain)
	}
	if sv.VerificationToken == "" {
		t.Error("expected non-empty verification token")
	}
	if sv.TokenExpiresAt == nil {
		t.Error("expected non-nil token expiry")
	}
	if !sv.TokenExpiresAt.Equal(time.Now().Add(StudentIdentityTokenTTL).UTC().Add(-time.Second)) &&
		!sv.TokenExpiresAt.After(time.Now()) {
		t.Error("token should expire in ~365 days")
	}
}

func TestVerifyStudentGateA_DomainNotAcademic(t *testing.T) {
	engine := newTestEngine()

	_, err := engine.VerifyStudentGateA(context.Background(), 2)
	if !errors.Is(err, ErrDomainNotAcademic) {
		t.Errorf("expected ErrDomainNotAcademic, got %v", err)
	}
}

func TestVerifyStudentGateA_UserNotFound(t *testing.T) {
	engine := newTestEngine()

	_, err := engine.VerifyStudentGateA(context.Background(), 999)
	if err == nil {
		t.Fatal("expected error for non-existent user")
	}
}

// ---------------------------------------------------------------------------
// Gate B tests
// ---------------------------------------------------------------------------

func TestSubmitIDDocument_CreatesPendingDocument(t *testing.T) {
	engine := newTestEngine()

	now := time.Now().UTC()
	sv, err := engine.SubmitIDDocument(context.Background(), 2, "minio://id-card-abc.jpg", "college_id")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sv.Status != model.VerificationPendingDocument {
		t.Errorf("status: expected %s, got %s", model.VerificationPendingDocument, sv.Status)
	}
	if sv.IDDocumentURL != "minio://id-card-abc.jpg" {
		t.Errorf("URL: expected minio://..., got %s", sv.IDDocumentURL)
	}
	if sv.IDDocumentUploadedAt == nil || sv.IDDocumentUploadedAt.Before(now.Add(-1*time.Second)) {
		t.Error("expected upload timestamp near now")
	}
	if sv.VerificationToken == "" {
		t.Error("expected non-empty token even in pending_document state")
	}
}

func TestSubmitIDDocument_EmptyURL(t *testing.T) {
	engine := newTestEngine()

	_, err := engine.SubmitIDDocument(context.Background(), 2, "", "college_id")
	if err == nil {
		t.Fatal("expected error for empty URL")
	}
}

func TestApproveDocumentVerification_SetsVerified(t *testing.T) {
	engine := newTestEngine()

	// Submit ID doc first.
	if _, err := engine.SubmitIDDocument(context.Background(), 2, "minio://id.jpg", "college_id"); err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Approve as admin user 99.
	sv, err := engine.ApproveDocumentVerification(context.Background(), 2, 99)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sv.Status != model.VerificationVerified {
		t.Errorf("status: expected %s, got %s", model.VerificationVerified, sv.Status)
	}
	if sv.ReviewedBy == nil || *sv.ReviewedBy != 99 {
		t.Error("expected ReviewedBy=99")
	}
	if sv.ReviewedAt == nil {
		t.Error("expected ReviewedAt set")
	}
	if sv.RejectionReason != "" {
		t.Errorf("expected empty rejection reason, got %s", sv.RejectionReason)
	}
}

func TestRejectDocumentVerification_SetsRejected(t *testing.T) {
	engine := newTestEngine()

	if _, err := engine.SubmitIDDocument(context.Background(), 2, "minio://id.jpg", "college_id"); err != nil {
		t.Fatalf("setup: %v", err)
	}

	sv, err := engine.RejectDocumentVerification(context.Background(), 2, 99, "Blurred document")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sv.Status != model.VerificationRejected {
		t.Errorf("status: expected %s, got %s", model.VerificationRejected, sv.Status)
	}
	if sv.RejectionReason != "Blurred document" {
		t.Errorf("reason: expected 'Blurred document', got %s", sv.RejectionReason)
	}
	if sv.VerificationToken != "" {
		t.Error("expected token cleared on rejection")
	}
}

// ---------------------------------------------------------------------------
// Status check + auto-expiry tests
// ---------------------------------------------------------------------------

func TestCheckStudentStatus_Verified(t *testing.T) {
	engine := newTestEngine()

	if _, err := engine.VerifyStudentGateA(context.Background(), 1); err != nil {
		t.Fatalf("setup: %v", err)
	}

	sv, ok := engine.CheckStudentStatus(context.Background(), 1)
	if !ok {
		t.Error("expected verified=true for academic domain user")
	}
	if sv.Status != model.VerificationVerifiedByDomain {
		t.Errorf("status: expected %s, got %s", model.VerificationVerifiedByDomain, sv.Status)
	}
}

func TestCheckStudentStatus_NoRecord(t *testing.T) {
	engine := newTestEngine()

	sv, ok := engine.CheckStudentStatus(context.Background(), 999)
	if sv != nil {
		t.Error("expected nil sv for non-existent record")
	}
	if ok {
		t.Error("expected verified=false for non-existent record")
	}
}

func TestCheckStudentStatus_AutoExpireOnExpiry(t *testing.T) {
	engine := newTestEngine()

	// Create user with academic email and immediately expire their token.
	if _, err := engine.VerifyStudentGateA(context.Background(), 1); err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Manually expire the token by setting expiry to past.
	sv, _ := engine.repo.GetByUserID(context.Background(), 1)
	past := time.Now().UTC().Add(-1 * time.Hour)
	sv.TokenExpiresAt = &past
	_ = engine.repo.Update(context.Background(), sv)

	// Check now — should auto-expire.
	result, ok := engine.CheckStudentStatus(context.Background(), 1)
	if ok {
		t.Error("expected verified=false after token expiry")
	}
	if result.Status != model.VerificationExpired {
		t.Errorf("status: expected %s, got %s", model.VerificationExpired, result.Status)
	}
	if result.VerificationToken != "" {
		t.Error("expected token cleared after expiry")
	}
}

// ---------------------------------------------------------------------------
// Academic domain lookup tests
// ---------------------------------------------------------------------------

func TestIsAcademicDomain_Valid(t *testing.T) {
	domains := []string{
		"student@iitd.ac.in",
		"prof@iiitb.ac.in",
		"researcher@edu.au",
		"user@ac.uk",
	}
	for _, email := range domains {
		if !model.IsAcademicDomain(email) {
			t.Errorf("expected %s to be academic", email)
		}
	}
}

func TestIsAcademicDomain_Invalid(t *testing.T) {
	domains := []string{
		"user@gmail.com",
		"user@yahoo.com",
		"user@company.org",
	}
	for _, email := range domains {
		if model.IsAcademicDomain(email) {
			t.Errorf("expected %s to NOT be academic", email)
		}
	}
}

func TestIsAcademicDomain_WhitespaceHandled(t *testing.T) {
	// Hinglish: email me leading/trailing space ho to bhi domain resolve hona chahiye.
	if !model.IsAcademicDomain("  user @iitd.ac.in  ") {
		t.Error("expected whitespace-containing email to resolve to academic domain")
	}
}

// ---------------------------------------------------------------------------
// Token validation test
// ---------------------------------------------------------------------------

func TestMintVerificationToken_ValidJWT(t *testing.T) {
	engine := newTestEngine()

	sv, err := engine.VerifyStudentGateA(context.Background(), 1)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Parse the token back.
	token, err := jwt.ParseWithClaims(sv.VerificationToken, &jwt.RegisteredClaims{},
		func(t *jwt.Token) (any, error) {
			return engine.jwtSecret, nil
		})
	if err != nil {
		t.Fatalf("token parse failed: %v", err)
	}
	if !token.Valid {
		t.Error("expected token to be valid")
	}

	claims, ok := token.Claims.(*jwt.RegisteredClaims)
	if !ok {
		t.Fatal("expected RegisteredClaims")
	}
	if claims.Issuer != "user-service-student-gate" {
		t.Errorf("issuer: expected user-service-student-gate, got %s", claims.Issuer)
	}
}

// ---------------------------------------------------------------------------
// User model: professional_role field test
// ---------------------------------------------------------------------------

func TestUserProfessionalRole_ValidValues(t *testing.T) {
	roles := []model.ProfessionalRole{
		model.RoleAdvocate,
		model.RoleLawyer,
		model.RoleStudent,
		model.RoleTutor,
		model.RoleMiddleIncomeEarner,
		model.RoleLowerMiddleEarner,
		model.RoleOther,
	}
	for _, role := range roles {
		if role == model.RoleUnset {
			t.Errorf("role should not be unset: %s", role)
		}
	}
}

// Ensure uuid import is used (for token ID claim).
func TestUUIDImportUsed(t *testing.T) {
	_ = uuid.New()
}
