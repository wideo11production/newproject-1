# Zero Hardcoding Law Compliance Auditor

This script audits all Go files across all services to identify hardcoded tokens, endpoints, and configuration parameters. It scans:

- Database connection strings
- JWT secrets and API keys  
- Service endpoints and URLs
- Configuration values
- Authentication tokens

Usage:
  .—help
  .—audit [ path ]
  .—audit – token – types ( "database"| "auth"| "api" )

Features:
- Identifies hardcoded JWT tokens, secrets, and credentials
- Detects database connection strings with embedded passwords
- Finds API endpoints and configuration values
- Provides detailed reports with file locations
- Suggests migration to .env files

Environment:
- Supports Windows PowerShell (; separators only)
- No external dependencies
- Recursive directory scanning
- Detailed output formatting

Legal Compliance:
- All scanned files are processed according to current jurisdiction
- No personal data or sensitive information is exposed
- Data is used solely for security audit purposes

This tool helps enforce the Zero Hardcoding Law across all microservices.
