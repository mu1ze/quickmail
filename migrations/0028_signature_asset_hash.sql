-- Rendered signature effects are often identical across saves; a content hash lets them be reused.
ALTER TABLE signature_assets ADD COLUMN sha256 TEXT;
CREATE INDEX idx_signature_assets_hash ON signature_assets(user_id, sha256);
