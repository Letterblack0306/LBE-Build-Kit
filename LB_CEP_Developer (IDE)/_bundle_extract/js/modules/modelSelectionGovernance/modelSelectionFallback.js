(function (global) {
  'use strict';

  var LB = global.LetterBlack || (global.LetterBlack = {});
  var MSG = LB.ModelSelectionGovernance || (LB.ModelSelectionGovernance = {});

  function sortDescending(a, b) {
    return b.score - a.score;
  }

  function buildCandidate(meta, capability, reason) {
    return {
      modelId: meta.id,
      provider: meta.provider,
      capability: capability,
      score: MSG.getCapabilityScore(meta, capability),
      tier: meta.tier,
      reason: reason || 'matched'
    };
  }

  function providerRank(contract, provider) {
    var order = (contract.fallbackPolicy && contract.fallbackPolicy.providerOrder) || [];
    var index = order.indexOf(provider);
    return index === -1 ? 999 : index;
  }

  function sortByFallbackPolicy(contract, candidates) {
    return candidates.sort(function (a, b) {
      var providerDelta = providerRank(contract, a.provider) - providerRank(contract, b.provider);
      if (providerDelta !== 0) return providerDelta;
      return sortDescending(a, b);
    });
  }

  MSG.resolveSelection = function (params) {
    var contract = params.contract;
    var capability = params.capability;
    var availableModels = params.availableModels || [];
    var preferredProvider = String(params.preferredProvider || '').toLowerCase();
    var preferredModel = String(params.preferredModel || '').toLowerCase();
    var requireSameProviderFirst = params.requireSameProviderFirst !== false;
    var threshold = (contract.capabilityThresholds || {})[capability] || 0;
    var modelMetaList = MSG.listModelMeta(availableModels);
    var allCandidates = [];
    var sameProviderCandidates = [];
    var fallbackCandidates = [];
    var i;
    var meta;
    var candidate;

    for (i = 0; i < modelMetaList.length; i++) {
      meta = modelMetaList[i];
      if (!MSG.isCapabilityAllowed(contract, meta, capability)) continue;
      if (MSG.getCapabilityScore(meta, capability) < threshold) continue;
      candidate = buildCandidate(meta, capability, 'capability_match');
      allCandidates.push(candidate);
      if (preferredProvider && meta.provider === preferredProvider) {
        sameProviderCandidates.push(candidate);
      } else {
        fallbackCandidates.push(candidate);
      }
    }

    sameProviderCandidates = sortByFallbackPolicy(contract, sameProviderCandidates);
    fallbackCandidates = sortByFallbackPolicy(contract, fallbackCandidates);
    allCandidates = sortByFallbackPolicy(contract, allCandidates);

    if (preferredModel) {
      for (i = 0; i < allCandidates.length; i++) {
        if (allCandidates[i].modelId === preferredModel) {
          allCandidates[i].reason = 'preferred_model_match';
          return {
            ok: true,
            selected: allCandidates[i],
            attempts: [allCandidates[i]],
            strategy: 'preferred_model'
          };
        }
      }
    }

    if (requireSameProviderFirst && sameProviderCandidates.length) {
      return {
        ok: true,
        selected: sameProviderCandidates[0],
        attempts: sameProviderCandidates.slice(0, contract.fallbackPolicy.maxAttempts || 5),
        strategy: 'same_provider'
      };
    }

    if (allCandidates.length) {
      return {
        ok: true,
        selected: allCandidates[0],
        attempts: allCandidates.slice(0, contract.fallbackPolicy.maxAttempts || 5),
        strategy: sameProviderCandidates.length ? 'same_provider_relaxed' : 'cross_provider'
      };
    }

    return {
      ok: false,
      selected: null,
      attempts: [],
      strategy: 'none',
      errorCode: 'NO_CAPABILITY_MATCH'
    };
  };
})(this);
