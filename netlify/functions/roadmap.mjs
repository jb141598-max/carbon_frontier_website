import { getStore } from "@netlify/blobs";
import { OAuth2Client } from "google-auth-library";

const ADMIN_ACCOUNTS = new Set(["jb141598@gmail.com", "jb14296@gmail.com"]);
const DEFAULT_GOOGLE_CLIENT_ID =
  "609911855152-3q1n4oiiaaokhq0lrr0blf1bdif6ev6q.apps.googleusercontent.com";
const ROADMAP_STORE_NAME = "carbon-frontier-roadmap";
const ROADMAP_STORE_KEY = "shared-state";

const googleClient = new OAuth2Client();

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
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!idToken) {
    return { ok: false, message: "Missing Google ID token." };
  }

  const audience =
    globalThis.Netlify?.env?.get("GOOGLE_CLIENT_ID") ||
    process.env.GOOGLE_CLIENT_ID ||
    DEFAULT_GOOGLE_CLIENT_ID;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience,
    });
    const payload = ticket.getPayload();
    const email = normalizeEmail(payload?.email);

    if (!email || payload?.email_verified === false) {
      return { ok: false, message: "Google account could not be verified." };
    }

    if (!ADMIN_ACCOUNTS.has(email)) {
      return { ok: false, message: "This email is not allowed to edit the roadmap." };
    }

    return { ok: true, email };
  } catch (error) {
    return { ok: false, message: "Google sign-in token is invalid or expired." };
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

  const auth = await verifyAdminRequest(request);
  if (!auth.ok) {
    return json({ error: auth.message }, 401);
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
