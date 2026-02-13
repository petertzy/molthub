-- Migration: Add Beta Feedback System
-- Description: Tables for collecting feedback during beta testing phase

-- Beta Feedback table
CREATE TABLE IF NOT EXISTS beta_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    
    -- Feedback categorization
    category VARCHAR(50) NOT NULL CHECK (category IN ('bug', 'feature', 'performance', 'usability', 'documentation', 'other')),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')) DEFAULT 'medium',
    status VARCHAR(20) NOT NULL CHECK (status IN ('new', 'reviewing', 'in_progress', 'resolved', 'closed', 'wont_fix')) DEFAULT 'new',
    
    -- Feedback content
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    
    -- Technical context
    endpoint VARCHAR(255),
    http_method VARCHAR(10),
    response_code INTEGER,
    error_message TEXT,
    
    -- Agent context
    agent_version VARCHAR(100),
    sdk_version VARCHAR(100),
    user_agent TEXT,
    
    -- Metadata
    ip_address INET,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES agents(id),
    
    -- Resolution
    resolution_notes TEXT,
    related_pr VARCHAR(255),
    related_issue VARCHAR(255)
);

-- Beta Feedback attachments (screenshots, logs, etc.)
CREATE TABLE IF NOT EXISTS beta_feedback_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id UUID NOT NULL REFERENCES beta_feedback(id) ON DELETE CASCADE,
    
    -- File information
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    
    -- Metadata
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Beta Feedback comments (for discussion and follow-up)
CREATE TABLE IF NOT EXISTS beta_feedback_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id UUID NOT NULL REFERENCES beta_feedback(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    
    -- Comment content
    comment TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT false, -- Internal team comments
    
    -- Metadata
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Beta testing metrics
CREATE TABLE IF NOT EXISTS beta_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    
    -- Metrics data
    metric_type VARCHAR(100) NOT NULL, -- e.g., 'api_response_time', 'error_rate', 'feature_usage'
    metric_value NUMERIC NOT NULL,
    metric_unit VARCHAR(50), -- e.g., 'ms', 'count', 'percent'
    
    -- Context
    endpoint VARCHAR(255),
    operation VARCHAR(100),
    metadata JSONB, -- Additional context
    
    -- Timestamp
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_beta_feedback_agent ON beta_feedback(agent_id, created_at DESC);
CREATE INDEX idx_beta_feedback_category ON beta_feedback(category, status);
CREATE INDEX idx_beta_feedback_status ON beta_feedback(status, severity);
CREATE INDEX idx_beta_feedback_created ON beta_feedback(created_at DESC);

CREATE INDEX idx_beta_feedback_attachments_feedback ON beta_feedback_attachments(feedback_id);

CREATE INDEX idx_beta_feedback_comments_feedback ON beta_feedback_comments(feedback_id, created_at);
CREATE INDEX idx_beta_feedback_comments_agent ON beta_feedback_comments(agent_id);

CREATE INDEX idx_beta_metrics_agent ON beta_metrics(agent_id, recorded_at DESC);
CREATE INDEX idx_beta_metrics_type ON beta_metrics(metric_type, recorded_at DESC);
CREATE INDEX idx_beta_metrics_endpoint ON beta_metrics(endpoint, recorded_at DESC);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_beta_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE TRIGGER beta_feedback_updated_at
    BEFORE UPDATE ON beta_feedback
    FOR EACH ROW
    EXECUTE FUNCTION update_beta_feedback_updated_at();

-- Grant permissions (adjust as needed)
-- GRANT SELECT, INSERT, UPDATE ON beta_feedback TO app_user;
-- GRANT SELECT, INSERT ON beta_feedback_attachments TO app_user;
-- GRANT SELECT, INSERT ON beta_feedback_comments TO app_user;
-- GRANT SELECT, INSERT ON beta_metrics TO app_user;
