import { getDatabase } from "@netlify/database";
import {
  createHmac,
  randomInt,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  createWikiSessionToken,
  getEnvironmentValue,
  isValidEmail,
  json,
  normalizeEmail,
  verifyMutationOrigin,
} from "./_shared/wiki-security.mjs";

const db = getDatabase();
const scrypt = promisify(scryptCallback);

const CODE_TTL_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 6;
const CODE_RESEND_SECONDS = 60;
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_LOCK_MINUTES = 15;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 128;
const SESSION_LIFETIME_SECONDS = 60 * 60 * 12;

export const config = {
  path: "/api/wiki-auth",
};

function passwordError(password) {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  return "";
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(String(password), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    "16384",
    "8",
    "1",
    salt.toString("base64url"),
    Buffer.from(derived).toString("base64url"),
  ].join("$");
}

async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (!N || !r || !p || !salt.length || !expected.length) return false;

  const actual = Buffer.from(
    await scrypt(String(password), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    })
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getAuthSecret() {
  const secret = String(getEnvironmentValue("WIKI_AUTH_SECRET") || "").trim();
  if (secret.length < 32) {
    throw new Error("WIKI_AUTH_SECRET is missing or too short.");
  }
  return secret;
}

function hashVerificationCode(email, purpose, code) {
  return createHmac("sha256", getAuthSecret())
    .update(`${normalizeEmail(email)}:${purpose}:${String(code || "").trim()}`)
    .digest("base64url");
}

function createVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function safeCompare(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function purposeCopy(purpose) {
  return purpose === "reset"
    ? {
        subject: "Reset your Carbon Frontier wiki password",
        heading: "Password reset code",
        intro: "Use this code to reset your Carbon Frontier wiki password.",
      }
    : {
        subject: "Verify your Carbon Frontier wiki account",
        heading: "Verification code",
        intro: "Use this code to finish creating your Carbon Frontier wiki account.",
      };
}

async function sendVerificationEmail(email, code, purpose) {
  const apiKey = String(getEnvironmentValue("RESEND_API_KEY") || "").trim();
  const from = String(
    getEnvironmentValue("WIKI_AUTH_FROM_EMAIL") ||
      "Carbon Frontier <noreply@carbonfrontier.org>"
  ).trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");

  const copy = purposeCopy(purpose);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Carbon-Frontier-Wiki/1.0",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: copy.subject,
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#111114;color:#f5f5f5;padding:32px;line-height:1.5">
          <div style="max-width:560px;margin:0 auto;background:#19191e;border:1px solid #34343c;border-radius:16px;padding:28px">
            <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#df2531;font-weight:700">Carbon Frontier Wiki</div>
            <h1 style="font-size:24px;margin:10px 0 12px">${escapeHtml(copy.heading)}</h1>
            <p style="color:#cfcfd5;margin:0 0 22px">${escapeHtml(copy.intro)}</p>
            <div style="font-size:36px;letter-spacing:.18em;font-weight:700;background:#0f0f12;border:1px solid #3a3a43;border-radius:12px;padding:18px 20px;text-align:center">${escapeHtml(code)}</div>
            <p style="color:#aaaab3;font-size:13px;margin:20px 0 0">This code expires in ${CODE_TTL_MINUTES} minutes. If you did not request it, you can ignore this email.</p>
          </div>
        </div>
      `,
      text: `Carbon Frontier Wiki\n\n${copy.intro}\n\nCode: ${code}\n\nThis code expires in ${CODE_TTL_MINUTES} minutes.`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Resend rejected wiki auth email", response.status, detail.slice(0, 1000));

    let resendType = "";
    let resendMessage = "";
    try {
      const parsed = JSON.parse(detail);
      resendType = String(parsed?.name || parsed?.type || "").trim();
      resendMessage = String(parsed?.message || "").trim();
    } catch (error) {}

    const combined = `${resendType} ${resendMessage}`.toLowerCase();
    if (combined.includes("invalid_api_key") || combined.includes("api key is invalid")) {
      throw new Error("RESEND_INVALID_API_KEY");
    }
    if (combined.includes("not verified") || combined.includes("domain mismatch")) {
      throw new Error("RESEND_DOMAIN_MISMATCH");
    }
    if (combined.includes("rate_limit") || response.status === 429) {
      throw new Error("RESEND_RATE_LIMIT");
    }
    if (combined.includes("quota") || combined.includes("monthly_quota") || combined.includes("daily_quota")) {
      throw new Error("RESEND_QUOTA");
    }
    if (combined.includes("1010")) {
      throw new Error("RESEND_USER_AGENT");
    }

    throw new Error(`Verification email could not be sent. Resend status ${response.status}.`);
  }
}

async function issueCode(client, { email, purpose, pendingPasswordHash = null }) {
  const existing = await client.query(
    `SELECT sent_at
     FROM wiki_email_codes
     WHERE email = $1 AND purpose = $2`,
    [email, purpose]
  );
  const sentAt = existing.rows[0]?.sent_at
    ? new Date(existing.rows[0].sent_at).getTime()
    : 0;
  const secondsSince = (Date.now() - sentAt) / 1000;
  if (sentAt && secondsSince < CODE_RESEND_SECONDS) {
    return {
      ok: false,
      status: 429,
      error: `Please wait ${Math.ceil(CODE_RESEND_SECONDS - secondsSince)} seconds before sending another code.`,
    };
  }

  const code = createVerificationCode();
  const codeHash = hashVerificationCode(email, purpose, code);
  await client.query(
    `INSERT INTO wiki_email_codes (
       email, purpose, code_hash, pending_password_hash, expires_at, sent_at, attempts
     ) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '${CODE_TTL_MINUTES} minutes', NOW(), 0)
     ON CONFLICT (email, purpose) DO UPDATE
     SET code_hash = EXCLUDED.code_hash,
         pending_password_hash = EXCLUDED.pending_password_hash,
         expires_at = EXCLUDED.expires_at,
         sent_at = EXCLUDED.sent_at,
         attempts = 0`,
    [email, purpose, codeHash, pendingPasswordHash]
  );

  try {
    await sendVerificationEmail(email, code, purpose);
    return { ok: true };
  } catch (error) {
    await client.query(
      `DELETE FROM wiki_email_codes
       WHERE email = $1 AND purpose = $2 AND code_hash = $3`,
      [email, purpose, codeHash]
    ).catch(() => {});
    throw error;
  }
}

async function startRegistration(client, body) {
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || "");
  if (!isValidEmail(email)) return { status: 400, error: "Enter a valid email address." };
  const invalidPassword = passwordError(password);
  if (invalidPassword) return { status: 400, error: invalidPassword };

  const existing = await client.query(
    `SELECT email, email_verified_at
     FROM wiki_accounts
     WHERE email = $1`,
    [email]
  );
  if (existing.rows[0]?.email_verified_at) {
    return { status: 409, error: "An account with this email already exists. Sign in instead." };
  }

  const pendingPasswordHash = await hashPassword(password);
  const issued = await issueCode(client, {
    email,
    purpose: "register",
    pendingPasswordHash,
  });
  if (!issued.ok) return issued;
  return {
    status: 200,
    data: {
      ok: true,
      step: "verify",
      email,
      message: `We sent a 6-digit verification code to ${email}.`,
    },
  };
}

async function verifyCodeRow(client, email, purpose, code) {
  const result = await client.query(
    `SELECT code_hash, pending_password_hash, expires_at, attempts
     FROM wiki_email_codes
     WHERE email = $1 AND purpose = $2`,
    [email, purpose]
  );
  const row = result.rows[0];
  if (!row) return { ok: false, status: 400, error: "That verification code is invalid or expired." };

  if (new Date(row.expires_at).getTime() <= Date.now() || Number(row.attempts) >= CODE_MAX_ATTEMPTS) {
    await client.query(
      `DELETE FROM wiki_email_codes WHERE email = $1 AND purpose = $2`,
      [email, purpose]
    );
    return { ok: false, status: 400, error: "That verification code is invalid or expired." };
  }

  const candidateHash = hashVerificationCode(email, purpose, code);
  if (!safeCompare(candidateHash, row.code_hash)) {
    await client.query(
      `UPDATE wiki_email_codes
       SET attempts = attempts + 1
       WHERE email = $1 AND purpose = $2`,
      [email, purpose]
    );
    return { ok: false, status: 400, error: "That verification code is incorrect." };
  }

  return { ok: true, row };
}

function createLoginResult(email) {
  const token = createWikiSessionToken({ email }, SESSION_LIFETIME_SECONDS);
  return {
    status: 200,
    data: {
      ok: true,
      token,
      account: {
        email,
        name: "",
        picture: "",
        authMethod: "password",
      },
      expiresIn: SESSION_LIFETIME_SECONDS,
    },
  };
}

async function finishRegistration(client, body) {
  const email = normalizeEmail(body?.email);
  const code = String(body?.code || "").trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return { status: 400, error: "Enter the email and 6-digit verification code." };
  }

  const checked = await verifyCodeRow(client, email, "register", code);
  if (!checked.ok) return checked;
  const pendingPasswordHash = String(checked.row.pending_password_hash || "");
  if (!pendingPasswordHash) return { status: 400, error: "Request a new verification code and try again." };

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO wiki_accounts (
         email, password_hash, email_verified_at, created_at, updated_at,
         failed_login_attempts, locked_until
       ) VALUES ($1, $2, NOW(), NOW(), NOW(), 0, NULL)
       ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           email_verified_at = COALESCE(wiki_accounts.email_verified_at, NOW()),
           updated_at = NOW(),
           failed_login_attempts = 0,
           locked_until = NULL`,
      [email, pendingPasswordHash]
    );
    await client.query(
      `DELETE FROM wiki_email_codes WHERE email = $1 AND purpose = 'register'`,
      [email]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }

  return createLoginResult(email);
}

