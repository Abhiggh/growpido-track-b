const $ = id => document.getElementById(id);
let researchId = null;
let claims = [];
let approvedIds = new Set();
let eligibilityStatus = "not established";

let currentSubject = null;
let currentSources = [];
let currentBudget = null;
let currentEligibility = null;
let currentDiagnostic = null;

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

function statusClass(status) {
  return status === "verified" ? "verified" : status === "partially verified" ? "partial" : status === "rejected" ? "rejected" : "unverified";
}

function normalizeLinkedIn(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://www.linkedin.com/in/${raw.replace(/^@/, "")}`;
}

function renderSubject(subject, eligibility) {
  const eligibilityText = eligibility
    ? `${eligibility.status}: ${eligibility.note}`
    : "Not assessed";

  const supported = eligibility?.status === "supported";
  $("subject").innerHTML = `
    <div class="section-head"><div><div class="card-kicker">SUBJECT PROFILE</div><h2>${escapeHtml(subject.name || "Unknown subject")}</h2></div><div class="output-badge">${supported ? "UAE eligible" : "Review required"}</div></div>
    <div class="field"><b>Role</b><span>${escapeHtml(subject.role)}</span></div>
    <div class="field"><b>Company</b><span>${escapeHtml(subject.company)}</span></div>
    <div class="field"><b>Location</b><span>${escapeHtml(subject.location)}</span></div>
    <div class="field"><b>UAE eligibility</b><span>${escapeHtml(eligibilityText)}</span></div>
    <div class="field"><b>LinkedIn</b><a href="${escapeHtml(subject.linkedinUrl)}" target="_blank" rel="noreferrer">Open profile ↗</a></div>`;
}

function renderBudget(b) {
  const pct = Math.min(100, Math.round((b.searches / b.limits.maxSearchesPerRun) * 100));
  $("budget").innerHTML = `
    <div class="section-head"><div><div class="card-kicker">RESEARCH BUDGET</div><h2>System health</h2></div><div class="output-badge">Hard stop active</div></div>
    <div class="field"><b>Searches</b><span>${b.searches} / ${b.limits.maxSearchesPerRun}</span></div>
    <div class="field"><b>Evidence checks</b><span>${b.verificationChecks} / ${b.limits.maxVerificationChecks}</span></div>
    <div class="field"><b>Claims</b><span>${b.claims} / ${b.limits.maxClaimsPerRun}</span></div>
    <div class="field"><b>AI calls</b><span>${b.aiCalls} / ${b.limits.maxAiCallsPerRun}</span></div>
    <div class="budget-meter"><div class="budget-meter-bar" style="width:${pct}%"></div></div>
    <div class="small">When a hard limit is reached, the system stops safely.</div>`;
}

function updateApprovalState() {
  $("approvedCount").textContent = `${approvedIds.size} approved`;
  const canGenerate = approvedIds.size > 0 && eligibilityStatus === "supported";
  $("diagnosticBtn").disabled = !canGenerate;
  $("reviewStatusText").textContent = approvedIds.size ? `${approvedIds.size} claim${approvedIds.size === 1 ? "" : "s"} approved` : "Awaiting human review";
}

function toggleApproval(id) {
  if (approvedIds.has(id)) approvedIds.delete(id); else approvedIds.add(id);
  renderClaims(claims);
  updateApprovalState();
}

function renderClaims(items) {
  claims = items || [];
  $("claims").innerHTML = claims.length ? claims.map(claim => {
    const canApprove = claim.status === "verified";
    const approved = approvedIds.has(String(claim.id));
    return `
      <div class="claim">
        <div class="claim-head">
          <div class="claim-text">${escapeHtml(claim.text)}</div>
          <span class="pill ${statusClass(claim.status)}">${escapeHtml(claim.status)}</span>
        </div>
        <div class="small">${escapeHtml(claim.reason || "")}</div>
        ${claim.primarySource ? `<div class="small"><b>Primary:</b> <a href="${escapeHtml(claim.primarySource.url)}" target="_blank" rel="noreferrer">${escapeHtml(claim.primarySource.title || claim.primarySource.url)} ↗</a></div>` : ""}
        ${claim.primarySupport ? `<div class="evidence-quote"><b>Primary evidence:</b> ${escapeHtml(claim.primarySupport)}</div>` : ""}
        ${claim.secondSource ? `<div class="small"><b>Independent:</b> <a href="${escapeHtml(claim.secondSource.url)}" target="_blank" rel="noreferrer">${escapeHtml(claim.secondSource.title || claim.secondSource.url)} ↗</a></div>` : ""}
        ${claim.independentSupport ? `<div class="evidence-quote"><b>Independent evidence:</b> ${escapeHtml(claim.independentSupport)}</div>` : ""}
        <div class="small"><b>Human gate:</b> ${canApprove ? "Approval required before client use." : "Blocked until evidence improves."}</div>
        ${canApprove ? `<button class="approve-btn ${approved ? "approved" : ""}" data-id="${escapeHtml(claim.id)}">${approved ? "✓ Approved for diagnostic" : "Approve for diagnostic"}</button>` : ""}
      </div>`;
  }).join("") : `<div class="small">No claims were extracted.</div>`;

  document.querySelectorAll(".approve-btn").forEach(btn => btn.addEventListener("click", () => toggleApproval(btn.dataset.id)));
}

