# Auth Service

Microservice for authentication, authorization, and user management in the Wideo11 platform.

## Features

- User registration with email verification
- Secure login with JWT access/refresh tokens
- Password hashing using bcrypt
- Session management with device tracking
- PIN setup and verification for additional security
- Role-based access control (RBAC)
- Logout and token revocation
- Refresh token rotation
- Rate limiting and brute force protection
- GDPR-compliant data deletion
- Comprehensive audit logging

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login user
- `POST /api/v1/auth/refresh` - Refresh access token
- `POST /api/v1/auth/logout` - Logout user (revoke session)

### Protected Routes (Require Authorization Header)
- `GET /api/v1/auth/profile` - Get user profile
- `POST /api/v1/auth/pin/setup` - Setup 6-digit PIN
- `POST /api/v1/auth/pin/verify` - Verify 6-digit PIN

## Security Features

- Passwords hashed with bcrypt (configurable cost)
- JWT tokens with configurable expiration
- Refresh token rotation to prevent replay attacks
- Session tracking with device fingerprinting
- PIN protection with attempt limiting and lockout
- Rate limiting on authentication endpoints
- SQL injection prevention via GORM
- CORS protection
- Security headers

## Database Schema

The service uses PostgreSQL with the following tables:
- `users` - User account information
- `sessions` - Active user sessions
- `devices` - Trusted user devices
- `pins` - User PIN information (hashed)
- `refresh_tokens` - Hashed refresh tokens for rotation

## Environment Variables

See `.env.example` for required configuration.

## Running the Service

```bash
# Development
go run cmd/auth-service/main.go

# Production (using Docker)
docker build -t auth-service .
docker run -p 8080:8080 --env-file .env auth-service
```

## Testing

```bash
go test ./... -v
```

## Dependencies

- Go 1.22+
- PostgreSQL 15+
- Redis 7+
- Gin web framework
- GORM ORM
- JWT library
- Bcrypt for password hashing
- Zerolog for structured logging
- Viper for configuration
- Godotenv for environment loading

## License

Proprietary - Wideo11 Platform