async function login(client, body) {
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || "");
  if (!isValidEmail(email) || !password) {
    return { status: 401, error: "Email or password is incorrect." };
  }

  const result = await client.query(
    `SELECT email, password_hash, email_verified_at, failed_login_attempts, locked_until
     FROM wiki_accounts
     WHERE email = $1`,
    [email]
  );
  const account = result.rows[0];
  if (!account?.email_verified_at) {
    return { status: 401, error: "Email or password is incorrect." };
  }

  const lockedUntil = account.locked_until ? new Date(account.locked_until).getTime() : 0;
  if (lockedUntil > Date.now()) {
    return { status: 429, error: "Too many sign-in attempts. Try again in about 15 minutes." };
  }
  if (lockedUntil && lockedUntil <= Date.now()) {
    await client.query(
      `UPDATE wiki_accounts SET failed_login_attempts = 0, locked_until = NULL WHERE email = $1`,
      [email]
    );
    account.failed_login_attempts = 0;
  }

  const valid = await verifyPassword(password, account.password_hash).catch(() => false);
  if (!valid) {
    const nextAttempts = Number(account.failed_login_attempts || 0) + 1;
    await client.query(
      `UPDATE wiki_accounts
       SET failed_login_attempts = $2,
           locked_until = CASE WHEN $2 >= ${LOGIN_MAX_ATTEMPTS}
             THEN NOW() + INTERVAL '${LOGIN_LOCK_MINUTES} minutes'
             ELSE NULL
           END,
           updated_at = NOW()
       WHERE email = $1`,
      [email, nextAttempts]
    );
    return nextAttempts >= LOGIN_MAX_ATTEMPTS
      ? { status: 429, error: "Too many sign-in attempts. Try again in about 15 minutes." }
      : { status: 401, error: "Email or password is incorrect." };
  }

  await client.query(
    `UPDATE wiki_accounts
     SET failed_login_attempts = 0,
         locked_until = NULL,
         last_login_at = NOW(),
         updated_at = NOW()
     WHERE email = $1`,
    [email]
  );
  return createLoginResult(email);
}

