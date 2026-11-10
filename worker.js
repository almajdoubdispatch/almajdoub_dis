/**
 * Almajdoub Dispatch — Standalone Production Cloudflare Worker
 * -------------------------------------------------------------
 * 1. 301 Canonical redirect (www.almajdoubdispatch.com -> almajdoubdispatch.com)
 * 2. Strict HTTP security headers
 * 3. Secure Founder Waitlist APIs (Turnstile verification + Atomic Supabase RPC)
 * 4. Digital Carrier Onboarding Submission API
 * 5. Owner Administration APIs (HMAC-SHA256 Auth, Metrics, Pipeline, Telemetry)
 * 6. Privacy Analytics Telemetry Ingestion
 * 7. Static Asset Serving (env.ASSETS)
 */

const MAX_BODY_BYTES = 8_192;
const QUALIFYING_CARRIER_THRESHOLD = 5;
const recentTelemetryEvents = [];
const MAX_TELEMETRY = 100;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-frame-options": "SAMEORIGIN",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    },
  });
}

function configuration(env) {
  let supabaseUrl;
  try {
    const parsed = new URL(env.SUPABASE_URL || "");
    if (parsed.protocol !== "https:") return null;
    supabaseUrl = parsed.origin;
  } catch {
    return null;
  }

  if (
    env.FOUNDER_WAITLIST_ENABLED !== "true" ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !env.TURNSTILE_SECRET_KEY ||
    !env.TURNSTILE_SITE_KEY ||
    !env.FOUNDER_PRIVACY_NOTICE_VERSION
  ) return null;

  return {
    supabaseUrl,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    turnstileSecret: env.TURNSTILE_SECRET_KEY,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    privacyVersion: env.FOUNDER_PRIVACY_NOTICE_VERSION,
  };
}

function supabaseHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
}

async function readWaitlistState(env, fetcher = fetch) {
  const config = configuration(env);
  if (!config) return { ready: false };

  try {
    const response = await fetcher(
      `${config.supabaseUrl}/rest/v1/rpc/founder_waitlist_status`,
      {
        method: "POST",
        headers: supabaseHeaders(config.serviceKey),
        body: "{}",
      },
    );
    if (!response.ok) return { ready: false };
    const gate = await response.json();
    if (!gate || typeof gate !== "object" || typeof gate.open !== "boolean") return { ready: false };
    const qualifyingCount = Number(gate.qualifyingCount);
    if (!Number.isSafeInteger(qualifyingCount) || qualifyingCount < 0 || qualifyingCount > QUALIFYING_CARRIER_THRESHOLD) {
      return { ready: false };
    }
    return {
      ready: true,
      open: gate.open && qualifyingCount < QUALIFYING_CARRIER_THRESHOLD,
      turnstileSiteKey: config.turnstileSiteKey,
      privacyVersion: config.privacyVersion,
    };
  } catch {
    return { ready: false };
  }
}

function validateRegistration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const allowed = new Set([
    "carrierName", "authorityType", "authorityNumber", "email",
    "equipment", "truckCount", "phone", "privacyAcknowledged", "marketingSmsConsent", "turnstileToken",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return null;

  const carrierName = typeof input.carrierName === "string"
    ? input.carrierName.trim().replace(/\s+/g, " ")
    : "";
  const authorityType = typeof input.authorityType === "string" ? input.authorityType.trim().toUpperCase() : "";
  const authorityNumber = typeof input.authorityNumber === "string"
    ? input.authorityNumber.replace(/\D/g, "")
    : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const equipment = typeof input.equipment === "string" ? input.equipment.trim() : "";
  const truckCount = Number(input.truckCount);
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const phoneDigits = phone.replace(/\D/g, "");
  const turnstileToken = typeof input.turnstileToken === "string" ? input.turnstileToken.trim() : "";
  const marketingSmsConsent = input.marketingSmsConsent === true;

  if (carrierName.length < 2 || carrierName.length > 160) return null;
  if (!["MC", "USDOT"].includes(authorityType)) return null;
  if (!/^\d{1,12}$/.test(authorityNumber)) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!["dry_van", "reefer"].includes(equipment)) return null;
  if (!Number.isSafeInteger(truckCount) || truckCount < 1 || truckCount > 2_147_483_647) return null;
  if (phoneDigits.length < 10 || phoneDigits.length > 15 || !/^\+?[0-9 ()-]+$/.test(phone)) return null;
  if (input.privacyAcknowledged !== true) return null;
  if (turnstileToken.length < 10 || turnstileToken.length > 2_048) return null;

  return {
    carrierName,
    authorityType,
    authorityNumber,
    email,
    equipment,
    truckCount,
    phone,
    turnstileToken,
    marketingSmsConsent,
  };
}

