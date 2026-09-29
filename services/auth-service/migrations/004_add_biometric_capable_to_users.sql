-- ============================================================================
-- 004_add_biometric_capable_to_users.sql
-- ============================================================================
-- SQL Server compatible version of the biometric_capable migration.
-- This keeps the same business intent: assume capability by default, but allow
-- users without a biometric sensor to complete setup without enrollment.
-- ============================================================================

-- ---- Step 1: add the column only if it does not already exist ----
IF COL_LENGTH('dbo.users', 'biometric_capable') IS NULL
BEGIN
    ALTER TABLE users
        ADD biometric_capable BIT NOT NULL
        CONSTRAINT DF_users_biometric_capable DEFAULT (1);
END
ELSE
BEGIN
    -- If the column exists but older rows still contain NULLs, backfill them.
    UPDATE users
       SET biometric_capable = 1
     WHERE biometric_capable IS NULL;
END;

-- ---- Step 2: fix any existing NULL values ----
UPDATE users
   SET biometric_capable = 1
 WHERE biometric_capable IS NULL;

-- ---- Step 3: ensure the column is not nullable ----
ALTER TABLE users
    ALTER COLUMN biometric_capable BIT NOT NULL;

-- ---- Step 4: ensure the default remains secure-by-default ----
IF NOT EXISTS (
    SELECT 1
      FROM sys.default_constraints dc
      JOIN sys.columns c
        ON dc.parent_object_id = c.object_id
       AND dc.parent_column_id = c.column_id
     WHERE dc.parent_object_id = OBJECT_ID('dbo.users')
       AND c.name = 'biometric_capable'
       AND dc.name = 'DF_users_biometric_capable'
)
BEGIN
    ALTER TABLE users
        ADD CONSTRAINT DF_users_biometric_capable DEFAULT (1) FOR biometric_capable;
END;

-- ---- Step 5: add metadata comment ----
EXEC sys.sp_addextendedproperty
     @name = N'MS_Description',
     @value = N'Whether this user''s device supports biometric auth (WebAuthn). If false, biometric enrollment is not required for security setup completion. Defaults to true (assume capable) for safety.',
     @level0type = N'SCHEMA',
     @level0name = N'dbo',
     @level1type = N'TABLE',
     @level1name = N'users',
     @level2type = N'COLUMN',
     @level2name = N'biometric_capable';

-- ============================================================================
-- NOTE (gate logic change is in Go, not here):
--   services/auth-service/internal/service/security.go
--   -> recomputeSetupComplete()
--   Ab: complete := hasPin && hasQuestions && (!capable || bioCount > 0)
--
--   Client is flag ko register request me bhejta hai:
--   web proxy : apps/web/src/app/api/auth/register/route.ts
--   form      : apps/web/src/app/auth/register/page.tsx
-- ============================================================================