async function startReset(client, body) {
  const email = normalizeEmail(body?.email);
  if (!isValidEmail(email)) return { status: 400, error: "Enter a valid email address." };

  const result = await client.query(
    `SELECT email FROM wiki_accounts WHERE email = $1 AND email_verified_at IS NOT NULL`,
    [email]
  );
  if (result.rows[0]) {
    const issued = await issueCode(client, { email, purpose: "reset" });
    if (!issued.ok) return issued;
  }

  return {
    status: 200,
    data: {
      ok: true,
      step: "verify",
      email,
      message: "If a verified account exists for that email, a reset code has been sent.",
    },
  };
}

async function finishReset(client, body) {
  const email = normalizeEmail(body?.email);
  const code = String(body?.code || "").trim();
  const newPassword = String(body?.newPassword || "");
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return { status: 400, error: "Enter the email and 6-digit reset code." };
  }
  const invalidPassword = passwordError(newPassword);
  if (invalidPassword) return { status: 400, error: invalidPassword };

  const accountResult = await client.query(
    `SELECT email FROM wiki_accounts WHERE email = $1 AND email_verified_at IS NOT NULL`,
    [email]
  );
  if (!accountResult.rows[0]) {
    return { status: 400, error: "That verification code is invalid or expired." };
  }

  const checked = await verifyCodeRow(client, email, "reset", code);
  if (!checked.ok) return checked;
  const passwordHash = await hashPassword(newPassword);

  await client.query("BEGIN");
  try {
    await client.query(
      `UPDATE wiki_accounts
       SET password_hash = $2,
           failed_login_attempts = 0,
           locked_until = NULL,
           updated_at = NOW()
       WHERE email = $1`,
      [email, passwordHash]
    );
    await client.query(
      `DELETE FROM wiki_email_codes WHERE email = $1 AND purpose = 'reset'`,
      [email]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }

  return createLoginResult(email);
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!verifyMutationOrigin(request)) {
    return json({ error: "Cross-site authentication request blocked." }, 403);
  }

  try {
    getAuthSecret();

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return json({ error: "Request body must be valid JSON." }, 400);
    }

    const action = String(body?.action || "").trim();
    const client = await db.pool.connect();
    try {
      let result;
      if (action === "register") result = await startRegistration(client, body);
      else if (action === "verify_registration") result = await finishRegistration(client, body);
      else if (action === "login") result = await login(client, body);
      else if (action === "forgot_password") result = await startReset(client, body);
      else if (action === "reset_password") result = await finishReset(client, body);
      else return json({ error: "Unknown authentication action." }, 400);

      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result.data || { ok: true }, result.status || 200);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("wiki-auth failed", error);
    const message = String(error?.message || "");
    if (message.includes("RESEND_API_KEY")) {
      return json({ error: "Email verification is not configured yet." }, 503);
    }
    if (message.includes("WIKI_AUTH_SECRET")) {
      return json({ error: "Manual wiki sign-in is not configured yet." }, 503);
    }
    if (message.includes("RESEND_INVALID_API_KEY")) {
      return json({ error: "Resend rejected the API key. Check RESEND_API_KEY in Netlify, or create a new Resend sending key and replace it." }, 502);
    }
    if (message.includes("RESEND_DOMAIN_MISMATCH")) {
      return json({ error: "Resend rejected the sender domain. WIKI_AUTH_FROM_EMAIL must use @carbonfrontier.org and the API key must have access to that domain." }, 502);
    }
    if (message.includes("RESEND_RATE_LIMIT")) {
      return json({ error: "Resend is rate-limiting verification emails. Wait a moment and try again." }, 429);
    }
    if (message.includes("RESEND_QUOTA")) {
      return json({ error: "The Resend sending quota has been reached." }, 502);
    }
    if (message.includes("RESEND_USER_AGENT")) {
      return json({ error: "Resend rejected the request because of its request headers. The updated wiki-auth function fixes this; redeploy and try again." }, 502);
    }
    if (message.includes("Verification email could not be sent")) {
      return json({ error: "Resend rejected the verification email request. Check the wiki-auth Function log for the exact Resend status." }, 502);
    }
    return json({ error: "The wiki account service could not complete this request." }, 500);
  }
}
