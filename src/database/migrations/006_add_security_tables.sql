-- Migration: Security Enhancement Tables
-- Version: 006
-- Description: Creates tables for API key rotation, security events, and security audit logs
-- Date: 2026-02-12

-- ============================================================================
-- 1. API Key Rotation History Table
-- ============================================================================
-- Tracks API key rotations with overlap periods for graceful migration
CREATE TABLE IF NOT EXISTS api_key_rotation_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    old_key_hash VARCHAR(255) NOT NULL,
    new_key_hash VARCHAR(255) NOT NULL,
    rotated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    revoked_at TIMESTAMP,
    rotation_reason TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_rotation_history_agent 
    ON api_key_rotation_history(agent_id, rotated_at DESC);

CREATE INDEX IF NOT EXISTS idx_rotation_history_old_key 
    ON api_key_rotation_history(old_key_hash, expires_at);

CREATE INDEX IF NOT EXISTS idx_rotation_history_expires 
    ON api_key_rotation_history(expires_at) 
    WHERE expires_at IS NOT NULL;

COMMENT ON TABLE api_key_rotation_history IS 'History of API key rotations with overlap periods';
COMMENT ON COLUMN api_key_rotation_history.expires_at IS 'When the old key expires (NULL = already expired)';
COMMENT ON COLUMN api_key_rotation_history.revoked_at IS 'When the old key was manually revoked';

