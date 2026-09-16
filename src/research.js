const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");
const {
  createBudget,
  consumeSearch,
  consumeVerification,
  consumeAiCall
} = require("./safety");

const TAVILY_URL = "https://api.tavily.com/search";

const STRONG_INDEPENDENT_DOMAINS = [
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "gulfnews.com",
  "arabnews.com",
  "thenationalnews.com",
  "khaleejtimes.com",
  "gulfbusiness.com",
  "arabianbusiness.com",
  "zawya.com",
  "wam.ae",
  "forbes.com",
  "techcrunch.com",
  "wamda.com",
  "entrepreneur.com",
  "economist.com",
  "cnbc.com",
  "business-standard.com",
  "economictimes.indiatimes.com",
  "moneycontrol.com",
  "timesofindia.indiatimes.com",
  "atlanticcouncil.org",
  "endeavor.org",
  "weforum.org",
  "mckinsey.com",
  "uber.com",
  "investor.uber.com",
  "businesswire.com",
  "constructionweek.com",
  "nasdaqdubai.com",
  "nasdaq.com",
  "dubaichamber.com",
  "mubadala.com",
  "adnoc.ae",
  "etisalat.ae",
  "eand.com"
];

const OFFICIAL_GENERIC_DOMAINS = [
  "gov.ae",
  "u.ae",
  "centralbank.ae",
  "sama.gov.sa",
  "dfsa.ae",
  "difc.ae",
  "harvard.edu",
  "stanford.edu",
  "usc.edu"
];

const WEAK_DOMAINS = [
  "rocketreach.co",
  "signalhire.com",
  "zoominfo.com",
  "lusha.com",
  "contactout.com",
  "apollo.io",
  "vcsift.com",
  "crunchbase.com",
  "theorg.com",
  "owler.com",
  "peopleai.com"
];

const NON_OFFICIAL_COMPANY_DOMAINS = [
  "propertyfinder.ae",
  "bayut.com",
  "dubizzle.com",
  "zoopla.co.uk",
  "rightmove.co.uk",
  "realtor.com",
  "zillow.com",
  "redfin.com",
  "indeed.com",
  "glassdoor.com",
  "comparably.com",
  "crunchbase.com",
  "theorg.com",
  "owler.com",
  "rocketreach.co",
  "signalhire.com",
  "zoominfo.com",
  "lusha.com",
  "contactout.com",
  "apollo.io",
  "peopleai.com"
];

const SOCIAL_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "tiktok.com",
  "reddit.com"
];

const GENERIC_COMPANY_TOKENS = new Set([
  "company",
  "group",
  "holding",
  "holdings",
  "llc",
  "ltd",
  "limited",
  "inc",
  "corp",
  "corporation",
  "real",
  "estate",
  "properties",
  "property",
  "homes",
  "home",
  "business",
  "international",
  "global",
  "ventures",
  "capital"
]);

const EDUCATION_WORDS = [
  "degree",
  "bachelor",
  "master",
  "mba",
  "university",
  "college",
  "education",
  "studied",
  "graduated",
  "school"
];

const FOUNDER_WORDS = [
  "co-founder",
  "cofounded",
  "co-founded",
  "founded",
  "founder",
  "launched",
  "started"
];

