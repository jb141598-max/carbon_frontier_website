import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";

import {
  createViewer,
  loadAccessState,
  verifyGoogleRequest,
  verifyMutationOrigin,
} from "./_shared/wiki-security.mjs";
const ROADMAP_STORE_NAME = "carbon-frontier-roadmap";
const ROADMAP_STORE_KEY = "shared-state";


const db = getDatabase();

export const config = {
  path: "/api/roadmap",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeBullet(bullet) {
  if (typeof bullet === "string") {
    const text = bullet.trim();
    return text ? { text, status: "NONE" } : null;
  }

  const text = String(bullet?.text || "").trim();
  if (!text) {
    return null;
  }

  const status = ["PLANNED", "IN PROGRESS", "FINISHED", "NONE"].includes(String(bullet?.status || "").trim())
    ? String(bullet.status).trim()
    : "NONE";

  return { text, status };
}

function normalizeCard(card) {
  const status = ["PLANNED", "IN PROGRESS", "FINISHED"].includes(String(card?.status || "").trim())
    ? String(card.status).trim()
    : "PLANNED";
  const bullets = Array.isArray(card?.bullets) ? card.bullets.map(normalizeBullet).filter(Boolean) : [];
  const manualOrder = Number.isFinite(Number(card?.manualOrder)) ? Number(card.manualOrder) : null;

  return {
    id: String(card?.id || "").trim() || crypto.randomUUID(),
    title: String(card?.title || "").trim(),
    description: String(card?.description || "").trim(),
    imagePath: String(card?.imagePath || "").trim(),
    date: String(card?.date || "").trim(),
    status,
    manualOrder,
    bullets,
  };
}

function normalizeState(payload) {
  const cards = Array.isArray(payload?.cards)
    ? payload.cards.map(normalizeCard).filter((card) => card.title && card.description)
    : [];

  return {
    cards,
    orderMode: payload?.orderMode === "manual" ? "manual" : "date",
  };
}

async function verifyAdminRequest(request) {
  const auth = await verifyGoogleRequest(request);
  if (!auth.ok) {
    return { ok: false, status: auth.status || 401, message: auth.message };
  }

  const client = await db.pool.connect();
  try {
    const accessState = await loadAccessState(client);
    const viewer = createViewer(accessState, auth.account);
    if (!viewer.canManageSettings) {
      return {
        ok: false,
        status: 403,
        message: "Only Carbon Frontier owners and admins can manage the roadmap.",
      };
    }

    return {
      ok: true,
      status: 200,
      email: auth.account.email,
      role: viewer.role,
      authMethod: auth.account.authMethod || "google",
    };
  } finally {
    client.release();
  }
}

export default async function handler(request) {
  const store = getStore({ name: ROADMAP_STORE_NAME, consistency: "strong" });

  if (request.method === "GET") {
    const storedState = await store.get(ROADMAP_STORE_KEY, { type: "json" });
    const normalizedState = normalizeState(storedState);

    return json({
      exists: storedState !== null,
      source: "netlify-blobs",
      ...normalizedState,
      updatedAt: storedState?.updatedAt || null,
      updatedBy: storedState?.updatedBy || null,
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  if (!verifyMutationOrigin(request)) {
    return json({ error: "Cross-site admin request blocked." }, 403);
  }

  const auth = await verifyAdminRequest(request);
  if (!auth.ok) {
    return json({ error: auth.message }, auth.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const normalizedState = normalizeState(body);
  const nextState = {
    ...normalizedState,
    updatedAt: new Date().toISOString(),
    updatedBy: auth.email,
  };

  await store.setJSON(ROADMAP_STORE_KEY, nextState);

  return json({
    ok: true,
    source: "netlify-blobs",
    ...nextState,
  });
}
