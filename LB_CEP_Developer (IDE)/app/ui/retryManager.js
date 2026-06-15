import { retryClassifier } from "./retryClassifier.js";
import { retryPromptBuilder } from "./retryPromptBuilder.js";
import { streamChat } from "./aiClient.js";
import { settingsStore } from "./settingsStore.js";

export const retryManager = {
  activeRetries: new Set(),

  isRetrying(txnId) {
    return this.activeRetries.has(txnId);
  },

  async attemptAutoFix(error, originalPatches, onNewAIResponse) {
    if (!retryClassifier.isRetryable(error)) return null;

    // Build the correction request
    const retryPrompt = retryPromptBuilder.build(error, originalPatches);
    
    settingsStore.load();
    const cfg = settingsStore.config;

    // Build a compact history for the retry (System + last User + Error)
    const messages = [
      { role: "user", content: retryPrompt }
    ];

    let fullResponse = "";
    try {
      for await (const chunk of streamChat(messages, cfg)) {
        fullResponse += chunk;
      }
      
      if (fullResponse) {
        // Pass the new response back to the main loop for parsing/scoring/execution
        await onNewAIResponse(fullResponse, true);
        return true;
      }
    } catch (err) {
      console.error("Auto-fix request failed", err);
    }
    
    return false;
  }
};