const ROLE_WORDS = [
  "ceo",
  "chief executive",
  "managing director",
  "partner",
  "president",
  "chairman",
  "executive"
];

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value || /^PASTE_|^YOUR_/i.test(value)) {
    throw new Error(
      `${name} is missing or still uses a placeholder in .env`
    );
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalize(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return normalize(text).split(" ").filter(token => token.length >= 2);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizedUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return String(url || "").replace(/#.*$/, "").replace(/\/$/, "");
  }
}

function domainMatches(host, domain) {
  return Boolean(host && domain && (host === domain || host.endsWith(`.${domain}`)));
}

function domainIn(url, domains) {
  const host = hostOf(url);
  return domains.some(domain => domainMatches(host, domain));
}

function profileSlug(linkedinUrl) {
  try {
    const url = new URL(linkedinUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex(part => part.toLowerCase() === "in");
    return idx >= 0 ? parts[idx + 1] || "" : "";
  } catch {
    return "";
  }
}

function isSubjectLinkedInUrl(url, subjectLinkedIn) {
  if (!subjectLinkedIn) return false;
  return (
    normalizedUrl(url).toLowerCase() ===
    normalizedUrl(subjectLinkedIn).toLowerCase()
  );
}

function isLinkedInCompanyUrl(url, companyName) {
  const host = hostOf(url);
  if (!domainMatches(host, "linkedin.com")) return false;

  try {
    const u = new URL(url);
    if (!u.pathname.toLowerCase().startsWith("/company/")) return false;
    if (!companyName) return true;

    const companyTokens = tokens(companyName).filter(token => token.length >= 2);
    const strongTokens = companyTokens.filter(
      token => !GENERIC_COMPANY_TOKENS.has(token)
    );
    const slug = normalize(u.pathname);

    if (!companyTokens.length) return true;

    const candidateTokens = strongTokens.length ? strongTokens : companyTokens;
    const hits = candidateTokens.filter(token => slug.includes(token)).length;
    const requiredHits =
      candidateTokens.length === 1 ? 1 : Math.min(2, candidateTokens.length);

    return hits >= requiredHits;
  } catch {
    return false;
  }
}

function isWikipedia(url) {
  return /(^|\.)wikipedia\.org$/i.test(hostOf(url));
}

function isSocial(url) {
  return domainIn(url, SOCIAL_DOMAINS);
}

function sourceQuality(url, context) {
  const {
    companyDomain,
    companyLinkedInUrl,
    subjectLinkedIn
  } = context;

  const host = hostOf(url);

  if (domainIn(url, NON_OFFICIAL_COMPANY_DOMAINS)) return "weak";

  if (companyDomain && domainMatches(host, companyDomain)) {
    return "primary-company";
  }

  if (
    companyLinkedInUrl &&
    normalizedUrl(url) === normalizedUrl(companyLinkedInUrl)
  ) {
    return "primary-company-linkedin";
  }

  if (isSubjectLinkedInUrl(url, subjectLinkedIn)) {
    return "primary-subject";
  }

  if (domainIn(url, OFFICIAL_GENERIC_DOMAINS)) {
    return "primary-official";
  }

  if (domainIn(url, STRONG_INDEPENDENT_DOMAINS)) {
    return "strong-independent";
  }

  if (
    domainIn(url, WEAK_DOMAINS) || isWikipedia(url) || isSocial(url)
  ) {
    return "weak";
  }
  return "secondary";
}

function isStrongIndependent(
  url,
  companyDomain,
  subjectLinkedIn,
  companyLinkedInUrl = ""
) {
  const host = hostOf(url);

  if (companyDomain && domainMatches(host, companyDomain)) return false;
  if (isSubjectLinkedInUrl(url, subjectLinkedIn)) return false;

  if (
    companyLinkedInUrl &&
    normalizedUrl(url) === normalizedUrl(companyLinkedInUrl)
  ) {
    return false;
  }

  if (domainIn(url, NON_OFFICIAL_COMPANY_DOMAINS)) return false;

  return domainIn(url, STRONG_INDEPENDENT_DOMAINS);
}

function dedupeSources(sources) {
  const map = new Map();

  for (const source of sources || []) {
    if (!source?.url) continue;

    const key = normalizedUrl(source.url);

    if (!map.has(key)) {
      map.set(key, {
        ...source,
        url: key
      });
    }
  }

  return [...map.values()];
}

function sourceText(source) {
  return normalize(
    `${source?.title || ""} ${source?.content || ""} ${source?.url || ""}`
  );
}

function looksLikeConflictingPerson(source, subject) {
  const title = normalize(source?.title || "");
  if (!title) return false;

  const targetTokens = tokens(subject?.name || "");
  if (targetTokens.length < 2) return false;

  const targetLast = targetTokens[targetTokens.length - 1];
  const targetFirst = targetTokens[0];

  const head = title
    .split(/\||:|\s[-–—]\s/)[0]
    .trim();

  const headTokens = tokens(head);
  if (headTokens.length < 2) return false;

  const sameLast = headTokens[headTokens.length - 1] === targetLast;
  const differentFirst = headTokens[0] !== targetFirst;

  return sameLast && differentFirst;
}

function containsPersonAndCompany(source, subject) {
  const text = normalize(
    `${source?.title || ""} ${source?.content || ""}`
  );

  if (looksLikeConflictingPerson(source, subject)) return false;

  const personName = normalize(subject?.name || "");
  const companyName = normalize(subject?.company || "");

  if (!personName) return false;

  const exactPersonMatch = text.includes(personName);
  if (!exactPersonMatch) return false;

  const fullCompanyMatch = companyName && text.includes(companyName);

  const isSubjectProfile = isSubjectLinkedInUrl(
    source.url,
    subject.linkedinUrl
  );

  const isCompanyProfile = isLinkedInCompanyUrl(
    source.url,
    subject.company
  );

  if (
    fullCompanyMatch || isSubjectProfile || isCompanyProfile
  ) {
    return true;
  }

  return false;
}

function claimTypeForClaim(claimText) {
  const text = normalize(claimText);

  if (
    /\b(?:is|serves as|serving as|currently)\b/i.test(claimText) &&
    ROLE_WORDS.some(word => text.includes(word))
  ) {
    return "leadership_role";
  }

  if (EDUCATION_WORDS.some(word => text.includes(word))) {
    return "education";
  }

  if (
    /(mckinsey|worked at|worked for|joined|employment|career|associate partner|management consultant|consultant at)/i.test(
      claimText
    )
  ) {
    return "employment";
  }

  if (FOUNDER_WORDS.some(word => text.includes(word))) {
    return "founder_history";
  }

  if (ROLE_WORDS.some(word => text.includes(word))) {
    return "leadership_role";
  }

  if (
    /(acquired|acquisition|funding|raised|valuation|revenue|users|customers|license|launched|started)/i.test(
      claimText
    )
  ) {
    return "company_milestone";
  }

  return "professional_achievement";
}

function claimPrimaryPreference(claimType) {
  if (claimType === "education") {
    return ["primary-subject", "primary-official"];
  }

  if (claimType === "leadership_role") {
    return [
      "primary-company",
      "primary-company-linkedin",
      "primary-subject"
    ];
  }

  if (claimType === "founder_history") {
    return [
      "primary-company",
      "primary-company-linkedin",
      "primary-subject"
    ];
  }

  if (claimType === "company_milestone") {
    return [
      "primary-company",
      "primary-company-linkedin",
      "primary-official"
    ];
  }

  if (claimType === "employment") {
    return [
      "primary-subject",
      "primary-official",
      "primary-company",
      "primary-company-linkedin"
    ];
  }

  return [
    "primary-subject",
    "primary-company",
    "primary-official"
  ];
}

function sourceLooksDirect(source, claim, subject, quality) {
  const raw = `${source?.title || ""} ${source?.content || ""}`;
  const text = normalize(raw);
  const personTokens = tokens(subject.name);
  const companyTokens = tokens(subject.company);
  const claimText = String(claim.text || "");
  const claimType = claimTypeForClaim(claimText);
  const normalizedClaim = normalize(claimText);
  const normalizedCompany = normalize(subject.company || "");

  const companyCentricClaim =
    claimType === "company_milestone" ||
    (
      claimType === "professional_achievement" &&
      Boolean(normalizedCompany) &&
      (
        normalizedClaim.includes(normalizedCompany) ||
        tokens(subject.company || "").filter(
          token =>
            token.length >= 3 &&
            normalizedClaim.includes(token)
        ).length >= 2
      )
    );

  const claimTokens = tokens(claimText)
    .filter(token => token.length >= 4)
    .filter(
      token =>
        ![
          "with",
          "from",
          "that",
          "this",
          "were",
          "been",
          "into",
          "after",
          "before",
          "along",
          "their",
          "there",
          "about",
          "during",
          "under",
          "degree",
          "company",
          "worked",
          "work",
          "prior",
          "founding"
        ].includes(token)
    )
    .slice(0, 30);

  const personHit =
    personTokens.length > 0 &&
    personTokens.every(token => text.includes(token));

  const companyNameHit =
    Boolean(normalizedCompany) &&
    text.includes(normalizedCompany);

  const companyTokenHits =
    companyTokens.filter(token => text.includes(token)).length;

  const companyHit =
    companyTokens.length === 0 ||
    companyNameHit ||
    companyTokenHits >=
      Math.min(2, Math.max(1, companyTokens.length));

  if (!personHit && !companyCentricClaim) return false;
  if (companyCentricClaim && !companyHit) return false;

  const yearTokens =
    claimText.match(/\b(?:19|20)\d{2}\b/g) || [];

  const amountTokens =
    claimText.match(
      /\$\s?[\d,.]+\s?(?:billion|million|bn|m)?/gi
    ) || [];

  const claimHasInstitution = [
    "harvard",
    "stanford",
    "usc",
    "university of southern california",
    "university of",
    "college"
  ].some(item =>
    normalize(claimText).includes(normalize(item))
  );

  const claimOverlap = claimTokens.filter(
    token => text.includes(token)
  ).length;

  const minimumOverlap = Math.min(
    4,
    Math.max(
      2,
      Math.ceil(claimTokens.length * 0.25)
    )
  );

  const exactYearSupport =
    yearTokens.length === 0 ||
    yearTokens.every(year => text.includes(String(year)));

  const normalizedRaw = normalize(raw).replace(/\s+/g, "");

  const exactAmountSupport =
    amountTokens.length === 0 ||
    amountTokens.every(amount =>
      normalizedRaw.includes(
        normalize(amount).replace(/\s+/g, "")
      )
    );

  if (claimType === "leadership_role") {
    const requestedFounder =
      /\b(co[- ]?founder|founder)\b/i.test(claimText);

    const requestedCeo =
      /\b(ceo|chief executive)\b/i.test(claimText);

    const requestedChair =
      /\b(chairman|president|managing director)\b/i.test(
        claimText
      );

    const hasFounder =
      /\b(co[- ]?founder|founder)\b/i.test(raw);

    const hasCeo =
      /\b(ceo|chief executive)\b/i.test(raw);

    const hasChair =
      /\b(chairman|president|managing director)\b/i.test(raw);

    const exactRoleSupport =
      (!requestedFounder || hasFounder) &&
      (!requestedCeo || hasCeo) &&
      (!requestedChair || hasChair);

    return companyHit && exactRoleSupport;
  }

  if (claimType === "founder_history") {
    const founderSupport =
      /\b(co[- ]?founder|cofounded|co-founded|founded|founder|started|launched)\b/i.test(
        raw
      );

    return (
      companyHit &&
      founderSupport &&
      exactYearSupport &&
      exactAmountSupport &&
      claimOverlap >= 2
    );
  }

  if (claimType === "education") {
    const institutionSupport =
      claimHasInstitution ||
      /\b(university|college|school)\b/i.test(raw);

    const educationSupport =
      /\b(degree|bachelor|master|mba|graduated|studied|education)\b/i.test(
        raw
      );

    return (
      institutionSupport &&
      educationSupport &&
      (
        claimOverlap >= minimumOverlap ||
        quality === "primary-subject"
      )
    );
  }

  if (claimType === "employment") {
    const employmentSupport =
      /\b(worked|joined|associate partner|management consultant|consultant|employee|career)\b/i.test(
        raw
      );

    const titleRequested =
      /(associate partner|partner|management consultant|consultant)/i.test(
        claimText
      );

    if (titleRequested) {
      return (
        employmentSupport &&
        claimOverlap >= minimumOverlap
      );
    }

    return (
      employmentSupport &&
      claimOverlap >= 2
    );
  }

  if (claimType === "company_milestone") {
    const milestoneSupport =
      /\b(acquired|acquisition|funding|raised|valuation|revenue|users|customers|license|launched|started)\b/i.test(
        raw
      );

    return (
      companyHit &&
      milestoneSupport &&
      exactYearSupport &&
      exactAmountSupport &&
      claimOverlap >= 2
    );
  }

  if (companyCentricClaim) {
    return (
      companyHit &&
      /\b(company|holdings|group|properties|business|headquartered|based in|provides|operates|brokerage|real estate|leasing|sales|investment advisory|services)\b/i.test(
        raw
      )
    );
  }

  return claimOverlap >= minimumOverlap;
}

function isIndependentProfessionalSource(
  source,
  subjectLinkedIn,
  companyLinkedInUrl
) {
  if (!source?.url) return false;

  const url = normalizedUrl(source.url);
  const host = hostOf(url);

  if (!domainMatches(host, "linkedin.com")) return false;
  if (isSubjectLinkedInUrl(url, subjectLinkedIn)) return false;

  if (
    companyLinkedInUrl &&
    url === normalizedUrl(companyLinkedInUrl)
  ) {
    return false;
  }

  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }

  if (
    path.startsWith("/pub/dir/") ||
    path.startsWith("/pub/")
  ) {
    return false;
  }

  if (
    !path.startsWith("/in/") &&
    !path.startsWith("/posts/")
  ) {
    return false;
  }

  const text = normalize(
    `${source.title || ""} ${source.content || ""}`
  );

  const activitySignals = [
    "shared this",
    "reposted",
    "founder & ceo",
    "founder and ceo",
    "founder & chief executive officer",
    "executive spotlight",
    "interview",
    "announces"
  ];

  return activitySignals.some(
    signal => text.includes(normalize(signal))
  );
}

function isCredibleIndependentSource(
  source,
  companyDomain,
  subjectLinkedIn,
  companyLinkedInUrl
) {
  if (!source?.url) return false;

  const host = hostOf(source.url);
  if (!host) return false;

  if (
    companyDomain &&
    domainMatches(host, companyDomain)
  ) {
    return false;
  }

  if (isSubjectLinkedInUrl(source.url, subjectLinkedIn)) {
    return false;
  }

  if (
    companyLinkedInUrl &&
    normalizedUrl(source.url) ===
      normalizedUrl(companyLinkedInUrl)
  ) {
    return false;
  }

  if (
    isWikipedia(source.url) ||
    isSocial(source.url) ||
    domainIn(source.url, WEAK_DOMAINS) ||
    domainIn(source.url, NON_OFFICIAL_COMPANY_DOMAINS) ||
    domainMatches(host, "linkedin.com")
  ) {
    return false;
  }

  if (
    domainIn(
      source.url,
      STRONG_INDEPENDENT_DOMAINS
    )
  ) {
    return true;
  }

  const pageText = normalize(
    `${source.title || ""} ${source.content || ""} ${source.url || ""}`
  );

  const publishingSignals = [
    "news",
    "article",
    "interview",
    "press release",
    "published",
    "journal",
    "report"
  ];

  const directorySignals = [
    "directory",
    "contact database",
    "email address",
    "people search",
    "profile database",
    "company directory",
    "people also viewed",
    "contact information"
  ];

  const hasPublishingSignal = publishingSignals.some(
    signal => pageText.includes(signal)
  );

  const hasDirectorySignal = directorySignals.some(
    signal => pageText.includes(signal)
  );

  const searchScore = Number(source.score || 0);

  return (
    searchScore >= 0.8 &&
    hasPublishingSignal &&
    !hasDirectorySignal
  );
}

async function tavilySearch(query, budget, options = {}) {
  requireEnv("TAVILY_API_KEY");
  consumeSearch(budget);

  const payload = {
    api_key: process.env.TAVILY_API_KEY,
    query,
    search_depth: options.search_depth || "basic",
    max_results: options.max_results || 5,
    include_answer: false,
    include_raw_content: false,
    include_images: false
  };

  if (
    Array.isArray(options.include_domains) &&
    options.include_domains.length
  ) {
    payload.include_domains = options.include_domains;
  }

  try {
    const response = await axios.post(
      TAVILY_URL,
      payload,
      {
        timeout: 25000
      }
    );

    return (
      response.data.results || []
    ).map(result => ({
      title: result.title || "",
      url: result.url || "",
      content: result.content || "",
      score: Number(result.score || 0),
      query
    }));
  } catch (error) {
    if (error.response?.status === 429) {
      throw new Error(
        "Tavily rate limit reached. No paid fallback is enabled."
      );
    }

    throw new Error(
      `Tavily search failed: ${
        error.response?.data?.detail ||
        error.message
      }`
    );
  }
}

async function generateJson(
  ai,
  budget,
  prompt,
  schema,
  maxOutputTokens = 3000
) {
  let lastError = null;

  const models = [
    process.env.GEMINI_MODEL || "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash"
  ].filter(
    (value, index, array) =>
      value && array.indexOf(value) === index
  );

  consumeAiCall(budget);

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
            maxOutputTokens
          }
        });

        const text = String(response.text || "").trim();

        try {
          return JSON.parse(text);
        } catch {
          const first = text.indexOf("{");
          const last = text.lastIndexOf("}");

          if (first !== -1 && last > first) {
            return JSON.parse(
              text.slice(first, last + 1)
            );
          }

          throw new Error(
            "Gemini returned invalid JSON."
          );
        }
      } catch (error) {
        lastError = error;

        const message = String(
          error?.message || error
        );

        const retryable =
          message.includes("503") ||
          message.includes("UNAVAILABLE") ||
          message.includes("429") ||
          message.includes("RESOURCE_EXHAUSTED") ||
          message.includes("500");

        if (!retryable) break;

        await sleep(
          5000 * Math.pow(2, attempt)
        );
      }
    }
  }

  throw new Error(
    `Gemini analysis failed: ${
      lastError?.message ||
      "Unknown error"
    }`
  );
}

