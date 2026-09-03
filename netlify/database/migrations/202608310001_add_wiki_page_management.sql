ALTER TABLE wiki_pages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_email TEXT;

CREATE INDEX IF NOT EXISTS wiki_pages_deleted_at_idx
  ON wiki_pages (deleted_at DESC)
  WHERE is_deleted = TRUE;

CREATE INDEX IF NOT EXISTS wiki_redirects_target_page_idx
  ON wiki_redirects (target_page_id);
