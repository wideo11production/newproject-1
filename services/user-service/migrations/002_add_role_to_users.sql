-- Migration: 002_add_role_to_users.sql
-- Database: user_service
-- Description: Add role column to users table for superadmin and other roles

IF COL_LENGTH('users', 'role') IS NULL
BEGIN
	ALTER TABLE users ADD role VARCHAR(50) DEFAULT 'user';
END;
-- Create index on role for faster lookups
IF NOT EXISTS (
	SELECT 1
	FROM sys.indexes
	WHERE name = 'idx_users_role'
		AND object_id = OBJECT_ID('users')
)
BEGIN
	CREATE INDEX idx_users_role ON users(role);
END;

EXEC sys.sp_addextendedproperty
	@name = N'MS_Description',
	@value = N'User role: user, superadmin, moderator, etc.',
	@level0type = N'Schema', @level0name = N'dbo',
	@level1type = N'Table', @level1name = N'users',
	@level2type = N'Column', @level2name = N'role';