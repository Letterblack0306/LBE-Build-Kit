/*
 * Optional patch if your provider registry wants direct capability-aware access.
 * Safe in global/IIFE environments.
 */
(function (global) {
  'use strict';

  var registry = global.providerRegistry = global.providerRegistry || {};

  if (typeof registry.getAvailableModels !== 'function') {
    registry.getAvailableModels = function () {
      return [];
    };
  }

  registry.getGovernedCandidates = function (provider, capability) {
    var LB = global.LetterBlack || {};
    var MSG = LB.ModelSelectionGovernance;
    var list = registry.getAvailableModels(provider) || [];
    var contract = MSG.createContract();
    var meta = MSG.listModelMeta(list);
    var candidates = [];
    var i;
    for (i = 0; i < meta.length; i++) {
      if (!MSG.isCapabilityAllowed(contract, meta[i], capability)) continue;
      candidates.push({
        provider: meta[i].provider,
        modelId: meta[i].id,
        score: MSG.getCapabilityScore(meta[i], capability),
        tier: meta[i].tier
      });
    }
    return candidates.sort(function (a, b) {
      return b.score - a.score;
    });
  };
})(this);
