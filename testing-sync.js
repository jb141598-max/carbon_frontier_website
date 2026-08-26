(function () {
  "use strict";

  const SNAPSHOT_STORAGE_KEY = "carbon-frontier-testing-snapshot-v1";
  const LIVE_URL_STORAGE_KEY = "carbon-frontier-testing-live-url-v1";
  const SYNC_KEY_STORAGE_KEY = "carbon-frontier-testing-sync-key-v1";
  const UPDATE_EVENT = "carbon-frontier-testing-snapshot-updated";

  function isTestingEnvironment() {
    const hostname = String(window.location.hostname || "").toLowerCase();
    const userAgent = String(window.navigator?.userAgent || "").toLowerCase();
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

  function readStorage(storage, key) {
    try {
      return storage.getItem(key) || "";
    } catch (error) {
      return "";
    }
  }

  function writeStorage(storage, key, value) {
    try {
      storage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeStorage(storage, key) {
    try {
      storage.removeItem(key);
    } catch (error) {
      // A locked-down preview can deny storage. The toolbar still works for this page load.
    }
  }

  function normalizeLiveSiteUrl(value) {
    const rawValue = String(value || "").trim();
    if (!rawValue) {
      return "";
    }

    try {
      const parsed = new URL(rawValue.includes("://") ? rawValue : `https://${rawValue}`);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return "";
      }
      return parsed.origin;
    } catch (error) {
      return "";
    }
  }

  function getLiveSiteUrl() {
    return normalizeLiveSiteUrl(readStorage(window.localStorage, LIVE_URL_STORAGE_KEY));
  }

  function getSyncKey() {
    return readStorage(window.sessionStorage, SYNC_KEY_STORAGE_KEY);
  }

  function getSnapshot() {
    const rawSnapshot = readStorage(window.localStorage, SNAPSHOT_STORAGE_KEY);
    if (!rawSnapshot) {
      return null;
    }

    try {
      const snapshot = JSON.parse(rawSnapshot);
      return snapshot && typeof snapshot === "object" ? snapshot : null;
    } catch (error) {
      return null;
    }
  }

  function getSection(name) {
    const snapshot = getSnapshot();
    const section = snapshot?.[name];
    return section && typeof section === "object" ? section : null;
  }

  function resolveAssetUrl(value) {
    const path = String(value || "").trim();
    if (!path || /^(?:https?:)?\/\//i.test(path) || /^(?:data|blob):/i.test(path)) {
      return path;
    }

    if (!isTestingEnvironment() || !getSnapshot()) {
      return path;
    }

    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    if (!/^\/(?:api\/images\/|\.netlify\/functions\/images\/)/i.test(normalizedPath)) {
      return path;
    }

    const liveUrl = getLiveSiteUrl();
    return liveUrl ? `${liveUrl}${normalizedPath}` : path;
  }

  function dispatchSnapshotUpdate(action) {
    window.dispatchEvent(
      new CustomEvent(UPDATE_EVENT, {
        detail: { action, snapshot: getSnapshot() },
      })
    );
  }

  let toolbar = null;
  let statusElement = null;
  let refreshButton = null;

  function setStatus(message, type = "normal") {
    if (!statusElement) {
      return;
    }
    statusElement.textContent = message;
    statusElement.dataset.type = type;
  }

  function formatSnapshotStatus() {
    const snapshot = getSnapshot();
    if (!snapshot?.generatedAt) {
      return getLiveSiteUrl() ? "Connected; no copy downloaded yet." : "Not connected to the live site.";
    }

    const generatedAt = new Date(snapshot.generatedAt);
    const formattedTime = Number.isNaN(generatedAt.getTime())
      ? snapshot.generatedAt
      : generatedAt.toLocaleString();
    return `Live copy downloaded ${formattedTime}.`;
  }

  async function configure({ refreshAfter = false } = {}) {
    const currentUrl = getLiveSiteUrl();
    const requestedUrl = window.prompt(
      "Enter the live Carbon Frontier site address (for example, https://your-site.netlify.app):",
      currentUrl
    );
    if (requestedUrl === null) {
      return false;
    }

    const liveUrl = normalizeLiveSiteUrl(requestedUrl);
    if (!liveUrl) {
      setStatus("That live website address is not valid.", "error");
      return false;
    }

    const requestedKey = window.prompt(
      "Enter the same CURSOR_TESTING_SYNC_KEY that you added in Netlify. It is kept only for this browser session:",
      ""
    );
    if (requestedKey === null || !requestedKey.trim()) {
      setStatus("The connection was not changed because no sync key was entered.", "error");
      return false;
    }

    writeStorage(window.localStorage, LIVE_URL_STORAGE_KEY, liveUrl);
    writeStorage(window.sessionStorage, SYNC_KEY_STORAGE_KEY, requestedKey.trim());
    setStatus(`Connected to ${liveUrl}.`, "success");

    if (refreshAfter) {
      return refresh();
    }
    return true;
  }

  async function refresh() {
    let liveUrl = getLiveSiteUrl();
    let syncKey = getSyncKey();
    if (!liveUrl || !syncKey) {
      const configured = await configure();
      if (!configured) {
        return false;
      }
      liveUrl = getLiveSiteUrl();
      syncKey = getSyncKey();
    }

    if (refreshButton) {
      refreshButton.disabled = true;
    }
    setStatus("Downloading a fresh read-only copy…");

    try {
      const response = await fetch(`${liveUrl}/api/testing-snapshot`, {
        method: "GET",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "x-testing-sync-key": syncKey,
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || `The live site returned ${response.status}.`);
      }
      if (!payload || typeof payload !== "object" || payload.schemaVersion !== 1) {
        throw new Error("The live site returned an unsupported testing snapshot.");
      }

      if (!writeStorage(window.localStorage, SNAPSHOT_STORAGE_KEY, JSON.stringify(payload))) {
        throw new Error("Cursor could not save the downloaded testing copy in this browser.");
      }
      setStatus(formatSnapshotStatus(), "success");
      dispatchSnapshotUpdate("refresh");
      return true;
    } catch (error) {
      setStatus(error?.message || "Could not download the live testing copy.", "error");
      return false;
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
      }
    }
  }

  function clear() {
    removeStorage(window.localStorage, SNAPSHOT_STORAGE_KEY);
    setStatus(
      "The live snapshot was disconnected. Local test edits remain here; your live site was not changed."
    );
    dispatchSnapshotUpdate("clear");
  }

  function mountToolbar() {
    if (!isTestingEnvironment() || toolbar) {
      return;
    }

    const style = document.createElement("style");
    style.textContent = `
      .cf-testing-toolbar {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: min(360px, calc(100vw - 32px));
        padding: 14px;
        border: 1px solid rgba(142, 230, 190, 0.5);
        border-radius: 14px;
        background: rgba(11, 19, 17, 0.97);
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.42);
        color: #f4fff9;
        font: 600 13px/1.35 Inter, ui-sans-serif, system-ui, sans-serif;
      }
      .cf-testing-toolbar__title {
        margin: 0 0 5px;
        color: #8ee6be;
        font-size: 12px;
        letter-spacing: 0.12em;
      }
      .cf-testing-toolbar__status {
        margin: 0 0 11px;
        color: rgba(244, 255, 249, 0.76);
        font-weight: 500;
      }
      .cf-testing-toolbar__status[data-type="success"] { color: #b9f5d7; }
      .cf-testing-toolbar__status[data-type="error"] { color: #ffb7bd; }
      .cf-testing-toolbar__actions { display: flex; flex-wrap: wrap; gap: 7px; }
      .cf-testing-toolbar button {
        appearance: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 9px;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        cursor: pointer;
        font: inherit;
      }
      .cf-testing-toolbar button:hover { background: rgba(255, 255, 255, 0.14); }
      .cf-testing-toolbar button:disabled { cursor: wait; opacity: 0.55; }
      .cf-testing-toolbar button[data-primary="true"] {
        border-color: #8ee6be;
        background: #8ee6be;
        color: #0b1311;
      }
    `;
    document.head.appendChild(style);

    toolbar = document.createElement("section");
    toolbar.className = "cf-testing-toolbar";
    toolbar.setAttribute("aria-label", "Cursor live data testing controls");
    toolbar.innerHTML = `
      <p class="cf-testing-toolbar__title">CURSOR LIVE TESTING</p>
      <p class="cf-testing-toolbar__status" aria-live="polite"></p>
      <div class="cf-testing-toolbar__actions">
        <button type="button" data-action="refresh" data-primary="true">Refresh Live Data</button>
        <button type="button" data-action="configure">Set Connection</button>
        <button type="button" data-action="clear">Disconnect Copy</button>
      </div>
    `;
    document.body.appendChild(toolbar);
    statusElement = toolbar.querySelector(".cf-testing-toolbar__status");
    refreshButton = toolbar.querySelector('[data-action="refresh"]');
    setStatus(formatSnapshotStatus());

    refreshButton.addEventListener("click", refresh);
    toolbar.querySelector('[data-action="configure"]').addEventListener("click", () =>
      configure({ refreshAfter: true })
    );
    toolbar.querySelector('[data-action="clear"]').addEventListener("click", clear);
  }

  window.CarbonFrontierTestingSync = Object.freeze({
    UPDATE_EVENT,
    isTestingEnvironment,
    getSnapshot,
    getSection,
    getLiveSiteUrl,
    resolveAssetUrl,
    configure,
    refresh,
    clear,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountToolbar, { once: true });
  } else {
    mountToolbar();
  }
})();
