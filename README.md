# Growpido Prospect to Diagnostic

Growpido Prospect to Diagnostic turns a public LinkedIn profile into a structured, source-backed founder diagnostic. The workflow is designed around evidence quality, conservative verification, explicit human approval, and controlled usage limits.

## Overview

The application accepts a public LinkedIn profile URL and builds a research trail around the person, their current role, company, and location. It then evaluates a small set of factual claims before producing a client-facing diagnostic.

The core principle is simple:

> **When evidence is uncertain, the system refuses the claim rather than guessing.**

## Workflow

1. **Input**  
   Accept a public LinkedIn profile URL.

2. **Profile discovery**  
   Identify the subject, current role, company, and public location.

3. **Company discovery**  
   Identify the company's likely official domain.

4. **Evidence collection**  
   Collect public evidence from the subject's LinkedIn profile, first-party company sources, and independent sources.

5. **Claim extraction**  
   Select a small set of high-value factual claims for verification.

6. **Claim verification**  
   Check claims against a primary evidence channel and an independent evidence channel, using exact evidence quotes before a claim can be marked Verified.

7. **Evidence classification**  
   Claims are labelled **Verified**, **Partially Verified**, **Unverified**, or **Rejected**.

8. **Human approval**  
   A verified claim must be explicitly approved before it can enter the diagnostic.

9. **Eligibility control**  
   The diagnostic is blocked unless UAE-based company eligibility has been established.

10. **Diagnostic generation**  
    After approval, the system produces exactly three public-profile gaps and corresponding recommendations.

## Evidence and source policy

The system follows a source hierarchy rather than treating every web result as equal.

- **First-party company sources** can support company and leadership claims.
- **The subject's public LinkedIn profile** can support personal profile, career, and education claims.
- **Strong independent sources** provide a second evidence channel for verification.
- **Weak directories, contact aggregators, and scraped profile sites** are not treated as independent verification sources.

The goal is not to maximize the number of facts. The goal is to keep only facts that can be defended from public evidence.

## Human approval gate

The diagnostic is intentionally gated.

Only claim IDs already marked `verified` can be approved by the reviewer. The server also validates the final approved set before allowing diagnostic generation. This keeps partially verified or unverified claims out of the client-facing narrative.

## usage safety

The application does not automatically switch to paid usage. Hard per-run limits are controlled through `.env`:

```env
MAX_SEARCHES_PER_RUN=30
MAX_CLAIMS_PER_RUN=4
MAX_VERIFICATION_CHECKS=8
MAX_AI_CALLS_PER_RUN=12
```

The expected research path is designed to remain within these limits. If a provider returns a quota or rate-limit error, the application stops safely instead of using a paid fallback.


## Local setup

### 1. Install dependencies

```cmd
npm install
```

### 2. Configure environment variables

Create a .env file in the project root and add your Gemini and Tavily API keys. Copy the variables from .env.example and replace the placeholders with your own keys.

### 3. Start the application

```cmd
npm start
```

Then open:

```text
http://localhost:3000
```

## Output

The client output is a one-page public-profile diagnostic containing:

- an evidence-backed summary
- verified strengths or public signals
- exactly three public-profile gaps
- practical recommendations
- a refused or excluded claim where evidence does not meet the verification standard
- a traceable public source trail

The application also exposes its verification state and research budget in the interface so a reviewer can see how the output was produced.

## Failure handling and limitations

This is public-source research, not an authenticated LinkedIn integration. Public pages may be incomplete, search providers may return partial excerpts, and a primary source may not be discoverable even when it exists.

Because of that, the system is deliberately conservative. When evidence is incomplete, a claim can remain Partially Verified, Unverified, or Rejected instead of being promoted into the final diagnostic.

A human reviewer remains part of the workflow before client use.

## Design principles

**Evidence before narrative**  
The system gathers and classifies evidence before generating the diagnostic.

**Primary-source preference**  
The strongest available first-party evidence is preferred for important factual claims.

**No guessing**  
Unclear claims are not upgraded simply because they sound plausible.

**Human control**  
Verified facts still require explicit approval before entering the client output.

**Safe usage**  
Research and AI-call limits are enforced per run, with no automatic paid fallback.

