import { getDatabase } from "@netlify/database";
import {
  createViewer, insertAuditEntry, json, loadAccessState,
  verifyGoogleRequest, verifyMutationOrigin,
} from "./_shared/wiki-security.mjs";

const db = getDatabase();
const ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;

function cleanCategoryName(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 80);
}
function categorySlug(name) {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
function validId(value) {
  return ID_PATTERN.test(String(value || ""));
}
async function categoryById(client, id, lock = false) {
  const found = await client.query(
    "SELECT id, name, slug FROM wiki_categories WHERE id = $1" + (lock ? " FOR UPDATE" : ""),
    [id]
  );
  return found.rows[0] || null;
}
async function viewCategory(client, id) {
  const category = await categoryById(client, id);
  if (!category) return null;
  const pages = await client.query(
    "SELECT p.id, p.slug, p.title FROM wiki_page_categories pc " +
    "JOIN wiki_pages p ON p.id = pc.page_id WHERE pc.category_id = $1 " +
    "AND p.is_deleted = FALSE ORDER BY p.title ASC, p.slug ASC LIMIT 1000",
    [id]
  );
  return { ...category, pages: pages.rows };
}
async function handleGet(request, account) {
  const client = await db.pool.connect();
  try {
    const state = await loadAccessState(client);
    const viewer = createViewer(state, account);
    if (!viewer.canView) {
      return json({ error: "This wiki is private. Sign in with an authorized account to view categories." }, 403);
    }
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      if (!validId(id)) return json({ error: "Invalid category ID." }, 400);
      const category = await viewCategory(client, id);
      return category ? json({ ok: true, category }) : json({ error: "Category not found." }, 404);
    }
    const rows = await client.query(
      "SELECT c.id, c.slug, c.name, COUNT(p.id)::int AS page_count " +
      "FROM wiki_categories c " +
      "LEFT JOIN wiki_page_categories pc ON pc.category_id = c.id " +
      "LEFT JOIN wiki_pages p ON p.id = pc.page_id AND p.is_deleted = FALSE " +
      "GROUP BY c.id, c.slug, c.name ORDER BY LOWER(c.name), c.name LIMIT 1000"
    );
    return json({ ok: true, categories: rows.rows, viewer: { role: viewer.role, canManage: viewer.authenticated && viewer.isAssignedStaff } });
  } finally {
    client.release();
  }
}
async function handlePost(request, account) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Provide a valid JSON request." }, 400); }
  const action = String(body?.action || "");
  const id = String(body?.id || "");
  if (!validId(id) || !["rename", "merge", "delete", "detach"].includes(action)) {
    return json({ error: "Specify a valid category and action." }, 400);
  }
  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const state = await loadAccessState(client);
    const viewer = createViewer(state, account);
    if (!viewer.authenticated || !viewer.isAssignedStaff) {
      return json({ error: "Only signed-in assigned wiki staff can modify categories." }, 403);
    }
    const category = await categoryById(client, id, true);
    if (!category) return json({ error: "That category no longer exists." }, 404);
    let result = { id: category.id, name: category.name, slug: category.slug };
    if (action === "rename") {
      const name = cleanCategoryName(body.name), slug = categorySlug(name);
      if (!name || !slug) return json({ error: "Enter a valid category name." }, 400);
      const duplicate = await client.query(
        "SELECT id FROM wiki_categories WHERE (slug = $1 OR LOWER(name) = LOWER($2)) AND id <> $3 LIMIT 1",
        [slug, name, id]
      );
      if (duplicate.rowCount) {
        return json({ error: "That category already exists. Use Merge instead." }, 409);
      }
      await client.query("UPDATE wiki_categories SET name = $1, slug = $2 WHERE id = $3", [name, slug, id]);
      result = { id, name, slug };
    } else if (action === "merge") {
      const targetId = String(body.targetId || "");
      if (!validId(targetId) || targetId === id) {
        return json({ error: "Choose a different destination category." }, 400);
      }
      const target = await categoryById(client, targetId, true);
      if (!target) return json({ error: "The destination category no longer exists." }, 404);
      const inserted = await client.query(
        "INSERT INTO wiki_page_categories (page_id, category_id) " +
        "SELECT page_id, $1 FROM wiki_page_categories WHERE category_id = $2 " +
        "ON CONFLICT DO NOTHING RETURNING page_id",
        [targetId, id]
      );
      await client.query("DELETE FROM wiki_categories WHERE id = $1", [id]);
      result = { ...target, mergedFrom: category.name, addedPages: inserted.rowCount || 0 };
    } else if (action === "delete") {
      if (String(body.confirmName || "") !== category.name) {
        return json({ error: "Please confirm the exact category name before deleting." }, 400);
      }
      const count = await client.query(
        "SELECT COUNT(*)::int AS count FROM wiki_page_categories WHERE category_id = $1",
        [id]
      );
      await client.query("DELETE FROM wiki_categories WHERE id = $1", [id]);
      result = { deleted: category.name, detachedPages: Number(count.rows[0]?.count) || 0 };
    } else if (action === "detach") {
      const pageId = String(body.pageId || "");
      if (!validId(pageId)) return json({ error: "Select a page to remove from this category." }, 400);
      const removed = await client.query(
        "DELETE FROM wiki_page_categories WHERE category_id = $1 AND page_id = $2 RETURNING page_id",
        [id, pageId]
      );
      if (!removed.rowCount) return json({ error: "That page is not assigned to this category." }, 404);
      result = { id, removedPageId: pageId };
    }
    await insertAuditEntry(client, {
      action: "wiki_category_" + action, actorEmail: account.email,
      details: { categoryId: id, categoryName: category.name, ...result },
    });
    await client.query("COMMIT");
    committed = true;
    return json({ ok: true, result });
  } catch (error) {
    if (error?.code === "23505") return json({ error: "A category with that name already exists. Try Merge." }, 409);
    throw error;
  } finally {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
export default async function handler(request) {
  try {
    if (request.method === "GET") {
      const auth = await verifyGoogleRequest(request, { optional: true });
      if (!auth.ok) return json({ error: auth.message }, auth.status);
      return handleGet(request, auth.account);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (!verifyMutationOrigin(request)) return json({ error: "Cross-site category modification blocked." }, 403);
    const auth = await verifyGoogleRequest(request);
    if (!auth.ok) return json({ error: auth.message }, auth.status);
    return handlePost(request, auth.account);
  } catch (error) {
    console.error("wiki-categories failed", error);
    return json({ error: "The wiki category service could not complete the request." }, 500);
  }
}
