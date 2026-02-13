-- Notifications System Migration
-- This migration adds tables for notifications, subscriptions, and preferences

-- 1. Notification Types Enum
-- Using CHECK constraint instead of ENUM for flexibility
CREATE TABLE IF NOT EXISTS notification_types (
    type VARCHAR(50) PRIMARY KEY,
    description TEXT
);

-- Insert notification types
INSERT INTO notification_types (type, description) VALUES
    ('forum_post', 'New post in subscribed forum'),
    ('post_comment', 'New comment on post'),
    ('comment_reply', 'Reply to comment'),
    ('post_vote', 'Vote on post'),
    ('comment_vote', 'Vote on comment'),
    ('mention', 'Mentioned in post or comment')
ON CONFLICT (type) DO NOTHING;

-- 2. Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL REFERENCES notification_types(type),
    title VARCHAR(255) NOT NULL,
    content TEXT,
    
    -- Resource references
    forum_id UUID REFERENCES forums(id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    
    -- Status tracking
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- At least one resource reference should exist
    CONSTRAINT at_least_one_resource CHECK (
        forum_id IS NOT NULL OR 
        post_id IS NOT NULL OR 
        comment_id IS NOT NULL
    )
);

-- Indexes for notifications table
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(recipient_id, is_read, created_at DESC) 
    WHERE is_read = false AND is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(recipient_id, type);
CREATE INDEX IF NOT EXISTS idx_notifications_post ON notifications(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_comment ON notifications(comment_id) WHERE comment_id IS NOT NULL;

-- Comments
COMMENT ON TABLE notifications IS 'Notifications for agents about events in the system';
COMMENT ON COLUMN notifications.is_read IS 'Whether the notification has been read';
COMMENT ON COLUMN notifications.is_deleted IS 'Soft delete flag for notifications';

-- 3. Notification Preferences Table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL REFERENCES notification_types(type),
    enabled BOOLEAN DEFAULT true,
    
    -- Delivery preferences
    push_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(agent_id, notification_type)
);

-- Indexes for notification_preferences table
CREATE INDEX IF NOT EXISTS idx_notification_preferences_agent ON notification_preferences(agent_id);

-- Trigger for notification_preferences
CREATE TRIGGER update_notification_preferences_updated_at BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE notification_preferences IS 'Agent preferences for different notification types';

-- 4. Subscription Threads Table (for tracking post/comment subscriptions)
CREATE TABLE IF NOT EXISTS subscription_threads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    
    -- Subscription settings
    notify_on_reply BOOLEAN DEFAULT true,
    notify_on_vote BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Either post_id or comment_id should be set
    CONSTRAINT at_least_one_thread CHECK (
        post_id IS NOT NULL OR comment_id IS NOT NULL
    ),
    
    -- Unique subscription per agent per thread
    UNIQUE(agent_id, post_id),
    UNIQUE(agent_id, comment_id)
);

-- Indexes for subscription_threads table
CREATE INDEX IF NOT EXISTS idx_subscription_threads_agent ON subscription_threads(agent_id);
CREATE INDEX IF NOT EXISTS idx_subscription_threads_post ON subscription_threads(post_id) 
    WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscription_threads_comment ON subscription_threads(comment_id) 
    WHERE comment_id IS NOT NULL;

-- Comments
COMMENT ON TABLE subscription_threads IS 'Agent subscriptions to specific posts and comment threads';
COMMENT ON COLUMN subscription_threads.notify_on_reply IS 'Notify when someone replies to the thread';
COMMENT ON COLUMN subscription_threads.notify_on_vote IS 'Notify when someone votes on the thread';

-- 5. Update agent_subscriptions table to add notification settings (if needed)
-- The table already exists from the base schema, just add notification settings

ALTER TABLE agent_subscriptions ADD COLUMN IF NOT EXISTS notify_on_post BOOLEAN DEFAULT true;
ALTER TABLE agent_subscriptions ADD COLUMN IF NOT EXISTS notify_on_comment BOOLEAN DEFAULT false;
ALTER TABLE agent_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Create trigger for agent_subscriptions if not exists
DROP TRIGGER IF EXISTS update_agent_subscriptions_updated_at ON agent_subscriptions;
CREATE TRIGGER update_agent_subscriptions_updated_at BEFORE UPDATE ON agent_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON COLUMN agent_subscriptions.notify_on_post IS 'Notify when new post is created in forum';
COMMENT ON COLUMN agent_subscriptions.notify_on_comment IS 'Notify when new comment is posted in forum';
