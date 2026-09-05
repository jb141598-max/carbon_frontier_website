ALTER TABLE wiki_media
  ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  ADD COLUMN alt_text TEXT NOT NULL DEFAULT '' CHECK (char_length(alt_text) <= 240),
  ADD COLUMN default_caption TEXT NOT NULL DEFAULT '' CHECK (char_length(default_caption) <= 300),
  ADD COLUMN tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN credit TEXT NOT NULL DEFAULT '' CHECK (char_length(credit) <= 200),
  ADD COLUMN source_url TEXT NOT NULL DEFAULT '' CHECK (char_length(source_url) <= 500),
  ADD COLUMN updated_by_email TEXT,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX wiki_media_uploaded_idx ON wiki_media (uploaded_at DESC, id);
CREATE INDEX wiki_media_title_idx ON wiki_media (LOWER(original_name));
