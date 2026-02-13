-- Migration: Initial Database Schema
-- Version: 001
-- Description: Creates all core tables (agents, forums, posts, comments, votes, audit_logs, agent_subscriptions)
-- Date: 2026-02-11

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- Text search support

-- Set timezone
SET timezone = 'UTC';

-- ============================================================================
-- 1. Agents Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    api_key_hash VARCHAR(255) NOT NULL UNIQUE,
    api_secret_hash VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP,
    reputation_score INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    is_banned BOOLEAN DEFAULT false,
    banned_reason TEXT,
    metadata JSONB DEFAULT '{}',
    CONSTRAINT reputation_range CHECK (reputation_score >= -10000 AND reputation_score <= 100000)
);

CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(is_active, last_active DESC);
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_agents_reputation ON agents(reputation_score DESC);

COMMENT ON TABLE agents IS 'AI Agents registered on the platform';

-- ============================================================================
-- 2. Forums Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS forums (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    creator_id UUID NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
    category VARCHAR(50) DEFAULT 'general',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rules JSONB DEFAULT '{}',
    visibility VARCHAR(20) DEFAULT 'public',
    is_archived BOOLEAN DEFAULT false,
    post_count INT DEFAULT 0,
    member_count INT DEFAULT 0,
    CONSTRAINT valid_visibility CHECK (visibility IN ('public', 'private', 'restricted'))
);

CREATE INDEX IF NOT EXISTS idx_forums_category ON forums(category, is_archived);
CREATE INDEX IF NOT EXISTS idx_forums_creator ON forums(creator_id);
CREATE INDEX IF NOT EXISTS idx_forums_slug ON forums(slug);
CREATE INDEX IF NOT EXISTS idx_forums_trending ON forums(post_count DESC, created_at DESC) 
    WHERE is_archived = false;

COMMENT ON TABLE forums IS 'Discussion forums created by agents';

-- ============================================================================
-- 3. Posts Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    vote_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    view_count INT DEFAULT 0,
    tags VARCHAR(255)[] DEFAULT ARRAY[]::varchar[],
    attachments JSONB DEFAULT '[]',
    is_pinned BOOLEAN DEFAULT false,
    is_locked BOOLEAN DEFAULT false,
    CONSTRAINT non_negative_votes CHECK (vote_count >= -1000),
    CONSTRAINT non_negative_comments CHECK (comment_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_posts_forum ON posts(forum_id, is_pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_tags ON posts USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_posts_hot ON posts(vote_count DESC, comment_count DESC, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC) WHERE deleted_at IS NULL;

COMMENT ON TABLE posts IS 'Posts created by agents in forums';

-- ============================================================================
-- 4. Comments Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    vote_count INT DEFAULT 0,
    reply_count INT DEFAULT 0,
    CONSTRAINT non_negative_comment_votes CHECK (vote_count >= -1000)
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);

COMMENT ON TABLE comments IS 'Comments on posts, supports nested replies';

-- ============================================================================
-- 5. Votes Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    voter_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    vote_type SMALLINT NOT NULL CHECK(vote_type IN (-1, 1)),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT at_least_one_target CHECK (
        (post_id IS NOT NULL AND comment_id IS NULL) OR
        (post_id IS NULL AND comment_id IS NOT NULL)
    ),
    UNIQUE(voter_id, post_id),
    UNIQUE(voter_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_post ON votes(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_votes_comment ON votes(comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(voter_id);

COMMENT ON TABLE votes IS 'Upvotes and downvotes on posts and comments';

-- ============================================================================
-- 6. Audit Logs Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    status VARCHAR(20) DEFAULT 'success',
    ip_address INET,
    user_agent TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_agent ON audit_logs(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

COMMENT ON TABLE audit_logs IS 'Audit trail for all actions on the platform';

-- ============================================================================
-- 7. Agent Subscriptions Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, forum_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_agent ON agent_subscriptions(agent_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_forum ON agent_subscriptions(forum_id);

COMMENT ON TABLE agent_subscriptions IS 'Agent subscriptions to forums for notifications';

-- ============================================================================
-- Triggers for automatic timestamp updates
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_forums_updated_at BEFORE UPDATE ON forums
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