const SUBJECT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    role: { type: "string" },
    company: { type: "string" },
    location: { type: "string" },
    linkedinUrl: { type: "string" },
    confidence: { type: "number" }
  },
  required: [
    "name",
    "role",
    "company",
    "location",
    "linkedinUrl",
    "confidence"
  ]
};

const CLAIM_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          importance: {
            type: "string",
            enum: ["high", "medium", "low"]
          }
        },
        required: [
          "id",
          "text",
          "importance"
        ]
      }
    }
  },
  required: ["claims"]
};

const ADJUDICATION_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claimId: { type: "string" },
          status: {
            type: "string",
            enum: [
              "verified",
              "partially verified",
              "unverified",
              "rejected"
            ]
          },
          reason: { type: "string" }
        },
        required: [
          "claimId",
          "status",
          "reason"
        ]
      }
    }
  },
  required: ["decisions"]
};

const DIAGNOSTIC_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    strengths: {
      type: "array",
      items: { type: "string" }
    },
    gaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          evidence: { type: "string" },
          implication: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                url: { type: "string" }
              },
              required: ["title", "url"]
            }
          }
        },
        required: [
          "title",
          "evidence",
          "implication",
          "sources"
        ]
      }
    },
    recommendations: {
      type: "array",
      items: { type: "string" }
    },
    refusedClaim: { type: "string" }
  },
  required: [
    "summary",
    "strengths",
    "gaps",
    "recommendations",
    "refusedClaim"
  ]
};

async function discoverSubject(
  linkedinUrl,
  slug,
  discovery,
  budget
) {
  requireEnv("GEMINI_API_KEY");

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  const sourcePack = discovery
    .slice(0, 20)
    .map(
      (source, index) =>
        `[${index + 1}]
TITLE: ${source.title}
URL: ${source.url}
EXCERPT: ${String(
  source.content || ""
).slice(0, 900)}`
    )
    .join("\n\n");

  const prompt = `Identify the person represented by this public LinkedIn URL.

LinkedIn URL:
${linkedinUrl}

Profile slug:
${slug}

Use only the provided sources.

Do not guess.

The person must be a founder, CEO, or fund manager.

The company must be the person's current company, not a former employer.

Return:
- full name
- current role
- current company
- location
- exact LinkedIn URL
- confidence from 0 to 1

Sources:

${sourcePack}`;

  return generateJson(
    ai,
    budget,
    prompt,
    SUBJECT_SCHEMA,
    2200
  );
}

function compactHost(host) {
  return normalize(
    String(host || "").replace(
      /\.(com|ae|io|co|ai|net|org|me|app|dev)$/i,
      ""
    )
  );
}

function inferEntityHints(subject) {
  const text = normalize(
    `${subject?.role || ""} ${subject?.company || ""}`
  );

  const hints = new Set();

  const groups = [
    {
      words: [
        "real estate",
        "property",
        "properties",
        "developer",
        "development",
        "brokerage"
      ],
      hints: [
        "real estate",
        "property",
        "properties",
        "developer",
        "development",
        "brokerage"
      ]
    },
    {
      words: [
        "hospitality",
        "hotel",
        "resort",
        "restaurant",
        "travel"
      ],
      hints: [
        "hospitality",
        "hotel",
        "resort",
        "restaurant",
        "travel"
      ]
    },
    {
      words: [
        "technology",
        "software",
        "saas",
        "artificial intelligence",
        "ai",
        "fintech"
      ],
      hints: [
        "technology",
        "software",
        "saas",
        "artificial intelligence",
        "fintech"
      ]
    },
    {
      words: [
        "finance",
        "investment",
        "asset management",
        "fund",
        "bank"
      ],
      hints: [
        "finance",
        "investment",
        "asset management",
        "fund",
        "bank"
      ]
    },
    {
      words: [
        "retail",
        "fashion",
        "consumer"
      ],
      hints: [
        "retail",
        "fashion",
        "consumer"
      ]
    }
  ];

  for (const group of groups) {
    if (
      group.words.some(
        word => text.includes(word)
      )
    ) {
      group.hints.forEach(
        hint => hints.add(hint)
      );
    }
  }

  return [...hints];
}

function scoreOfficialDomainCandidate(
  source,
  context
) {
  const {
    companyName,
    subjectName,
    subjectLocation,
    subjectRole
  } = context;

  const host = hostOf(source?.url);

  if (!host) {
    return {
      score: -1000,
      hardReject: true
    };
  }

  if (
    isWikipedia(source.url) ||
    isSocial(source.url) ||
    domainIn(source.url, WEAK_DOMAINS) ||
    domainIn(
      source.url,
      NON_OFFICIAL_COMPANY_DOMAINS
    ) ||
    domainMatches(host, "linkedin.com")
  ) {
    return {
      score: -1000,
      hardReject: true
    };
  }

  const companyTokens =
    tokens(companyName).filter(
      token => token.length >= 2
    );

  const strongCompanyTokens =
    companyTokens.filter(
      token =>
        !GENERIC_COMPANY_TOKENS.has(token)
    );

  const personTokens =
    tokens(subjectName).filter(
      token => token.length >= 3
    );

  const locationTokens =
    tokens(subjectLocation).filter(
      token => token.length >= 3
    );

  const hostText = compactHost(host);

  const pageText = normalize(
    `${source?.title || ""} ${source?.content || ""}`
  );

  const hints = inferEntityHints({
    company: companyName,
    role: subjectRole
  });

  let score = 0;
  let personHits = 0;
  let companyHits = 0;
  let locationHits = 0;
  let hintHits = 0;
  let hostCompanyHits = 0;
  let hostStrongCompanyHits = 0;

  for (const token of companyTokens) {
    const isGenericCompanyToken =
      GENERIC_COMPANY_TOKENS.has(token);

    if (hostText.includes(token)) {
      companyHits += 1;
      hostCompanyHits += 1;

      if (!isGenericCompanyToken) {
        hostStrongCompanyHits += 1;
        score += 28;
      } else {
        score += 4;
      }
    }

    if (pageText.includes(token)) {
      companyHits += 1;
      score += 7;
    }
  }

  for (const token of personTokens) {
    if (pageText.includes(token)) {
      personHits += 1;
      score += 18;
    }
  }

  for (const token of locationTokens) {
    if (pageText.includes(token)) {
      locationHits += 1;
      score += 8;
    }
  }

  for (const hint of hints) {
    if (pageText.includes(hint)) {
      hintHits += 1;
      score += 6;
    }
  }

  const officialSignals = [
    "about us",
    "about",
    "leadership",
    "our team",
    "contact",
    "who we are",
    "our story",
    "company",
    "founder",
    "chief executive",
    "ceo",
    "website",
    "headquarters",
    "locations"
  ];

  let officialSignalCount = 0;

  for (const signal of officialSignals) {
    if (pageText.includes(signal)) {
      officialSignalCount += 1;
      score += 3;
    }
  }

  const contradictionSignals = [
    "campgrounds of america",
    "campground",
    "camping",
    "rv park",
    "rv parks",
    "outdoor recreation"
  ];

  const targetHints = new Set(hints);

  const targetIsOutdoor =
    targetHints.has("hospitality") &&
    /camp|outdoor|rv/i.test(
      `${companyName} ${subjectRole}`
    );

  if (!targetIsOutdoor) {
    for (const signal of contradictionSignals) {
      if (pageText.includes(signal)) {
        score -= 55;
      }
    }
  }

  const thirdPartySignals = [
    "people also viewed",
    "directory",
    "email address",
    "contact information",
    "crunchbase",
    "linkedin members",
    "company directory",
    "profile database"
  ];

  for (const signal of thirdPartySignals) {
    if (pageText.includes(signal)) {
      score -= 30;
    }
  }

  const compactCompanyName =
    normalize(companyName).replace(/\s/g, "");

  const originalCompanyName =
    String(companyName || "").trim();

  const isUppercaseAcronym =
    /^[A-Z0-9]{2,6}$/.test(
      originalCompanyName
    );

  const isAcronymLike =
    isUppercaseAcronym ||
    (
      compactCompanyName.length <= 4 &&
      companyTokens.length <= 2
    );

  const hasStrongIdentity =
    personHits >=
      Math.min(2, personTokens.length) &&
    companyHits >= 1;

  const hasStrongAcronymIdentity =
    !isAcronymLike ||
    (
      personHits >= 2 &&
      companyHits >= 1 &&
      (
        locationHits >= 1 ||
        hintHits >= 1
      )
    );

  const hasHostIdentity =
    strongCompanyTokens.length > 0
      ? hostStrongCompanyHits >= 1
      : hostCompanyHits >= 1;

  const titleExactCompany =
    normalize(source?.title || "").includes(
      normalize(companyName)
    );

  const hasOfficialAliasIdentity =
    titleExactCompany &&
    pageText.includes(
      normalize(companyName)
    ) &&
    officialSignalCount >= 2 &&
    /\b(headquarters?|website|contact|about us|our team|locations?)\b/i.test(
      pageText
    ) &&
    !thirdPartySignals.some(
      signal => pageText.includes(signal)
    );

  const hardReject =
    score < -20 ||
    (
      !hasHostIdentity &&
      !hasOfficialAliasIdentity
    ) ||
    (
      isAcronymLike &&
      !hasStrongAcronymIdentity
    );

  return {
    score,
    hardReject,
    personHits,
    companyHits,
    locationHits,
    hintHits,
    host
  };
}

