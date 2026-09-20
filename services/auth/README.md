# Biometric Authentication Service (WebAuthn/FIDO2)

This service provides WebAuthn (FIDO2) based passwordless authentication using passkeys.

## Features

- Passwordless authentication using biometrics (fingerprint, face ID) or device PIN
- Registration of platform authenticators (built-in to device) and roaming authenticators (security keys)
- Challenge-based authentication to prevent replay attacks
- Signature counter verification to prevent cloned authenticator attacks
- Support for resident keys (discoverable credentials)
- Attestation verification (optional)

## API Endpoints

### Registration Flow
1. `POST /api/v1/biometric/register/begin` - Start registration process
   - Request: `{ "user_id": "uuid", "user_name": "email@example.com", "display_name": "Full Name" }`
   - Response: WebAuthn credential creation options + session ID

2. `POST /api/v1/biometric/register/finish` - Complete registration
   - Request: `{ "user_id": "uuid", "session_id": "...", "credential": {...}, "response": {...} }`
   - Response: Success message

### Authentication Flow
1. `POST /api/v1/biometric/login/begin` - Start authentication process
   - Request: `{ "user_id": "uuid" }`
   - Response: WebAuthn credential assertion options + session ID

2. `POST /api/v1/biometric/login/finish` - Complete authentication
   - Request: `{ "user_id": "uuid", "session_id": "...", "assertion": {...}, "response": {...} }`
   - Response: Success message

## Security Features

- Cryptographically random challenges (32 bytes)
- Challenge expiration (5 minutes)
- Signature counter validation to prevent replay attacks
- Origin validation to prevent phishing
- Support for UV (User Verification) via device biometrics/PIN
- Credential backup state tracking

## Database Schema

The service requires two tables:
1. `users` - Basic user information (would normally be shared with main auth service)
2. `webauthn_credentials` - Stores WebAuthn credential public keys and metadata

## Dependencies

- Go 1.22+
- PostgreSQL
- WebAuthn Go library (duo-labs/webauthn)
- Gin web framework
- Gorilla sessions (for session management in challenge store)
- Google UUID
- Lib/pq (PostgreSQL driver)
- Gorilla/securecookie (indirect via sessions)
- Jonboulle/clockindirect via koanf

## Running the Service

```bash
# Development
go run src/main.go

# With Docker (example)
docker build -t auth-biometric .
docker run -p 8081:8081 --env-file .env auth-biometric
```

## Integration Notes

This service is designed to work alongside a main authentication service that handles:
- Traditional password-based authentication
- User registration and profile management
- Password reset and email verification
- Session/JWT token management

The biometric service focuses solely on WebAuthn/FIDO2 operations and would typically be called by the main auth service during login/registration flows when the user opts for biometric authentication.