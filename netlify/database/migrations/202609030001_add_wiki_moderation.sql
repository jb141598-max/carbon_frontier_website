ALTER TABLE wiki_settings
  ADD COLUMN review_mode TEXT NOT NULL DEFAULT 'immediate'
    CHECK (review_mode IN ('immediate', 'approval'));

CREATE TABLE wiki_pending_edits (
  id TEXT PRIMARY KEY,
  submission_type TEXT NOT NULL
    CHECK (submission_type IN ('create', 'edit')),
  page_id TEXT REFERENCES wiki_pages(id) ON DELETE SET NULL,
  requested_slug TEXT NOT NULL
    CHECK (requested_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  page_title TEXT NOT NULL CHECK (char_length(page_title) BETWEEN 1 AND 120),
  base_revision_id TEXT REFERENCES wiki_revisions(id) ON DELETE SET NULL,
  content_json JSONB NOT NULL
    CHECK (jsonb_typeof(content_json) IN ('object', 'array')),
  edit_summary TEXT NOT NULL DEFAULT '' CHECK (char_length(edit_summary) <= 300),
  author_email TEXT NOT NULL,
  author_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  reviewed_by_email TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '' CHECK (char_length(review_note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX wiki_pending_edits_status_created_idx
  ON wiki_pending_edits (status, created_at DESC);
CREATE INDEX wiki_pending_edits_author_created_idx
  ON wiki_pending_edits (author_email, created_at DESC);
CREATE UNIQUE INDEX wiki_pending_create_slug_unique
  ON wiki_pending_edits (requested_slug)
  WHERE submission_type = 'create' AND status = 'pending';

CREATE TABLE wiki_blocked_users (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '' CHECK (char_length(reason) <= 300),
  blocked_by_email TEXT NOT NULL,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX wiki_blocked_users_blocked_at_idx
  ON wiki_blocked_users (blocked_at DESC);
