(function (global) {
  'use strict';

  var LB = global.LetterBlack || (global.LetterBlack = {});
  var MSG = LB.ModelSelectionGovernance || (LB.ModelSelectionGovernance = {});

  function clone(value) {
    return MSG.clone ? MSG.clone(value) : JSON.parse(JSON.stringify(value));
  }

  function mergeDeep(base, extra) {
    var out = clone(base || {});
    var key;
    var source = extra || {};
    for (key in source) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        out[key] = mergeDeep(out[key] || {}, source[key]);
      } else {
        out[key] = source[key];
      }
    }
    return out;
  }

  function normalizeMode(value) {
    return String(value || 'chat').toLowerCase();
  }

  function validateCapability(contract, capability) {
    var order = contract.capabilityOrder || [];
    var i;
    for (i = 0; i < order.length; i++) {
      if (order[i] === capability) return true;
    }
    return false;
  }

  MSG.createContract = function (overrides) {
    return mergeDeep(MSG.DEFAULT_CONTRACT || {}, overrides || {});
  };

  MSG.resolveCapabilityForMode = function (contract, mode) {
    var normalizedMode = normalizeMode(mode);
    var capability = contract.modeToCapability[normalizedMode] || 'chat';
    if (!validateCapability(contract, capability)) {
      return 'chat';
    }
    return capability;
  };

  MSG.validateProviderRule = function (contract, provider, capability) {
    var rules = contract.providerRules || {};
    var rule = rules[provider];
    if (!rule) return !contract.requireProviderAllowlist;
    if (rule.enabled === false) return false;
    if (!contract.requireCapabilityMatch) return true;
    return (rule.allowCapabilities || []).indexOf(capability) !== -1;
  };

  MSG.isCapabilityAllowed = function (contract, modelMeta, capability) {
    if (!modelMeta || !modelMeta.capabilities) return false;
    if (!MSG.validateProviderRule(contract, modelMeta.provider, capability)) return false;
    if (!contract.requireCapabilityMatch) return true;
    return !!modelMeta.capabilities[capability];
  };

  MSG.getCapabilityScore = function (modelMeta, capability) {
    if (!modelMeta || !modelMeta.scores) return 0;
    return Number(modelMeta.scores[capability] || 0);
  };

  MSG.validateSelection = function (contract, selection) {
    var errors = [];
    if (!selection) {
      errors.push('SELECTION_MISSING');
      return { ok: false, errors: errors };
    }
    if (!selection.capability) errors.push('CAPABILITY_MISSING');
    if (!selection.modelId) errors.push('MODEL_ID_MISSING');
    if (!selection.provider) errors.push('PROVIDER_MISSING');
    if (selection.capability && !validateCapability(contract, selection.capability)) {
      errors.push('CAPABILITY_INVALID');
    }
    if (selection.provider && !MSG.validateProviderRule(contract, selection.provider, selection.capability)) {
      errors.push('PROVIDER_RULE_REJECTED');
    }
    return {
      ok: errors.length === 0,
      errors: errors
    };
  };
})(this);
