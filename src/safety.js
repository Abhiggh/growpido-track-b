const DEFAULT_LIMITS = {
  maxSearchesPerRun: 30,
  maxClaimsPerRun: 4,
  maxVerificationChecks: 8,
  maxAiCallsPerRun: 12
};

function numberFromEnv(
  name,
  fallback
) {
  const value =
    Number(
      process.env[name]
    );

  if (
    Number.isFinite(value) &&
    value > 0
  ) {
    return value;
  }

  return fallback;
}

function createBudget() {
  return {
    searches: 0,
    claims: 0,
    verificationChecks: 0,
    aiCalls: 0,

    limits: {
      maxSearchesPerRun:
        numberFromEnv(
          "MAX_SEARCHES_PER_RUN",
          DEFAULT_LIMITS
            .maxSearchesPerRun
        ),

      maxClaimsPerRun:
        numberFromEnv(
          "MAX_CLAIMS_PER_RUN",
          DEFAULT_LIMITS
            .maxClaimsPerRun
        ),

      maxVerificationChecks:
        numberFromEnv(
          "MAX_VERIFICATION_CHECKS",
          DEFAULT_LIMITS
            .maxVerificationChecks
        ),

      maxAiCallsPerRun:
        numberFromEnv(
          "MAX_AI_CALLS_PER_RUN",
          DEFAULT_LIMITS
            .maxAiCallsPerRun
        )
    }
  };
}

function consumeSearch(budget) {
  if (
    budget.searches >=
    budget.limits
      .maxSearchesPerRun
  ) {
    throw new Error(
      "Research search limit reached. No paid fallback is enabled."
    );
  }

  budget.searches += 1;
}

function consumeVerification(
  budget
) {
  if (
    budget.verificationChecks >=
    budget.limits
      .maxVerificationChecks
  ) {
    throw new Error(
      "Evidence verification limit reached. No paid fallback is enabled."
    );
  }

  budget.verificationChecks += 1;
}

function consumeAiCall(budget) {
  if (
    budget.aiCalls >=
    budget.limits
      .maxAiCallsPerRun
  ) {
    throw new Error(
      "AI analysis limit reached. No paid fallback is enabled."
    );
  }

  budget.aiCalls += 1;
}

module.exports = {
  createBudget,
  consumeSearch,
  consumeVerification,
  consumeAiCall
};