(function () {
  "use strict";

  const SNAPSHOT_STORAGE_KEY = "carbon-frontier-testing-snapshot-v1";
  const LIVE_URL_STORAGE_KEY = "carbon-frontier-testing-live-url-v1";
  const SYNC_KEY_STORAGE_KEY = "carbon-frontier-testing-sync-key-v1";
  const TOOLBAR_HIDDEN_STORAGE_KEY = "carbon-frontier-testing-toolbar-hidden-v1";
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
  let connectionForm = null;
  let liveUrlInput = null;
  let syncKeyInput = null;

  function isToolbarHidden() {
    return readStorage(window.localStorage, TOOLBAR_HIDDEN_STORAGE_KEY) === "1";
  }

  function hideToolbar() {
    if (!toolbar) {
      return;
    }
    toolbar.hidden = true;
    writeStorage(window.localStorage, TOOLBAR_HIDDEN_STORAGE_KEY, "1");
  }

  function showToolbar() {
    if (!toolbar) {
      return;
    }
    removeStorage(window.localStorage, TOOLBAR_HIDDEN_STORAGE_KEY);
    toolbar.hidden = false;
    setStatus(formatSnapshotStatus());
  }

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

  function setConnectionFormOpen(isOpen) {
    if (!connectionForm) {
      return;
    }
    connectionForm.hidden = !isOpen;
    if (isOpen) {
      liveUrlInput.value = getLiveSiteUrl();
      syncKeyInput.value = "";
      window.setTimeout(() => liveUrlInput.focus(), 0);
    }
  }

  function configure() {
    setConnectionFormOpen(true);
    setStatus("Enter the live Netlify address and your private testing code below.");
    return false;
  }

  function setInputValue(input, value) {
    if (!input) {
      return;
    }
    input.value = String(value || "").trim();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
  }

  function allowNativePaste(input) {
    input.addEventListener("keydown", (event) => {
      // Keep Cursor/page-wide shortcuts from intercepting typing or Command+V
      // while either connection field is focused.
      event.stopPropagation();
    });
    input.addEventListener("paste", (event) => {
      event.stopPropagation();
      const pastedText = event.clipboardData?.getData("text");
      if (typeof pastedText !== "string" || pastedText.length === 0) {
        return;
      }

      event.preventDefault();
      const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
      const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
      const nextValue = `${input.value.slice(0, start)}${pastedText}${input.value.slice(end)}`;
      setInputValue(input, nextValue);
    });
  }

  async function pasteFromClipboard(input, description) {
    input?.focus();
    try {
      if (!window.navigator?.clipboard?.readText) {
        throw new Error("Clipboard reading is unavailable in this Cursor preview.");
      }
      const clipboardText = await window.navigator.clipboard.readText();
      if (!clipboardText) {
        throw new Error("Your clipboard is empty.");
      }
      setInputValue(input, clipboardText);
      setStatus(`${description} pasted from your clipboard.`, "success");
      return true;
    } catch (error) {
      setStatus(
        `${error?.message || "Cursor blocked clipboard access."} You can also right-click the box and choose Paste.`,
        "error"
      );
      return false;
    }
  }

  async function saveConnection(event) {
    event.preventDefault();
    const liveUrl = normalizeLiveSiteUrl(liveUrlInput?.value);
    const syncKey = String(syncKeyInput?.value || "").trim();

    if (!liveUrl) {
      setStatus("Enter a valid live website address, including the .netlify.app domain.", "error");
      liveUrlInput?.focus();
      return false;
    }
    if (!syncKey) {
      setStatus("Enter the CURSOR_TESTING_SYNC_KEY value from Netlify.", "error");
      syncKeyInput?.focus();
      return false;
    }

    writeStorage(window.localStorage, LIVE_URL_STORAGE_KEY, liveUrl);
    writeStorage(window.sessionStorage, SYNC_KEY_STORAGE_KEY, syncKey);
    setConnectionFormOpen(false);
    setStatus(`Connection saved for ${liveUrl}. Downloading live data…`, "success");
    return refresh();
  }

  async function refresh() {
    let liveUrl = getLiveSiteUrl();
    let syncKey = getSyncKey();
    if (!liveUrl || !syncKey) {
      configure();
      return false;
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
      if (
        !payload ||
        typeof payload !== "object" ||
        ![1, 2, 3, 4].includes(payload.schemaVersion)
      ) {
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
        width: min(420px, calc(100vw - 32px));
        padding: 14px;
        border: 1px solid rgba(142, 230, 190, 0.5);
        border-radius: 14px;
        background: rgba(11, 19, 17, 0.97);
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.42);
        color: #f4fff9;
        font: 600 13px/1.35 Inter, ui-sans-serif, system-ui, sans-serif;
      }
      .cf-testing-toolbar[hidden] { display: none !important; }
      .cf-testing-toolbar__topline {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 0 0 5px;
      }
      .cf-testing-toolbar__title {
        margin: 0;
        color: #8ee6be;
        font-size: 12px;
        letter-spacing: 0.12em;
      }
      .cf-testing-toolbar__close {
        width: 28px;
        height: 28px;
        display: inline-grid;
        place-items: center;
        flex: 0 0 auto;
        padding: 0 !important;
        border-radius: 999px !important;
        font-size: 20px !important;
        line-height: 1 !important;
      }
      .cf-testing-toolbar__status {
        margin: 0 0 11px;
        color: rgba(244, 255, 249, 0.76);
        font-weight: 500;
      }
      .cf-testing-toolbar__status[data-type="success"] { color: #b9f5d7; }
      .cf-testing-toolbar__status[data-type="error"] { color: #ffb7bd; }
      .cf-testing-toolbar__actions { display: flex; flex-wrap: wrap; gap: 7px; }
      .cf-testing-toolbar__connection[hidden] { display: none !important; }
      .cf-testing-toolbar__connection {
        display: grid;
        gap: 9px;
        margin: 0 0 11px;
        padding: 11px;
        border: 1px solid rgba(142, 230, 190, 0.22);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
      }
      .cf-testing-toolbar__field {
        display: grid;
        gap: 5px;
        color: rgba(244, 255, 249, 0.82);
        font-size: 12px;
      }
      .cf-testing-toolbar input {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 8px;
        padding: 9px 10px;
        outline: none;
        background: rgba(0, 0, 0, 0.28);
        color: #f4fff9;
        font: 500 13px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .cf-testing-toolbar input:focus {
        border-color: #8ee6be;
        box-shadow: 0 0 0 2px rgba(142, 230, 190, 0.14);
      }
      .cf-testing-toolbar__field-control {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 7px;
        align-items: stretch;
      }
      .cf-testing-toolbar__paste {
        min-width: 62px;
      }
      .cf-testing-toolbar__hint {
        margin: 0;
        color: rgba(244, 255, 249, 0.58);
        font-size: 11px;
        font-weight: 500;
      }
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
      <div class="cf-testing-toolbar__topline">
        <p class="cf-testing-toolbar__title">CURSOR LIVE TESTING</p>
        <button
          class="cf-testing-toolbar__close"
          type="button"
          data-action="hide-toolbar"
          aria-label="Hide live testing panel"
          title="Hide live testing panel"
        >&times;</button>
      </div>
      <p class="cf-testing-toolbar__status" aria-live="polite"></p>
      <form class="cf-testing-toolbar__connection" data-connection-form hidden>
        <div class="cf-testing-toolbar__field">
          <label for="cf-testing-live-url">Live Netlify website</label>
          <span class="cf-testing-toolbar__field-control">
            <input
              id="cf-testing-live-url"
              name="live-url"
              type="url"
              inputmode="url"
              autocomplete="url"
              placeholder="https://your-site.netlify.app"
              required
            />
            <button class="cf-testing-toolbar__paste" type="button" data-action="paste-url">
              Paste
            </button>
          </span>
        </div>
        <div class="cf-testing-toolbar__field">
          <label for="cf-testing-sync-key">Private testing code</label>
          <span class="cf-testing-toolbar__field-control">
            <input
              id="cf-testing-sync-key"
              name="sync-key"
              type="password"
              autocomplete="off"
              placeholder="CURSOR_TESTING_SYNC_KEY value"
              required
            />
            <button class="cf-testing-toolbar__paste" type="button" data-action="paste-key">
              Paste
            </button>
          </span>
        </div>
        <p class="cf-testing-toolbar__hint">
          The code is kept only for this Cursor browser session.
        </p>
        <div class="cf-testing-toolbar__actions">
          <button type="submit" data-primary="true">Connect &amp; Download</button>
          <button type="button" data-action="cancel-connection">Cancel</button>
        </div>
      </form>
      <div class="cf-testing-toolbar__actions">
        <button type="button" data-action="refresh" data-primary="true">Refresh Live Data</button>
        <button type="button" data-action="configure">Set Connection</button>
        <button type="button" data-action="clear">Disconnect Copy</button>
      </div>
    `;
    document.body.appendChild(toolbar);
    toolbar.hidden = isToolbarHidden();
    statusElement = toolbar.querySelector(".cf-testing-toolbar__status");
    refreshButton = toolbar.querySelector('[data-action="refresh"]');
    connectionForm = toolbar.querySelector("[data-connection-form]");
    liveUrlInput = connectionForm.querySelector('[name="live-url"]');
    syncKeyInput = connectionForm.querySelector('[name="sync-key"]');
    allowNativePaste(liveUrlInput);
    allowNativePaste(syncKeyInput);
    setStatus(formatSnapshotStatus());

    refreshButton.addEventListener("click", refresh);
    toolbar.querySelector('[data-action="hide-toolbar"]').addEventListener("click", hideToolbar);
    toolbar.querySelector('[data-action="configure"]').addEventListener("click", configure);
    toolbar
      .querySelector('[data-action="cancel-connection"]')
      .addEventListener("click", () => {
        setConnectionFormOpen(false);
        setStatus(formatSnapshotStatus());
      });
    connectionForm.addEventListener("submit", saveConnection);
    toolbar
      .querySelector('[data-action="paste-url"]')
      .addEventListener("click", () => pasteFromClipboard(liveUrlInput, "Website address"));
    toolbar
      .querySelector('[data-action="paste-key"]')
      .addEventListener("click", () => pasteFromClipboard(syncKeyInput, "Private testing code"));
    toolbar.querySelector('[data-action="clear"]').addEventListener("click", clear);

    document.querySelectorAll("[data-testing-toolbar-show]").forEach((button) => {
      button.hidden = false;
      button.addEventListener("click", showToolbar);
    });
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
    hideToolbar,
    showToolbar,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountToolbar, { once: true });
  } else {
    mountToolbar();
  }
})();
