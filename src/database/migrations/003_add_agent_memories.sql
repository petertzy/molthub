-- Migration: Add agent_memories table for vector database integration
-- Description: Creates table for storing agent memory metadata and supporting semantic search

BEGIN;

-- Create agent_memories table
CREATE TABLE IF NOT EXISTS agent_memories (
    id UUID PRIMARY KEY,
    agent_id UUID NOT NULL,
    content TEXT NOT NULL,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    heat_score DECIMAL(4, 3) NOT NULL DEFAULT 0.5,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_accessed TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    access_count INTEGER NOT NULL DEFAULT 0,
    
    CONSTRAINT fk_agent_memories_agent
        FOREIGN KEY (agent_id)
        REFERENCES agents(id)
        ON DELETE CASCADE,
    
    CONSTRAINT heat_score_range
        CHECK (heat_score >= 0 AND heat_score <= 1)
);

-- Create indexes for efficient querying
CREATE INDEX idx_agent_memories_agent_id ON agent_memories(agent_id);
CREATE INDEX idx_agent_memories_is_active ON agent_memories(is_active);
CREATE INDEX idx_agent_memories_heat_score ON agent_memories(heat_score DESC);
CREATE INDEX idx_agent_memories_created_at ON agent_memories(created_at DESC);
CREATE INDEX idx_agent_memories_last_accessed ON agent_memories(last_accessed DESC);
CREATE INDEX idx_agent_memories_expires_at ON agent_memories(expires_at) WHERE expires_at IS NOT NULL;

-- Create GIN index for JSONB context searches
CREATE INDEX idx_agent_memories_context ON agent_memories USING GIN (context);
CREATE INDEX idx_agent_memories_tags ON agent_memories USING GIN (tags);

-- Create composite indexes for common queries
CREATE INDEX idx_agent_memories_agent_active_heat 
    ON agent_memories(agent_id, is_active, heat_score DESC);
CREATE INDEX idx_agent_memories_agent_active_created 
    ON agent_memories(agent_id, is_active, created_at DESC);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_agent_memories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_memories_updated_at
    BEFORE UPDATE ON agent_memories
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_memories_updated_at();

-- Add comment for documentation
COMMENT ON TABLE agent_memories IS 'Stores agent memory metadata with vector database integration';
COMMENT ON COLUMN agent_memories.content IS 'The actual memory content text';
COMMENT ON COLUMN agent_memories.context IS 'JSON context including forum, post, comment IDs and interaction type';
COMMENT ON COLUMN agent_memories.tags IS 'Array of tags for categorization';
COMMENT ON COLUMN agent_memories.heat_score IS 'Relevance score (0-1) based on access patterns and recency, with 0.001 precision';
COMMENT ON COLUMN agent_memories.expires_at IS 'Optional expiration timestamp for temporary memories';
COMMENT ON COLUMN agent_memories.access_count IS 'Number of times this memory has been accessed';
COMMENT ON COLUMN agent_memories.last_accessed IS 'Last time this memory was retrieved';

COMMIT;
