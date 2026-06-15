export const retryClassifier = {
  retryableCodes: [
    "SYNTAX_ERROR",
    "PATCH_TARGET_NOT_FOUND",
    "BRACE_MISMATCH",
    "LINE_OUT_OF_RANGE",
    "VALIDATION_FORMAT_ERROR",
    "COMMIT_FAILED"
  ],

  isRetryable(error) {
    if (!error) return false;
    const code = error.code || error;
    // Never retry security or policy blocks
    if (code === "PATH_TRAVERSAL_BLOCKED" || code === "OUT_OF_PROJECT_BLOCKED" || code === "FORBIDDEN_TERM") {
      return false;
    }
    return this.retryableCodes.includes(code);
  }
};