function findCompanyDomain(
  sources,
  context
) {
  const candidates =
    dedupeSources(sources);

  const scored =
    candidates
      .map(source => ({
        source,
        evaluation:
          scoreOfficialDomainCandidate(
            source,
            context
          )
      }))
      .filter(
        item =>
          !item.evaluation.hardReject &&
          item.evaluation.score >= 20
      )
      .sort((a, b) => {
        const scoreDiff =
          b.evaluation.score -
          a.evaluation.score;

        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        return (
          Number(b.source.score || 0) -
          Number(a.source.score || 0)
        );
      });

  const best = scored[0];

  if (best) {
    return hostOf(best.source.url);
  }

  const companyLinkedInCandidates =
    dedupeSources(sources)
      .filter(source =>
        looksLikeTargetCompanyLinkedInSource(
          source,
          context
        )
      )
      .map(source => ({
        source,
        domain:
          extractOfficialWebsiteFromCompanyLinkedIn(
            source,
            context
          )
      }))
      .filter(item => item.domain);

  if (companyLinkedInCandidates.length) {
    companyLinkedInCandidates.sort(
      (a, b) =>
        a.domain.localeCompare(b.domain)
    );

    return companyLinkedInCandidates[0].domain;
  }

  return "";
}

function companyCandidateSource(
  sources,
  context
) {
  return dedupeSources(sources)
    .map(source => ({
      source,
      evaluation:
        scoreOfficialDomainCandidate(
          source,
          context
        )
    }))
    .filter(
      item =>
        !item.evaluation.hardReject &&
        item.evaluation.score >= 20
    )
    .sort(
      (a, b) =>
        b.evaluation.score -
          a.evaluation.score ||
        normalizedUrl(a.source.url).localeCompare(
          normalizedUrl(b.source.url)
        )
    );
}

function looksLikeTargetCompanyLinkedInSource(
  source,
  context
) {
  if (
    !source?.url ||
    !domainMatches(
      hostOf(source.url),
      "linkedin.com"
    )
  ) {
    return false;
  }

  let path = "";

  try {
    path = new URL(source.url).pathname.toLowerCase();
  } catch {
    return false;
  }

  if (!path.startsWith("/company/")) {
    return false;
  }

  const pageText = normalize(
    `${source.title || ""} ${source.content || ""}`
  );

  const company =
    normalize(context.companyName || "");

  const person =
    normalize(context.subjectName || "");

  const location =
    normalize(context.subjectLocation || "");

  const companyTokens =
    tokens(context.companyName || "")
      .filter(t => t.length >= 2);

  const strongTokens =
    companyTokens.filter(
      t => !GENERIC_COMPANY_TOKENS.has(t)
    );

  const exactCompany =
    company && pageText.includes(company);

  const personHit =
    person && pageText.includes(person);

  const locationHit =
    [
      "dubai",
      "abu dhabi",
      "sharjah",
      "ajman",
      "fujairah",
      "ras al khaimah",
      "umm al quwain",
      "united arab emirates",
      "uae"
    ].some(
      loc =>
        location.includes(loc) &&
        pageText.includes(loc)
    );

  const slug = normalize(path);

  const strongSlugHit =
    strongTokens.some(t => slug.includes(t));

  const companyLinkedInSignals = [
    "headquarters",
    "employees",
    "website",
    "about",
    "company size",
    "industry",
    "locations",
    "specialties"
  ].filter(
    x => pageText.includes(x)
  ).length;

  return Boolean(
    exactCompany &&
    (
      personHit ||
      (
        locationHit &&
        companyLinkedInSignals >= 1
      ) ||
      (
        strongSlugHit &&
        companyLinkedInSignals >= 2
      )
    )
  );
}

