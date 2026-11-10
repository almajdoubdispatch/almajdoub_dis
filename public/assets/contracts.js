/**
 * Almajdoub Dispatch — One-Shot Digital Agreement Controller
 * ------------------------------------------------------------
 * Handles multi-tab contract viewing, PDF print shortcuts, and one-shot
 * legally binding electronic execution via /api/onboarding/submit.
 */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    // 1. Contract Tabs Switching
    const tabBtns = document.querySelectorAll(".contract-tab-btn");
    const docPanels = document.querySelectorAll(".contract-doc-panel");

    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-target");
        tabBtns.forEach((b) => b.classList.remove("active"));
        docPanels.forEach((p) => {
          p.classList.remove("active");
          p.style.display = "none";
        });

        btn.classList.add("active");
        const activePanel = document.getElementById(targetId);
        if (activePanel) {
          activePanel.classList.add("active");
          activePanel.style.display = "block";
        }
      });
    });

    // 2. Smooth Scroll to Form
    const jumpBtn = document.getElementById("jump-to-sign-btn");
    if (jumpBtn) {
      jumpBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const formSection = document.getElementById("oneshot-execution-section");
        if (formSection) {
          formSection.scrollIntoView({ behavior: "smooth" });
        }
      });
    }

    // 3. Print Shortcut
    const printBtn = document.getElementById("print-contract-btn");
    if (printBtn) {
      printBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.print();
      });
    }

    // 4. One-Shot Form Submission
    const form = document.getElementById("oneshot-agreement-form");
    const submitBtn = document.getElementById("submit-agreement-btn");
    const errorBanner = document.getElementById("agreement-error-banner");
    const successCard = document.getElementById("agreement-success-card");
    const refCodeEl = document.getElementById("confirmed-ref-code");
    const signerDisplayEl = document.getElementById("confirmed-signer-name");
    const timestampDisplayEl = document.getElementById("confirmed-timestamp");

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (errorBanner) errorBanner.style.display = "none";

        // Validate Required Fields
        const carrierName = (form.carrierLegalName.value || "").trim();
        const mcNumber = (form.mcNumber.value || "").trim();
        const dotNumber = (form.dotNumber.value || "").trim();
        const contactName = (form.contactName.value || "").trim();
        const phone = (form.phone.value || "").trim();
        const email = (form.email.value || "").trim();
        const physicalAddress = (form.physicalAddress.value || "").trim();
        const equipment = form.equipmentType.value || "53_dry_van";
        const truckCount = parseInt(form.truckCount.value, 10) || 1;
        const selectedPlan = form.selectedPlan.value || "Standard 7% Linehaul";
        const targetRpm = (form.targetRpm.value || "$2.00+").trim();
        const preferredLanes = (form.preferredLanes.value || "All 48 States").trim();
        const signerName = (form.signerName.value || "").trim();
        const signerTitle = (form.signerTitle.value || "").trim();

        // Check Affirmations
        const chkAgreement = document.getElementById("chk-master-agreement")?.checked;
        const chkScheduleA = document.getElementById("chk-schedule-a")?.checked;
        const chkLpoa = document.getElementById("chk-lpoa")?.checked;
        const chkZeroForced = document.getElementById("chk-zero-forced")?.checked;

        if (!carrierName || !mcNumber || !dotNumber || !contactName || !phone || !email || !physicalAddress) {
          showError("Please complete all required carrier and authority details.");
          return;
        }

        if (!chkAgreement || !chkScheduleA || !chkLpoa || !chkZeroForced) {
          showError("You must affirmatively review and check all agreement conditions and the Zero Forced Dispatch acknowledgment.");
          return;
        }

        if (!signerName || !signerTitle) {
          showError("Please type your full legal name and executive title for the electronic signature.");
          return;
        }

        if (selectedPlan.includes("$299") && truckCount < 3) {
          showError("The $299/week Flat-Rate Fleet plan requires a minimum of three (3) active trucks under Schedule A terms. For 1-2 trucks, please select the Standard 7% or Founder 5% plan.");
          return;
        }

        if (selectedPlan.includes("$245") && truckCount < 2) {
          showError("The $245/week Founding Flat-Rate plan requires a minimum of two (2) active trucks under Schedule A terms.");
          return;
        }

        // Disable button while submitting
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Executing Agreement & Transmitting…";
        }

        const now = new Date();
        const appRef = `AD-AGR-${now.getTime().toString(36).toUpperCase()}`;

        const payload = {
          application_reference: appRef,
          carrier_name: carrierName,
          company_name: carrierName,
          dba_name: (form.carrierDba?.value || "").trim(),
          contact_name: contactName,
          phone: phone,
          email: email,
          mc_number: mcNumber,
          dot_number: dotNumber,
          physical_address: physicalAddress,
          equipment_type: equipment,
          truck_count: truckCount,
          selected_plan: selectedPlan,
          target_rpm: targetRpm,
          preferred_lanes: preferredLanes,
          source: "Direct Contract Packet Execution (One-Shot)",
          electronic_signature: {
            signer_name: signerName,
            signer_title: signerTitle,
            signed_at: now.toISOString(),
            consent_acknowledged: true,
            agreement_version: "2026-11-05",
            esign_compliant: true,
            user_agent: navigator.userAgent,
          },
        };

        try {
          const res = await fetch("/api/onboarding/submit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            throw new Error(`Submission failed with server status ${res.status}`);
          }

          const data = await res.json();
          const confirmedRef = data.reference || appRef;

          // Track telemetry event
          if (window.AlmajdoubAnalytics && typeof window.AlmajdoubAnalytics.trackEvent === "function") {
            window.AlmajdoubAnalytics.trackEvent("agreement_executed", {
              reference: confirmedRef,
              plan: selectedPlan,
              equipment: equipment,
            });
          }

          // Show confirmation card
          if (refCodeEl) refCodeEl.textContent = confirmedRef;
          if (signerDisplayEl) signerDisplayEl.textContent = `${signerName} (${signerTitle})`;
          if (timestampDisplayEl) timestampDisplayEl.textContent = now.toLocaleString();

          form.style.display = "none";
          if (successCard) {
            successCard.style.display = "block";
            successCard.scrollIntoView({ behavior: "smooth" });
          }
        } catch (err) {
          console.error("Agreement submission error:", err);
          showError("Unable to submit agreement at this moment. Please verify your connection or contact our operations desk directly.");
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "⚡ Sign & Submit Agreement — Send to Operations Desk (One-Shot)";
          }
        }
      });
    }

    function showError(msg) {
      if (errorBanner) {
        errorBanner.textContent = msg;
        errorBanner.style.display = "block";
        errorBanner.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        alert(msg);
      }
    }
  });
})();