async function onStatusGet({ env }, fetcher = fetch) {
  const state = await readWaitlistState(env, fetcher);
  if (!state.ready) {
    return jsonResponse({ available: false, message: "Registration is temporarily unavailable." }, 503);
  }
  if (!state.open) {
    return jsonResponse({ available: false, closed: true, message: "The Founder Waitlist is closed." });
  }
  return jsonResponse({
    available: true,
    turnstileSiteKey: state.turnstileSiteKey,
    privacyNoticeVersion: state.privacyVersion,
  });
}

async function onRegistrationPost({ request, env }, fetcher = fetch) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!origin || origin !== requestUrl.origin) {
    return jsonResponse({ error: "same_origin_required" }, 403);
  }
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    return jsonResponse({ error: "json_required" }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return jsonResponse({ error: "request_too_large" }, 413);
  let raw;
  let input;
  try {
    raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return jsonResponse({ error: "request_too_large" }, 413);
    input = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const registration = validateRegistration(input);
  if (!registration) return jsonResponse({ error: "invalid_registration" }, 400);

  const config = configuration(env);
  if (!config) return jsonResponse({ error: "registration_unavailable" }, 503);

  const turnstile = new URLSearchParams({
    secret: config.turnstileSecret,
    response: registration.turnstileToken,
  });
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) turnstile.set("remoteip", clientIp);

  try {
    const verifyResponse = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: turnstile,
    });
    if (!verifyResponse.ok) return jsonResponse({ error: "verification_unavailable" }, 503);
    const verified = await verifyResponse.json();
    const officialTestSecret = "1x0000000000000000000000000000000AA";
    const isLoopbackPreview = ["localhost", "127.0.0.1", "[::1]"].includes(requestUrl.hostname);
    const officialLocalTest = config.turnstileSecret === officialTestSecret &&
      isLoopbackPreview && verified.hostname === "example.com";
    if (verified.success !== true || (verified.hostname !== requestUrl.hostname && !officialLocalTest)) {
      return jsonResponse({ error: "verification_failed" }, 422);
    }
  } catch {
    return jsonResponse({ error: "verification_unavailable" }, 503);
  }

  const referenceCode = `ADW-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const rpcInput = {
    p_reference_code: referenceCode,
    p_carrier_name: registration.carrierName,
    p_authority_type: registration.authorityType,
    p_authority_number: registration.authorityNumber,
    p_email: registration.email,
    p_equipment: registration.equipment,
    p_truck_count: registration.truckCount,
    p_phone: registration.phone,
    p_privacy_notice_version: config.privacyVersion,
    p_privacy_acknowledged: true,
  };

  try {
    const insertResponse = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/register_founder_waitlist`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(config.serviceKey),
      },
      body: JSON.stringify(rpcInput),
    });
    if (!insertResponse.ok) {
      let databaseError = {};
      try { databaseError = await insertResponse.json(); } catch {}
      const code = databaseError.code || "";
      const message = databaseError.message || databaseError.error || "";
      if (message === "waitlist_closed") return jsonResponse({ error: "waitlist_closed" }, 409);
      if (["duplicate_authority", "duplicate_identity"].includes(message)) {
        return jsonResponse({ error: "duplicate_authority" }, 409);
      }
      if (message === "invalid_registration") return jsonResponse({ error: "invalid_registration" }, 400);
      if (code === "23505" && String(databaseError.details || "").includes("founder_waitlist_authority_unique")) {
        return jsonResponse({ error: "duplicate_authority" }, 409);
      }
      return jsonResponse({ error: "registration_unavailable" }, 503);
    }
    let result = await insertResponse.json();
    if (Array.isArray(result)) [result] = result;
    if (!result || result.outcome !== "registered" || !result.reference_code) {
      return jsonResponse({ error: "registration_unavailable" }, 503);
    }
    const identityVerified = result.identity_status === "VERIFIED" && Boolean(result.founder_eligible_at);
    return jsonResponse({
      ok: true,
      referenceCode: result.reference_code,
      identityStatus: result.identity_status,
      founderEligibility: identityVerified ? "eligible" : "pending_identity_review",
    }, 201);
  } catch {
    return jsonResponse({ error: "registration_unavailable" }, 503);
  }
}

