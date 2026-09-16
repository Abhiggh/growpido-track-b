require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { runResearch, buildApprovedDiagnostic } = require("./src/research");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 2;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function cleanupSessions() {
  const now = Date.now();
  for (const [id, record] of sessions.entries()) {
    if (now - record.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

function configured(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/^PASTE_|^YOUR_/i.test(text);
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    tavilyConfigured: configured(process.env.TAVILY_API_KEY),
    geminiConfigured: configured(process.env.GEMINI_API_KEY),
    noPaidFallback: true
  });
});

app.post("/api/research", async (req, res) => {
  cleanupSessions();
  try {
    const linkedinUrl = String(req.body.linkedinUrl || "").trim();
    if (!linkedinUrl) {
      return res.status(400).json({ ok: false, error: "LinkedIn URL is required." });
    }

    const result = await runResearch(linkedinUrl);
    const researchId = crypto.randomUUID();
    sessions.set(researchId, { createdAt: Date.now(), result });

    res.json({
      ok: true,
      researchId,
      subject: result.subject,
      claims: result.claims,
      sources: result.sources,
      eligibility: result.eligibility,
      budget: result.budget
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message || "Research failed.", noPaidFallback: true });
  }
});

app.post("/api/diagnostic", async (req, res) => {
  cleanupSessions();
  try {
    const researchId = String(req.body.researchId || "").trim();
    const approvedClaimIds = Array.isArray(req.body.approvedClaimIds)
      ? req.body.approvedClaimIds.map(String)
      : [];

    const session = sessions.get(researchId);
    if (!session) {
      return res.status(404).json({ ok: false, error: "Research session expired. Run the research again." });
    }

    const eligible = new Set(
      session.result.claims.filter(c => c.status === "verified").map(c => String(c.id))
    );
    const approved = approvedClaimIds.filter(id => eligible.has(id));

    if (session.result.eligibility?.status !== "supported") {
      return res.status(400).json({ ok: false, error: "The system has not established that this company is UAE-based. Do not generate the client diagnostic until that is resolved." });
    }

    if (!approved.length) {
      return res.status(400).json({ ok: false, error: "Approve at least one VERIFIED claim before generating the diagnostic." });
    }

    const diagnostic = await buildApprovedDiagnostic(
      session.result.subject,
      session.result.claims,
      approved,
      session.result.sources,
      session.result.eligibility
    );

    res.json({ ok: true, diagnostic, approvedClaimIds: approved });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message || "Diagnostic generation failed.", noPaidFallback: true });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Growpido Diagnostic running on http://localhost:${PORT}`);
});
