(function () {
  "use strict";

  const AUTH_STORAGE_KEY = "carbon-frontier-google-session-v1";
  const LOCAL_MODERATION_KEY = "carbon-frontier-wiki-local-moderation-v1";
  const LOCAL_PAGE_KEY = "carbon-frontier-wiki-local-pages-v3";
  const LEGACY_PAGE_KEYS = ["carbon-frontier-wiki-local-pages-v2", "carbon-frontier-wiki-local-pages-v1"];
  const ENDPOINTS = ["/api/wiki/moderation", "/.netlify/functions/wiki-moderation"];
  const STAFF_ROLES = new Set(["owner", "admin", "wiki_editor"]);
  const CURSOR_ACCOUNT = { email: "jb141598@gmail.com", name: "Cursor Testing Owner", picture: "", idToken: "" };

  const ACTION_LABELS = {
    settings_updated: "Wiki settings changed",
    member_added: "Wiki member added",
    member_role_changed: "Wiki member role changed",
    member_removed: "Wiki member removed",
    page_created: "Page created",
    page_revision_saved: "Page revision published",
    page_revision_restored: "Page revision restored",
    page_editing_changed: "Page editing permission changed",
    page_moved: "Page moved",
    page_trashed: "Page moved to Trash",
    page_restored_from_trash: "Page restored from Trash",
    wiki_media_uploaded: "Wiki image uploaded",
    page_edit_submitted: "Contribution submitted",
    page_edit_approved: "Contribution approved",
    page_edit_rejected: "Contribution rejected",
    page_edit_superseded: "Contribution became outdated",
    contributor_blocked: "Contributor blocked",
    contributor_unblocked: "Contributor unblocked",
  };

  const ui = {
    accountPill: document.getElementById("account-pill"),
    loadingView: document.getElementById("loading-view"),
    unavailableView: document.getElementById("unavailable-view"),
    unavailableCopy: document.getElementById("unavailable-copy"),
    googleSigninSlot: document.getElementById("google-signin-slot"),
    moderationView: document.getElementById("moderation-view"),
    pendingTotal: document.getElementById("pending-total"),
    blockedTotal: document.getElementById("blocked-total"),
    reviewMode: document.getElementById("review-mode"),
    pendingBadge: document.getElementById("pending-badge"),
    pendingList: document.getElementById("pending-list"),
    pendingEmpty: document.getElementById("pending-empty"),
    pendingFeedback: document.getElementById("pending-feedback"),
    blockForm: document.getElementById("block-form"),
    blockEmail: document.getElementById("block-email"),
    blockReason: document.getElementById("block-reason"),
    blockButton: document.getElementById("block-button"),
    blockedList: document.getElementById("blocked-list"),
    blockedEmpty: document.getElementById("blocked-empty"),
    blockedFeedback: document.getElementById("blocked-feedback"),
    activityList: document.getElementById("activity-list"),
    activityEmpty: document.getElementById("activity-empty"),
  };

  const state = {
    testing: isTestingEnvironment(),
    account: null,
    idToken: "",
    data: null,
    remoteEndpoint: "",
    googleInitialized: false,
    armedAction: "",
    busy: false,
  };

  function isTestingEnvironment() {
    const hostname = String(window.location.hostname || "").toLowerCase();
    const agent = String(navigator.userAgent || "").toLowerCase();
    const referrer = String(document.referrer || "").toLowerCase();
    return window.location.protocol === "file:" || ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) ||
      hostname.includes("cursor") || hostname.includes("vscode") || agent.includes("cursor") || agent.includes("electron") ||
      referrer.includes("cursor") || referrer.includes("vscode");
  }

  function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function randomId(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
  function escapeHtml(value) {
    return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  function formatDate(value) {
    if (!value) return "Unknown time";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function emailSpoiler(email) {
    return `<button class="email-spoiler" type="button" data-email-spoiler aria-pressed="false" aria-label="Reveal hidden email address">
      <span class="email-spoiler-text">${escapeHtml(email)}</span><span class="email-spoiler-cover">Hidden email</span>
    </button>`;
  }

  function toggleSpoiler(button) {
    const revealed = button.classList.toggle("is-revealed");
    button.setAttribute("aria-pressed", String(revealed));
    button.setAttribute("aria-label", revealed ? "Hide email address" : "Reveal hidden email address");
  }

  function setFeedback(element, message, isError = false) {
    element.textContent = message || "";
    element.classList.toggle("is-error", Boolean(isError));
  }

  function getGoogleClientId() {
    return String(window.CARBON_FRONTIER_GOOGLE_CLIENT_ID || document.querySelector('meta[name="google-signin-client_id"]')?.content || "")
      .trim().replace(/^['"]+|['"]+$/g, "");
  }

  function decodeJwtPayload(token) {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = `${base64}${"=".repeat((4 - base64.length % 4) % 4)}`;
      const decoded = atob(padded);
      const utf8 = decodeURIComponent(Array.from(decoded).map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
      return JSON.parse(utf8);
    } catch (error) { return null; }
  }

  function tokenIsUsable(token) {
    const payload = decodeJwtPayload(token);
    const clientId = getGoogleClientId();
    if (!payload?.email || payload.email_verified === false) return false;
    if (clientId && payload.aud && payload.aud !== clientId) return false;
    return !payload.exp || Number(payload.exp) * 1000 > Date.now() + 15_000;
  }

  function loadSession() {
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
      if (!session?.email || !tokenIsUsable(session.idToken)) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return null;
      }
      return { email: normalizeEmail(session.email), name: String(session.name || "").trim(), picture: String(session.picture || ""), idToken: String(session.idToken || "") };
    } catch (error) { return null; }
  }

  function saveSession(account) {
    if (!state.testing && account?.email) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(account));
  }

  function handleGoogleCredential(response) {
    const payload = decodeJwtPayload(response?.credential);
    if (!payload?.email || payload.email_verified === false) {
      showUnavailable("Google did not return a verified email account.");
      return;
    }
    state.account = { email: normalizeEmail(payload.email), name: String(payload.name || ""), picture: String(payload.picture || ""), idToken: String(response.credential || "") };
    state.idToken = state.account.idToken;
    saveSession(state.account);
    loadModeration();
  }

  function renderGoogleButton() {
    if (state.testing || !window.google?.accounts?.id) return false;
    if (!state.googleInitialized) {
      window.google.accounts.id.initialize({ client_id: getGoogleClientId(), callback: handleGoogleCredential, auto_select: false, cancel_on_tap_outside: true, use_fedcm_for_prompt: true });
      state.googleInitialized = true;
    }
    ui.googleSigninSlot.innerHTML = "";
    window.google.accounts.id.renderButton(ui.googleSigninSlot, { theme: "outline", size: "large", shape: "pill", text: "signin_with", logo_alignment: "left", width: 270 });
    return true;
  }

  function waitForGoogle(attempt = 0) {
    if (renderGoogleButton() || attempt >= 40) return;
    window.setTimeout(() => waitForGoogle(attempt + 1), 250);
  }

  function showUnavailable(message) {
    ui.loadingView.hidden = true;
    ui.moderationView.hidden = true;
    ui.unavailableView.hidden = false;
    ui.unavailableCopy.textContent = message;
    ui.accountPill.textContent = state.account ? "No moderation access" : "Sign in required";
    ui.googleSigninSlot.hidden = Boolean(state.account);
    if (!state.account) waitForGoogle();
  }

  function showMain() {
    ui.loadingView.hidden = true;
    ui.unavailableView.hidden = true;
    ui.moderationView.hidden = false;
    ui.accountPill.textContent = state.testing ? "Owner access · Local testing" : `${state.account?.name || "Owner/Admin"} · Moderation`;
  }

  function endpointOrder() {
    return state.remoteEndpoint ? [state.remoteEndpoint, ...ENDPOINTS.filter((endpoint) => endpoint !== state.remoteEndpoint)] : ENDPOINTS;
  }

  async function remoteRequest(body = null) {
    let lastError = new Error("The wiki moderation service is unavailable.");
    for (const endpoint of endpointOrder()) {
      try {
        const response = await fetch(endpoint, {
          method: body ? "POST" : "GET",
          headers: { authorization: `Bearer ${state.idToken}`, ...(body ? { "content-type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && endpoint.startsWith("/api/")) {
          lastError = new Error(payload?.error || "Moderation Function not found.");
          continue;
        }
        if (!response.ok) {
          const error = new Error(payload?.error || `Moderation request failed (${response.status}).`);
          error.status = response.status;
          throw error;
        }
        state.remoteEndpoint = endpoint;
        return payload;
      } catch (error) {
        lastError = error;
        if (error?.status && error.status !== 404) throw error;
      }
    }
    throw lastError;
  }

  function sourceStamp() {
    return String(window.CarbonFrontierTestingSync?.getSnapshot()?.generatedAt || "no-live-snapshot");
  }

  function baseLocalData() {
    const wiki = window.CarbonFrontierTestingSync?.getSection("wiki") || {};
    const moderation = wiki.moderation || {};
    const members = Array.isArray(wiki.members) ? clone(wiki.members) : [];
    if (!members.some((member) => normalizeEmail(member.email) === CURSOR_ACCOUNT.email)) {
      members.push({ email: CURSOR_ACCOUNT.email, role: "owner" });
    }
    return {
      sourceStamp: sourceStamp(),
      settings: { reviewMode: wiki.settings?.reviewMode === "approval" ? "approval" : "immediate" },
      members,
      pendingEdits: Array.isArray(moderation.pendingEdits) ? clone(moderation.pendingEdits) : [],
      blockedUsers: Array.isArray(moderation.blockedUsers) ? clone(moderation.blockedUsers) : [],
      activity: Array.isArray(moderation.activity) ? clone(moderation.activity) : [],
    };
  }

  function readLocalData() {
    const base = baseLocalData();
    try {
      const stored = JSON.parse(localStorage.getItem(LOCAL_MODERATION_KEY) || "null");
      return stored?.sourceStamp === base.sourceStamp ? stored : base;
    } catch (error) { return base; }
  }

  function writeLocalData(data) {
    localStorage.setItem(LOCAL_MODERATION_KEY, JSON.stringify(data));
  }

  function readPageOverrides() {
    try {
      const raw = localStorage.getItem(LOCAL_PAGE_KEY) || LEGACY_PAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean) || "{}";
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) { return {}; }
  }

  function writePageOverrides(overrides) { localStorage.setItem(LOCAL_PAGE_KEY, JSON.stringify(overrides)); }

  function allLocalPages() {
    const wikiPages = window.CarbonFrontierTestingSync?.getSection("wiki")?.pages;
    const pages = new Map((Array.isArray(wikiPages) ? wikiPages : []).map((page) => [page.slug, clone(page)]));
    Object.values(readPageOverrides()).forEach((page) => { if (page?.slug) pages.set(page.slug, clone(page)); });
    return pages;
  }

  function addLocalAudit(data, action, options = {}) {
    data.activity.unshift({
      id: randomId("local-audit"), action, actorEmail: CURSOR_ACCOUNT.email,
      targetEmail: options.targetEmail || null, pageId: options.pageId || null,
      pageTitle: options.pageTitle || null, pageSlug: options.pageSlug || null,
      details: options.details || {}, createdAt: new Date().toISOString(),
    });
    data.activity = data.activity.slice(0, 150);
  }

  function approveLocalSubmission(data, submission, reviewNote) {
    const pages = allLocalPages();
    const overrides = readPageOverrides();
    const now = new Date().toISOString();
    let page = pages.get(submission.slug);
    let revisionNumber = 1;
    if (submission.type === "create") {
      if (page) throw new Error("That page address is already in use in this testing copy.");
      const revision = {
        id: randomId("local-revision"), number: 1, title: submission.title, content: clone(submission.content),
        editSummary: submission.editSummary || "Create page", authorEmail: submission.authorEmail,
        authorName: submission.authorName || null, authorRole: "contributor", createdAt: now,
      };
      page = {
        id: randomId("local-page"), slug: submission.slug, title: submission.title, allowNormalEdits: true,
        createdAt: now, updatedAt: now, createdBy: submission.authorEmail, updatedBy: submission.authorEmail,
        currentRevision: revision, localRevisions: [revision],
      };
    } else {
      if (!page || page.isDeleted) throw new Error("The page is no longer available in this testing copy.");
      if (page.currentRevision?.id !== submission.baseRevisionId) throw new Error("The page changed after this contribution was submitted.");
      page.localRevisions = Array.isArray(page.localRevisions) ? page.localRevisions : [page.currentRevision].filter(Boolean);
      revisionNumber = Number(page.currentRevision?.number || 0) + 1;
      const revision = {
        id: randomId("local-revision"), number: revisionNumber, title: submission.title, content: clone(submission.content),
        editSummary: submission.editSummary || "", authorEmail: submission.authorEmail,
        authorName: submission.authorName || null, authorRole: "contributor", createdAt: now,
      };
      page.title = submission.title;
      page.updatedAt = now;
      page.updatedBy = submission.authorEmail;
      page.localRevisions.push(revision);
      page.currentRevision = revision;
    }
    overrides[page.slug] = page;
    writePageOverrides(overrides);
    data.pendingEdits = data.pendingEdits.filter((item) => item.id !== submission.id);
    addLocalAudit(data, "page_edit_approved", {
      targetEmail: submission.authorEmail, pageId: page.id, pageTitle: page.title, pageSlug: page.slug,
      details: { submissionId: submission.id, submissionType: submission.type, revisionNumber, reviewNote },
    });
  }

  function localRequest(body = null) {
    const data = readLocalData();
    if (body) {
      const action = String(body.action || "");
      if (action === "approve_submission" || action === "reject_submission") {
        const submission = data.pendingEdits.find((item) => item.id === body.submissionId);
        if (!submission) throw new Error("That pending edit is no longer available.");
        if (action === "approve_submission") {
          approveLocalSubmission(data, submission, String(body.reviewNote || ""));
        } else {
          data.pendingEdits = data.pendingEdits.filter((item) => item.id !== submission.id);
          addLocalAudit(data, "page_edit_rejected", {
            targetEmail: submission.authorEmail, pageId: submission.pageId, pageTitle: submission.title, pageSlug: submission.slug,
            details: { submissionId: submission.id, submissionType: submission.type, reviewNote: String(body.reviewNote || "") },
          });
        }
      } else if (action === "block_user") {
        const email = normalizeEmail(body.email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid contributor email address.");
        if (data.members.some((member) => STAFF_ROLES.has(member.role) && normalizeEmail(member.email) === email)) {
          throw new Error("Assigned Owners, Admins, and Wiki Editors cannot be blocked.");
        }
        data.blockedUsers = data.blockedUsers.filter((person) => normalizeEmail(person.email) !== email);
        data.blockedUsers.unshift({ email, reason: String(body.reason || "").slice(0, 300), blockedBy: CURSOR_ACCOUNT.email, blockedAt: new Date().toISOString() });
        data.pendingEdits = data.pendingEdits.filter((item) => normalizeEmail(item.authorEmail) !== email);
        addLocalAudit(data, "contributor_blocked", { targetEmail: email, details: { reason: String(body.reason || "") } });
      } else if (action === "unblock_user") {
        const email = normalizeEmail(body.email);
        if (!data.blockedUsers.some((person) => normalizeEmail(person.email) === email)) throw new Error("That contributor is not blocked.");
        data.blockedUsers = data.blockedUsers.filter((person) => normalizeEmail(person.email) !== email);
        addLocalAudit(data, "contributor_unblocked", { targetEmail: email });
      } else {
        throw new Error("Unknown moderation action.");
      }
      writeLocalData(data);
    }
    return {
      ok: true, settings: data.settings,
      viewer: { role: "owner", canModerate: true },
      totals: { pending: data.pendingEdits.length, blocked: data.blockedUsers.length, activityEntries: data.activity.length },
      pendingEdits: clone(data.pendingEdits), blockedUsers: clone(data.blockedUsers), activity: clone(data.activity),
    };
  }

  function contentPreview(content) {
    const blocks = Array.isArray(content?.blocks) ? content.blocks : [];
    const text = blocks.map((block) => {
      if (Array.isArray(block.items)) return block.items.join(" · ");
      if (block.type === "image") return block.caption || block.alt || "Image";
      return block.text || String(block.html || "").replace(/<[^>]+>/g, " ");
    }).join(" ").replace(/\s+/g, " ").trim();
    return text ? `${text.slice(0, 280)}${text.length > 280 ? "…" : ""}` : "No text preview is available.";
  }

  function renderPending(items) {
    ui.pendingList.innerHTML = items.map((submission) => {
      const approveKey = `approve:${submission.id}`;
      const rejectKey = `reject:${submission.id}`;
      return `<article class="review-card">
        <div class="review-top">
          <div>
            <span class="review-type">${submission.type === "create" ? "New page" : "Page edit"}</span>
            <h3>${escapeHtml(submission.title)}</h3>
            <p class="review-meta">/${escapeHtml(submission.slug)}${submission.baseRevisionNumber ? ` · Based on revision ${submission.baseRevisionNumber}` : ""} · ${escapeHtml(formatDate(submission.createdAt))}</p>
            <p class="review-meta">Submitted by ${escapeHtml(submission.authorName || "Contributor")} ${emailSpoiler(submission.authorEmail)}</p>
          </div>
          <button class="secondary-button" type="button" data-action="prepare-block" data-email="${escapeHtml(submission.authorEmail)}">Block Contributor</button>
        </div>
        <p class="review-summary"><strong>Edit summary:</strong> ${escapeHtml(submission.editSummary || "No edit summary")}</p>
        <p class="review-preview">${escapeHtml(contentPreview(submission.content))}</p>
        <div class="review-controls">
          <label><span>Private review note (optional)</span><textarea id="review-note-${escapeHtml(submission.id)}" maxlength="500" placeholder="Why this was approved or rejected"></textarea></label>
          <div class="card-actions">
            <button class="secondary-button${state.armedAction === rejectKey ? " is-armed" : ""}" type="button" data-action="reject" data-id="${escapeHtml(submission.id)}">${state.armedAction === rejectKey ? "Confirm Reject" : "Reject"}</button>
            <button class="primary-button${state.armedAction === approveKey ? " is-armed" : ""}" type="button" data-action="approve" data-id="${escapeHtml(submission.id)}">${state.armedAction === approveKey ? "Confirm Approve" : "Approve"}</button>
          </div>
        </div>
      </article>`;
    }).join("");
    ui.pendingEmpty.hidden = items.length > 0;
  }

  function renderBlocks(items) {
    ui.blockedList.innerHTML = items.map((person) => {
      const key = `unblock:${normalizeEmail(person.email)}`;
      return `<article class="block-row"><div><strong>${emailSpoiler(person.email)}</strong>
        <p class="block-meta">${escapeHtml(person.reason || "No reason recorded")} · Blocked ${escapeHtml(formatDate(person.blockedAt))} by ${emailSpoiler(person.blockedBy)}</p></div>
        <button class="secondary-button${state.armedAction === key ? " is-armed" : ""}" type="button" data-action="unblock" data-email="${escapeHtml(person.email)}">${state.armedAction === key ? "Confirm Unblock" : "Unblock"}</button></article>`;
    }).join("");
    ui.blockedEmpty.hidden = items.length > 0;
  }

  function activityDetails(entry) {
    const details = entry.details || {};
    if (entry.pageTitle || details.title) return entry.pageTitle || details.title;
    if (details.oldSlug && details.newSlug) return `${details.oldSlug} → ${details.newSlug}`;
    if (details.reviewNote) return details.reviewNote;
    if (details.reason) return details.reason;
    return "";
  }

  function renderActivity(items) {
    ui.activityList.innerHTML = items.map((entry) => `<article class="activity-row">
      <div class="activity-copy"><strong>${escapeHtml(ACTION_LABELS[entry.action] || entry.action.replaceAll("_", " "))}</strong>
      <p class="activity-meta">By ${emailSpoiler(entry.actorEmail)}${entry.targetEmail ? ` · Account ${emailSpoiler(entry.targetEmail)}` : ""}${activityDetails(entry) ? ` · ${escapeHtml(activityDetails(entry))}` : ""}</p></div>
      <span class="activity-time">${escapeHtml(formatDate(entry.createdAt))}</span></article>`).join("");
    ui.activityEmpty.hidden = items.length > 0;
  }

  function render(data) {
    state.data = data;
    showMain();
    ui.pendingTotal.textContent = String(data.totals.pending);
    ui.blockedTotal.textContent = String(data.totals.blocked);
    const approval = data.settings.reviewMode === "approval";
    ui.reviewMode.textContent = approval ? "Approval" : "Immediate";
    ui.reviewMode.dataset.mode = approval ? "approval" : "immediate";
    ui.pendingBadge.textContent = String(data.totals.pending);
    renderPending(data.pendingEdits);
    renderBlocks(data.blockedUsers);
    renderActivity(data.activity);
  }

  async function loadModeration({ preserveFeedback = false } = {}) {
    try {
      const payload = state.testing ? localRequest() : await remoteRequest();
      render(payload);
      if (!preserveFeedback) {
        setFeedback(ui.pendingFeedback, state.testing ? "Local moderation testing is active. Changes stay in this browser." : "Moderation queue loaded.");
      }
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) showUnavailable(error.message);
      else showUnavailable(error?.message || "The moderation tools could not be loaded.");
    }
  }

  async function performMutation(body, feedbackElement, successMessage) {
    if (state.busy) return false;
    state.busy = true;
    setFeedback(feedbackElement, "Saving moderation change...");
    try {
      const payload = state.testing ? localRequest(body) : await remoteRequest(body);
      state.armedAction = "";
      render(payload);
      setFeedback(feedbackElement, successMessage);
      return true;
    } catch (error) {
      if (!state.testing && error?.status === 409) await loadModeration({ preserveFeedback: true });
      setFeedback(feedbackElement, error?.message || "The moderation change could not be saved.", true);
      return false;
    } finally { state.busy = false; }
  }

  function armOrRun(key, renderFunction, run) {
    if (state.armedAction !== key) {
      state.armedAction = key;
      renderFunction();
      return false;
    }
    run();
    return true;
  }

  ui.pendingList.addEventListener("click", (event) => {
    const spoiler = event.target.closest("[data-email-spoiler]");
    if (spoiler) { toggleSpoiler(spoiler); return; }
    const button = event.target.closest("[data-action]");
    if (!button || state.busy) return;
    if (button.dataset.action === "prepare-block") {
      ui.blockEmail.value = button.dataset.email || "";
      ui.blockReason.value = "";
      state.armedAction = "";
      ui.blockEmail.focus();
      ui.blockForm.scrollIntoView({ behavior: "smooth", block: "center" });
      setFeedback(ui.blockedFeedback, "Add an optional reason, then click Block.");
      return;
    }
    const submissionId = button.dataset.id;
    const action = button.dataset.action;
    const key = `${action}:${submissionId}`;
    if (state.armedAction !== key) {
      state.armedAction = key;
      ui.pendingList.querySelectorAll('[data-action="approve"], [data-action="reject"]').forEach((candidate) => {
        candidate.classList.remove("is-armed");
        candidate.textContent = candidate.dataset.action === "approve" ? "Approve" : "Reject";
      });
      button.classList.add("is-armed");
      button.textContent = `Confirm ${action === "approve" ? "Approve" : "Reject"}`;
      setFeedback(ui.pendingFeedback, `Click Confirm ${action === "approve" ? "Approve" : "Reject"} to continue.`);
      return;
    }
    const note = document.getElementById(`review-note-${submissionId}`)?.value || "";
    performMutation(
      { action: action === "approve" ? "approve_submission" : "reject_submission", submissionId, reviewNote: note },
      ui.pendingFeedback,
      action === "approve" ? "Contribution approved and published." : "Contribution rejected. The current page was not changed."
    );
  });

  ui.blockForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = normalizeEmail(ui.blockEmail.value);
    const key = `block:${email}`;
    if (state.armedAction !== key) {
      state.armedAction = key;
      ui.blockButton.textContent = "Confirm Block";
      ui.blockButton.classList.add("is-armed");
      setFeedback(ui.blockedFeedback, `Click Confirm Block to block this contributor and reject their pending edits.`);
      return;
    }
    performMutation({ action: "block_user", email, reason: ui.blockReason.value.trim() }, ui.blockedFeedback, "Contributor blocked and pending edits rejected.")
      .then((saved) => {
        if (saved) ui.blockForm.reset();
        ui.blockButton.textContent = "Block";
        ui.blockButton.classList.remove("is-armed");
      });
  });

  [ui.blockEmail, ui.blockReason].forEach((input) => input.addEventListener("input", () => {
    if (state.armedAction.startsWith("block:")) {
      state.armedAction = "";
      ui.blockButton.textContent = "Block";
      ui.blockButton.classList.remove("is-armed");
    }
  }));

  ui.blockedList.addEventListener("click", (event) => {
    const spoiler = event.target.closest("[data-email-spoiler]");
    if (spoiler) { toggleSpoiler(spoiler); return; }
    const button = event.target.closest('[data-action="unblock"]');
    if (!button || state.busy) return;
    const email = normalizeEmail(button.dataset.email);
    const key = `unblock:${email}`;
    armOrRun(key, () => renderBlocks(state.data.blockedUsers), () => performMutation(
      { action: "unblock_user", email }, ui.blockedFeedback, "Contributor unblocked."
    ));
  });

  ui.activityList.addEventListener("click", (event) => {
    const spoiler = event.target.closest("[data-email-spoiler]");
    if (spoiler) toggleSpoiler(spoiler);
  });

  window.addEventListener("carbon-frontier-testing-snapshot-updated", () => {
    if (state.testing) {
      localStorage.removeItem(LOCAL_MODERATION_KEY);
      loadModeration();
    }
  });

  if (state.testing) {
    state.account = CURSOR_ACCOUNT;
    loadModeration();
  } else {
    state.account = loadSession();
    state.idToken = state.account?.idToken || "";
    if (state.account) loadModeration();
    else showUnavailable("Sign in with an assigned Owner or Admin account to moderate the wiki.");
  }
})();
