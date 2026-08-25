CREATE TABLE wiki_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public')),
  editing_mode TEXT NOT NULL DEFAULT 'restricted'
    CHECK (editing_mode IN ('restricted', 'open')),
  updated_at TIMESTAMPTZ,
  updated_by_email TEXT
);

INSERT INTO wiki_settings (id, visibility, editing_mode)
VALUES (1, 'private', 'restricted');

CREATE TABLE wiki_members (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'wiki_editor')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by_email TEXT NOT NULL
);

INSERT INTO wiki_members (email, role, assigned_by_email)
VALUES
  ('jb141598@gmail.com', 'owner', 'system'),
  ('jb14296@gmail.com', 'owner', 'system');

CREATE TABLE wiki_pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  current_revision_id TEXT,
  allow_normal_edits BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_email TEXT NOT NULL,
  updated_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wiki_revisions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  revision_number BIGINT NOT NULL CHECK (revision_number > 0),
  content_json JSONB NOT NULL
    CHECK (jsonb_typeof(content_json) IN ('object', 'array')),
  edit_summary TEXT NOT NULL DEFAULT '' CHECK (char_length(edit_summary) <= 300),
  author_email TEXT NOT NULL,
  author_name TEXT,
  author_role TEXT CHECK (author_role IN ('owner', 'admin', 'wiki_editor', 'contributor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (page_id, revision_number)
);

ALTER TABLE wiki_pages
  ADD CONSTRAINT wiki_pages_current_revision_fk
  FOREIGN KEY (current_revision_id)
  REFERENCES wiki_revisions(id);

CREATE INDEX wiki_pages_updated_at_idx ON wiki_pages (updated_at DESC)
  WHERE is_deleted = FALSE;
CREATE INDEX wiki_revisions_page_created_idx
  ON wiki_revisions (page_id, created_at DESC);
CREATE INDEX wiki_revisions_author_created_idx
  ON wiki_revisions (author_email, created_at DESC);

CREATE TABLE wiki_categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wiki_page_categories (
  page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES wiki_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, category_id)
);

CREATE TABLE wiki_redirects (
  source_slug TEXT PRIMARY KEY
    CHECK (source_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  target_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wiki_media (
  id TEXT PRIMARY KEY,
  blob_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  is_private BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by_email TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wiki_audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  target_email TEXT,
  page_id TEXT REFERENCES wiki_pages(id) ON DELETE SET NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX wiki_audit_log_created_idx ON wiki_audit_log (created_at DESC);

INSERT INTO wiki_pages (
  id,
  slug,
  title,
  current_revision_id,
  allow_normal_edits,
  created_by_email,
  updated_by_email
)
VALUES (
  'page-front-page',
  'front-page',
  'Carbon Frontier Wiki',
  NULL,
  TRUE,
  'system',
  'system'
);

INSERT INTO wiki_revisions (
  id,
  page_id,
  revision_number,
  content_json,
  edit_summary,
  author_email,
  author_name,
  author_role
)
VALUES (
  'revision-front-page-1',
  'page-front-page',
  1,
  '{"type":"document","version":1,"blocks":[{"id":"front-page-intro","type":"paragraph","text":"Welcome to the Carbon Frontier wiki. This database-backed front page is ready for the page editor that will be added in Step 3."}]}'::JSONB,
  'Create the wiki front page',
  'system',
  'Carbon Frontier',
  'owner'
);

UPDATE wiki_pages
SET current_revision_id = 'revision-front-page-1'
WHERE id = 'page-front-page';
