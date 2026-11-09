const form = document.querySelector("#founder-waitlist-form");
const submitButton = document.querySelector("#waitlist-submit");
const message = document.querySelector("#waitlist-message");
const turnstileContainer = document.querySelector("#turnstile-container");
let turnstileWidgetId = null;
let turnstileToken = "";

function showMessage(text, state = "info") {
  if (!message) return;
  message.textContent = text;
  message.dataset.state = state;
}

function renderTurnstile(siteKey) {
  if (!turnstileContainer || !window.turnstile) return;
  turnstileWidgetId = window.turnstile.render(turnstileContainer, {
    sitekey: siteKey,
    callback(token) {
      turnstileToken = token;
      if (submitButton) submitButton.disabled = false;
      showMessage("Security check complete. You may submit your registration.", "info");
    },
    "expired-callback"() {
      turnstileToken = "";
      if (submitButton) submitButton.disabled = true;
      showMessage("Verification expired. Please complete the security check again.", "error");
    },
    "error-callback"() {
      turnstileToken = "";
      if (submitButton) submitButton.disabled = true;
      showMessage("Security verification service could not load. Try again later.", "error");
    },
  });
}

function loadTurnstile(siteKey) {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      try {
        renderTurnstile(siteKey);
        resolve();
      } catch (err) {
        reject(err);
      }
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      try {
        renderTurnstile(siteKey);
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    script.onerror = () => reject(new Error("turnstile_load_failed"));
    document.head.append(script);
  });
}

async function initialize() {
  try {
    const response = await fetch("/api/founder-waitlist/status", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const state = await response.json();
    if (!response.ok || state.available !== true) {
      showMessage(state.message || "The Founder Waitlist is not accepting registrations right now.", "error");
      if (submitButton) submitButton.disabled = true;
      return;
    }
    await loadTurnstile(state.turnstileSiteKey);
    showMessage("Complete the security check below to enable registration.", "info");
  } catch (err) {
    console.warn("Founder waitlist status check unavailable:", err);
    showMessage("Founder Waitlist status is currently unavailable. No registration has been sent.", "error");
    if (submitButton) submitButton.disabled = true;
  }
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    if (!turnstileToken) {
      showMessage("Complete the security check before submitting.", "error");
      return;
    }

    const privacyBox = document.querySelector("#privacy-acknowledged");
    const privacyAcknowledged = privacyBox && privacyBox.checked;
    if (!privacyAcknowledged) {
      showMessage("You must acknowledge the Privacy Notice to register.", "error");
      return;
    }

    const marketingBox = document.querySelector("#marketing-consent");
    const marketingSmsConsent = Boolean(marketingBox && marketingBox.checked);

    if (submitButton) submitButton.disabled = true;
    showMessage("Submitting registration to founder waitlist…", "info");

    const data = new FormData(form);
    const carrierName = (data.get("carrierName") || "").toString().trim().replace(/\s+/g, " ");
    const authorityType = (data.get("authorityType") || "MC").toString().trim().toUpperCase();
    const authorityNumber = (data.get("authorityNumber") || "").toString().trim().replace(/\D/g, "");
    const email = (data.get("email") || "").toString().trim().toLowerCase();
    const rawEquipment = (data.get("equipment") || "dry_van").toString().trim();
    const equipment = rawEquipment.includes("reefer") ? "reefer" : "dry_van";
    const truckCountRaw = parseInt(data.get("truckCount") || "1", 10);
    const truckCount = Number.isSafeInteger(truckCountRaw) && truckCountRaw > 0 ? truckCountRaw : 1;
    const phone = (data.get("phone") || "").toString().trim();

    const payload = {
      carrierName,
      authorityType,
      authorityNumber,
      email,
      equipment,
      truckCount,
      phone,
      privacyAcknowledged: true,
      marketingSmsConsent,
      turnstileToken,
    };

    try {
      const response = await fetch("/api/founder-waitlist/registrations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        turnstileToken = "";
        if (turnstileWidgetId !== null && window.turnstile) window.turnstile.reset(turnstileWidgetId);
        if (result.error === "duplicate_authority") {
          showMessage("A registration is already on file for that MC/USDOT authority. If you need to update details, please contact our desk.", "error");
        } else if (result.error === "waitlist_closed") {
          showMessage("The Founder Waitlist has closed after reaching the 5-converted carrier threshold.", "error");
        } else {
          showMessage("We could not complete your registration at this time. Please try again later.", "error");
        }
        return;
      }

      form.reset();
      turnstileToken = "";
      if (turnstileWidgetId !== null && window.turnstile) window.turnstile.reset(turnstileWidgetId);

      const isEligible = result.founderEligibility === "eligible";
      const confirmationText = isEligible
        ? `Registration confirmed! Reference: ${result.referenceCode}. Founder pricing eligibility is recorded; this is not carrier approval or a service start.`
        : `Registration received! Reference: ${result.referenceCode}. Identity review is required before founder eligibility can be confirmed; this is not carrier approval or a service start.`;
      showMessage(confirmationText, "success");
    } catch (err) {
      console.error("Waitlist submission network error:", err);
      turnstileToken = "";
      if (turnstileWidgetId !== null && window.turnstile) window.turnstile.reset(turnstileWidgetId);
      showMessage("Submission failed due to a network error. No data was recorded; please try again.", "error");
    } finally {
      if (!turnstileToken && submitButton) submitButton.disabled = true;
    }
  });
}

initialize();
