-- Preserve historical media IDs and filenames when a duplicate image is
-- merged into an existing catalog entry. Never delete the canonical target
-- while redirects still depend on it.
CREATE TABLE wiki_media_redirects (
  source_id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  target_id TEXT NOT NULL REFERENCES wiki_media(id) ON DELETE RESTRICT,
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_id <> target_id)
);
CREATE INDEX wiki_media_redirects_target_idx
  ON wiki_media_redirects (target_id);
CREATE INDEX wiki_media_redirects_name_idx
  ON wiki_media_redirects (LOWER(source_name));
