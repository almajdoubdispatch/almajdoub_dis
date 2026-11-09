const form = document.querySelector("#founder-waitlist-form");
const submitButton = document.querySelector("#waitlist-submit");
const message = document.querySelector("#waitlist-message");

const SUPABASE_REST_URL = "https://rnduoxdzyeqteamqsars.supabase.co/rest/v1/inquiries";
const SUPABASE_ANON_KEY = "sb_publishable_q8ON25cKslO1BpS4D_gvLw_JNbW4i0S";

function showMessage(text, state = "info") {
  if (!message) return;
  message.textContent = text;
  message.dataset.state = state;
}

if (submitButton) {
  submitButton.disabled = false;
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const privacyBox = document.querySelector("#privacy-acknowledged");
    const privacyAcknowledged = privacyBox && privacyBox.checked;
    if (!privacyAcknowledged) {
      showMessage("Please acknowledge the Privacy Notice before submitting.", "error");
      return;
    }

    if (submitButton) submitButton.disabled = true;
    showMessage("Submitting your Founder Waitlist registration…", "info");

    const data = new FormData(form);
    const carrierName = (data.get("carrierName") || "").toString().trim().replace(/\s+/g, " ");
    const authorityType = (data.get("authorityType") || "MC").toString().trim().toUpperCase();
    const authorityNumber = (data.get("authorityNumber") || "").toString().trim().replace(/\D/g, "");
    const email = (data.get("email") || "").toString().trim().toLowerCase();
    const rawEquipment = (data.get("equipment") || "53_dry_van").toString().trim();
    const equipment = (rawEquipment === "53_reefer" || rawEquipment === "reefer") ? "53_reefer" : "53_dry_van";
    const truckCountRaw = parseInt(data.get("truckCount") || "1", 10);
    const truckCount = Number.isSafeInteger(truckCountRaw) && truckCountRaw > 0 ? truckCountRaw : 1;
    const phone = (data.get("phone") || "").toString().trim();

    if (carrierName.length < 2) {
      showMessage("Please provide a valid carrier legal or trade name.", "error");
      if (submitButton) submitButton.disabled = false;
      return;
    }

    if (!authorityNumber) {
      showMessage("Please provide a valid MC or USDOT number.", "error");
      if (submitButton) submitButton.disabled = false;
      return;
    }

    const payload = {
      name: carrierName,
      company_name: carrierName,
      phone: phone,
      email: email,
      mc_number: authorityType === "MC" ? authorityNumber : null,
      dot_number: authorityType === "USDOT" ? authorityNumber : null,
      equipment_type: equipment,
      truck_count: truckCount,
      preferred_lanes: "Founder Waitlist (5-seat tier)",
      source: "Founder Waitlist (4% Program)",
      status: "NEW_LEAD",
      notes: `Founder Waitlist Application. Authority: ${authorityType} ${authorityNumber}. Equipment: ${equipment}. Trucks: ${truckCount}. Identity review is required before founder eligibility can be confirmed.`,
      tcpa_consent: true,
    };

    try {
      const response = await fetch(SUPABASE_REST_URL, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      form.reset();
      showMessage("Registration received successfully! Our operations desk will review your authority details. Identity review is required before founder eligibility can be confirmed; this is not carrier approval or a service start.", "success");
    } catch (error) {
      console.error("Founder Waitlist submission failed:", error);
      showMessage("We could not confirm a new registration. No success has been recorded; please try again later.", "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
