CREATE TABLE wiki_styles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 80),
  config_json JSONB NOT NULL CHECK (jsonb_typeof(config_json) = 'object'),
  created_by_email TEXT NOT NULL,
  updated_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wiki_style_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  active_style_id TEXT NOT NULL REFERENCES wiki_styles(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_email TEXT NOT NULL
);

CREATE INDEX wiki_styles_updated_at_idx ON wiki_styles (updated_at DESC);

INSERT INTO wiki_styles (
  id, name, config_json, created_by_email, updated_by_email
) VALUES
(
  'style-carbon-frontier-classic',
  'Carbon Frontier Classic',
  '{
    "accentColor":"#df2531",
    "accentSoftColor":"#ff9ba2",
    "linkColor":"#ff929a",
    "textColor":"#ffffff",
    "articleTextColor":"#d1d1d1",
    "mutedTextColor":"#b3b3b3",
    "softTextColor":"#7a7a7a",
    "backgroundTop":"#080808",
    "backgroundMiddle":"#000000",
    "backgroundBottom":"#050505",
    "panelColor":"#ffffff",
    "panelOpacity":0.045,
    "panelStrongOpacity":0.075,
    "articleColor":"#080808",
    "articleOpacity":0.9,
    "borderColor":"#ffffff",
    "borderOpacity":0.12,
    "gridEnabled":true,
    "gridSize":96,
    "gridOpacity":0.035,
    "glowEnabled":true,
    "glowStrength":0.24,
    "secondaryGlowStrength":0.15,
    "shadowOpacity":0.44,
    "fontFamily":"Play",
    "baseFontSize":16,
    "articleLineHeight":1.65,
    "headingWeight":700,
    "contentMaxWidth":1240,
    "pagePadding":28,
    "articleRadius":28,
    "articlePadding":48,
    "linkUnderline":false
  }'::JSONB,
  'system',
  'system'
),
(
  'style-foundry-dark',
  'Foundry Dark',
  '{
    "accentColor":"#f08c2b",
    "accentSoftColor":"#ffc27f",
    "linkColor":"#ffc27f",
    "textColor":"#fffaf4",
    "articleTextColor":"#e0d7ce",
    "mutedTextColor":"#b9ada2",
    "softTextColor":"#80766e",
    "backgroundTop":"#120d09",
    "backgroundMiddle":"#050403",
    "backgroundBottom":"#0b0806",
    "panelColor":"#f7c79d",
    "panelOpacity":0.05,
    "panelStrongOpacity":0.09,
    "articleColor":"#0b0806",
    "articleOpacity":0.94,
    "borderColor":"#f7c79d",
    "borderOpacity":0.14,
    "gridEnabled":true,
    "gridSize":88,
    "gridOpacity":0.03,
    "glowEnabled":true,
    "glowStrength":0.2,
    "secondaryGlowStrength":0.1,
    "shadowOpacity":0.5,
    "fontFamily":"Play",
    "baseFontSize":16,
    "articleLineHeight":1.68,
    "headingWeight":700,
    "contentMaxWidth":1240,
    "pagePadding":28,
    "articleRadius":22,
    "articlePadding":48,
    "linkUnderline":false
  }'::JSONB,
  'system',
  'system'
),
(
  'style-midnight-grid',
  'Midnight Grid',
  '{
    "accentColor":"#4f83ff",
    "accentSoftColor":"#8fb0ff",
    "linkColor":"#8fb0ff",
    "textColor":"#ffffff",
    "articleTextColor":"#d5dcf0",
    "mutedTextColor":"#aeb8d0",
    "softTextColor":"#75809a",
    "backgroundTop":"#07101f",
    "backgroundMiddle":"#02050b",
    "backgroundBottom":"#050914",
    "panelColor":"#9db8ff",
    "panelOpacity":0.045,
    "panelStrongOpacity":0.08,
    "articleColor":"#050914",
    "articleOpacity":0.94,
    "borderColor":"#9db8ff",
    "borderOpacity":0.13,
    "gridEnabled":true,
    "gridSize":72,
    "gridOpacity":0.04,
    "glowEnabled":true,
    "glowStrength":0.2,
    "secondaryGlowStrength":0.12,
    "shadowOpacity":0.5,
    "fontFamily":"Play",
    "baseFontSize":16,
    "articleLineHeight":1.67,
    "headingWeight":700,
    "contentMaxWidth":1280,
    "pagePadding":28,
    "articleRadius":24,
    "articlePadding":48,
    "linkUnderline":false
  }'::JSONB,
  'system',
  'system'
);

INSERT INTO wiki_style_settings (id, active_style_id, updated_by_email)
VALUES (1, 'style-carbon-frontier-classic', 'system');
