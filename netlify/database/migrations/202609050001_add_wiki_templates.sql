CREATE TABLE wiki_templates (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  canvas_width INTEGER NOT NULL DEFAULT 720 CHECK (canvas_width BETWEEN 240 AND 1600),
  canvas_height INTEGER NOT NULL DEFAULT 420 CHECK (canvas_height BETWEEN 120 AND 1600),
  current_revision_id TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_email TEXT NOT NULL,
  updated_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wiki_template_revisions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES wiki_templates(id) ON DELETE CASCADE,
  revision_number BIGINT NOT NULL CHECK (revision_number > 0),
  definition_json JSONB NOT NULL CHECK (jsonb_typeof(definition_json) = 'object'),
  edit_summary TEXT NOT NULL DEFAULT '' CHECK (char_length(edit_summary) <= 300),
  author_email TEXT NOT NULL,
  author_name TEXT,
  author_role TEXT CHECK (author_role IN ('owner', 'admin', 'wiki_editor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, revision_number)
);

ALTER TABLE wiki_templates
  ADD CONSTRAINT wiki_templates_current_revision_fk
  FOREIGN KEY (current_revision_id)
  REFERENCES wiki_template_revisions(id);

CREATE INDEX wiki_templates_updated_at_idx
  ON wiki_templates (updated_at DESC)
  WHERE is_deleted = FALSE;

CREATE INDEX wiki_template_revisions_template_created_idx
  ON wiki_template_revisions (template_id, created_at DESC);

INSERT INTO wiki_templates (
  id, slug, name, description, canvas_width, canvas_height,
  current_revision_id, created_by_email, updated_by_email
) VALUES (
  'template-machine-infobox',
  'machine-infobox',
  'Machine Infobox',
  'A reusable information card for Carbon Frontier machines.',
  420,
  560,
  NULL,
  'system',
  'system'
);

INSERT INTO wiki_template_revisions (
  id, template_id, revision_number, definition_json, edit_summary,
  author_email, author_name, author_role
) VALUES (
  'template-machine-infobox-revision-1',
  'template-machine-infobox',
  1,
  '{
    "version": 1,
    "canvas": {"width": 420, "height": 560, "backgroundColor": "#0b0b0b"},
    "elements": [
      {"id":"frame","type":"frame","x":8,"y":8,"width":404,"height":544,"rotation":0,"zIndex":1,"fill":"#111111","stroke":"#df2531","strokeWidth":3,"borderRadius":22,"opacity":1},
      {"id":"header","type":"shape","shape":"rectangle","x":8,"y":8,"width":404,"height":88,"rotation":0,"zIndex":2,"fill":"#8f1922","stroke":"#df2531","strokeWidth":0,"borderRadius":20,"opacity":1},
      {"id":"machine-name","type":"placeholder","placeholderKey":"machine_name","defaultValue":"Machine Name","x":30,"y":29,"width":360,"height":48,"rotation":0,"zIndex":3,"fontFamily":"Play","fontSize":30,"fontWeight":700,"fontStyle":"normal","textAlign":"left","color":"#ffffff","opacity":1},
      {"id":"tier-label","type":"text","text":"TIER","x":30,"y":126,"width":120,"height":24,"rotation":0,"zIndex":3,"fontFamily":"Play","fontSize":13,"fontWeight":700,"fontStyle":"normal","textAlign":"left","color":"#ff9ba2","opacity":1},
      {"id":"tier-value","type":"placeholder","placeholderKey":"tier","defaultValue":"Tier 1","x":30,"y":154,"width":360,"height":35,"rotation":0,"zIndex":3,"fontFamily":"Play","fontSize":22,"fontWeight":400,"fontStyle":"normal","textAlign":"left","color":"#ffffff","opacity":1},
      {"id":"category-label","type":"text","text":"CATEGORY","x":30,"y":214,"width":160,"height":24,"rotation":0,"zIndex":3,"fontFamily":"Play","fontSize":13,"fontWeight":700,"fontStyle":"normal","textAlign":"left","color":"#ff9ba2","opacity":1},
      {"id":"category-value","type":"placeholder","placeholderKey":"category","defaultValue":"Processing","x":30,"y":242,"width":360,"height":35,"rotation":0,"zIndex":3,"fontFamily":"Play","fontSize":22,"fontWeight":400,"fontStyle":"normal","textAlign":"left","color":"#ffffff","opacity":1},
      {"id":"description-label","type":"text","text":"DESCRIPTION","x":30,"y":310,"width":180,"height":24,"rotation":0,"zIndex":3,"fontFamily":"Play","fontSize":13,"fontWeight":700,"fontStyle":"normal","textAlign":"left","color":"#ff9ba2","opacity":1},
      {"id":"description-value","type":"placeholder","placeholderKey":"description","defaultValue":"Describe what this machine does.","x":30,"y":342,"width":360,"height":150,"rotation":0,"zIndex":3,"fontFamily":"Play","fontSize":18,"fontWeight":400,"fontStyle":"normal","textAlign":"left","color":"#e6e6e6","opacity":1}
    ]
  }'::JSONB,
  'Create starter Machine Infobox template',
  'system',
  'Carbon Frontier',
  'owner'
);

UPDATE wiki_templates
SET current_revision_id = 'template-machine-infobox-revision-1'
WHERE id = 'template-machine-infobox';
