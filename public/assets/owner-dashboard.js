/**
 * Almajdoub Dispatch — Owner Dashboard Operations Controller
 * -----------------------------------------------------------
 * Real data-backed administration for CRM pipeline, founder gate, carriers, and billing.
 */
(function () {
  "use strict";

  const token = window.AlmajdoubOwnerAuth ? window.AlmajdoubOwnerAuth.getSessionToken() : null;
  if (!token) {
    window.location.href = "login.html";
    return;
  }

  // Tab switching
  const navBtns = document.querySelectorAll(".dash-nav-btn[data-tab]");
  const contentTabs = document.querySelectorAll(".dash-content-tab");
  const dashTitle = document.querySelector("#dash-title");

  const tabTitles = {
    "tab-overview": "Executive Operations Overview",
    "tab-pipeline": "Leads & CRM Pipeline",
    "tab-founder": "Founder Program & Concurrency Gate",
    "tab-carriers": "Carrier Roster & Power Units",
    "tab-onboarding": "Applications & E-Signatures",
    "tab-billing": "Billing & Reconciliation",
    "tab-analytics": "Funnel Analytics & Attribution",
  };

  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      navBtns.forEach((b) => b.classList.remove("active"));
      contentTabs.forEach((tab) => {
        tab.style.display = "none";
        tab.classList.remove("active");
      });

      btn.classList.add("active");
      const activeTab = document.getElementById(target);
      if (activeTab) {
        activeTab.style.display = "block";
        activeTab.classList.add("active");
      }
      if (dashTitle && tabTitles[target]) {
        dashTitle.textContent = tabTitles[target];
      }
    });
  });

  async function apiFetch(endpoint, options = {}) {
    const headers = {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    };
    try {
      const res = await fetch(endpoint, { ...options, headers });
      if (res.status === 401 || res.status === 403) {
        window.AlmajdoubOwnerAuth.logout();
        return null;
      }
      return await res.json();
    } catch (err) {
      console.error(`API fetch failed on ${endpoint}:`, err);
      return null;
    }
  }

  // Load Executive Overview
  async function loadOverview() {
    const data = await apiFetch("/api/owner/overview");
    if (!data) return;

    document.querySelector("#kpi-inquiries").textContent = data.inquiriesCount ?? "0";
    document.querySelector("#kpi-founder-reg").textContent = data.founderCount ?? "0";
    document.querySelector("#kpi-pending-review").textContent = data.pendingReviewCount ?? "0";
    document.querySelector("#kpi-conversions").textContent = `${data.qualifyingConversionsCount ?? 0} / 5`;
    document.querySelector("#kpi-onboarding").textContent = data.onboardingCount ?? "0";
    document.querySelector("#kpi-active-trucks").textContent = data.activeTrucksCount ?? "0";
    document.querySelector("#kpi-pending-invoices").textContent = `$${(data.pendingInvoicesTotal ?? 0).toLocaleString()}`;

    const gateBadge = document.querySelector("#dash-gate-badge");
    const gateText = document.querySelector("#founder-gate-text");
    if (data.gateOpen === false) {
      if (gateBadge) {
        gateBadge.textContent = "GATE: CLOSED";
        gateBadge.className = "badge red";
      }
      if (gateText) {
        gateText.textContent = "CLOSED (5 of 5 Qualifying Conversions Reconciled)";
        gateText.style.color = "#c62828";
      }
    } else {
      if (gateBadge) {
        gateBadge.textContent = "GATE: OPEN";
        gateBadge.className = "badge blue";
      }
      if (gateText) {
        gateText.textContent = `OPEN (${data.qualifyingConversionsCount ?? 0} / 5 Qualifying First Paid Conversions)`;
        gateText.style.color = "var(--blue-deep)";
      }
    }

    // Render Recent Activity Table
    const tbody = document.querySelector("#tbody-recent-activity");
    if (tbody && data.recentActivity && data.recentActivity.length > 0) {
      tbody.innerHTML = data.recentActivity.map((row) => `
        <tr>
          <td><small>${new Date(row.timestamp).toLocaleString()}</small></td>
          <td><span class="badge ${row.type === 'FOUNDER' ? 'blue' : (row.type === 'ONBOARDING' ? 'green' : 'gray')}">${row.type}</span></td>
          <td><strong>${escapeHtml(row.carrier_name || row.identifier)}</strong></td>
          <td><span class="badge ${getStatusBadgeClass(row.status)}">${row.status}</span></td>
          <td><button class="button secondary" style="padding: 0.25rem 0.6rem; font-size: 0.8rem;" onclick="alert('Viewing record ID: ${row.id}')">Inspect</button></td>
        </tr>
      `).join("");
    } else if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--muted); padding: 1.5rem;">No recent submissions recorded.</td></tr>`;
    }
  }

  // Load CRM Pipeline
  async function loadPipeline() {
    const data = await apiFetch("/api/owner/pipeline");
    if (!data) return;

    const stages = {
      new: { countEl: "#count-stage-new", cardsEl: "#cards-stage-new", items: data.new || [] },
      review: { countEl: "#count-stage-review", cardsEl: "#cards-stage-review", items: data.review || [] },
      eligible: { countEl: "#count-stage-eligible", cardsEl: "#cards-stage-eligible", items: data.eligible || [] },
      onboarding: { countEl: "#count-stage-onboarding", cardsEl: "#cards-stage-onboarding", items: data.onboarding || [] },
      active: { countEl: "#count-stage-active", cardsEl: "#cards-stage-active", items: data.active || [] },
    };

    for (const [key, stage] of Object.entries(stages)) {
      const countEl = document.querySelector(stage.countEl);
      const cardsEl = document.querySelector(stage.cardsEl);
      if (countEl) countEl.textContent = stage.items.length;
      if (cardsEl) {
        if (stage.items.length === 0) {
          cardsEl.innerHTML = `<div style="font-size: 0.82rem; color: var(--muted); text-align: center; padding: 1rem;">No carriers in this stage</div>`;
        } else {
          cardsEl.innerHTML = stage.items.map((c) => `
            <div class="pipeline-card">
              <strong>${escapeHtml(c.carrier_name)}</strong>
              <small>MC: ${escapeHtml(c.mc_number || 'N/A')} · Trucks: ${c.truck_count || 1}</small>
              <small style="margin-top: 0.35rem; color: var(--blue-deep);">Source: ${escapeHtml(c.source || 'Website')}</small>
            </div>
          `).join("");
        }
      }
    }
  }

  // Load Founder Registrations
  async function loadFounderWaitlist() {
    const data = await apiFetch("/api/owner/founder-waitlist");
    if (!data) return;

    const tbody = document.querySelector("#tbody-founder-registrations");
    if (tbody && data.registrations && data.registrations.length > 0) {
      tbody.innerHTML = data.registrations.map((r) => `
        <tr>
          <td><code style="font-family: var(--font-mono); font-size: 0.85rem;">${r.reference_code}</code></td>
          <td><small>${new Date(r.submitted_at).toLocaleString()}</small></td>
          <td><strong>${escapeHtml(r.carrier_name)}</strong></td>
          <td>${r.authority_type} ${r.authority_number}</td>
          <td>${r.equipment === 'reefer' ? 'Reefer' : '53 Dry Van'}</td>
          <td>${r.truck_count}</td>
          <td><span class="badge ${r.identity_status === 'VERIFIED' ? 'green' : 'amber'}">${r.identity_status}</span></td>
          <td>${r.founder_eligible_at ? 'ELIGIBLE' : 'PENDING'}</td>
          <td>
            ${r.identity_status !== 'VERIFIED' ? `
              <button class="button" style="padding: 0.25rem 0.6rem; font-size: 0.8rem;" onclick="window.AlmajdoubDashboard.verifyIdentity('${r.id}')">Approve Identity</button>
            ` : '<span class="fine">Verified</span>'}
          </td>
        </tr>
      `).join("");
    } else if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--muted); padding: 1.5rem;">No waitlist registrations currently on file.</td></tr>`;
    }
  }

  // Load Analytics Stream
  async function loadAnalytics() {
    const data = await apiFetch("/api/owner/analytics");
    if (!data) return;

    document.querySelector("#ana-page-views").textContent = data.pageViews ?? "0";
    document.querySelector("#ana-form-starts").textContent = data.formStarts ?? "0";
    document.querySelector("#ana-conversion-rate").textContent = `${data.conversionRate ?? 0}%`;
    document.querySelector("#ana-top-campaign").textContent = data.topCampaign || "direct";

    const tbody = document.querySelector("#tbody-analytics-stream");
    if (tbody && data.events && data.events.length > 0) {
      tbody.innerHTML = data.events.map((e) => `
        <tr>
          <td><small>${new Date(e.timestamp).toLocaleTimeString()}</small></td>
          <td><strong><code>${escapeHtml(e.event)}</code></strong></td>
          <td>${escapeHtml(e.path)}</td>
          <td>${escapeHtml(e.device || 'desktop')}</td>
          <td>${escapeHtml(e.attribution?.utm_source || 'direct')} / ${escapeHtml(e.attribution?.utm_campaign || 'none')}</td>
        </tr>
      `).join("");
    } else if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--muted); padding: 1.5rem;">No telemetry events in current stream.</td></tr>`;
    }
  }

  function getStatusBadgeClass(status) {
    if (!status) return "gray";
    const s = status.toUpperCase();
    if (s.includes("APPROVED") || s.includes("ACTIVE") || s.includes("VERIFIED") || s.includes("PAID")) return "green";
    if (s.includes("REVIEW") || s.includes("PENDING") || s.includes("ELIGIBLE")) return "amber";
    if (s.includes("REJECTED") || s.includes("CLOSED")) return "red";
    return "blue";
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function verifyIdentity(registrationId) {
    if (!confirm("Confirm identity review verification for this carrier authority?")) return;
    const res = await apiFetch("/api/owner/founder-waitlist", {
      method: "POST",
      body: JSON.stringify({ action: "verify_identity", id: registrationId, note: "Verified active authority via FMCSA SAFER" }),
    });
    if (res && res.ok) {
      alert("Carrier identity verified successfully!");
      refreshData();
    } else {
      alert("Failed to verify identity: " + (res?.error || "Unknown error"));
    }
  }

  async function refreshData() {
    const updated = document.querySelector("#dash-last-updated");
    if (updated) updated.textContent = "Updating records…";
    await Promise.all([
      loadOverview(),
      loadPipeline(),
      loadFounderWaitlist(),
      loadAnalytics(),
    ]);
    if (updated) updated.textContent = `Last refreshed at ${new Date().toLocaleTimeString()}`;
  }

  window.AlmajdoubDashboard = {
    refreshData,
    verifyIdentity,
  };

  document.addEventListener("DOMContentLoaded", () => {
    refreshData();
  });
})();
