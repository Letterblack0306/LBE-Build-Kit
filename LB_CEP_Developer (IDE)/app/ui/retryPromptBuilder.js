export const retryPromptBuilder = {
  build(error, patches) {
    let prompt = `\n\n[RETRY MODE - PREVIOUS ATTEMPT FAILED]\n`;
    prompt += `The previous patch(es) failed to apply or commit.\n\n`;
    prompt += `Error Details:\n- Code: ${error.code}\n- Message: ${error.message}\n\n`;
    
    if (patches && patches.length > 0) {
      prompt += `Attempted Targets:\n`;
      patches.forEach(p => {
        if (p.target) prompt += `- Function: ${p.target} in ${p.filePath}\n`;
        else if (p.range) prompt += `- Lines: ${p.range} in ${p.filePath}\n`;
      });
    }

    prompt += `\nInstructions for Correction:\n`;
    prompt += `1. Fix the specific error mentioned above.\n`;
    prompt += `2. Return only the corrected PATCH blocks.\n`;
    prompt += `3. Do NOT rewrite the full file unless absolutely necessary.\n`;
    prompt += `4. Ensure valid ES5 syntax (No ES6 modules, no import/export, no async/await).\n`;
    prompt += `5. Maintain the exact same file paths.\n`;

    return prompt;
  }
};