async function signToken(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret || "almajdoub_secure_owner_key_2026"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = JSON.stringify(payload);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
  return btoa(data) + "." + sigHex;
}

async function verifyToken(secret, token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [dataB64, sigHex] = token.split(".");
  try {
    const enc = new TextEncoder();
    const data = atob(dataB64);
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret || "almajdoub_secure_owner_key_2026"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(data));
    if (!valid) return null;
    const payload = JSON.parse(data);
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Canonical Redirect: www.almajdoubdispatch.com -> almajdoubdispatch.com
    if (url.hostname.startsWith("www.")) {
      const canonicalHost = url.hostname.replace(/^www\./, "");
      const target = `https://${canonicalHost}${url.pathname}${url.search}`;
      return Response.redirect(target, 301);
    }

    // Helper to add security headers to any Response
    const addSecurityHeaders = (response) => {
      const headers = new Headers(response.headers);
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "strict-origin-when-cross-origin");
      headers.set("x-frame-options", "SAMEORIGIN");
      headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };

    // 2. ROUTE: Founder Waitlist Status & Registrations
    if (url.pathname === "/api/founder-waitlist/status" && request.method === "GET") {
      const res = await onStatusGet({ request, env });
      return addSecurityHeaders(res);
    }
    if (url.pathname === "/api/founder-waitlist/registrations" && request.method === "POST") {
      const res = await onRegistrationPost({ request, env });
      return addSecurityHeaders(res);
    }

    // 3. ROUTE: Privacy Analytics Telemetry
    if (url.pathname === "/api/track" && request.method === "POST") {
      try {
        const body = await request.json();
        if (body && typeof body === "object") {
          recentTelemetryEvents.unshift({
            timestamp: body.timestamp || new Date().toISOString(),
            event: String(body.event || "unknown").slice(0, 50),
            path: String(body.path || "/").slice(0, 100),
            device: String(body.device || "desktop").slice(0, 20),
            attribution: body.attribution || {},
          });
          if (recentTelemetryEvents.length > MAX_TELEMETRY) recentTelemetryEvents.pop();
        }
      } catch {}
      return addSecurityHeaders(jsonResponse({ ok: true }));
    }

    // 4. ROUTE: Digital Carrier Onboarding Submission
    if (url.pathname === "/api/onboarding/submit" && request.method === "POST") {
      try {
        const body = await request.json();
        const ref = body.application_reference || `APP-${Date.now().toString(36).toUpperCase()}`;

        // Save to Supabase inquiries as dedicated digital onboarding lead
        if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
          const payload = {
            name: body.contact_name || body.carrier_name,
            company_name: body.carrier_name,
            phone: body.phone,
            email: body.email,
            mc_number: body.mc_number,
            dot_number: body.dot_number,
            equipment_type: body.equipment_type === "53_reefer" ? "53_reefer" : "53_dry_van",
            truck_count: body.truck_count || 1,
            preferred_lanes: body.preferred_lanes,
            source: "Digital Onboarding Application",
            status: "NEW_LEAD",
            notes: `Full Onboarding Reference: ${ref}. Plan: ${body.selected_plan}. Units: ${body.truck_count}. Signer: ${body.electronic_signature?.signer_name || "N/A"} (${body.electronic_signature?.signer_title || "N/A"}).`,
            tcpa_consent: false,
          };

          await fetch(`${env.SUPABASE_URL}/rest/v1/inquiries`, {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              "content-type": "application/json",
              prefer: "return=minimal",
            },
            body: JSON.stringify(payload),
          });
        }

        return addSecurityHeaders(jsonResponse({ ok: true, reference: ref }, 201));
      } catch (err) {
        return addSecurityHeaders(jsonResponse({ error: "onboarding_failed" }, 500));
      }
    }

    // 5. ROUTE: Owner Authentication Login
    if (url.pathname === "/api/owner/login" && request.method === "POST") {
      try {
        const { username, password } = await request.json();
        const configuredAdminUser = env.OWNER_ADMIN_USER || "admin";
        const configuredAdminPass = env.OWNER_ADMIN_PASSWORD || "AlmajdoubDispatch2026!";

        // Secure credential validation
        if (username === configuredAdminUser && password === configuredAdminPass) {
          const token = await signToken(env.SUPABASE_SERVICE_ROLE_KEY || "owner_secret", {
            user: username,
            role: "owner",
            exp: Date.now() + 8 * 3600 * 1000, // 8 hour session
          });
          return addSecurityHeaders(jsonResponse({ token, user: username }));
        }

        return addSecurityHeaders(jsonResponse({ error: "Invalid username or password" }, 401));
      } catch {
        return addSecurityHeaders(jsonResponse({ error: "Authentication failed" }, 400));
      }
    }

    // 6. ROUTE: Protected Owner APIs
    if (url.pathname.startsWith("/api/owner/")) {
      const authHeader = request.headers.get("authorization") || "";
      const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
      const session = await verifyToken(env.SUPABASE_SERVICE_ROLE_KEY || "owner_secret", bearerToken);

      if (!session) {
        return addSecurityHeaders(jsonResponse({ error: "Unauthorized access" }, 401));
      }

      // Telemetry Events stream
      if (url.pathname === "/api/owner/telemetry" && request.method === "GET") {
        return addSecurityHeaders(jsonResponse({ events: recentTelemetryEvents }));
      }

      // Live Metrics
      if (url.pathname === "/api/owner/metrics" && request.method === "GET") {
        let founderCount = 0;
        let pendingInquiries = 0;

        if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const gateRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/founder_waitlist_status`, {
              method: "POST",
              headers: supabaseHeaders(env.SUPABASE_SERVICE_ROLE_KEY),
              body: "{}",
            });
            if (gateRes.ok) {
              const gate = await gateRes.json();
              founderCount = gate.qualifyingCount || 0;
            }

            const inqRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inquiries?select=id&limit=100`, {
              headers: supabaseHeaders(env.SUPABASE_SERVICE_ROLE_KEY),
            });
            if (inqRes.ok) {
              const inqs = await inqRes.json();
              pendingInquiries = inqs.length;
            }
          } catch {}
        }

        return addSecurityHeaders(jsonResponse({
          founderCapacity: { used: founderCount, max: 5 },
          activePipelineCount: pendingInquiries,
          fleetCount: 0,
          pendingApplications: pendingInquiries,
        }));
      }

      // Full Applications list
      if (url.pathname === "/api/owner/applications" && request.method === "GET") {
        let items = [];
        if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const inqRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inquiries?order=created_at.desc&limit=50`, {
              headers: supabaseHeaders(env.SUPABASE_SERVICE_ROLE_KEY),
            });
            if (inqRes.ok) {
              items = await inqRes.json();
            }
          } catch {}
        }
        return addSecurityHeaders(jsonResponse({ applications: items }));
      }
    }

    // 7. DEFAULT: Fallback to Cloudflare Static Assets (HTML, CSS, JS)
    return env.ASSETS.fetch(request);
  },
};
