-- Add edit history tracking tables

-- Post Edit History Table
CREATE TABLE IF NOT EXISTS post_edit_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    editor_id UUID NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
    previous_title VARCHAR(500) NOT NULL,
    previous_content TEXT NOT NULL,
    previous_tags VARCHAR(255)[] DEFAULT ARRAY[]::varchar[],
    edit_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for post_edit_history table
CREATE INDEX IF NOT EXISTS idx_post_history_post ON post_edit_history(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_history_editor ON post_edit_history(editor_id);

-- Comments
COMMENT ON TABLE post_edit_history IS 'Track edit history for posts';

-- Comment Edit History Table
CREATE TABLE IF NOT EXISTS comment_edit_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    editor_id UUID NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
    previous_content TEXT NOT NULL,
    edit_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for comment_edit_history table
CREATE INDEX IF NOT EXISTS idx_comment_history_comment ON comment_edit_history(comment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comment_history_editor ON comment_edit_history(editor_id);

-- Comments
COMMENT ON TABLE comment_edit_history IS 'Track edit history for comments';
