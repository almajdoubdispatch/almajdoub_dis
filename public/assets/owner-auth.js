/**
 * Almajdoub Dispatch — Owner Portal Authentication Client
 * --------------------------------------------------------
 * Manages admin session validation, login, rate-limiting, and logout.
 */
(function () {
  "use strict";

  const SESSION_TOKEN_KEY = "almajdoub_owner_token_v1";
  const ATTEMPTS_KEY = "almajdoub_login_fails_v1";
  const LOCKOUT_KEY = "almajdoub_lockout_until_v1";
  const MAX_FAILS = 5;
  const LOCK_DURATION_MS = 60000; // 1 minute lockout

  const loginForm = document.querySelector("#owner-login-form");
  const loginMessage = document.querySelector("#login-message");
  const submitBtn = document.querySelector("#login-submit-btn");

  function showMessage(text, state = "info") {
    if (!loginMessage) return;
    loginMessage.textContent = text;
    loginMessage.dataset.state = state;
  }

  function isLockedOut() {
    const lockUntil = parseInt(sessionStorage.getItem(LOCKOUT_KEY) || "0", 10);
    const now = Date.now();
    if (lockUntil > now) {
      const remainingSecs = Math.ceil((lockUntil - now) / 1000);
      showMessage(`Too many failed attempts. Try again in ${remainingSecs} seconds.`, "error");
      return true;
    }
    return false;
  }

  function recordFail() {
    let fails = parseInt(sessionStorage.getItem(ATTEMPTS_KEY) || "0", 10) + 1;
    sessionStorage.setItem(ATTEMPTS_KEY, fails.toString());
    if (fails >= MAX_FAILS) {
      sessionStorage.setItem(LOCKOUT_KEY, (Date.now() + LOCK_DURATION_MS).toString());
      sessionStorage.setItem(ATTEMPTS_KEY, "0");
      showMessage("Too many failed attempts. Login locked for 60 seconds.", "error");
    }
  }

  function resetFails() {
    sessionStorage.removeItem(ATTEMPTS_KEY);
    sessionStorage.removeItem(LOCKOUT_KEY);
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (isLockedOut()) return;

      const username = (document.querySelector("#owner-username")?.value || "").trim();
      const password = (document.querySelector("#owner-password")?.value || "").trim();

      if (!username || !password) {
        showMessage("Please provide both username and password.", "error");
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      showMessage("Authenticating credentials…", "info");

      try {
        const response = await fetch("/api/owner/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ username, password }),
        });

        const data = await response.json();
        if (!response.ok || !data.token) {
          recordFail();
          showMessage(data.error || "Invalid credentials or unauthorized access.", "error");
          return;
        }

        // Success
        resetFails();
        sessionStorage.setItem(SESSION_TOKEN_KEY, data.token);
        sessionStorage.setItem("almajdoub_owner_user", data.user || username);
        showMessage("Authenticated successfully. Redirecting to console…", "success");
        setTimeout(() => {
          window.location.href = "index.html";
        }, 400);
      } catch (err) {
        console.error("Login request error:", err);
        recordFail();
        showMessage("Connection error during authentication. Please retry.", "error");
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  function getSessionToken() {
    return sessionStorage.getItem(SESSION_TOKEN_KEY);
  }

  function logout() {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem("almajdoub_owner_user");
    window.location.href = "login.html";
  }

  window.AlmajdoubOwnerAuth = {
    getSessionToken,
    logout,
  };
})();
