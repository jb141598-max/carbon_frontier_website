(() => {
  "use strict";

  const AUTH_STORAGE_KEY = "carbon-frontier-google-session-v1";
  const ENDPOINTS = ["/api/wiki-auth", "/.netlify/functions/wiki-auth"];
  let pendingRegistration = null;
  let pendingResetEmail = "";

  const $ = (id) => document.getElementById(id);
  const panels = {
    login: $("login-panel"),
    register: $("register-panel"),
    reset: $("reset-panel"),
  };

  function setMode(mode) {
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== mode;
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === mode);
    });
  }

  function setFeedback(element, message, kind = "") {
    element.textContent = message || "";
    element.classList.toggle("is-error", kind === "error");
    element.classList.toggle("is-success", kind === "success");
  }

  function setBusy(form, busy) {
    form.querySelectorAll("button, input").forEach((element) => {
      if (element.matches("button")) element.disabled = Boolean(busy);
    });
  }

  async function callAuth(body) {
    let lastError = new Error("The wiki account service is unavailable.");
    for (const endpoint of ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => null);
        if (response.status === 404 && endpoint.startsWith("/api/")) continue;
        if (!response.ok) {
          const error = new Error(payload?.error || `Request failed (${response.status}).`);
          error.status = response.status;
          throw error;
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (error?.status && error.status !== 404) break;
      }
    }
    throw lastError;
  }

  function saveSession(payload) {
    const email = String(payload?.account?.email || "").trim().toLowerCase();
    const token = String(payload?.token || "").trim();
    if (!email || !token) throw new Error("The server did not return a valid sign-in session.");
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      email,
      name: String(payload?.account?.name || ""),
      picture: String(payload?.account?.picture || ""),
      idToken: token,
      authMethod: "password",
    }));
  }

  function returnUrl() {
    const raw = new URLSearchParams(location.search).get("return") || "/wiki";
    try {
      const url = new URL(raw, location.origin);
      if (url.origin === location.origin && url.pathname.startsWith("/")) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
    } catch (error) {}
    return "/wiki";
  }

  function finishLogin(payload) {
    saveSession(payload);
    location.assign(returnUrl());
  }

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const feedback = $("login-feedback");
    setBusy(form, true);
    setFeedback(feedback, "Signing in...");
    try {
      const payload = await callAuth({
        action: "login",
        email: $("login-email").value,
        password: $("login-password").value,
      });
      setFeedback(feedback, "Signed in. Opening the wiki...", "success");
      finishLogin(payload);
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      setBusy(form, false);
    }
  });

  async function requestRegistrationCode() {
    const form = $("register-form");
    const feedback = $("register-feedback");
    const password = $("register-password").value;
    if (password !== $("register-password-confirm").value) {
      setFeedback(feedback, "The two passwords do not match.", "error");
      return;
    }
    setBusy(form, true);
    setFeedback(feedback, "Sending verification code...");
    try {
      const payload = await callAuth({
        action: "register",
        email: $("register-email").value,
        password,
      });
      pendingRegistration = {
        email: String(payload.email || $("register-email").value).trim().toLowerCase(),
        password,
      };
      $("register-email").value = pendingRegistration.email;
      $("register-verify-box").hidden = false;
      $("register-code").focus();
      setFeedback(feedback, payload.message || "Verification code sent.", "success");
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      setBusy(form, false);
    }
  }

  $("register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await requestRegistrationCode();
  });

  $("register-resend").addEventListener("click", async () => {
    await requestRegistrationCode();
  });

  $("register-verify-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const feedback = $("register-feedback");
    const email = pendingRegistration?.email || $("register-email").value;
    setBusy(form, true);
    setFeedback(feedback, "Checking verification code...");
    try {
      const payload = await callAuth({
        action: "verify_registration",
        email,
        code: $("register-code").value,
      });
      setFeedback(feedback, "Email verified. Opening the wiki...", "success");
      finishLogin(payload);
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      setBusy(form, false);
    }
  });

  $("reset-request-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const feedback = $("reset-feedback");
    setBusy(form, true);
    setFeedback(feedback, "Requesting reset code...");
    try {
      const payload = await callAuth({
        action: "forgot_password",
        email: $("reset-email").value,
      });
      pendingResetEmail = String(payload.email || $("reset-email").value).trim().toLowerCase();
      $("reset-email").value = pendingResetEmail;
      $("reset-verify-box").hidden = false;
      $("reset-code").focus();
      setFeedback(feedback, payload.message || "If the account exists, a reset code was sent.", "success");
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      setBusy(form, false);
    }
  });

  $("reset-verify-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const feedback = $("reset-feedback");
    const password = $("reset-password").value;
    if (password !== $("reset-password-confirm").value) {
      setFeedback(feedback, "The two passwords do not match.", "error");
      return;
    }
    setBusy(form, true);
    setFeedback(feedback, "Resetting password...");
    try {
      const payload = await callAuth({
        action: "reset_password",
        email: pendingResetEmail || $("reset-email").value,
        code: $("reset-code").value,
        newPassword: password,
      });
      setFeedback(feedback, "Password reset. Opening the wiki...", "success");
      finishLogin(payload);
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      setBusy(form, false);
    }
  });
})();
