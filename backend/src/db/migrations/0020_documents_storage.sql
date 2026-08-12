-- Supports real file storage (POST /documents/upload), not just filename
-- metadata. storage_path is the internal generated filename on disk;
-- mime_type is needed to serve the file with the right Content-Type.
ALTER TABLE documents ADD COLUMN storage_path TEXT;
ALTER TABLE documents ADD COLUMN mime_type TEXT;
