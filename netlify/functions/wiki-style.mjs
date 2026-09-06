import { getDatabase } from "@netlify/database";
import {
  createViewer,
  insertAuditEntry,
  json,
  loadAccessState,
  verifyGoogleRequest,
  verifyMutationOrigin,
} from "./_shared/wiki-security.mjs";

const db = getDatabase();
const FONT_FAMILIES = new Set([
  "Play",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Courier New",
]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const config = { path: "/api/wiki/style" };

const CLASSIC_CONFIG = Object.freeze({
  accentColor: "#df2531",
  accentSoftColor: "#ff9ba2",
  linkColor: "#ff929a",
  textColor: "#ffffff",
  articleTextColor: "#d1d1d1",
  mutedTextColor: "#b3b3b3",
  softTextColor: "#7a7a7a",
  backgroundTop: "#080808",
  backgroundMiddle: "#000000",
  backgroundBottom: "#050505",
  panelColor: "#ffffff",
  panelOpacity: 0.045,
  panelStrongOpacity: 0.075,
  articleColor: "#080808",
  articleOpacity: 0.9,
  borderColor: "#ffffff",
  borderOpacity: 0.12,
  gridEnabled: true,
  gridSize: 96,
  gridOpacity: 0.035,
  glowEnabled: true,
  glowStrength: 0.24,
  secondaryGlowStrength: 0.15,
  shadowOpacity: 0.44,
  fontFamily: "Play",
  baseFontSize: 16,
  articleLineHeight: 1.65,
  headingWeight: 700,
  contentMaxWidth: 1240,
  pagePadding: 28,
  articleRadius: 28,
  articlePadding: 48,
  linkUnderline: false,
});

function cleanText(value, maximum) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function color(value, fallback) {
  const candidate = String(value || "").trim().toLowerCase();
  return HEX_COLOR.test(candidate) ? candidate : fallback;
}

function number(value, minimum, maximum, fallback) {
  const candidate = Number(value);
  return Number.isFinite(candidate)
    ? Math.min(maximum, Math.max(minimum, candidate))
    : fallback;
}

function integer(value, minimum, maximum, fallback) {
  return Math.round(number(value, minimum, maximum, fallback));
}

function normalizeConfig(raw = {}) {
  return {
    accentColor: color(raw.accentColor, CLASSIC_CONFIG.accentColor),
    accentSoftColor: color(raw.accentSoftColor, CLASSIC_CONFIG.accentSoftColor),
    linkColor: color(raw.linkColor, CLASSIC_CONFIG.linkColor),
    textColor: color(raw.textColor, CLASSIC_CONFIG.textColor),
    articleTextColor: color(raw.articleTextColor, CLASSIC_CONFIG.articleTextColor),
    mutedTextColor: color(raw.mutedTextColor, CLASSIC_CONFIG.mutedTextColor),
    softTextColor: color(raw.softTextColor, CLASSIC_CONFIG.softTextColor),
    backgroundTop: color(raw.backgroundTop, CLASSIC_CONFIG.backgroundTop),
    backgroundMiddle: color(raw.backgroundMiddle, CLASSIC_CONFIG.backgroundMiddle),
    backgroundBottom: color(raw.backgroundBottom, CLASSIC_CONFIG.backgroundBottom),
    panelColor: color(raw.panelColor, CLASSIC_CONFIG.panelColor),
    panelOpacity: number(raw.panelOpacity, 0, 0.4, CLASSIC_CONFIG.panelOpacity),
    panelStrongOpacity: number(raw.panelStrongOpacity, 0, 0.55, CLASSIC_CONFIG.panelStrongOpacity),
    articleColor: color(raw.articleColor, CLASSIC_CONFIG.articleColor),
    articleOpacity: number(raw.articleOpacity, 0.55, 1, CLASSIC_CONFIG.articleOpacity),
    borderColor: color(raw.borderColor, CLASSIC_CONFIG.borderColor),
    borderOpacity: number(raw.borderOpacity, 0, 0.55, CLASSIC_CONFIG.borderOpacity),
    gridEnabled: raw.gridEnabled !== false,
    gridSize: integer(raw.gridSize, 32, 180, CLASSIC_CONFIG.gridSize),
    gridOpacity: number(raw.gridOpacity, 0, 0.16, CLASSIC_CONFIG.gridOpacity),
    glowEnabled: raw.glowEnabled !== false,
    glowStrength: number(raw.glowStrength, 0, 0.55, CLASSIC_CONFIG.glowStrength),
    secondaryGlowStrength: number(
      raw.secondaryGlowStrength,
      0,
      0.45,
      CLASSIC_CONFIG.secondaryGlowStrength
    ),
    shadowOpacity: number(raw.shadowOpacity, 0, 0.8, CLASSIC_CONFIG.shadowOpacity),
    fontFamily: FONT_FAMILIES.has(raw.fontFamily) ? raw.fontFamily : CLASSIC_CONFIG.fontFamily,
    baseFontSize: integer(raw.baseFontSize, 13, 22, CLASSIC_CONFIG.baseFontSize),
    articleLineHeight: number(raw.articleLineHeight, 1.25, 2.1, CLASSIC_CONFIG.articleLineHeight),
    headingWeight: Number(raw.headingWeight) >= 700 ? 700 : 400,
    contentMaxWidth: integer(raw.contentMaxWidth, 760, 1800, CLASSIC_CONFIG.contentMaxWidth),
    pagePadding: integer(raw.pagePadding, 10, 64, CLASSIC_CONFIG.pagePadding),
    articleRadius: integer(raw.articleRadius, 0, 56, CLASSIC_CONFIG.articleRadius),
    articlePadding: integer(raw.articlePadding, 16, 84, CLASSIC_CONFIG.articlePadding),
    linkUnderline: raw.linkUnderline === true,
  };
}

function styleFromRow(row, activeStyleId = "") {
  return {
    id: row.id,
    name: row.name,
    config: normalizeConfig(row.config_json || {}),
    isActive: row.id === activeStyleId,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    createdBy: row.created_by_email || null,
    updatedBy: row.updated_by_email || null,
  };
}

async function loadActiveStyle(client) {
  const result = await client.query(
    `SELECT s.*, state.active_style_id, state.updated_at AS active_updated_at,
            state.updated_by_email AS active_updated_by
     FROM wiki_style_settings state
     INNER JOIN wiki_styles s ON s.id = state.active_style_id
     WHERE state.id = 1`
  );
  const row = result.rows[0];
  if (!row) {
    return {
      id: "style-carbon-frontier-classic",
      name: "Carbon Frontier Classic",
      config: { ...CLASSIC_CONFIG },
      isActive: true,
      updatedAt: null,
    };
  }
  return styleFromRow(row, row.active_style_id);
}

async function requireManager(request, client) {
  const auth = await verifyGoogleRequest(request);
  if (!auth.ok) return { response: json({ error: auth.message }, auth.status) };
  const access = await loadAccessState(client);
  const viewer = createViewer(access, auth.account);
  if (!viewer.canManageSettings) {
    return {
      response: json({ error: "Only wiki owners and admins can manage wiki styles." }, 403),
    };
  }
  return { account: auth.account, viewer };
}

async function managementPayload(client, viewer) {
  const stateResult = await client.query(
    `SELECT active_style_id, updated_at, updated_by_email
     FROM wiki_style_settings WHERE id = 1`
  );
  const activeStyleId = stateResult.rows[0]?.active_style_id || "";
  const stylesResult = await client.query(
    `SELECT id, name, config_json, created_by_email, updated_by_email, created_at, updated_at
     FROM wiki_styles
     ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC, name ASC`,
    [activeStyleId]
  );
  return {
    ok: true,
    viewer,
    activeStyleId,
    activeUpdatedAt: stateResult.rows[0]?.updated_at
      ? new Date(stateResult.rows[0].updated_at).toISOString()
      : null,
    activeUpdatedBy: stateResult.rows[0]?.updated_by_email || null,
    styles: stylesResult.rows.map((row) => styleFromRow(row, activeStyleId)),
  };
}

async function mutateStyle(client, account, body) {
  const action = String(body?.action || "").trim();

  if (action === "create_style") {
    const name = cleanText(body?.name, 80);
    if (!name) return { status: 400, error: "Enter a style name." };
    const id = `style-${crypto.randomUUID()}`;
    const config = normalizeConfig(body?.config || {});
    await client.query(
      `INSERT INTO wiki_styles (
         id, name, config_json, created_by_email, updated_by_email
       ) VALUES ($1, $2, $3::jsonb, $4, $4)`,
      [id, name, JSON.stringify(config), account.email]
    );
    await insertAuditEntry(client, {
      action: "wiki_style_created",
      actorEmail: account.email,
      details: { styleId: id, name },
    });
    return { status: 201, result: { styleId: id } };
  }

  if (action === "update_style") {
    const id = cleanText(body?.styleId, 100);
    const name = cleanText(body?.name, 80);
    if (!id || !name) return { status: 400, error: "Choose a style and enter a name." };
    const exists = await client.query(`SELECT 1 FROM wiki_styles WHERE id = $1 FOR UPDATE`, [id]);
    if (!exists.rowCount) return { status: 404, error: "That wiki style no longer exists." };
    const config = normalizeConfig(body?.config || {});
    await client.query(
      `UPDATE wiki_styles
       SET name = $2, config_json = $3::jsonb, updated_by_email = $4, updated_at = NOW()
       WHERE id = $1`,
      [id, name, JSON.stringify(config), account.email]
    );
    await insertAuditEntry(client, {
      action: "wiki_style_updated",
      actorEmail: account.email,
      details: { styleId: id, name },
    });
    return { status: 200, result: { styleId: id } };
  }

  if (action === "activate_style") {
    const id = cleanText(body?.styleId, 100);
    const style = await client.query(`SELECT name FROM wiki_styles WHERE id = $1`, [id]);
    if (!style.rowCount) return { status: 404, error: "That wiki style no longer exists." };
    await client.query(
      `UPDATE wiki_style_settings
       SET active_style_id = $1, updated_at = NOW(), updated_by_email = $2
       WHERE id = 1`,
      [id, account.email]
    );
    await insertAuditEntry(client, {
      action: "wiki_style_activated",
      actorEmail: account.email,
      details: { styleId: id, name: style.rows[0].name },
    });
    return { status: 200, result: { styleId: id } };
  }

  if (action === "delete_style") {
    const id = cleanText(body?.styleId, 100);
    const state = await client.query(
      `SELECT active_style_id FROM wiki_style_settings WHERE id = 1 FOR UPDATE`
    );
    if (state.rows[0]?.active_style_id === id) {
      return { status: 409, error: "Activate a different style before deleting this one." };
    }
    const count = await client.query(`SELECT COUNT(*)::INTEGER AS count FROM wiki_styles`);
    if (Number(count.rows[0]?.count || 0) <= 1) {
      return { status: 409, error: "The wiki must keep at least one style." };
    }
    const deleted = await client.query(
      `DELETE FROM wiki_styles WHERE id = $1 RETURNING name`,
      [id]
    );
    if (!deleted.rowCount) return { status: 404, error: "That wiki style no longer exists." };
    await insertAuditEntry(client, {
      action: "wiki_style_deleted",
      actorEmail: account.email,
      details: { styleId: id, name: deleted.rows[0].name },
    });
    return { status: 200, result: { styleId: id } };
  }

  return { status: 400, error: "Unknown wiki style action." };
}

export default async function handler(request) {
  const client = await db.pool.connect();
  let transaction = false;
  let committed = false;
  try {
    if (request.method === "GET") {
      const manage = new URL(request.url).searchParams.get("manage") === "1";
      if (!manage) {
        return json({ ok: true, style: await loadActiveStyle(client) });
      }
      const manager = await requireManager(request, client);
      if (manager.response) return manager.response;
      return json(await managementPayload(client, manager.viewer));
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }
    if (!verifyMutationOrigin(request)) {
      return json({ error: "Cross-site wiki style request blocked." }, 403);
    }

    const manager = await requireManager(request, client);
    if (manager.response) return manager.response;
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: "Request body must be valid JSON." }, 400);

    await client.query("BEGIN");
    transaction = true;
    const mutation = await mutateStyle(client, manager.account, body);
    if (mutation.error) return json({ error: mutation.error }, mutation.status);
    await client.query("COMMIT");
    committed = true;

    return json({
      ...(await managementPayload(client, manager.viewer)),
      mutation: mutation.result,
    }, mutation.status === 201 ? 201 : 200);
  } catch (error) {
    if (error?.code === "23505") {
      return json({ error: "A wiki style already uses that name." }, 409);
    }
    console.error("wiki-style failed", error);
    return json({ error: "The wiki style service could not complete this request." }, 500);
  } finally {
    if (transaction && !committed) {
      await client.query("ROLLBACK").catch(() => {});
    }
    client.release();
  }
}
