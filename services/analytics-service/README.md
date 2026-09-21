analytics-service
  
├── src
│   ├── model
│   │   ├── analytics.go              # ViewLog, ClickLog, ConversionEvent, Reach, RevenueReport
│   │   ├── creator.go                # ₹500/day target ledger tracker
│   │   └── billing.go                # SubscriptionPlan, Subscription, TaxRate, InvoiceItem, Payment, ManualExpense
│   ├── repository
│   │   ├── analytics_repository.go    # ClickStreamRepository, RetentionRepository, ViewEventRepository, CreatorRevenueRepository
│   │   └── billing_repository.go       # PlanRepository, SubscriptionRepository, TaxRateRepository, InvoiceRepository, PaymentRepository, ManualExpenseRepository
│   ├── service
│   │   ├── analytics_service.go       # ClickStreamProcessingService, RetentionAnalyticsService, ViewEventAnalyticsService, CreatorRevenueCalculator
│   │   └── billing_service.go          # BillingService with ₹500/day target tracking and payout calculations
│   └── handler
│       ├── analytics_handler.go      # API endpoints for analytics data ingestion and querying
│       └── billing_handler.go        # API endpoints for billing operations and creator payments
│   └── database
│       └── database.go              # PostgreSQL connection and AutoMigrate for all models
├── cmd
│   └── analytics-service
│       └── main.go                  # Service entry point
├── config
│   └── config.yaml                # Service configuration
└── go.mod                          # Go module configuration

# Creator ₹500/day Target Ledger Tracker Service Components:
#
# CreatorRevenueCalculator service implements the core logic for tracking daily creator payouts
# Tracks individual creator earnings across multiple revenue sources
# Calculates ₹500/day target achievement status and forecasts for upcoming periods
# Generates detailed creator-specific financial metrics and transparency reports
# Supports granular tracking for low-income tier channels and daily target computations
#
# ClickStreamProcessingService ingests real-time user interaction data
# Processes click streams with timestamp, IP, device, and geographic metadata
# Tracks content engagement patterns across different content types
# Provides real-time analytics for user behavior and content performance
#
# RetentionAnalyticsService analyzes user retention patterns and cohorts
# Tracks user engagement over time periods and identifies retention trends
# Calculates retention percentages and user lifetime value metrics
# Supports multi-dimensional retention analysis by user segments and content types
#
# ViewEventAnalyticsService processes comprehensive view event data
# Captures video, image, text, and live content viewing behaviors
# Tracks percent watched, duration, and user engagement metrics
# Provides detailed content performance analytics and insights
#
# BillingService integrates with creator revenue calculations
# Processes subscription payments and billing cycles
# Tracks invoice generation and payment status
# Manages tax calculations and platform revenue sharing
#
# Manual Expense Tracker supports offline expenditure recording
# Captures manual creator expenses with detailed categorization
# Tracks tax deductions and platform reimbursements
# Provides comprehensive expense reporting and audit trails
#
# ViewLog, ClickLog, ConversionEvent, Reach, RevenueReport models support comprehensive analytics
# Creator, SubscriptionPlan, Subscription, TaxRate, InvoiceItem, Payment, ManualExpense models support billing operations
#
# All services use GORM for database operations and PostgreSQL for production
# Native Go implementations with zero mock scripts or automated boilerplate