function renderDiagnostic(diagnostic) {
  if (!diagnostic) {
    currentDiagnostic = null;

    $("diagnostic").innerHTML = `
      <div class="section-head">
        <div>
          <div class="card-kicker">CLIENT OUTPUT</div>
          <h2>One-page diagnostic</h2>
        </div>
        <div class="output-badge">Approval required</div>
      </div>

      <div class="empty-diagnostic">
        <div class="empty-icon">↗</div>
        <div>
          <strong>Not generated yet</strong>
          <p>Approve at least one verified claim to unlock the client-facing diagnostic.</p>
        </div>
      </div>`;
    return;
  }

  currentDiagnostic = diagnostic;

  const strengths = (diagnostic.strengths || [])
    .map(s => `<li>${escapeHtml(s)}</li>`)
    .join("");

  const gaps = (diagnostic.gaps || [])
    .map(g => {
      const evidenceSources = (g.sources || [])
        .map(source =>
          `<a href="${escapeAttr(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a>`
        )
        .join(" · ");

      return `
        <div class="gap">
          <b>${escapeHtml(g.title)}</b>
          <div class="small">
            <b>Evidence:</b> ${escapeHtml(g.evidence)}
          </div>
          <div class="small">
            <b>Implication:</b> ${escapeHtml(g.implication)}
          </div>
          <div class="small">
            <b>Sources:</b> ${evidenceSources}
          </div>
        </div>`;
    })
    .join("");

  const recommendations = (diagnostic.recommendations || [])
    .map(r => `<li>${escapeHtml(r)}</li>`)
    .join("");

  $("diagnostic").innerHTML = `
    <div class="section-head">
      <div>
        <div class="card-kicker">CLIENT OUTPUT</div>
        <h2>One-page diagnostic</h2>
      </div>
      <div class="output-badge">Generated from approved claims</div>
    </div>

    <div class="diag">
      <p class="diag-summary">${escapeHtml(diagnostic.summary || "")}</p>

      <h3>What is working</h3>
      <ul>${strengths}</ul>

      <h3>Three biggest gaps</h3>
      ${gaps}

      <h3>Recommendations</h3>
      <ul>${recommendations}</ul>

      <h3>Claim refused</h3>
      <p>${escapeHtml(
        diagnostic.refusedClaim || "No refused claim explanation returned."
      )}</p>

      <div style="margin-top: 20px;">
       <button id="downloadDiagnosticBtn" class="approve-btn" type="button">
         Download Diagnostic PDF
        </button>
      </div>
    </div>
  `;

  $("downloadDiagnosticBtn").addEventListener(
    "click",
    downloadDiagnosticPdf
  );
}

function sourceLabel(quality) {
  const value = String(quality || "secondary").toLowerCase();
  if (value.includes("primary")) return "Primary";
  if (value.includes("independent")) return "Independent";
  if (value.includes("low")) return "Low trust";
  return "Secondary";
}

function renderSources(sources) {
  const items = sources || [];
  const previewCount = 8;
  let expanded = false;

  function draw() {
    const visible = expanded ? items : items.slice(0, previewCount);
    $("sourceCount").textContent = `${items.length} source${items.length === 1 ? "" : "s"}`;

    const cards = visible.map((source, index) => {
      const label = sourceLabel(source.sourceQuality);
      const excerpt = String(source.content || "").trim();
      return `
        <article class="source source-premium">
          <div class="source-topline">
            <span class="source-index">${String(index + 1).padStart(2, "0")}</span>
            <span class="source-type source-type-${label.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(label)}</span>
            <span class="source-date">${escapeHtml(source.publishedDate || "Date unavailable")}</span>
          </div>
          <div class="source-title"><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.url)} <span class="source-arrow">↗</span></a></div>
          <div class="source-meta">${escapeHtml(source.url || "")}</div>
          ${excerpt ? `<p class="source-excerpt">${escapeHtml(excerpt.slice(0, 280))}${excerpt.length > 280 ? "…" : ""}</p>` : ""}
        </article>`;
    }).join("");

    const canExpand = items.length > previewCount;
    $("sources").innerHTML = `
      <div class="sources-intro">
        <div><strong>${expanded ? "All collected evidence" : "Highest-signal evidence"}</strong><span>Primary sources and credible corroboration are surfaced first.</span></div>
        ${canExpand ? `<button id="sourcesToggle" class="source-toggle">${expanded ? "Show top sources" : `View all ${items.length} sources`} <span>→</span></button>` : ""}
      </div>
      <div class="source-list">${cards || `<div class="small">No sources collected.</div>`}</div>`;

    const toggle = $("sourcesToggle");
    if (toggle) toggle.addEventListener("click", () => { expanded = !expanded; draw(); });
  }

  draw();
}

async function refreshHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) return;
    await response.json();
  } catch {
    // Health status is not displayed in the current UI.
  }
}

$("linkedinUrl").addEventListener("keydown", event => {
  if (event.key === "Enter") $("researchBtn").click();
});

