(function () {
  "use strict";

  const AUTH_STORAGE_KEY = "carbon-frontier-google-session-v1";
  const LOCAL_PAGE_KEYS = [
    "carbon-frontier-wiki-local-pages-v3",
    "carbon-frontier-wiki-local-pages-v2",
    "carbon-frontier-wiki-local-pages-v1",
  ];
  const ANALYTICS_ENDPOINTS = [
    "/api/wiki/analytics",
    "/.netlify/functions/wiki-analytics",
  ];
  const ROLE_LABELS = {
    owner: "Owner",
    admin: "Admin",
    wiki_editor: "Wiki Editor",
    contributor: "Contributor",
  };
  const ROLE_ORDER = { owner: 0, admin: 1, wiki_editor: 2, contributor: 3 };
  const CURSOR_ACCOUNT = {
    email: "jb141598@gmail.com",
    name: "Cursor Testing Owner",
    picture: "",
    idToken: "",
  };

  const ui = {
    accountPill: document.getElementById("account-pill"),
    loadingView: document.getElementById("loading-view"),
    unavailableView: document.getElementById("unavailable-view"),
    unavailableCopy: document.getElementById("unavailable-copy"),
    googleSigninSlot: document.getElementById("google-signin-slot"),
    analyticsView: document.getElementById("analytics-view"),
    startDate: document.getElementById("start-date"),
    endDate: document.getElementById("end-date"),
    scopeAll: document.getElementById("scope-all"),
    scopeStaff: document.getElementById("scope-staff"),
    generate: document.getElementById("generate-button"),
    export: document.getElementById("export-button"),
    feedback: document.getElementById("report-feedback"),
    totalEdits: document.getElementById("total-edits"),
    pagesCreated: document.getElementById("pages-created"),
    activeEditors: document.getElementById("active-editors"),
    peopleListed: document.getElementById("people-listed"),
    rangeLabel: document.getElementById("range-label"),
    contributorsBody: document.getElementById("contributors-body"),
    contributorsEmpty: document.getElementById("contributors-empty"),
    topPagesList: document.getElementById("top-pages-list"),
    pagesEmpty: document.getElementById("pages-empty"),
  };

  const state = {
    testing: isTestingEnvironment(),
    account: null,
    idToken: "",
    scope: "assigned_staff",
    report: null,
    remoteEndpoint: "",
    googleInitialized: false,
  };

  function isTestingEnvironment() {
    const hostname = String(window.location.hostname || "").toLowerCase();
    const userAgent = String(navigator.userAgent || "").toLowerCase();
    const referrer = String(document.referrer || "").toLowerCase();
    return (
      window.location.protocol === "file:" ||
      ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) ||
      hostname.includes("cursor") ||
      hostname.includes("vscode") ||
      userAgent.includes("cursor") ||
      userAgent.includes("electron") ||
      referrer.includes("cursor") ||
      referrer.includes("vscode")
    );
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function dateString(date) {
    return date.toISOString().slice(0, 10);
  }

  function setDefaultDates() {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 29);
    ui.startDate.value = dateString(start);
    ui.endDate.value = dateString(end);
  }

  function getGoogleClientId() {
    return String(
      window.CARBON_FRONTIER_GOOGLE_CLIENT_ID ||
      document.querySelector('meta[name="google-signin-client_id"]')?.content ||
      ""
    ).trim().replace(/^['"]+|['"]+$/g, "");
  }

  function decodeJwtPayload(token) {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
      const json = atob(padded);
      const utf8 = decodeURIComponent(
        Array.from(json).map((character) =>
          `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`
        ).join("")
      );
      return JSON.parse(utf8);
    } catch (error) {
      return null;
    }
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
      return {
        email: normalizeEmail(session.email),
        name: String(session.name || "").trim(),
        picture: String(session.picture || "").trim(),
        idToken: String(session.idToken || "").trim(),
      };
    } catch (error) {
      return null;
    }
  }

  function saveSession(account) {
    if (!account?.email || state.testing) return;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(account));
  }

  function handleGoogleCredential(response) {
    const payload = decodeJwtPayload(response?.credential);
    if (!payload?.email || payload.email_verified === false) {
      showUnavailable("Google did not return a verified email account.");
      return;
    }
    state.account = {
      email: normalizeEmail(payload.email),
      name: String(payload.name || "").trim(),
      picture: String(payload.picture || "").trim(),
      idToken: String(response.credential || "").trim(),
    };
    state.idToken = state.account.idToken;
    saveSession(state.account);
    loadReport({ respectServerDefault: true });
  }

  function renderGoogleButton() {
    if (state.testing || !window.google?.accounts?.id) return false;
    if (!state.googleInitialized) {
      window.google.accounts.id.initialize({
        client_id: getGoogleClientId(),
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: true,
      });
      state.googleInitialized = true;
    }
    ui.googleSigninSlot.innerHTML = "";
    window.google.accounts.id.renderButton(ui.googleSigninSlot, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with",
      logo_alignment: "left",
      width: 270,
    });
    return true;
  }

  function waitForGoogle(attempt = 0) {
    if (renderGoogleButton() || attempt >= 40) return;
    window.setTimeout(() => waitForGoogle(attempt + 1), 250);
  }

  function setScope(scope) {
    state.scope = scope === "all_editors" ? "all_editors" : "assigned_staff";
    ui.scopeAll.setAttribute("aria-pressed", String(state.scope === "all_editors"));
    ui.scopeStaff.setAttribute("aria-pressed", String(state.scope === "assigned_staff"));
  }

  function setFeedback(message, isError = false) {
    ui.feedback.textContent = message;
    ui.feedback.classList.toggle("is-error", isError);
  }

  function showUnavailable(message) {
    ui.loadingView.hidden = true;
    ui.analyticsView.hidden = true;
    ui.unavailableView.hidden = false;
    ui.unavailableCopy.textContent = message;
    ui.accountPill.textContent = state.account?.email ? "No analytics access" : "Sign in required";
    ui.googleSigninSlot.hidden = Boolean(state.account?.email);
    if (!ui.googleSigninSlot.hidden) waitForGoogle();
  }

  function showReportView() {
    ui.loadingView.hidden = true;
    ui.unavailableView.hidden = true;
    ui.analyticsView.hidden = false;
    ui.accountPill.textContent = state.testing
      ? "Owner access · Local testing"
      : `${state.account?.name || "Owner/Admin"} · Analytics`;
  }

  function requestEndpoints() {
    return state.remoteEndpoint
      ? [state.remoteEndpoint, ...ANALYTICS_ENDPOINTS.filter((item) => item !== state.remoteEndpoint)]
      : ANALYTICS_ENDPOINTS;
  }

  async function requestRemoteReport({ respectServerDefault = false } = {}) {
    let lastError = new Error("The wiki analytics service is unavailable.");
    for (const endpoint of requestEndpoints()) {
      const url = new URL(endpoint, window.location.origin);
      url.searchParams.set("start", ui.startDate.value);
      url.searchParams.set("end", ui.endDate.value);
      if (!respectServerDefault) url.searchParams.set("scope", state.scope);
      try {
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${state.idToken}` },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && endpoint.startsWith("/api/")) {
          lastError = new Error(payload?.error || "Analytics Function not found.");
          continue;
        }
        if (!response.ok) {
          const error = new Error(payload?.error || `Analytics request failed (${response.status}).`);
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

  function readLocalOverrides() {
    try {
      const raw = LOCAL_PAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
      const parsed = JSON.parse(raw || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function localWikiData() {
    const snapshot = window.CarbonFrontierTestingSync?.getSection("wiki") || {};
    const pages = new Map(
      (Array.isArray(snapshot.pages) ? snapshot.pages : []).map((page) => [page.slug, page])
    );
    Object.values(readLocalOverrides()).forEach((page) => {
      if (page?.slug) pages.set(page.slug, page);
    });
    const members = Array.isArray(snapshot.members) ? [...snapshot.members] : [];
    if (!members.some((member) => normalizeEmail(member.email) === CURSOR_ACCOUNT.email)) {
      members.push({ email: CURSOR_ACCOUNT.email, role: "owner" });
    }
    return {
      settings: snapshot.settings || { visibility: "private", editingMode: "restricted" },
      pages: [...pages.values()],
      members,
    };
  }

  function localReport({ respectServerDefault = false } = {}) {
    const data = localWikiData();
    const defaultScope =
      data.settings.visibility === "public" && data.settings.editingMode === "open"
        ? "all_editors"
        : "assigned_staff";
    const scope = respectServerDefault ? defaultScope : state.scope;
    const startTime = new Date(`${ui.startDate.value}T00:00:00.000Z`).getTime();
    const endTime = new Date(`${ui.endDate.value}T23:59:59.999Z`).getTime();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) {
      throw new Error("Choose a valid date range with the start date first.");
    }

    const staff = new Map(
      data.members.map((member) => [normalizeEmail(member.email), { ...member, email: normalizeEmail(member.email) }])
    );
    const stats = new Map();
    const topPages = [];

    function getStats(email) {
      const normalized = normalizeEmail(email);
      if (!stats.has(normalized)) {
        stats.set(normalized, {
          email: normalized,
          authorName: "",
          edits: 0,
          pages: new Set(),
          pagesCreated: 0,
          lastEditAt: null,
        });
      }
      return stats.get(normalized);
    }

    data.pages.forEach((page) => {
      const creator = normalizeEmail(page.createdBy);
      const createdAt = new Date(page.createdAt || 0).getTime();
      if (creator && creator !== "system" && createdAt >= startTime && createdAt <= endTime) {
        getStats(creator).pagesCreated += 1;
      }
      const revisions = Array.isArray(page.localRevisions)
        ? page.localRevisions
        : page.currentRevision
          ? [page.currentRevision]
          : [];
      let pageEdits = 0;
      revisions.forEach((revision) => {
        const email = normalizeEmail(revision.authorEmail);
        const created = new Date(revision.createdAt || 0).getTime();
        if (!email || email === "system" || created < startTime || created > endTime) return;
        const person = getStats(email);
        person.edits += 1;
        person.pages.add(page.id || page.slug);
        if (revision.authorName) person.authorName = String(revision.authorName);
        if (!person.lastEditAt || created > new Date(person.lastEditAt).getTime()) {
          person.lastEditAt = new Date(created).toISOString();
        }
        if (scope === "all_editors" || staff.has(email)) pageEdits += 1;
      });
      if (pageEdits > 0) {
        topPages.push({
          id: page.id,
          slug: page.slug,
          title: page.title,
          isDeleted: Boolean(page.isDeleted),
          edits: pageEdits,
        });
      }
    });

    const included = new Set(staff.keys());
    if (scope === "all_editors") {
      stats.forEach((person, email) => {
        if (person.edits > 0) included.add(email);
      });
    }
    const contributors = [...included].map((email) => {
      const member = staff.get(email);
      const person = stats.get(email) || {
        authorName: "", edits: 0, pages: new Set(), pagesCreated: 0, lastEditAt: null,
      };
      const role = member?.role || "contributor";
      return {
        email,
        displayName: person.authorName || ROLE_LABELS[role] || "Contributor",
        role,
        isAssignedStaff: Boolean(member),
        edits: person.edits,
        pagesEdited: person.pages.size,
        pagesCreated: person.pagesCreated,
        lastEditAt: person.lastEditAt,
      };
    }).filter((person) => person.isAssignedStaff || person.edits > 0)
      .sort((a, b) =>
        b.edits - a.edits ||
        (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99) ||
        a.displayName.localeCompare(b.displayName) ||
        a.email.localeCompare(b.email)
      );

    topPages.sort((a, b) => b.edits - a.edits || a.title.localeCompare(b.title));
    return {
      ok: true,
      range: { start: ui.startDate.value, end: ui.endDate.value },
      scope,
      defaultScope,
      totals: {
        edits: contributors.reduce((sum, person) => sum + person.edits, 0),
        pagesCreated: contributors.reduce((sum, person) => sum + person.pagesCreated, 0),
        editorsWithEdits: contributors.filter((person) => person.edits > 0).length,
        listedContributors: contributors.length,
      },
      contributors,
      topPages: topPages.slice(0, 20),
    };
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString(undefined, includeTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" });
  }

  function initials(person) {
    return String(person.displayName || person.email || "CF")
      .split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function emailSpoiler(email) {
    return `<button class="email-spoiler" type="button" data-email-spoiler aria-expanded="false" aria-label="Reveal hidden email address">
      <span class="email-spoiler-text">${escapeHtml(email)}</span>
      <span class="email-spoiler-cover">Show email</span>
    </button>`;
  }

  function pageHref(page) {
    if (state.testing || /wiki-analytics\.html$/i.test(window.location.pathname)) {
      return page.slug === "front-page" ? "wiki.html" : `wiki.html?page=${encodeURIComponent(page.slug)}`;
    }
    return page.slug === "front-page" ? "/wiki" : `/wiki/${encodeURIComponent(page.slug)}`;
  }

  function renderReport(report) {
    state.report = report;
    setScope(report.scope);
    showReportView();
    ui.totalEdits.textContent = String(report.totals.edits);
    ui.pagesCreated.textContent = String(report.totals.pagesCreated);
    ui.activeEditors.textContent = String(report.totals.editorsWithEdits);
    ui.peopleListed.textContent = String(report.totals.listedContributors);
    ui.rangeLabel.textContent = `${formatDate(`${report.range.start}T00:00:00Z`)} – ${formatDate(`${report.range.end}T00:00:00Z`)}`;

    ui.contributorsBody.innerHTML = report.contributors.map((person) => `
      <tr>
        <td>
          <div class="person-cell">
            <span class="person-avatar">${escapeHtml(initials(person))}</span>
            <div>
              <span class="person-name">${escapeHtml(person.displayName)}</span>
              <span class="role-label">${escapeHtml(ROLE_LABELS[person.role] || "Contributor")}${person.isAssignedStaff ? " · Assigned" : ""}</span>
              ${emailSpoiler(person.email)}
            </div>
          </div>
        </td>
        <td>${person.edits}</td>
        <td>${person.pagesEdited}</td>
        <td>${person.pagesCreated}</td>
        <td>${escapeHtml(formatDate(person.lastEditAt, true))}</td>
      </tr>`).join("");
    ui.contributorsEmpty.hidden = report.contributors.length > 0;

    ui.topPagesList.innerHTML = report.topPages.map((page) => `
      <a class="page-row" href="${escapeHtml(pageHref(page))}">
        <span>
          <span class="page-title">${escapeHtml(page.title)}</span>
          <span class="page-meta">${page.isDeleted ? "In Trash" : escapeHtml(page.slug)}</span>
        </span>
        <span class="page-edits">${page.edits} ${page.edits === 1 ? "edit" : "edits"}</span>
      </a>`).join("");
    ui.pagesEmpty.hidden = report.topPages.length > 0;
    ui.export.disabled = report.contributors.length === 0;
    setFeedback(
      state.testing
        ? "Local report generated from the latest downloaded live copy plus your Cursor-only edits."
        : "Report generated from saved wiki revisions."
    );
  }

  async function loadReport(options = {}) {
    if (!ui.startDate.value || !ui.endDate.value || ui.startDate.value > ui.endDate.value) {
      setFeedback("Choose a valid date range with the start date first.", true);
      return;
    }
    ui.generate.disabled = true;
    ui.export.disabled = true;
    setFeedback("Generating contributor report...");
    try {
      const report = state.testing
        ? localReport(options)
        : await requestRemoteReport(options);
      renderReport(report);
    } catch (error) {
      if (!state.testing && (error?.status === 401 || error?.status === 403)) {
        showUnavailable(error.message);
      } else {
        showReportView();
        setFeedback(error?.message || "The report could not be generated.", true);
      }
    } finally {
      ui.generate.disabled = false;
      ui.export.disabled = !state.report?.contributors?.length;
    }
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    if (!state.report) return;
    const rows = [
      ["Display name", "Email", "Role", "Assigned staff", "Edits", "Pages edited", "Pages created", "Last edit"],
      ...state.report.contributors.map((person) => [
        person.displayName,
        person.email,
        ROLE_LABELS[person.role] || "Contributor",
        person.isAssignedStaff ? "Yes" : "No",
        person.edits,
        person.pagesEdited,
        person.pagesCreated,
        person.lastEditAt || "",
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `wiki-analytics-${state.report.range.start}-to-${state.report.range.end}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  ui.scopeAll.addEventListener("click", () => setScope("all_editors"));
  ui.scopeStaff.addEventListener("click", () => setScope("assigned_staff"));
  ui.generate.addEventListener("click", () => loadReport());
  ui.export.addEventListener("click", exportCsv);
  ui.contributorsBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-email-spoiler]");
    if (!button) return;
    const revealed = button.classList.toggle("is-revealed");
    button.setAttribute("aria-expanded", String(revealed));
    button.setAttribute("aria-label", revealed ? "Hide email address" : "Reveal hidden email address");
  });
  window.addEventListener("carbon-frontier-testing-snapshot-updated", () => {
    if (state.testing) loadReport();
  });

  setDefaultDates();
  if (state.testing) {
    state.account = CURSOR_ACCOUNT;
    setScope("assigned_staff");
    loadReport({ respectServerDefault: true });
  } else {
    state.account = loadSession();
    state.idToken = state.account?.idToken || "";
    if (state.account) {
      loadReport({ respectServerDefault: true });
    } else {
      showUnavailable("Sign in with an assigned Owner or Admin account to view contributor analytics.");
    }
  }
})();
