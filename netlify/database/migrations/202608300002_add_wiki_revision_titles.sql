ALTER TABLE wiki_revisions
  ADD COLUMN IF NOT EXISTS page_title TEXT;

UPDATE wiki_revisions r
SET page_title = p.title
FROM wiki_pages p
WHERE r.page_id = p.id
  AND r.page_title IS NULL;

ALTER TABLE wiki_revisions
  ALTER COLUMN page_title SET NOT NULL;

ALTER TABLE wiki_revisions
  ADD CONSTRAINT wiki_revisions_page_title_length
  CHECK (char_length(page_title) BETWEEN 1 AND 120);