$("researchBtn").addEventListener("click", async () => {
  const linkedinUrl = normalizeLinkedIn($("linkedinUrl").value);
  $("error").classList.add("hidden");
  $("results").classList.add("hidden");
  approvedIds = new Set();
  researchId = null;

  if (!linkedinUrl) {
    $("error").textContent = "Enter a public LinkedIn profile URL.";
    $("error").classList.remove("hidden");
    return;
  }

  $("researchBtn").disabled = true;
  $("researchBtn").querySelector(".btn-label").textContent = "Researching…";
  $("loading").classList.remove("hidden");

  try {
    const response = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkedinUrl })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Research failed.");

    researchId = data.researchId;
    eligibilityStatus = data.eligibility?.status || "not established";

    currentSubject = data.subject;
    currentSources = data.sources || [];
    currentBudget = data.budget || null;
    currentEligibility = data.eligibility || null;
    currentDiagnostic = null;

    renderSubject(data.subject, data.eligibility);
    renderBudget(data.budget);
    renderClaims(data.claims);
    renderDiagnostic(null);
    renderSources(data.sources);
    updateApprovalState();
    $("results").classList.remove("hidden");
    window.scrollTo({ top: $("results").offsetTop - 18, behavior: "smooth" });
  } catch (error) {
    $("error").textContent = error.message;
    $("error").classList.remove("hidden");
  } finally {
    $("loading").classList.add("hidden");
    $("researchBtn").disabled = false;
    $("researchBtn").querySelector(".btn-label").textContent = "Run research";
  }
});

$("diagnosticBtn").addEventListener("click", async () => {
  $("error").classList.add("hidden");
  $("diagnosticLoading").classList.remove("hidden");
  $("diagnosticBtn").disabled = true;

  try {
    const response = await fetch("/api/diagnostic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ researchId, approvedClaimIds: [...approvedIds] })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Diagnostic generation failed.");
    renderDiagnostic(data.diagnostic);
    $("diagnostic").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("error").textContent = error.message;
    $("error").classList.remove("hidden");
  } finally {
    $("diagnosticLoading").classList.add("hidden");
    updateApprovalState();
  }
});

function downloadDiagnosticPdf() {
  if (!currentDiagnostic || !currentSubject) {
    $("error").textContent = "Generate the diagnostic first.";
    $("error").classList.remove("hidden");
    return;
  }

  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const margin = 16;
  const width = 210 - margin * 2;
  let y = 18;

  function addText(text, size = 9.5, gap = 4) {
    if (!text) return;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);

    const lines = doc.splitTextToSize(String(text), width);

    lines.forEach(line => {
      if (y > 280) {
        doc.addPage();
        y = 18;
      }

      doc.text(line, margin, y);
      y += 4.5;
    });

    y += gap;
  }

  function addHeading(text) {
    if (y > 270) {
      doc.addPage();
      y = 18;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(text, margin, y);
    y += 6;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("GROWPIDO | TRACK B", margin, y);

  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("One-page public-profile diagnostic", margin, y);

  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(
    `${currentSubject.name || ""} | ${currentSubject.company || ""}`,
    margin,
    y
  );

  y += 6;

  addText(
    `Location: ${currentSubject.location || "Not established"}`
  );

  const eligibilityStatus = currentEligibility?.status || "not established";
  const eligibilityNote = currentEligibility?.note || "Eligibility was not established.";
  addText(
    `UAE eligibility: ${eligibilityStatus === "supported" ? "Supported" : "Not established"}`,
    9.5,
    2
  );
  addText(eligibilityNote, 8.8, 4);

  addHeading("HUMAN GATE");

  addText(`${approvedIds.size} approved`);

  addHeading("SUMMARY");

  addText(currentDiagnostic.summary || "");

  addHeading("WHAT IS WORKING");

  (currentDiagnostic.strengths || []).forEach(item => {
    addText(`• ${item}`, 9.5, 1);
  });

  addHeading("THREE BIGGEST GAPS");

  (currentDiagnostic.gaps || []).forEach((gap, index) => {
    addText(`${index + 1}. ${gap.title}`, 10, 1);
    addText(`Evidence: ${gap.evidence || ""}`, 9.2, 1);
    addText(`Implication: ${gap.implication || ""}`, 9.2, 3);
  });

  addHeading("RECOMMENDATIONS");

  (currentDiagnostic.recommendations || []).forEach(item => {
    addText(`• ${item}`, 9.5, 1);
  });

  addHeading("CLAIM REFUSED");

  addText(
    currentDiagnostic.refusedClaim ||
    "No refused claim explanation returned."
  );

  addHeading("PUBLIC SOURCES COLLECTED");

  (currentSources || []).forEach((source, index) => {
    addText(
      `${index + 1}. ${source.title || source.url}`,
      9,
      1
    );

    addText(
      source.url || "",
      8.5,
      2
    );
  });

  doc.save(
    `Growpido_${String(currentSubject.name || "Diagnostic")
      .replace(/[^a-z0-9]+/gi, "_")}_Diagnostic.pdf`
  );
}
refreshHealth();
