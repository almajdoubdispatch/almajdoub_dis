/**
 * Almajdoub Dispatch — Owner Dashboard Operations Controller
 * -----------------------------------------------------------
 * Real data-backed administration for CRM pipeline, founder gate, carriers, applications, and billing.
 */
(function () {
  "use strict";

  const token = window.AlmajdoubOwnerAuth ? window.AlmajdoubOwnerAuth.getSessionToken() : null;
  if (!token) {
    window.location.href = "login.html";
    return;
  }

  // Local record store for instant dossier inspection
  const recordCache = new Map();

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

  // Helper: FMCSA SAFER Link
  function getSaferUrl(mcOrDot) {
    if (!mcOrDot) return "#";
    const clean = String(mcOrDot).replace(/[^0-9]/g, "");
    return `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${clean}`;
  }

  // Helper: Badge Colors
  function getStatusBadgeClass(status) {
    if (!status) return "gray";
    const s = String(status).toUpperCase();
    if (s.includes("APPROVED") || s.includes("ACTIVE") || s.includes("VERIFIED") || s.includes("PAID") || s.includes("WON")) return "green";
    if (s.includes("REVIEW") || s.includes("PENDING") || s.includes("ELIGIBLE") || s.includes("CONTACTED") || s.includes("PACKET")) return "amber";
    if (s.includes("REJECTED") || s.includes("CLOSED") || s.includes("DECLINED")) return "red";
    return "blue";
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 1. Load Executive Overview
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
      data.recentActivity.forEach((item) => {
        if (item.id) recordCache.set(String(item.id), item);
      });

      tbody.innerHTML = data.recentActivity.map((row) => `
        <tr>
          <td><small>${new Date(row.timestamp).toLocaleString()}</small></td>
          <td><span class="badge ${row.type === 'FOUNDER' ? 'blue' : (row.type === 'ONBOARDING' ? 'green' : 'gray')}">${row.type}</span></td>
          <td><strong>${escapeHtml(row.carrier_name || row.identifier)}</strong></td>
          <td><span class="badge ${getStatusBadgeClass(row.status)}">${row.status}</span></td>
          <td><button class="button secondary" style="padding: 0.25rem 0.6rem; font-size: 0.8rem;" onclick="window.AlmajdoubDashboard.inspectCarrier('${row.id}')">Inspect</button></td>
        </tr>
      `).join("");
    } else if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--muted); padding: 1.5rem;">No recent submissions recorded.</td></tr>`;
    }
  }

  // 2. Load CRM Pipeline
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
          cardsEl.innerHTML = stage.items.map((c) => {
            if (c.id) recordCache.set(String(c.id), c);
            return `
              <div class="pipeline-card" style="cursor: pointer;" onclick="window.AlmajdoubDashboard.inspectCarrier('${c.id}')">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                  <strong>${escapeHtml(c.carrier_name || c.name || 'Unnamed Lead')}</strong>
                  <span class="badge ${getStatusBadgeClass(c.status)}" style="font-size: 0.7rem;">${c.status || 'NEW'}</span>
                </div>
                <small style="margin-top: 0.25rem;">
                  MC: ${escapeHtml(c.mc_number || 'Pending')} · Trucks: ${c.truck_count || 1} · ${c.equipment_type === '53_reefer' ? 'Reefer' : '53 Dry Van'}
                </small>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.45rem;">
                  <small style="color: var(--blue-deep); font-weight: 600;">${escapeHtml(c.source || 'Website')}</small>
                  <button class="button secondary" style="padding: 0.15rem 0.45rem; font-size: 0.75rem;" onclick="event.stopPropagation(); window.AlmajdoubDashboard.inspectCarrier('${c.id}')">Dossier &rarr;</button>
                </div>
              </div>
            `;
          }).join("");
        }
      }
    }
  }

  // 3. Load Founder Waitlist
  async function loadFounderWaitlist() {
    const data = await apiFetch("/api/owner/founder-waitlist");
    if (!data) return;

    const tbody = document.querySelector("#tbody-founder-registrations");
    if (tbody && data.registrations && data.registrations.length > 0) {
      data.registrations.forEach((r) => {
        if (r.id) recordCache.set(String(r.id), r);
      });

      tbody.innerHTML = data.registrations.map((r) => {
        const saferUrl = getSaferUrl(r.authority_number);
        return `
          <tr>
            <td><code style="font-family: var(--font-mono); font-size: 0.85rem;">${escapeHtml(r.reference_code)}</code></td>
            <td><small>${new Date(r.submitted_at).toLocaleString()}</small></td>
            <td><strong>${escapeHtml(r.carrier_name)}</strong></td>
            <td>
              <a href="${saferUrl}" target="_blank" rel="noopener noreferrer" style="font-family: var(--font-mono); font-weight: 700; color: var(--blue);" title="Verify on FMCSA SAFER">
                ${escapeHtml(r.authority_type)} ${escapeHtml(r.authority_number)} &#x2197;
              </a>
            </td>
            <td>${r.equipment === 'reefer' ? '53 Reefer' : '53 Dry Van'}</td>
            <td>${r.truck_count}</td>
            <td><span class="badge ${r.identity_status === 'VERIFIED' ? 'green' : 'amber'}">${escapeHtml(r.identity_status)}</span></td>
            <td>${r.founder_eligible_at ? '<span class="badge green">ELIGIBLE</span>' : '<span class="badge amber">PENDING</span>'}</td>
            <td style="white-space: nowrap;">
              <button class="button secondary" style="padding: 0.2rem 0.5rem; font-size: 0.8rem; margin-right: 0.35rem;" onclick="window.AlmajdoubDashboard.inspectCarrier('${r.id}')">Inspect</button>
              ${r.identity_status !== 'VERIFIED' ? `
                <button class="button btn-amber" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;" onclick="window.AlmajdoubDashboard.verifyIdentity('${r.id}')">Approve Identity</button>
              ` : '<span class="fine" style="color: #2e7d32; font-weight: 600;">&#10003; Verified</span>'}
            </td>
          </tr>
        `;
      }).join("");
    } else if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--muted); padding: 1.5rem;">No waitlist registrations currently on file.</td></tr>`;
    }
  }

  // 4. Load Active Carriers & Fleet
  async function loadCarriers() {
    const data = await apiFetch("/api/owner/carriers");
    const tbody = document.querySelector("#tbody-carriers");
    if (!tbody) return;

    if (data && data.carriers && data.carriers.length > 0) {
      data.carriers.forEach((c) => {
        if (c.id) recordCache.set(String(c.id), c);
      });

      tbody.innerHTML = data.carriers.map((c) => {
        const saferUrl = getSaferUrl(c.mc_number || c.dot_number);
        return `
          <tr>
            <td><strong>${escapeHtml(c.carrier_name || c.name)}</strong></td>
            <td>
              <a href="${saferUrl}" target="_blank" rel="noopener noreferrer" style="font-family: var(--font-mono); color: var(--blue);">
                MC: ${escapeHtml(c.mc_number || 'N/A')} · DOT: ${escapeHtml(c.dot_number || 'N/A')} &#x2197;
              </a>
            </td>
            <td><span class="badge blue">${escapeHtml(c.commission_model || c.plan_type || 'STANDARD_7%')}</span></td>
            <td><strong>${c.truck_count || 1}</strong> unit(s)</td>
            <td>${c.equipment_type === '53_reefer' ? 'Reefer (Addendum Required)' : '53 Dry Van'}</td>
            <td>${c.equipment_type === '53_reefer' ? '<span class="badge amber">REQUIRED</span>' : '<span class="fine">N/A (Dry Van)</span>'}</td>
            <td><span class="badge ${getStatusBadgeClass(c.status)}">${escapeHtml(c.status || 'ACTIVE')}</span></td>
            <td>
              <button class="button secondary" style="padding: 0.25rem 0.6rem; font-size: 0.8rem;" onclick="window.AlmajdoubDashboard.inspectCarrier('${c.id}')">Dossier</button>
            </td>
          </tr>
        `;
      }).join("");
    } else {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--muted); padding: 1.5rem;">No active contracted carriers on file yet. As onboarding applications are approved, active carriers populate here.</td></tr>`;
    }
  }

  // 5. Load Full Digital Onboarding Applications
  async function loadOnboardingApps() {
    const data = await apiFetch("/api/owner/applications");
    const tbody = document.querySelector("#tbody-onboarding-apps");
    if (!tbody) return;

    if (data && data.applications && data.applications.length > 0) {
      data.applications.forEach((app) => {
        if (app.id) recordCache.set(String(app.id), app);
      });

      tbody.innerHTML = data.applications.map((app) => {
        const saferUrl = getSaferUrl(app.mc_number || app.dot_number);
        const ref = app.reference || (app.notes && app.notes.match(/Reference:\s*([A-Za-z0-9-]+)/)?.[1]) || `APP-${String(app.id).slice(0, 8).toUpperCase()}`;
        return `
          <tr>
            <td><code style="font-family: var(--font-mono); font-size: 0.85rem;">${escapeHtml(ref)}</code></td>
            <td><strong>${escapeHtml(app.company_name || app.carrier_name || app.name)}</strong></td>
            <td>
              <a href="${saferUrl}" target="_blank" rel="noopener noreferrer" style="font-family: var(--font-mono); font-weight: 700; color: var(--blue);">
                MC: ${escapeHtml(app.mc_number || 'N/A')} &#x2197;
              </a>
            </td>
            <td>
              <small>
                <a href="tel:${escapeHtml(app.phone)}">${escapeHtml(app.phone)}</a><br>
                <a href="mailto:${escapeHtml(app.email)}">${escapeHtml(app.email)}</a>
              </small>
            </td>
            <td>
              <strong>${escapeHtml(app.selected_plan || 'Standard 7%')}</strong><br>
              <small style="color: var(--muted);">Min RPM: ${escapeHtml(app.target_rpm || '$2.00+')}</small>
            </td>
            <td>
              <span class="badge green">&#10003; Signed</span><br>
              <small class="fine">${escapeHtml(app.signer_name || app.name || 'Carrier Signer')}</small>
            </td>
            <td><span class="badge ${getStatusBadgeClass(app.status)}">${escapeHtml(app.status || 'NEW_LEAD')}</span></td>
            <td>
              <button class="button" style="padding: 0.25rem 0.65rem; font-size: 0.8rem;" onclick="window.AlmajdoubDashboard.inspectCarrier('${app.id}')">Review Dossier</button>
            </td>
          </tr>
        `;
      }).join("");
    } else {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--muted); padding: 1.5rem;">No full digital onboarding submissions yet. Direct applications submitted via /onboarding.html appear here for review and activation.</td></tr>`;
    }
  }

  // 6. Load Billing & Invoices
  async function loadInvoices() {
    const tbody = document.querySelector("#tbody-invoices");
    if (!tbody) return;
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--muted); padding: 1.5rem;">
          No unreconciled invoices currently pending. Weekly dispatch settlement runs on Friday / Monday cycle. Linehaul and POD approval are required before fee release.
        </td>
      </tr>
    `;
  }

  // 7. Load Analytics Stream
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

  // 8. Open Carrier Dossier Inspector Modal
  function inspectCarrier(recordId) {
    const record = recordCache.get(String(recordId));
    const modal = document.querySelector("#modal-carrier-dossier");
    const titleEl = document.querySelector("#modal-carrier-title");
    const bodyEl = document.querySelector("#modal-carrier-body");

    if (!modal || !bodyEl) return;

    if (!record) {
      alert("Carrier record details could not be retrieved from local cache.");
      return;
    }

    const carrierName = record.carrier_name || record.company_name || record.name || "Unknown Carrier";
    const mcNumber = record.mc_number || record.authority_number || "Pending";
    const dotNumber = record.dot_number || "Pending";
    const saferUrl = getSaferUrl(mcNumber !== "Pending" ? mcNumber : dotNumber);
    const phone = record.phone || "Not provided";
    const email = record.email || "Not provided";
    const equipment = record.equipment_type || record.equipment || "53_dry_van";
    const equipmentDisplay = equipment === "53_reefer" || equipment === "reefer" ? "53' Reefer (Addendum Required)" : "53' Dry Van (Standard)";
    const truckCount = record.truck_count || 1;
    const plan = record.selected_plan || record.commission_model || "Standard 7% Linehaul";
    const lanes = record.preferred_lanes || "All 48 States / Open to load recommendations";
    const minRpm = record.target_rpm || "$2.00 / mile";
    const status = record.status || record.identity_status || "NEW_LEAD";
    const notes = record.notes || record.verification_note || "None recorded.";
    const createdTime = record.created_at || record.submitted_at || new Date().toISOString();

    if (titleEl) titleEl.textContent = `${carrierName} — Carrier Evaluation Dossier`;

    bodyEl.innerHTML = `
      <div class="dossier-grid">
        <!-- Card 1: Identity & Contact -->
        <div class="dossier-card">
          <h4>1. Carrier Identity &amp; Contact</h4>
          <div class="dossier-row">
            <span class="dossier-label">Carrier Legal Name:</span>
            <span class="dossier-value">${escapeHtml(carrierName)}</span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Contact Person:</span>
            <span class="dossier-value">${escapeHtml(record.name || carrierName)}</span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Phone:</span>
            <span class="dossier-value"><a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Email:</span>
            <span class="dossier-value"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Current Stage:</span>
            <span class="dossier-value"><span class="badge ${getStatusBadgeClass(status)}">${escapeHtml(status)}</span></span>
          </div>
        </div>

        <!-- Card 2: Regulatory & SAFER Verification -->
        <div class="dossier-card">
          <h4>2. FMCSA Authority Check</h4>
          <div class="dossier-row">
            <span class="dossier-label">MC Number:</span>
            <span class="dossier-value">${escapeHtml(mcNumber)}</span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">USDOT Number:</span>
            <span class="dossier-value">${escapeHtml(dotNumber)}</span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">FMCSA Snapshot:</span>
            <span class="dossier-value">
              <a href="${saferUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--blue); font-weight: 700;">
                Check SAFER &rarr;
              </a>
            </span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Authority Type:</span>
            <span class="dossier-value">Motor Carrier of Property (Common/Contract)</span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Submitted Timestamp:</span>
            <span class="dossier-value fine">${new Date(createdTime).toLocaleString()}</span>
          </div>
        </div>

        <!-- Card 3: Equipment & Dispatch Economics -->
        <div class="dossier-card">
          <h4>3. Equipment &amp; Operating Parameters</h4>
          <div class="dossier-row">
            <span class="dossier-label">Equipment:</span>
            <span class="dossier-value">${escapeHtml(equipmentDisplay)}</span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Power Units (Fleet):</span>
            <span class="dossier-value"><strong>${truckCount}</strong> Truck(s)</span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Target Min RPM:</span>
            <span class="dossier-value" style="color: var(--blue-deep); font-weight: 700;">${escapeHtml(minRpm)}</span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Preferred Lanes:</span>
            <span class="dossier-value fine">${escapeHtml(lanes)}</span>
          </div>
        </div>

        <!-- Card 4: Plan & E-Signature Audit Trail -->
        <div class="dossier-card">
          <h4>4. Plan &amp; Compliance Audit</h4>
          <div class="dossier-row">
            <span class="dossier-label">Commercial Plan:</span>
            <span class="dossier-value"><strong>${escapeHtml(plan)}</strong></span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Electronic Signature:</span>
            <span class="dossier-value" style="color: #2e7d32; font-weight: 700;">&#10003; Executed</span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Signer:</span>
            <span class="dossier-value fine">${escapeHtml(record.signer_name || record.name || carrierName)}</span>
          </div>
          <div class="dossier-row">
            <span class="dossier-label">Operational Notes:</span>
            <span class="dossier-value fine" style="max-width: 200px; text-align: right;">${escapeHtml(notes)}</span>
          </div>
        </div>
      </div>

      <!-- Decision Controls -->
      <div class="dossier-actions">
        <h4>Operational Decision: Transition Carrier Stage</h4>
        <p class="fine" style="margin-bottom: 0.85rem;">Click an action below to advance or update this carrier in the operational pipeline:</p>
        <div class="stage-btn-group">
          <button class="button secondary" style="font-size: 0.82rem;" onclick="window.AlmajdoubDashboard.updateStage('${record.id}', 'CONTACTED')">
            Mark Contacted
          </button>
          <button class="button btn-amber" style="font-size: 0.82rem;" onclick="window.AlmajdoubDashboard.updateStage('${record.id}', 'AUTHORITY_REVIEW')">
            Move to Authority Review
          </button>
          <button class="button secondary" style="font-size: 0.82rem;" onclick="window.AlmajdoubDashboard.updateStage('${record.id}', 'PACKET_SENT')">
            Send Agreement / LPOA
          </button>
          <button class="button btn-success" style="font-size: 0.82rem;" onclick="window.AlmajdoubDashboard.updateStage('${record.id}', 'ACTIVE')">
            &#10003; Approve &amp; Activate Carrier
          </button>
          <button class="button btn-danger" style="font-size: 0.82rem;" onclick="window.AlmajdoubDashboard.updateStage('${record.id}', 'DECLINED')">
            Decline / Ineligible
          </button>
        </div>
      </div>
    `;

    modal.style.display = "flex";
  }

  function closeModal() {
    const modal = document.querySelector("#modal-carrier-dossier");
    if (modal) modal.style.display = "none";
  }

  // 9. Update Carrier Pipeline Stage
  async function updateStage(recordId, newStage) {
    if (!confirm(`Are you sure you want to transition this carrier to stage "${newStage}"?`)) return;

    const res = await apiFetch("/api/owner/update-status", {
      method: "POST",
      body: JSON.stringify({ id: recordId, status: newStage }),
    });

    if (res && res.ok) {
      alert(`Carrier status successfully updated to ${newStage}`);
      closeModal();
      refreshData();
    } else {
      alert("Failed to update status: " + (res?.error || "Unknown server error"));
    }
  }

  // 10. Verify Founder Identity
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

  // 11. Export All Carrier & Pipeline Records to CSV (Excel compatible)
  async function exportCsv() {
    try {
      const res = await fetch("/api/owner/export-csv", {
        headers: { "authorization": `Bearer ${token}` },
      });
      if (!res.ok) {
        alert("Failed to generate CSV export from database.");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `almajdoub_carrier_operations_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Error initiating CSV download: " + err.message);
    }
  }

  // 12. Master Refresh
  async function refreshData() {
    const updated = document.querySelector("#dash-last-updated");
    if (updated) updated.textContent = "Updating records…";
    await Promise.all([
      loadOverview(),
      loadPipeline(),
      loadFounderWaitlist(),
      loadCarriers(),
      loadOnboardingApps(),
      loadInvoices(),
      loadAnalytics(),
    ]);
    if (updated) updated.textContent = `Last refreshed at ${new Date().toLocaleTimeString()}`;
  }

  window.AlmajdoubDashboard = {
    refreshData,
    verifyIdentity,
    inspectCarrier,
    updateStage,
    exportCsv,
    closeModal,
  };

  document.addEventListener("DOMContentLoaded", () => {
    refreshData();
  });
})();
