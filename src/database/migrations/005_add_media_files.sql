-- Migration: Add media_files table for file upload and storage
-- Created: 2026-02-12
-- Description: Adds support for file uploads with S3/local storage tracking

-- Create media_files table
CREATE TABLE IF NOT EXISTS media_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uploader_id UUID NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_path VARCHAR(500) NOT NULL,
    storage_type VARCHAR(20) NOT NULL DEFAULT 'local', -- 'local', 's3', 'minio'
    url TEXT,
    thumbnail_url TEXT,
    width INT,
    height INT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    CONSTRAINT valid_storage_type CHECK (storage_type IN ('local', 's3', 'minio')),
    CONSTRAINT positive_size CHECK (size_bytes > 0)
);

-- Indexes for media_files table
CREATE INDEX IF NOT EXISTS idx_media_files_uploader ON media_files(uploader_id);
CREATE INDEX IF NOT EXISTS idx_media_files_created ON media_files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_files_mime_type ON media_files(mime_type);
CREATE INDEX IF NOT EXISTS idx_media_files_deleted ON media_files(deleted_at) WHERE deleted_at IS NULL;

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_media_files_updated_at BEFORE UPDATE ON media_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE media_files IS 'Uploaded media files with storage metadata';
COMMENT ON COLUMN media_files.storage_path IS 'Path in storage system (S3 key or local path)';
COMMENT ON COLUMN media_files.storage_type IS 'Storage backend: local, s3, or minio';
COMMENT ON COLUMN media_files.url IS 'Public URL to access the file';
COMMENT ON COLUMN media_files.thumbnail_url IS 'URL to thumbnail (for images)';
COMMENT ON COLUMN media_files.deleted_at IS 'Soft delete timestamp';
