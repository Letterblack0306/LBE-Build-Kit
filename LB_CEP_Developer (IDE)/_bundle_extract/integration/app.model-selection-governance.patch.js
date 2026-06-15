/*
 * Drop-in patch block for your current app.js
 * Assumptions based on your current runtime description:
 * - sendChatMessage() exists
 * - settingsStore.load() exists
 * - availableModels can be retrieved from provider registry / current provider cache
 * - model badge updater exists or can be added
 */

(function (global) {
  'use strict';

  function ensureLB() {
    var LB = global.LetterBlack || (global.LetterBlack = {});
    LB.runtime = LB.runtime || {};
    LB.runtime.modelSelectionState = LB.runtime.modelSelectionState ||
      (LB.ModelSelectionGovernance && LB.ModelSelectionGovernance.createDefaultRuntimeState
        ? LB.ModelSelectionGovernance.createDefaultRuntimeState()
        : { sessionAutoSelection: null, lastSelection: null, lastAuditEvent: null });
    return LB;
  }

  function mapModeToCapability(mode) {
    var LB = ensureLB();
    var MSG = LB.ModelSelectionGovernance;
    var contractOverrides = (global.settingsStore && global.settingsStore.load && global.settingsStore.load().modelSelectionGovernance) || {};
    var contract = MSG.createContract(contractOverrides);
    return MSG.resolveCapabilityForMode(contract, mode);
  }

  function getAvailableModelsForProvider(provider) {
    if (global.providerRegistry && typeof global.providerRegistry.getAvailableModels === 'function') {
      return global.providerRegistry.getAvailableModels(provider) || [];
    }
    if (global.getAvailableModelsForProvider && typeof global.getAvailableModelsForProvider === 'function') {
      return global.getAvailableModelsForProvider(provider) || [];
    }
    return [];
  }

  function updateResolvedModelBadge(text, state) {
    var badge = global.document && global.document.getElementById('model-badge');
    if (!badge) return;
    badge.textContent = text || '';
    badge.setAttribute('data-state', state || 'manual');
    badge.style.display = text ? 'inline-flex' : 'none';
  }

  function appendModelSelectionAudit(event) {
    if (global.appendAuditLog && typeof global.appendAuditLog === 'function') {
      global.appendAuditLog(event);
      return;
    }
    global.__LB_MODEL_SELECTION_AUDIT__ = global.__LB_MODEL_SELECTION_AUDIT__ || [];
    global.__LB_MODEL_SELECTION_AUDIT__.push(event);
  }

  function appendModelSelectionTimeline(item) {
    if (global.appendTimelineItem && typeof global.appendTimelineItem === 'function') {
      global.appendTimelineItem(item);
      return;
    }
    global.__LB_MODEL_SELECTION_TIMELINE__ = global.__LB_MODEL_SELECTION_TIMELINE__ || [];
    global.__LB_MODEL_SELECTION_TIMELINE__.push(item);
  }

  global.__LB_applyGovernedModelSelection = function (cfg, mode) {
    var LB = ensureLB();
    var MSG = LB.ModelSelectionGovernance;
    var loadedSettings = (global.settingsStore && global.settingsStore.load) ? global.settingsStore.load() : {};
    var contractOverrides = loadedSettings.modelSelectionGovernance || {};
    var capability = mapModeToCapability(mode);
    var availableModels = getAvailableModelsForProvider(cfg.provider);

    var selectionResult = MSG.resolveRequestSelection({
      cfg: cfg,
      mode: mode,
      capability: capability,
      availableModels: availableModels,
      runtimeState: LB.runtime.modelSelectionState,
      contractOverrides: contractOverrides
    });

    if (!selectionResult.ok) {
      var error = global.createStructuredError
        ? global.createStructuredError('MODEL_SELECTION_FAILED', 'No governed model matched the requested capability.', {
            mode: mode,
            capability: capability,
            attempts: selectionResult.attempts || [],
            errorCode: selectionResult.errorCode
          })
        : new Error('MODEL_SELECTION_FAILED');
      throw error;
    }

    var resolvedCfg = MSG.applySelectionToConfig(cfg, selectionResult);
    var auditEvent = MSG.recordAuditEvent({
      eventType: 'model_selection',
      source: 'sendChatMessage',
      mode: mode,
      capability: selectionResult.capability,
      selectionMode: selectionResult.selection.selectionMode,
      selectionStrategy: selectionResult.selection.strategy,
      providerRequested: cfg.provider,
      providerResolved: resolvedCfg.provider,
      modelRequested: cfg.model,
      selectedModel: resolvedCfg.model,
      fallbackApplied: !!selectionResult.selection.fallbackApplied,
      attempts: selectionResult.attempts
    }, {
      appendAuditLog: appendModelSelectionAudit,
      appendTimelineItem: appendModelSelectionTimeline
    });

    LB.runtime.modelSelectionState.lastAuditEvent = auditEvent;
    updateResolvedModelBadge(selectionResult.badgeText, selectionResult.badgeState);

    return {
      cfg: resolvedCfg,
      selectionResult: selectionResult,
      auditEvent: auditEvent
    };
  };
})(this);