function extractOfficialWebsiteFromCompanyLinkedIn(
  source,
  context
) {
  if (
    !looksLikeTargetCompanyLinkedInSource(
      source,
      context
    )
  ) {
    return "";
  }

  const raw =
    `${source.title || ""} ${
      source.content || ""
    }`;

  const urls =
    raw.match(
      /https?:\/\/[^\s<>()"']+/gi
    ) || [];

  const candidates = [];

  for (const rawUrl of urls) {
    const cleaned =
      rawUrl.replace(/[),.;]+$/g, "");

    const host = hostOf(cleaned);

    if (!host) continue;

    if (
      domainMatches(host, "linkedin.com") ||
      isSocial(cleaned) ||
      domainIn(
        cleaned,
        NON_OFFICIAL_COMPANY_DOMAINS
      )
    ) {
      continue;
    }

    candidates.push({
      url: cleaned,
      host
    });
  }

  const ranked =
    candidates
      .map(item => {
        const pageText = normalize(raw);
        let score = 0;

        const companyTokens =
          tokens(context.companyName || "")
            .filter(
              t =>
                t.length >= 3 &&
                !GENERIC_COMPANY_TOKENS.has(t)
            );

        for (const t of companyTokens) {
          if (
            compactHost(item.host).includes(t)
          ) {
            score += 30;
          }
        }

        if (
          /website|official website|company website/i.test(
            pageText
          )
        ) {
          score += 20;
        }

        if (
          /headquarters|dubai|uae|united arab emirates/i.test(
            pageText
          )
        ) {
          score += 5;
        }

        return {
          ...item,
          score
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.host.localeCompare(b.host)
      );

  return ranked[0]?.host || "";
}

function companyLinkedInFromSources(
  sources,
  context
) {
  const candidates =
    dedupeSources(sources)
      .filter(source =>
        isLinkedInCompanyUrl(
          source.url,
          context.companyName
        ) ||
        looksLikeTargetCompanyLinkedInSource(
          source,
          context
        )
      )
      .map(source => {
        const pageText =
          normalize(
            `${source.title || ""} ${
              source.content || ""
            }`
          );

        const companyTokens =
          tokens(context.companyName).filter(
            token => token.length >= 2
          );

        const strongTokens =
          companyTokens.filter(
            token =>
              !GENERIC_COMPANY_TOKENS.has(token)
          );

        const personTokens =
          tokens(context.subjectName).filter(
            token => token.length >= 3
          );

        const locationTokens =
          tokens(context.subjectLocation).filter(
            token => token.length >= 3
          );

        let score = 0;
        let personHits = 0;
        let companyHits = 0;
        let locationHits = 0;

        for (const token of companyTokens) {
          if (
            normalize(source.url).includes(token)
          ) {
            score += 20;
            companyHits += 1;
          }

          if (pageText.includes(token)) {
            score += 8;
            companyHits += 1;
          }
        }

        for (const token of personTokens) {
          if (pageText.includes(token)) {
            score += 18;
            personHits += 1;
          }
        }

        for (const token of locationTokens) {
          if (pageText.includes(token)) {
            score += 7;
            locationHits += 1;
          }
        }

        const acronymLike =
          companyTokens.length <= 2 &&
          normalize(
            context.companyName
          ).replace(/\s/g, "").length <= 6;

        const allGeneric =
          companyTokens.length > 0 &&
          strongTokens.length === 0;

        const exactCompanyText =
          pageText.includes(
            normalize(context.companyName)
          );

        const strongTokenHits =
          strongTokens.filter(
            token =>
              normalize(source.url).includes(token) ||
              pageText.includes(token)
          ).length;

        const valid =
          (
            allGeneric
              ? (
                  personHits >= 1 &&
                  companyHits >= 1
                )
              : (
                  (
                    personHits >= 1 &&
                    companyHits >= 1
                  ) ||
                  (
                    locationHits >= 1 &&
                    strongTokenHits >= 1 &&
                    companyHits >= 1 &&
                    exactCompanyText
                  )
                )
          ) &&
          (
            !acronymLike ||
            (
              (
                personHits >= 1 &&
                companyHits >= 1
              ) ||
              (
                locationHits >= 1 &&
                strongTokenHits >= 1
              )
            )
          );

        const websiteBonus =
          extractOfficialWebsiteFromCompanyLinkedIn(
            source,
            context
          )
            ? 25
            : 0;

        return {
          source,
          score: score + websiteBonus,
          valid
        };
      })
      .filter(item => item.valid)
      .sort(
        (a, b) =>
          b.score - a.score ||
          normalizedUrl(
            a.source.url
          ).localeCompare(
            normalizedUrl(
              b.source.url
            )
          )
      );

  return candidates[0]?.source?.url || "";
}

async function extractClaims(
  subject,
  sources,
  budget
) {
  requireEnv("GEMINI_API_KEY");

  const ai =
    new GoogleGenAI({
      apiKey:
        process.env.GEMINI_API_KEY
    });

  const sourcePack =
    sources
      .slice(0, 35)
      .map(
        (source, index) =>
          `[${index + 1}] ${
            source.sourceQuality ||
            "unknown"
          }
TITLE: ${source.title}
URL: ${source.url}
EXCERPT: ${String(
  source.content || ""
).slice(0, 850)}`
      )
      .join("\n\n");

  const prompt = `Extract the four highest-value factual claims for a reputation and narrative diagnostic.

SUBJECT:
${JSON.stringify(
  subject,
  null,
  2
)}

Rules:
1. Current leadership/role claim has highest priority.
2. A founder-history or major company milestone claim is required when the collected evidence supports one.
3. Include at most one education claim.
4. Employment history is lower priority than founder/company facts.
5. Do not use more than one education claim.
6. Do not create unsupported claims.
7. Keep claims narrow and exact.
8. Do not combine unrelated facts.
9. Preserve exact dates and numbers.
10. Do not turn a company achievement into a personal achievement without direct attribution.

Priority:
A. leadership
B. founder/company milestone
C. important career history
D. one education claim

Return JSON only.

SOURCES:

${sourcePack}`;

  const result =
    await generateJson(
      ai,
      budget,
      prompt,
      CLAIM_SCHEMA,
      3000
    );

  let claims =
    Array.isArray(result.claims)
      ? result.claims
      : [];

  claims =
    claims
      .map(claim => ({
        ...claim,
        type:
          claimTypeForClaim(
            claim.text
          )
      }))
      .filter(
        claim =>
          claim.text &&
          String(
            claim.text
          ).trim()
      );

  const selected = [];
  const usedTypes = new Set();

  const leadership =
    claims.find(
      claim =>
        claim.type ===
        "leadership_role"
    );

  if (leadership) {
    selected.push(leadership);
    usedTypes.add("leadership_role");
  }

  const founder =
    claims.find(
      claim =>
        claim.type === "founder_history" ||
        claim.type === "company_milestone"
    );

  if (founder) {
    selected.push(founder);
    usedTypes.add(founder.type);
  }

  const employment =
    claims.find(
      claim =>
        claim.type === "employment"
    );

  if (
    employment &&
    selected.length < 4
  ) {
    selected.push(employment);
    usedTypes.add("employment");
  }

  const education =
    claims.find(
      claim =>
        claim.type === "education"
    );

  if (
    education &&
    selected.length < 4
  ) {
    selected.push(education);
    usedTypes.add("education");
  }

  for (const claim of claims) {
    if (selected.length >= 4) break;

    if (
      selected.some(
        selectedClaim =>
          selectedClaim.id === claim.id
      )
    ) {
      continue;
    }

    if (
      claim.type === "education" &&
      usedTypes.has("education")
    ) {
      continue;
    }

    selected.push(claim);
    usedTypes.add(claim.type);
  }

  return selected
    .slice(0, 4)
    .map((claim, index) => ({
      ...claim,
      id:
        claim.id ||
        `claim-${index + 1}`
    }));
}

async function verifyClaimEvidence(
  claim,
  subject,
  companyDomain,
  companyLinkedInUrl,
  sources,
  budget
) {
  const context = {
    companyDomain,
    companyLinkedInUrl,
    subjectLinkedIn:
      subject.linkedinUrl,
    companyName:
      subject.company
  };

  const claimType =
    claimTypeForClaim(claim.text);

  const primaryPreference =
    claimPrimaryPreference(
      claimType
    );

  const available =
    dedupeSources(sources).map(
      source => ({
        ...source,
        sourceQuality:
          source.sourceQuality ||
          sourceQuality(
            source.url,
            context
          )
      })
    );

  let primaryCandidates =
    available
      .filter(source =>
        primaryPreference.includes(
          source.sourceQuality
        )
      )
      .filter(source =>
        sourceLooksDirect(
          source,
          claim,
          subject,
          source.sourceQuality
        )
      );

  if (
    [
      "leadership_role",
      "founder_history",
      "company_milestone"
    ].includes(claimType)
  ) {
    const companyPrimary =
      primaryCandidates.filter(
        source =>
          source.sourceQuality ===
            "primary-company" ||
          source.sourceQuality ===
            "primary-company-linkedin"
      );

    if (companyPrimary.length) {
      primaryCandidates =
        companyPrimary;
    }
  }

  primaryCandidates.sort((a, b) => {
    const qualityRank = {
      "primary-company": 0,
      "primary-company-linkedin": 1,
      "primary-subject": 2,
      "primary-official": 3
    };

    return (
      (qualityRank[a.sourceQuality] ?? 9) -
      (qualityRank[b.sourceQuality] ?? 9) ||
      Number(b.score || 0) -
      Number(a.score || 0) ||
      normalizedUrl(a.url).localeCompare(
        normalizedUrl(b.url)
      )
    );
  });

  let primary =
    primaryCandidates[0] || null;

  if (
    !primary &&
    budget.searches <
      budget.limits.maxSearchesPerRun &&
    companyDomain &&
    [
      "leadership_role",
      "founder_history",
      "company_milestone"
    ].includes(claimType)
  ) {
    const query =
      `site:${companyDomain} "${subject.name}" "${claim.text}"`;

    const results =
      await tavilySearch(
        query,
        budget,
        {
          max_results: 8,
          include_domains: [
            companyDomain
          ]
        }
      );

    const contextual =
      results.map(source => ({
        ...source,
        sourceQuality:
          "primary-company"
      }));

    primaryCandidates =
      contextual.filter(
        source =>
          sourceLooksDirect(
            source,
            claim,
            subject,
            "primary-company"
          )
      );

    primary =
      primaryCandidates[0] || null;
  }

  if (
    !primary &&
    budget.searches <
      budget.limits.maxSearchesPerRun &&
    [
      "leadership_role",
      "founder_history"
    ].includes(claimType)
  ) {
    const query =
      `site:linkedin.com/in "${subject.name}" "${subject.company}" CEO founder`;

    const results =
      await tavilySearch(
        query,
        budget,
        {
          max_results: 8,
          include_domains: ["linkedin.com"]
        }
      );

    const contextual =
      results.map(source => ({
        ...source,
        sourceQuality:
          isSubjectLinkedInUrl(
            source.url,
            subject.linkedinUrl
          )
            ? "primary-subject"
            : "secondary"
      }));

    primary =
      contextual
        .filter(
          source =>
            source.sourceQuality ===
            "primary-subject"
        )
        .filter(
          source =>
            sourceLooksDirect(
              source,
              claim,
              subject,
              "primary-subject"
            )
        )[0] || null;
  }

  if (
    !primary &&
    budget.searches <
      budget.limits.maxSearchesPerRun
  ) {
    const query =
      `"${subject.name}" "${claim.text}"`;

    const results =
      await tavilySearch(
        query,
        budget,
        {
          max_results: 8
        }
      );

    const contextual =
      results.map(source => ({
        ...source,
        sourceQuality:
          sourceQuality(
            source.url,
            context
          )
      }));

    primaryCandidates =
      contextual
        .filter(source =>
          primaryPreference.includes(
            source.sourceQuality
          )
        )
        .filter(source =>
          sourceLooksDirect(
            source,
            claim,
            subject,
            source.sourceQuality
          )
        );

    primary =
      primaryCandidates[0] || null;
  }

  let independentCandidates =
    available
      .filter(source =>
        isCredibleIndependentSource(
          source,
          companyDomain,
          subject.linkedinUrl,
          companyLinkedInUrl
        )
      )
      .filter(source =>
        sourceLooksDirect(
          source,
          claim,
          subject,
          "strong-independent"
        )
      )
      .sort(
        (a, b) =>
          Number(b.score || 0) -
          Number(a.score || 0)
      );

  let independent =
    independentCandidates[0] || null;

  if (
    independent &&
    claimType === "leadership_role" &&
    !sourceLooksDirect(
      independent,
      claim,
      subject,
      "strong-independent"
    )
  ) {
    independent = null;
  }

  if (
    !independent &&
    [
      "leadership_role",
      "founder_history"
    ].includes(claimType)
  ) {
    const firstPartySecond =
      available
        .filter(source =>
          [
            "primary-company",
            "primary-company-linkedin",
            "primary-subject",
            "primary-official"
          ].includes(source.sourceQuality)
        )
        .filter(
          source =>
            !primary ||
            normalizedUrl(source.url) !==
              normalizedUrl(primary.url)
        )
        .filter(source =>
          sourceLooksDirect(
            source,
            claim,
            subject,
            source.sourceQuality
          )
        )
        .filter(source => {
          if (!primary) return false;

          const pair =
            `${source.sourceQuality}|${primary.sourceQuality}`;

          return new Set([
            "primary-subject|primary-company",
            "primary-subject|primary-company-linkedin",
            "primary-subject|primary-official",
            "primary-company|primary-subject",
            "primary-company-linkedin|primary-subject",
            "primary-official|primary-subject"
          ]).has(pair);
        })
        .sort(
          (a, b) =>
            Number(b.score || 0) -
            Number(a.score || 0)
        );

    if (firstPartySecond.length) {
      independent = {
        ...firstPartySecond[0],
        sourceQuality:
          "corroborating-first-party"
      };
    }
  }

  if (
    !independent &&
    [
      "leadership_role",
      "founder_history"
    ].includes(claimType)
  ) {
    const professionalCandidates =
      available
        .filter(source =>
          isIndependentProfessionalSource(
            source,
            subject.linkedinUrl,
            companyLinkedInUrl
          )
        )
        .filter(source =>
          sourceLooksDirect(
            source,
            claim,
            subject,
            "independent-professional"
          )
        );

    if (professionalCandidates.length) {
      independent = {
        ...professionalCandidates[0],
        sourceQuality:
          "independent-professional"
      };
    }
  }

  if (
    !independent &&
    budget.searches <
      budget.limits.maxSearchesPerRun
  ) {
    const leadershipExact =
      claimType === "leadership_role"
        ? " CEO founder co-founder chief executive"
        : "";

    const query =
      `"${subject.name}" "${subject.company}" "${claim.text}"${leadershipExact}`;

    const results =
      await tavilySearch(
        query,
        budget,
        {
          max_results: 10,
          include_domains:
            STRONG_INDEPENDENT_DOMAINS
        }
      );

    independentCandidates =
      results
        .map(source => ({
          ...source,
          sourceQuality:
            "strong-independent"
        }))
        .filter(source =>
          isCredibleIndependentSource(
            source,
            companyDomain,
            subject.linkedinUrl,
            companyLinkedInUrl
          )
        )
        .filter(source =>
          sourceLooksDirect(
            source,
            claim,
            subject,
            "strong-independent"
          )
        );

    independent =
      independentCandidates[0] || null;
  }

  if (
    !independent &&
    budget.searches <
      budget.limits.maxSearchesPerRun
  ) {
    const query =
      `"${subject.name}" "${subject.company}" ${
        claimType === "leadership_role"
          ? "CEO founder leadership"
          : claimType === "founder_history"
            ? "founder founded launched"
            : claimType === "education"
              ? "education university degree"
              : claimType === "employment"
                ? "career role"
                : "company"
      }`;

    const results =
      await tavilySearch(
        query,
        budget,
        {
          max_results: 10
        }
      );

    independentCandidates =
      results
        .map(source => ({
          ...source,
          sourceQuality:
            "strong-independent"
        }))
        .filter(source =>
          isCredibleIndependentSource(
            source,
            companyDomain,
            subject.linkedinUrl,
            companyLinkedInUrl
          )
        )
        .filter(source =>
          sourceLooksDirect(
            source,
            claim,
            subject,
            "strong-independent"
          )
        );

    independent =
      independentCandidates[0] || null;
  }

  consumeVerification(budget);

  return {
    ...claim,
    type: claimType,
    primarySource: primary,
    secondSource: independent
  };
}

async function adjudicateAll(
  claimEvidence,
  subject,
  budget
) {
  requireEnv("GEMINI_API_KEY");

  const ai =
    new GoogleGenAI({
      apiKey:
        process.env.GEMINI_API_KEY
    });

  const records =
    claimEvidence.map(claim => ({
      claimId: claim.id,
      claimType: claim.type,
      claim: claim.text,
      primarySource:
        claim.primarySource
          ? {
              quality:
                claim.primarySource
                  .sourceQuality,
              title:
                claim.primarySource
                  .title,
              url:
                claim.primarySource
                  .url,
              excerpt:
                String(
                  claim.primarySource
                    .content || ""
                ).slice(0, 1000)
            }
          : null,
      independentSource:
        claim.secondSource
          ? {
              quality:
                claim.secondSource
                  .sourceQuality,
              title:
                claim.secondSource
                  .title,
              url:
                claim.secondSource
                  .url,
              excerpt:
                String(
                  claim.secondSource
                    .content || ""
                ).slice(0, 1000)
            }
          : null
    }));

  const prompt = `Adjudicate these claims conservatively.

SUBJECT:
${JSON.stringify(
  subject,
  null,
  2
)}

Rules:
1. VERIFIED requires:
   - qualifying primary evidence
   - qualifying strong independent evidence
   - both sources must support the exact claim wording
2. If the claim contains a year, both supporting sources must support the year.
3. If the claim contains an exact job title, the evidence must support that exact title.
4. If the claim contains a number or amount, the evidence must support it.
5. Do not infer a founder claim from ordinary employment.
6. Do not infer a title from a broader career statement.
7. Do not infer a company achievement as the person's achievement.
8. PARTIALLY VERIFIED means meaningful evidence exists but the exact claim is not fully established.
9. UNVERIFIED means the evidence is insufficient.
10. REJECTED means credible evidence contradicts the claim.

Return JSON only.

CLAIMS AND EVIDENCE:
${JSON.stringify(
  records,
  null,
  2
)}`;

  return generateJson(
    ai,
    budget,
    prompt,
    ADJUDICATION_SCHEMA,
    3200
  );
}

function applyAdjudications(
  claimEvidence,
  adjudicated,
  subject
) {
  const decisions = new Map(
    (adjudicated?.decisions || []).map(
      decision => [
        String(
          decision.claimId ??
          decision.id ??
          ""
        ),
        decision
      ]
    )
  );

  function norm(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[-_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasAny(text, terms) {
    const value = norm(text);

    return terms.some(term =>
      value.includes(norm(term))
    );
  }

  function sourceMatchesClaim(
    claim,
    source,
    person
  ) {
    if (!source) return false;

    const claimText =
      String(claim.text || "");

    const sourceText =
      `${source.title || ""} ${source.content || ""}`;

    const claimType =
      claim.type ||
      claimTypeForClaim(claimText);

    const normalizedClaim =
      norm(claimText);

    const normalizedSource =
      norm(sourceText);

    const personName =
      norm(person?.name || "");

    const companyName =
      norm(person?.company || "");

    const personTokens =
      tokens(personName).filter(
        token => token.length >= 3
      );

    const companyTokens =
      tokens(companyName).filter(
        token => token.length >= 3
      );

    const personHit =
      Boolean(personName) &&
      normalizedSource.includes(
        personName
      );

    const personTokenHits =
      personTokens.filter(
        token =>
          normalizedSource.includes(
            token
          )
      ).length;

    const companyHit =
      Boolean(companyName) &&
      normalizedSource.includes(
        companyName
      );

    const companyTokenHits =
      companyTokens.filter(
        token =>
          normalizedSource.includes(
            token
          )
      ).length;

    const companyCentricClaim =
      claimType === "company_milestone" ||
      (
        claimType ===
          "professional_achievement" &&
        Boolean(companyName) &&
        (
          normalizedClaim.includes(companyName) ||
          tokens(person?.company || "").filter(
            token =>
              token.length >= 3 &&
              normalizedClaim.includes(token)
          ).length >= 2
        )
      );

    if (
      !companyCentricClaim &&
      !personHit &&
      personTokenHits <
        Math.min(
          2,
          Math.max(
            1,
            personTokens.length
          )
        )
    ) {
      return false;
    }

    if (
      companyCentricClaim &&
      !companyHit &&
      companyTokenHits <
        Math.min(
          2,
          Math.max(
            1,
            companyTokens.length
          )
        )
    ) {
      return false;
    }

    if (claimType === "leadership_role") {
      const roleSupported =
        hasAny(
          claimText,
          [
            "ceo",
            "chief executive",
            "chairman",
            "founder",
            "co-founder",
            "co founder",
            "managing director",
            "president"
          ]
        );

      if (!roleSupported) return false;

      const requestedFounder =
        /\b(co[- ]?founder|founder)\b/i.test(
          claimText
        );

      const requestedCeo =
        /\b(ceo|chief executive)\b/i.test(
          claimText
        );

      const requestedChair =
        /\b(chairman|president|managing director)\b/i.test(
          claimText
        );

      const hasFounder =
        /\b(co[- ]?founder|founder)\b/i.test(
          normalizedSource
        );

      const hasCeo =
        /\b(ceo|chief executive)\b/i.test(
          normalizedSource
        );

      const hasChair =
        /\b(chairman|president|managing director)\b/i.test(
          normalizedSource
        );

      return (
        (!requestedFounder || hasFounder) &&
        (!requestedCeo || hasCeo) &&
        (!requestedChair || hasChair)
      );
    }

    if (claimType === "founder_history") {
      const founderWords = [
        "founded",
        "founder",
        "co-founded",
        "co founder",
        "cofounder",
        "started",
        "launched"
      ];

      if (
        !hasAny(
          sourceText,
          founderWords
        )
      ) {
        return false;
      }

      const years =
        claimText.match(
          /\b(?:19|20)\d{2}\b/g
        ) || [];

      if (years.length) {
        const allYearsPresent =
          years.every(year =>
            normalizedSource.includes(
              year
            )
          );

        if (!allYearsPresent) {
          return false;
        }
      }

      return true;
    }

    if (
      claimType === "company_milestone" ||
      claimType === "professional_achievement"
    ) {
      return hasAny(
        sourceText,
        [
          "company",
          "holdings",
          "group",
          "properties",
          "business",
          "founded",
          "acquired",
          "launched",
          "headquartered",
          "based in",
          "provides",
          "operates"
        ]
      );
    }

    if (claimType === "education") {
      return hasAny(
        sourceText,
        [
          "university",
          "college",
          "degree",
          "bachelor",
          "master",
          "mba",
          "graduated",
          "studied"
        ]
      );
    }

    if (claimType === "employment") {
      const titleRequested =
        /(associate partner|partner|management consultant|consultant)/i.test(
          claimText
        );

      if (titleRequested) {
        return hasAny(
          sourceText,
          [
            "associate partner",
            "partner",
            "management consultant",
            "consultant"
          ]
        );
      }

      return hasAny(
        sourceText,
        [
          "worked",
          "joined",
          "employee",
          "career",
          "consultant",
          "partner"
        ]
      );
    }

    return false;
  }

  function qualifiesAsPrimary(source) {
    if (!source) return false;

    return [
      "primary-company",
      "primary-company-linkedin",
      "primary-subject",
      "primary-official"
    ].includes(
      source.sourceQuality
    );
  }

  function qualifiesAsIndependent(source) {
    // A second company/subject source is corroboration, not independent evidence.
    // Only genuinely independent or independent-professional sources satisfy the
    // independent-evidence requirement for VERIFIED claims.
    return Boolean(
      source &&
      [
        "strong-independent",
        "independent-professional"
      ].includes(source.sourceQuality)
    );
  }

  return claimEvidence.map(
    claim => {
      const decision =
        decisions.get(
          String(
            claim.id || ""
          )
        );

      let status =
        decision?.status ||
        "unverified";

      let reason =
        decision?.reason ||
        "The evidence did not meet the verification standard.";

      const primary =
        claim.primarySource;

      const independent =
        claim.secondSource;

      const type =
        claim.type ||
        claimTypeForClaim(
          claim.text
        );

      const primarySupports =
        sourceMatchesClaim(
          claim,
          primary,
          subject
        );

      const independentSupports =
        sourceMatchesClaim(
          claim,
          independent,
          subject
        );

      if (
        type === "leadership_role" ||
        type === "founder_history"
      ) {
        if (
          qualifiesAsPrimary(primary) &&
          qualifiesAsIndependent(independent) &&
          primarySupports &&
          independentSupports
        ) {
          status = "verified";
          reason =
            "A qualifying primary source and a credible independent source both support the exact claim.";
        } else if (
          primarySupports ||
          independentSupports
        ) {
          status = "partially verified";
          reason =
            "Relevant evidence exists, but the claim is not fully corroborated by both required source types.";
        } else {
          status = "unverified";
        }
      }

      if (
        type === "company_milestone" ||
        type === "professional_achievement"
      ) {
        if (
          qualifiesAsPrimary(primary) &&
          primarySupports
        ) {
          status = "verified";
          reason =
            "The official company source directly supports the claim.";
        } else if (
          primarySupports ||
          independentSupports
        ) {
          status = "partially verified";
          reason =
            "Relevant evidence exists, but the strongest source standard was not fully met.";
        } else {
          status = "unverified";
        }
      }

      if (type === "education") {
        if (
          qualifiesAsPrimary(primary) &&
          qualifiesAsIndependent(independent) &&
          primarySupports &&
          independentSupports
        ) {
          status = "verified";
          reason =
            "Primary and independent evidence support the education claim.";
        } else if (
          primarySupports ||
          independentSupports
        ) {
          status = "partially verified";
          reason =
            "The education claim has supporting evidence, but the required corroboration is incomplete.";
        } else {
          status = "unverified";
        }
      }

      if (type === "employment") {
        if (
          qualifiesAsPrimary(primary) &&
          qualifiesAsIndependent(independent) &&
          primarySupports &&
          independentSupports
        ) {
          status = "verified";
          reason =
            "The exact employment claim is supported by both primary and independent evidence.";
        } else if (
          primarySupports ||
          independentSupports
        ) {
          status = "partially verified";
          reason =
            "Employment evidence exists, but the exact claimed role/title is not sufficiently corroborated.";
        } else {
          status = "unverified";
        }
      }

      if (
        status === "verified" &&
        !primary
      ) {
        status = "partially verified";
        reason =
          "No primary source is attached.";
      }

      if (
        status === "verified" &&
        !independent &&
        (
          type === "leadership_role" ||
          type === "founder_history" ||
          type === "education" ||
          type === "employment"
        )
      ) {
        status = "partially verified";
        reason =
          "The required independent corroboration is missing.";
      }

      return {
        ...claim,
        status,
        reason,
        primarySupport:
          claim.primarySupport ||
          decision?.primaryQuote ||
          "",
        independentSupport:
          claim.independentSupport ||
          decision?.independentQuote ||
          "",
        primarySource:
          primary || null,
        secondSource:
          independent || null,
        humanApproval:
          status === "verified"
            ? "required"
            : "blocked",
        includeInDiagnostic:
          status === "verified"
      };
    }
  );
}

function companyActuallyLooksUaeBased(source, companyName) {
  if (!source) return false;

  const raw = `${source.title || ""} ${source.content || ""}`;
  const lower = raw.toLowerCase();
  const normalizedCompany = normalize(companyName || "");

  const regionalEntityPatterns = [
   `${normalizedCompany} uae`,
   `${normalizedCompany} middle east`,
   `${normalizedCompany} mena`,
   `${normalizedCompany} mea`,
   `${normalizedCompany} gulf`
  ];

  const regionalEntityMatch = regionalEntityPatterns.some(pattern =>
  pattern && lower.includes(pattern)
  );

  if (regionalEntityMatch) {
   return false;
  }

  const uaeBasePatterns = [
    /\bglobal headquarters?\s*(?:is|are|:|at|in)\s*(?:dubai|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain)\b/i,

    /\bheadquartered\s+(?:in|at)\s+(?:dubai|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain)\b/i,

    /\bheadquarters?\s*(?:is|are|:|at|in)\s*(?:dubai|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain)\b/i,

    /\b(?:company|business|group)\s+is\s+(?:based|headquartered)\s+(?:in|at)\s*(?:dubai|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain)\b/i,

    /\b(?:uae|united arab emirates)[- ]based\s+(?:company|business|group)\b/i
  ];

  return uaeBasePatterns.some(pattern => pattern.test(lower));
}

async function checkEligibility(
  subject,
  companyDomain,
  companyLinkedInUrl,
  sources,
  budget
 ) {
  const context = {
    companyDomain,
    companyLinkedInUrl,
    subjectLinkedIn:
      subject.linkedinUrl,
    companyName:
      subject.company
  };

  const normalizedLocation = normalize(subject.location || "");

  const uaeLocationTerms = [
   "dubai",
   "abu dhabi",
   "sharjah",
   "ajman",
   "fujairah",
   "ras al khaimah",
   "umm al quwain",
   "united arab emirates",
   "uae"
  ];

  const clearlyUaeBasedPerson = uaeLocationTerms.some(term =>
  normalizedLocation.includes(normalize(term))
  );

  // Do not short-circuit on the person's location. UAE eligibility can be
  // established by either the person's UAE location or strong first-party
  // evidence that the current company is UAE-based.
  const firstParty =
    dedupeSources(sources)
      .map(source => ({
        ...source,
        sourceQuality:
          source.sourceQuality ||
          sourceQuality(
            source.url,
            context
          )
      }))
      .filter(source =>
        [
          "primary-company",
          "primary-company-linkedin"
        ].includes(
          source.sourceQuality
        )
      );

  const directMatch =
    firstParty.filter(source =>companyActuallyLooksUaeBased(source,subject.company));

  if (directMatch.length) {
    return {
      status: "supported",
      note:
        "A first-party company source explicitly places the business in the UAE.",
      sources:
        directMatch.slice(0, 5)
    };
  }

  if (
    companyDomain &&
    budget.searches <
      budget.limits.maxSearchesPerRun
  ) {
    const queries = [
      `site:${companyDomain} "${subject.company}" headquarters Dubai`,
      `site:${companyDomain} "${subject.company}" global headquarters Dubai`

    ];

    for (const query of queries) {
      if (
        budget.searches >=
        budget.limits.maxSearchesPerRun
      ) {
        break;
      }

      const results =
        await tavilySearch(
          query,
          budget,
          {
            max_results: 8,
            include_domains: [
              companyDomain
            ]
          }
        );

      const official =
        results
          .map(source => ({
            ...source,
            sourceQuality:
              "primary-company"
          }))
          .filter(source =>companyActuallyLooksUaeBased(source,subject.company));

      if (official.length) {
        return {
          status: "supported",
          note:
            "The official company domain contains explicit UAE location evidence.",
          sources:
            official.slice(0, 5)
        };
      }
    }
  }

  if (
    budget.searches <
    budget.limits.maxSearchesPerRun
  ) {
    const queries = [
      `"${subject.company}" LinkedIn headquarters Dubai`,
      `"${subject.company}" LinkedIn Dubai UAE company`
    ];

    for (const query of queries) {
      if (
        budget.searches >=
        budget.limits.maxSearchesPerRun
      ) {
        break;
      }

      const results =
        await tavilySearch(
          query,
          budget,
          {
            max_results: 8,
            include_domains: [
              "linkedin.com"
            ]
          }
        );

      const linkedinSources =
        results
          .map(source => ({
            ...source,
            sourceQuality:
              "primary-company-linkedin"
          }))
          .filter(source =>
            looksLikeTargetCompanyLinkedInSource(
              source,
              {
                companyName:
                  subject.company,
                subjectName:
                  subject.name,
                subjectLocation:
                  subject.location,
                subjectRole:
                  subject.role
              }
            )
          )
          .filter(source =>companyActuallyLooksUaeBased(source,subject.company));

      if (linkedinSources.length) {
        return {
          status: "supported",
          note:
            "The official company LinkedIn page provides explicit UAE location evidence.",
          sources:
            linkedinSources.slice(0, 5)
        };
      }
    }
  }
  if (clearlyUaeBasedPerson) {
    const subjectProfileSource = dedupeSources(sources).find(source =>
      isSubjectLinkedInUrl(source.url, subject.linkedinUrl)
    );

    return {
      status: "supported",
      note: "The subject's public LinkedIn location explicitly places the subject in the UAE.",
      sources: subjectProfileSource ? [subjectProfileSource] : []
    };
  }

  return {
    status: "not established",
    note:
      "Neither the subject's public location nor first-party company evidence established a UAE base strongly enough for the assignment.",
    sources: []
  };
}

async function runResearch(
  linkedinUrl
) {
  if (
    !/^https?:\/\/(www\.)?(ae\.)?linkedin\.com\/in\//i.test(
      linkedinUrl
    )
  ) {
    throw new Error(
      "Please enter a public LinkedIn profile URL."
    );
  }

  requireEnv("TAVILY_API_KEY");
  requireEnv("GEMINI_API_KEY");

  const budget =
    createBudget();

  const slug =
    profileSlug(
      linkedinUrl
    );

  const discoveryQueries = [
    `"${linkedinUrl}"`,
    `"${slug}" LinkedIn founder CEO UAE`,
    `"${slug}" current company`
  ];

  let discovery = [];

  for (const query of discoveryQueries) {
    if (
      budget.searches >=
      budget.limits.maxSearchesPerRun
    ) {
      break;
    }

    discovery.push(
      ...(await tavilySearch(
        query,
        budget,
        {
          max_results: 6
        }
      ))
    );
  }

  discovery =
    dedupeSources(discovery);

  const subject =
    await discoverSubject(
      linkedinUrl,
      slug,
      discovery,
      budget
    );

  if (
    subject.confidence < 0.65
  ) {
    throw new Error(
      "The system could not identify the subject with enough confidence. No diagnostic was generated."
    );
  }

  const companyLookup = [];

  const companySearchQueries = [
    `site:linkedin.com/company "${subject.company}" "${subject.name}"`,
    `site:linkedin.com/company "${subject.company}" Dubai UAE`,
    `"${subject.name}" "${subject.company}" official website`,
    `"${subject.name}" "${subject.company}" ${subject.location || ""} official`,
    `"${subject.company}" "${subject.name}" founder CEO`,
    `"${subject.company}" "${subject.name}" about`,
    `"${subject.company}" "${subject.name}" leadership`,
    `"${subject.company}" official website`
  ];

  for (const query of companySearchQueries) {
    if (
      budget.searches >=
      budget.limits.maxSearchesPerRun
    ) {
      break;
    }

    companyLookup.push(
      ...(await tavilySearch(
        query.trim(),
        budget,
        {
          max_results: 8
        }
      ))
    );
  }

  const companyLookupSources =
    dedupeSources(
      companyLookup
    );

  const companyContext = {
    companyName: subject.company,
    subjectName: subject.name,
    subjectLocation: subject.location,
    subjectRole: subject.role
  };

  let companyDomain =
    findCompanyDomain(
      companyLookupSources,
      companyContext
    );

  if (
    !companyDomain &&
    budget.searches <
      budget.limits.maxSearchesPerRun
  ) {
    const inferredHints =
      inferEntityHints(subject);

    const industryContext =
      inferredHints.slice(0, 3).join(" ") ||
      "company business";

    const disambiguationQuery =
      `"${subject.name}" "${subject.company}" "${subject.location || "Dubai"}" ${industryContext} official website`;

    const extraOfficial =
      await tavilySearch(
        disambiguationQuery,
        budget,
        {
          max_results: 10
        }
      );

    companyLookupSources.push(
      ...extraOfficial
    );

    companyDomain =
      findCompanyDomain(
        companyLookupSources,
        companyContext
      );
  }

  const companyIdentityContext = {
    companyName: subject.company,
    subjectName: subject.name,
    subjectLocation: subject.location,
    subjectRole: subject.role
  };

  const companyLinkedInUrl =
    companyLinkedInFromSources(
      companyLookupSources,
      companyIdentityContext
    );

  if (
    !companyDomain &&
    companyLinkedInUrl
  ) {
    const companyLinkedInSource =
      companyLookupSources.find(
        source =>
          normalizedUrl(source.url) ===
          normalizedUrl(companyLinkedInUrl)
      );

    if (companyLinkedInSource) {
      companyDomain =
        extractOfficialWebsiteFromCompanyLinkedIn(
          companyLinkedInSource,
          companyIdentityContext
        );
    }
  }

  const targetedQueries = [
    `"${subject.name}" "${subject.company}"`,
    `"${subject.name}" "${subject.company}" founder CEO`,
    `"${subject.name}" "${subject.company}" biography`
  ];

  if (
    companyDomain &&
    budget.searches <
      budget.limits.maxSearchesPerRun
  ) {
    targetedQueries.push(
      `site:${companyDomain} "${subject.name}" "${subject.company}"`
    );

    targetedQueries.push(
      `site:${companyDomain} "${subject.name}" CEO founder leadership`
    );
  }

  let targeted = [];

  for (const query of targetedQueries) {
    if (
      budget.searches >=
      budget.limits.maxSearchesPerRun
    ) {
      break;
    }

    targeted.push(
      ...(await tavilySearch(
        query,
        budget,
        {
          max_results: 7,
          include_domains:
            query.startsWith("site:")
              ? [companyDomain]
              : undefined
        }
      ))
    );
  }

  const context = {
    companyDomain,
    companyLinkedInUrl,
    subjectLinkedIn:
      subject.linkedinUrl,
    companyName:
      subject.company
  };

  const allSources =
    dedupeSources([
      ...discovery,
      ...companyLookupSources,
      ...targeted
    ]).map(source => ({
      ...source,
      sourceQuality:
        sourceQuality(
          source.url,
          context
        )
    }));

  const usefulSources =
    allSources
      .filter(source => {
        const isSubjectProfile =
          isSubjectLinkedInUrl(
            source.url,
            linkedinUrl
          );

        const isCompanyProfile =
          Boolean(
            companyLinkedInUrl &&
            normalizedUrl(source.url) ===
              normalizedUrl(companyLinkedInUrl)
          );

        const isCompanyPrimary =
          [
            "primary-company",
            "primary-company-linkedin"
          ].includes(
            source.sourceQuality
          );

        if (
          isSubjectProfile ||
          isCompanyProfile ||
          isCompanyPrimary
        ) {
          return true;
        }

        return containsPersonAndCompany(
          source,
          subject
        );
      })
      .sort((a, b) => {
        const rank = {
          "primary-company": 0,
          "primary-company-linkedin": 1,
          "primary-subject": 2,
          "primary-official": 3,
          "strong-independent": 4,
          secondary: 5,
          weak: 6
        };

        return (
          (rank[a.sourceQuality] ?? 9) -
          (rank[b.sourceQuality] ?? 9) ||
          Number(b.score || 0) -
          Number(a.score || 0)
        );
      })
      .slice(0, 50);

  const eligibility =
    await checkEligibility(
      subject,
      companyDomain,
      companyLinkedInUrl,
      usefulSources,
      budget
    );

  const eligibilitySources =
    Array.isArray(eligibility.sources)
      ? eligibility.sources
      : [];

  const researchSources =
    dedupeSources([
      ...usefulSources,
      ...eligibilitySources
    ]).map(source => ({
      ...source,
      sourceQuality:
        source.sourceQuality ||
        sourceQuality(
          source.url,
          {
            companyDomain,
            companyLinkedInUrl,
            subjectLinkedIn:
              subject.linkedinUrl,
            companyName:
              subject.company
          }
        )
    }));

  const claims =
    await extractClaims(
      subject,
      researchSources,
      budget
    );

  if (!claims.length) {
    throw new Error(
      "No defensible factual claims were extracted from the collected evidence."
    );
  }

  const claimEvidence = [];

  for (const claim of claims) {
    claimEvidence.push(
      await verifyClaimEvidence(
        claim,
        subject,
        companyDomain,
        companyLinkedInUrl,
        researchSources,
        budget
      )
    );
  }

  const adjudicated =
    await adjudicateAll(
      claimEvidence,
      subject,
      budget
    );

  const finalClaims =
    applyAdjudications(
      claimEvidence,
      adjudicated,
      subject
    );

  return {
    subject: {
      ...subject,
      companyDomain,
      companyLinkedInUrl
    },
    claims: finalClaims,
    sources: researchSources,
    eligibility,
    budget
  };
}

function sanitizeDiagnostic(
  diagnostic,
  sources
 ) {
  const validUrls =
    new Set(
      (sources || []).map(source =>
        normalizedUrl(source.url)
      )
    );

  const cleaned = {
    ...diagnostic
  };

  cleaned.gaps =
    Array.isArray(diagnostic?.gaps)
      ? diagnostic.gaps
          .slice(0, 3)
          .map(gap => ({
            ...gap,
            sources:
              Array.isArray(gap.sources)
                ? gap.sources.filter(
                    source =>
                      validUrls.has(
                        normalizedUrl(
                          source.url
                        )
                      )
                  )
                : []
          }))
      : [];

  return cleaned;
}

async function buildApprovedDiagnostic(
  subject,
  claims,
  approvedClaimIds,
  sources = [],
  eligibility = null
 ) {
  requireEnv("GEMINI_API_KEY");

  const budget =
    createBudget();

  const ai =
    new GoogleGenAI({
      apiKey:
        process.env.GEMINI_API_KEY
    });

  const approvedSet =
    new Set(
      approvedClaimIds.map(String)
    );

  const approved =
    claims.filter(
      claim =>
        claim.status === "verified" &&
        approvedSet.has(
          String(claim.id)
        )
    );

  const unapprovedVerified =
    claims.filter(
      claim =>
        claim.status === "verified" &&
        !approvedSet.has(
          String(claim.id)
        )
    );

  const refused =
    claims.filter(
      claim =>
        claim.status !== "verified"
    );

  if (!approved.length) {
    throw new Error(
      "No verified claims were approved by the human reviewer."
    );
  }

  const diagnosticSubject = {
    name: subject.name,
    company: subject.company,
    location: subject.location,
    linkedinUrl:
      subject.linkedinUrl
  };

  const sourcePack =
    (sources || [])
      .slice(0, 35)
      .map(
        (source, index) =>
          `[${index + 1}]
QUALITY: ${
  source.sourceQuality ||
  "unknown"
}
TITLE: ${source.title}
URL: ${source.url}
EXCERPT: ${String(
  source.content || ""
).slice(0, 700)}`
      )
      .join("\n\n");

  const prompt = `Create a one-page public-profile diagnostic.

SUBJECT:
${JSON.stringify(
  diagnosticSubject,
  null,
  2
)}

UAE ELIGIBILITY:
${JSON.stringify(
  eligibility || {},
  null,
  2
)}

APPROVED VERIFIED CLAIMS:
${JSON.stringify(
  approved,
  null,
  2
)}

UNAPPROVED VERIFIED CLAIMS:
${JSON.stringify(
  unapprovedVerified,
  null,
  2
)}

REFUSED / EXCLUDED CLAIMS:
${JSON.stringify(
  refused,
  null,
  2
)}

COLLECTED PUBLIC SOURCES:
${sourcePack}

Rules:
- Audience: a reputation or narrative advisor.
- Exactly 3 gaps.
- Gaps must describe genuine public-profile or narrative weaknesses.
- Never turn a missing research result into a reputation gap.
- Each gap needs 1 to 3 sources from the supplied source set.
- Never invent URLs.
- Approved verified claims are the only claims that may be presented as established facts.
- The subject's role or job title must not be treated as an established fact unless that exact role is present in APPROVED VERIFIED CLAIMS.
- Do not infer, reconstruct, or restate any partially verified, unverified, rejected, or unapproved claim from subject metadata.
- The approved verified claims are the only factual basis for the client-facing narrative.
- Unapproved verified claims must be omitted from the factual narrative.
- Partially verified, unverified, or rejected claims may appear only in the refused/excluded section with exact status.
- Company achievements are not personal achievements unless directly attributed.
- Never invent a number, date, title, amount, valuation, employer, award, or achievement.
- No em dashes.
- No hashtags.
- No AI filler vocabulary.
- Use concise professional consulting language.

Return JSON only.`;

  const diagnostic =
    await generateJson(
      ai,
      budget,
      prompt,
      DIAGNOSTIC_SCHEMA,
      3800
    );

  return sanitizeDiagnostic(
    diagnostic,
    sources
  );
}

module.exports = {
  runResearch,
  buildApprovedDiagnostic
};