-- ============================================================================
-- 2. Security Events Table
-- ============================================================================
-- Comprehensive audit trail for security-related events
CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for event querying
CREATE INDEX IF NOT EXISTS idx_security_events_type_time 
    ON security_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_severity 
    ON security_events(severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_agent 
    ON security_events(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_created 
    ON security_events(created_at DESC);

COMMENT ON TABLE security_events IS 'Audit trail for security-related events';
COMMENT ON COLUMN security_events.event_type IS 'Type of security event (e.g., KEY_ROTATION, FAILED_AUTH, RATE_LIMIT_EXCEEDED)';
COMMENT ON COLUMN security_events.severity IS 'Severity level of the event';

-- ============================================================================
-- 3. Failed Authentication Attempts Table
-- ============================================================================
-- Track failed authentication attempts for account lockout and abuse detection
CREATE TABLE IF NOT EXISTS failed_auth_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    api_key_hash VARCHAR(255),
    ip_address INET NOT NULL,
    user_agent TEXT,
    attempt_type VARCHAR(50) NOT NULL CHECK (attempt_type IN ('API_KEY', 'JWT_TOKEN', 'SIGNATURE')),
    failure_reason VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for abuse detection
CREATE INDEX IF NOT EXISTS idx_failed_auth_ip_time 
    ON failed_auth_attempts(ip_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_failed_auth_agent_time 
    ON failed_auth_attempts(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_failed_auth_created 
    ON failed_auth_attempts(created_at DESC);

COMMENT ON TABLE failed_auth_attempts IS 'Tracks failed authentication attempts for security monitoring';

-- ============================================================================
-- 4. Rate Limit Violations Table
-- ============================================================================
-- Track rate limit violations for monitoring and alerting
CREATE TABLE IF NOT EXISTS rate_limit_violations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    ip_address INET NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    violation_type VARCHAR(50) NOT NULL CHECK (violation_type IN ('IP_LIMIT', 'AGENT_LIMIT', 'ENDPOINT_LIMIT', 'CONNECTION_LIMIT')),
    request_count INT NOT NULL,
    limit_threshold INT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for monitoring
CREATE INDEX IF NOT EXISTS idx_rate_violations_ip_time 
    ON rate_limit_violations(ip_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_violations_agent_time 
    ON rate_limit_violations(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_violations_endpoint 
    ON rate_limit_violations(endpoint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_violations_created 
    ON rate_limit_violations(created_at DESC);

COMMENT ON TABLE rate_limit_violations IS 'Tracks rate limit violations for abuse detection';

-- ============================================================================
-- 5. Account Lockouts Table
-- ============================================================================
-- Track temporary account lockouts due to suspicious activity
CREATE TABLE IF NOT EXISTS account_lockouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    lockout_reason VARCHAR(255) NOT NULL,
    locked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unlocked_at TIMESTAMP,
    auto_unlock_at TIMESTAMP NOT NULL,
    failed_attempts_count INT DEFAULT 0,
    ip_addresses INET[],
    metadata JSONB DEFAULT '{}'
);

-- Indexes for lockout management
CREATE INDEX IF NOT EXISTS idx_lockouts_agent 
    ON account_lockouts(agent_id, locked_at DESC);

CREATE INDEX IF NOT EXISTS idx_lockouts_active 
    ON account_lockouts(auto_unlock_at) 
    WHERE unlocked_at IS NULL;

COMMENT ON TABLE account_lockouts IS 'Tracks account lockouts due to security concerns';
COMMENT ON COLUMN account_lockouts.auto_unlock_at IS 'When the lockout automatically expires';
COMMENT ON COLUMN account_lockouts.unlocked_at IS 'When the lockout was manually removed (NULL = still locked)';

-- ============================================================================
-- 6. Input Validation Logs Table
-- ============================================================================
-- Log suspicious input attempts for security analysis
CREATE TABLE IF NOT EXISTS input_validation_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    ip_address INET NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    field_name VARCHAR(100),
    validation_type VARCHAR(50) NOT NULL CHECK (validation_type IN ('XSS', 'SQL_INJECTION', 'MALICIOUS_PATTERN', 'LENGTH', 'FORMAT')),
    input_sample TEXT, -- First 500 chars of suspicious input
    blocked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for analysis
CREATE INDEX IF NOT EXISTS idx_input_validation_type_time 
    ON input_validation_logs(validation_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_input_validation_agent 
    ON input_validation_logs(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_input_validation_endpoint 
    ON input_validation_logs(endpoint, created_at DESC);

COMMENT ON TABLE input_validation_logs IS 'Logs suspicious input attempts for security analysis';
COMMENT ON COLUMN input_validation_logs.input_sample IS 'Sample of the suspicious input (truncated for storage)';

-- ============================================================================
-- 7. Add status column to agents table if not exists
-- ============================================================================
-- Supports active, suspended, banned states
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'agents' AND column_name = 'status'
    ) THEN
        ALTER TABLE agents ADD COLUMN status VARCHAR(20) DEFAULT 'active' 
            CHECK (status IN ('active', 'suspended', 'banned', 'inactive'));
        
        -- Migrate existing data
        UPDATE agents SET status = 'banned' WHERE is_banned = true;
        UPDATE agents SET status = 'inactive' WHERE is_active = false;
        
        -- Create index
        CREATE INDEX idx_agents_status ON agents(status);
    END IF;
END $$;

-- ============================================================================
-- 8. Functions for Security Automation
-- ============================================================================

-- Function to automatically lock account after failed attempts
CREATE OR REPLACE FUNCTION check_failed_auth_threshold()
RETURNS TRIGGER AS $$
DECLARE
    failed_count INT;
    lockout_duration INTERVAL := INTERVAL '15 minutes';
    threshold INT := 5;
BEGIN
    -- Count recent failed attempts (last 15 minutes)
    SELECT COUNT(*) INTO failed_count
    FROM failed_auth_attempts
    WHERE agent_id = NEW.agent_id
        AND created_at > CURRENT_TIMESTAMP - INTERVAL '15 minutes';
    
    -- Lock account if threshold exceeded
    IF failed_count >= threshold THEN
        INSERT INTO account_lockouts (
            agent_id, 
            lockout_reason, 
            auto_unlock_at, 
            failed_attempts_count,
            ip_addresses
        ) VALUES (
            NEW.agent_id,
            'Too many failed authentication attempts',
            CURRENT_TIMESTAMP + lockout_duration,
            failed_count,
            ARRAY[NEW.ip_address]
        );
        
        -- Log security event
        INSERT INTO security_events (
            event_type,
            severity,
            agent_id,
            ip_address,
            description
        ) VALUES (
            'ACCOUNT_LOCKED',
            'HIGH',
            NEW.agent_id,
            NEW.ip_address,
            'Account locked due to ' || failed_count || ' failed authentication attempts'
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for automatic account lockout
DROP TRIGGER IF EXISTS trigger_check_failed_auth ON failed_auth_attempts;
CREATE TRIGGER trigger_check_failed_auth
    AFTER INSERT ON failed_auth_attempts
    FOR EACH ROW
    EXECUTE FUNCTION check_failed_auth_threshold();

-- Function to automatically unlock expired lockouts
CREATE OR REPLACE FUNCTION auto_unlock_expired_accounts()
RETURNS void AS $$
BEGIN
    UPDATE account_lockouts
    SET unlocked_at = CURRENT_TIMESTAMP
    WHERE unlocked_at IS NULL 
        AND auto_unlock_at <= CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup old security logs (run periodically)
CREATE OR REPLACE FUNCTION cleanup_old_security_logs(retention_days INT DEFAULT 90)
RETURNS void AS $$
BEGIN
    -- Delete old failed auth attempts
    DELETE FROM failed_auth_attempts 
    WHERE created_at < CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    -- Delete old rate limit violations
    DELETE FROM rate_limit_violations 
    WHERE created_at < CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    -- Delete old input validation logs
    DELETE FROM input_validation_logs 
    WHERE created_at < CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    -- Delete old unlocked account lockouts
    DELETE FROM account_lockouts 
    WHERE unlocked_at IS NOT NULL 
        AND unlocked_at < CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    -- Delete expired key rotation history
    DELETE FROM api_key_rotation_history 
    WHERE expires_at IS NOT NULL 
        AND expires_at < CURRENT_TIMESTAMP - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 9. Initial Security Events
-- ============================================================================
INSERT INTO security_events (event_type, severity, description, metadata)
VALUES (
    'SECURITY_TABLES_INITIALIZED',
    'LOW',
    'Security enhancement tables created and initialized',
    jsonb_build_object(
        'migration_version', '006',
        'timestamp', CURRENT_TIMESTAMP
    )
);

-- ============================================================================
-- Migration Complete
-- ============================================================================
COMMENT ON SCHEMA public IS 'Security enhancement migration 006 applied successfully';
