/**
 * Almajdoub Dispatch — Privacy-Conscious Web Analytics & Attribution Engine
 * -------------------------------------------------------------------------
 * Zero-PII, server-verifiable telemetry for acquisition & carrier funnel tracking.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "almajdoub_attribution_v1";
  const SESSION_KEY = "almajdoub_anon_session_v1";

  function getDeviceType() {
    const width = window.innerWidth;
    if (width < 640) return "mobile";
    if (width < 1024) return "tablet";
    return "desktop";
  }

  function getOrSetSessionId() {
    try {
      let id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = "s_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch {
      return "s_local";
    }
  }

  function extractAttribution() {
    const params = new URLSearchParams(window.location.search);
    const existing = (() => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    })();

    const detected = {};
    const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "ref", "plan"];
    for (const k of keys) {
      const val = params.get(k);
      if (val && typeof val === "string" && val.length < 100) {
        detected[k] = val.trim();
      }
    }

    const merged = {
      ...existing,
      ...detected,
      initial_landing: existing.initial_landing || window.location.pathname,
      first_seen: existing.first_seen || new Date().toISOString(),
      referrer: existing.referrer || document.referrer || "direct",
    };

    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {}

    return merged;
  }

  const attribution = extractAttribution();
  const sessionId = getOrSetSessionId();

  function track(eventName, properties = {}) {
    if (!eventName || typeof eventName !== "string") return;

    // Zero-PII Sanitization check: Ensure no contact or financial inputs leak
    const sanitizedProps = {};
    const blockedKeys = new Set(["phone", "email", "ssn", "ein", "password", "token", "mc", "dot", "address"]);
    for (const [k, v] of Object.entries(properties)) {
      const lower = k.toLowerCase();
      if (!blockedKeys.has(lower) && typeof v !== "object") {
        sanitizedProps[k] = v;
      }
    }

    const payload = {
      event: eventName,
      path: window.location.pathname,
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      device: getDeviceType(),
      attribution: {
        utm_source: attribution.utm_source || "direct",
        utm_medium: attribution.utm_medium || "none",
        utm_campaign: attribution.utm_campaign || "none",
        ref: attribution.ref || null,
      },
      properties: sanitizedProps,
    };

    const endpoint = "/api/track";
    const body = JSON.stringify(payload);

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(endpoint, blob);
      } else {
        fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {}
  }

  // Global API
  window.AlmajdoubAnalytics = {
    track,
    getAttribution: () => ({ ...attribution }),
    getSessionId: () => sessionId,
  };

  // Auto track page view
  track("page_view", { title: document.title });

  // Track primary CTA clicks automatically
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".button, .cta-button, a[href*='waitlist'], a[href*='onboarding']").forEach((el) => {
      el.addEventListener("click", () => {
        const text = (el.textContent || "").trim().slice(0, 50);
        const href = el.getAttribute("href") || "";
        track("primary_cta_click", { cta_text: text, target_url: href });
      });
    });
  });
})();
