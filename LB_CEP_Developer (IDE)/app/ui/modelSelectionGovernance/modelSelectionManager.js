(function (global) {
  'use strict';

  var LB = global.LetterBlack || (global.LetterBlack = {});
  var MSG = LB.ModelSelectionGovernance || (LB.ModelSelectionGovernance = {});

  function lower(value) {
    return String(value || '').toLowerCase();
  }

  function buildBadgeText(selection) {
    if (!selection) return '';
    if (selection.selectionMode === 'auto') {
      if (selection.fallbackApplied) return 'auto: ' + selection.modelId + ' (fallback)';
      return 'auto: ' + selection.modelId;
    }
    return selection.modelId;
  }

  function selectManual(cfg, contract, capability) {
    var provider = lower(cfg.provider);
    var modelId = lower(cfg.model);
    var selection = {
      provider: provider,
      modelId: modelId,
      capability: capability,
      selectionMode: 'manual',
      fallbackApplied: false,
      strategy: 'manual'
    };
    var validation = MSG.validateSelection(contract, selection);
    return {
      ok: validation.ok,
      selected: selection,
      validation: validation,
      attempts: [selection],
      strategy: 'manual'
    };
  }

  MSG.resolveRequestSelection = function (params) {
    var contract = MSG.createContract(params.contractOverrides || {});
    var runtimeState = params.runtimeState || MSG.createDefaultRuntimeState();
    var cfg = params.cfg || {};
    var availableModels = params.availableModels || [];
    var mode = lower(params.mode || 'chat');
    var capability = params.capability || MSG.resolveCapabilityForMode(contract, mode);
    var smartEnabled = !!cfg.smartModelSelection && contract.smartSelectionEnabled;
    var provider = lower(cfg.provider);
    var manualModel = lower(cfg.model);
    var resolution;
    var selected;
    var sessionKey = provider + '|' + capability;

    if (!smartEnabled) {
      resolution = selectManual(cfg, contract, capability);
      selected = resolution.selected;
    } else if (contract.sessionLockEnabled && runtimeState.sessionAutoSelection && runtimeState.sessionAutoSelection.key === sessionKey) {
      selected = MSG.clone(runtimeState.sessionAutoSelection.selection);
      resolution = {
        ok: true,
        selected: selected,
        validation: MSG.validateSelection(contract, selected),
        attempts: [selected],
        strategy: 'session_lock'
      };
    } else {
      resolution = MSG.resolveSelection({
        contract: contract,
        capability: capability,
        availableModels: availableModels,
        preferredProvider: provider,
        preferredModel: manualModel,
        requireSameProviderFirst: !contract.fallbackPolicy.allowCrossProviderFallback ? true : true
      });

      if (!resolution.ok && contract.fallbackPolicy.allowManualModelOverrideWhenSmartOff && manualModel) {
        resolution = selectManual(cfg, contract, capability);
        if (resolution.ok) {
          resolution.selected.fallbackApplied = true;
          resolution.selected.strategy = 'manual_override_rescue';
        }
      }

      selected = resolution.selected;
      if (selected) {
        selected.selectionMode = 'auto';
        selected.fallbackApplied = resolution.strategy !== 'same_provider' && resolution.strategy !== 'preferred_model' && resolution.strategy !== 'session_lock';
        selected.strategy = resolution.strategy;
      }

      if (contract.sessionLockEnabled && selected) {
        runtimeState.sessionAutoSelection = {
          key: sessionKey,
          selection: MSG.clone(selected)
        };
      }
    }

    if (!selected) {
      return {
        ok: false,
        errorCode: resolution && resolution.errorCode ? resolution.errorCode : 'MODEL_SELECTION_FAILED',
        capability: capability,
        mode: mode,
        attempts: resolution && resolution.attempts ? resolution.attempts : []
      };
    }

    runtimeState.lastSelection = MSG.clone(selected);

    return {
      ok: true,
      capability: capability,
      mode: mode,
      selection: selected,
      attempts: resolution.attempts || [selected],
      badgeText: buildBadgeText(selected),
      badgeState: selected.selectionMode === 'auto' ? 'auto' : 'manual',
      contract: contract
    };
  };

  MSG.applySelectionToConfig = function (cfg, selectionResult) {
    var out = MSG.clone(cfg || {});
    if (!selectionResult || !selectionResult.ok) return out;
    out.provider = selectionResult.selection.provider;
    out.model = selectionResult.selection.modelId;
    out._resolvedCapability = selectionResult.capability;
    out._selectionMode = selectionResult.selection.selectionMode;
    out._selectionStrategy = selectionResult.selection.strategy;
    out._selectionFallbackApplied = !!selectionResult.selection.fallbackApplied;
    return out;
  };
})(this);
