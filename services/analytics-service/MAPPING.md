// Services Directory
analytics-service/src/service/service.go                 // Main service interface and implementation
analytics-service/src/service/analytics_service.go     // Analytics service implementation

// Repositories Directory  
analytics-service/src/repository/analytics_repository.go  // Analytics data access layer
analytics-service/src/repository/billing_repository.go     // Billing data access layer

// Model Directory
analytics-service/src/model/analytics.go         // ViewLog, ClickLog, ConversionEvent, Reach, RevenueReport models
analytics-service/src/model/creator.go           // Creator model with ₹500/day target tracking
analytics-service/src/model/billing.go           // SubscriptionPlan, Subscription, TaxRate, InvoiceItem, Payment, ManualExpense models

// Handler Directory
analytics-service/src/handler/analytics_handler.go // Analytics API endpoints
analytics-service/src/handler/billing_handler.go    // Billing API endpoints

// Database Directory
analytics-service/src/database/database.go         // PostgreSQL connection and AutoMigrate

// Command Directory
analytics-service/cmd/analytics-service/main.go     // Service entry point

// Config Directory
analytics-service/config/config.yaml                 // Service configuration

// Root Directory
analytics-service/go.mod                         // Go module configuration
analytics-service/README.md                        // Documentation and architecture overview
