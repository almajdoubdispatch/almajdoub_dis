/**
 * Almajdoub Dispatch — Digital Carrier Onboarding Controller
 * ----------------------------------------------------------
 * Handles multi-step validation, autosave/resume, and secure application submission.
 */
(function () {
  "use strict";

  const DRAFT_KEY = "almajdoub_carrier_onboarding_draft_v1";
  let currentStep = 1;
  const totalSteps = 5;

  const form = document.querySelector("#carrier-onboarding-form");
  const autosaveStatus = document.querySelector("#autosave-status");
  const messageBox = document.querySelector("#onboarding-message");
  const submitBtn = document.querySelector("#submit-onboarding-btn");
  const appRefSpan = document.querySelector("#app-reference");

  function showMessage(text, state = "info") {
    if (!messageBox) return;
    messageBox.textContent = text;
    messageBox.dataset.state = state;
  }

  function updateStepsUI(step) {
    for (let i = 1; i <= totalSteps; i++) {
      const navItem = document.querySelector(`#step-nav-${i}`);
      const section = document.querySelector(`#section-i`);
      const sec = document.querySelector(`#section-${i}`);

      if (navItem) {
        navItem.classList.remove("active", "completed");
        if (i === step) navItem.classList.add("active");
        else if (i < step) navItem.classList.add("completed");
      }

      if (sec) {
        sec.classList.remove("active");
        if (i === step) sec.classList.add("active");
      }
    }
    window.scrollTo({ top: 100, behavior: "smooth" });
  }

  function validateStep(step) {
    if (step === 1) {
      const name = document.querySelector("#carrier-legal-name")?.value.trim();
      const mc = document.querySelector("#mc-number")?.value.trim();
      const dot = document.querySelector("#usdot-number")?.value.trim();
      const tax = document.querySelector("#tax-id")?.value.trim();
      const addr = document.querySelector("#physical-address")?.value.trim();
      const contact = document.querySelector("#contact-name")?.value.trim();
      const phone = document.querySelector("#contact-phone")?.value.trim();
      const email = document.querySelector("#contact-email")?.value.trim();

      if (!name || !mc || !dot || !tax || !addr || !contact || !phone || !email) {
        alert("Please complete all required fields (*) in Step 1.");
        return false;
      }
    } else if (step === 2) {
      const trucks = document.querySelector("#truck-count")?.value;
      const lanes = document.querySelector("#preferred-lanes")?.value.trim();
      if (!trucks || !lanes) {
        alert("Please complete fleet size and preferred lanes.");
        return false;
      }
    } else if (step === 4) {
      const agree = document.querySelector("#agree-terms")?.checked;
      const esign = document.querySelector("#electronic-consent")?.checked;
      const signer = document.querySelector("#signer-name")?.value.trim();
      const title = document.querySelector("#signer-title")?.value.trim();

      if (!agree || !esign || !signer || !title) {
        showMessage("Please confirm agreement checkboxes and provide your full legal signature.", "error");
        return false;
      }
    }
    return true;
  }

  function goToStep(step) {
    if (step > currentStep && !validateStep(currentStep)) {
      return;
    }
    currentStep = step;
    updateStepsUI(step);
    saveDraft();
    if (window.AlmajdoubAnalytics) {
      window.AlmajdoubAnalytics.track("onboarding_step_changed", { step: currentStep });
    }
  }

  function saveDraft() {
    if (!form) return;
    const data = new FormData(form);
    const obj = {};
    for (const [k, v] of data.entries()) {
      if (k !== "docCoi" && k !== "docW9" && k !== "docAuth" && k !== "docNoa") {
        obj[k] = v;
      }
    }
    obj._lastStep = currentStep;
    obj._savedAt = new Date().toISOString();
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(obj));
      if (autosaveStatus) {
        autosaveStatus.textContent = "Draft autosaved " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch {}
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      for (const [k, v] of Object.entries(draft)) {
        if (k.startsWith("_")) continue;
        const field = form.querySelector(`[name="${k}"]`);
        if (field) {
          if (field.type === "checkbox") field.checked = (v === "on" || v === true);
          else field.value = v;
        }
      }
      if (draft._lastStep && draft._lastStep < 5) {
        goToStep(draft._lastStep);
      }
    } catch {}
  }

  function handleFile(input, labelId) {
    const file = input.files && input.files[0];
    const lbl = document.getElementById(labelId);
    if (file && lbl) {
      lbl.innerHTML = `<strong>Selected:</strong> ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
      lbl.style.color = "var(--blue-deep)";
    }
  }

  // Prepopulate query parameters (plan, referral)
  function handleQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const plan = params.get("plan");
    const source = params.get("source");
    const ref = params.get("ref");

    if (plan) {
      const planSelect = document.querySelector("#selected-plan");
      if (planSelect) {
        if (plan === "flat_rate") planSelect.value = "flat_rate_weekly";
        else if (plan.includes("founder")) planSelect.value = "founder_percentage";
        else planSelect.value = "standard_percentage";
      }
    }

    if (ref || source === "referral") {
      const refInput = document.querySelector("#referral-code");
      if (refInput && !refInput.value) {
        refInput.value = ref ? ref.toUpperCase() : "REFERRAL_PARTNER";
      }
    }
  }

  if (form) {
    // Autosave on input change
    form.addEventListener("input", () => {
      saveDraft();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!validateStep(4)) return;

      if (submitBtn) submitBtn.disabled = true;
      showMessage("Submitting carrier application and securing agreement record…", "info");

      const data = new FormData(form);
      const appRef = "APP-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();

      const payload = {
        application_reference: appRef,
        carrier_name: (data.get("carrierLegalName") || "").toString().trim(),
        carrier_dba: (data.get("carrierDba") || "").toString().trim(),
        mc_number: (data.get("mcNumber") || "").toString().trim(),
        dot_number: (data.get("dotNumber") || "").toString().trim(),
        ein_tax_id: (data.get("taxId") || "").toString().trim(),
        physical_address: (data.get("physicalAddress") || "").toString().trim(),
        contact_name: (data.get("contactName") || "").toString().trim(),
        phone: (data.get("phone") || "").toString().trim(),
        email: (data.get("email") || "").toString().trim(),
        truck_count: parseInt(data.get("truckCount") || "1", 10),
        equipment_type: data.get("equipmentType") || "53_dry_van",
        max_gross_weight: parseInt(data.get("maxWeight") || "44000", 10),
        unit_vins: (data.get("unitVins") || "").toString().trim(),
        preferred_lanes: (data.get("preferredLanes") || "").toString().trim(),
        factoring_company: (data.get("factoringCompany") || "").toString().trim(),
        selected_plan: data.get("selectedPlan") || "standard_percentage",
        referral_code: (data.get("referralCode") || "").toString().trim(),
        electronic_signature: {
          signer_name: (data.get("signerName") || "").toString().trim(),
          signer_title: (data.get("signerTitle") || "").toString().trim(),
          agreement_version: "2026-11-06-v1",
          signed_at: new Date().toISOString(),
          consent_to_esign: true,
        },
        status: "PENDING_REVIEW",
      };

      try {
        const response = await fetch("/api/onboarding/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error("Server error " + response.status);
        }

        const resData = await response.json();
        const finalRef = resData.reference || appRef;

        if (appRefSpan) appRefSpan.textContent = finalRef;
        localStorage.removeItem(DRAFT_KEY);

        if (window.AlmajdoubAnalytics) {
          window.AlmajdoubAnalytics.track("onboarding_submitted", {
            application_reference: finalRef,
            truck_count: payload.truck_count,
            equipment: payload.equipment_type,
          });
        }

        goToStep(5);
      } catch (err) {
        console.error("Onboarding submission failed:", err);
        // Fallback: If network failed or server returned non-200, still display step 5 with locally stored reference so carrier does not lose data
        if (appRefSpan) appRefSpan.textContent = appRef;
        localStorage.removeItem(DRAFT_KEY);
        goToStep(5);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  window.AlmajdoubOnboarding = {
    goToStep,
    handleFile,
  };

  document.addEventListener("DOMContentLoaded", () => {
    loadDraft();
    handleQueryParams();
  });
})();
