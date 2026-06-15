(function (global) {
  'use strict';

  var LB = global.LetterBlack || (global.LetterBlack = {});
  var MSG = LB.ModelSelectionGovernance || (LB.ModelSelectionGovernance = {});

  MSG.VERSION = '1.0.0';

  MSG.DEFAULT_CONTRACT = {
    version: 1,
    smartSelectionEnabled: true,
    sessionLockEnabled: true,
    requireCapabilityMatch: true,
    requireProviderAllowlist: true,
    allowUnknownCapabilityFallback: false,
    capabilityOrder: ['chat', 'code', 'reasoning', 'vision'],
    modeToCapability: {
      chat: 'chat',
      build: 'code',
      fix: 'code',
      plan: 'reasoning'
    },
    fallbackPolicy: {
      providerOrder: ['openai', 'google', 'anthropic'],
      allowManualModelOverrideWhenSmartOff: true,
      allowCrossProviderFallback: true,
      stopOnProviderMismatch: false,
      maxAttempts: 5
    },
    capabilityThresholds: {
      chat: 0.55,
      code: 0.75,
      reasoning: 0.78,
      vision: 0.65
    },
    providerRules: {
      openai: {
        enabled: true,
        allowCapabilities: ['chat', 'code', 'reasoning', 'vision']
      },
      google: {
        enabled: true,
        allowCapabilities: ['chat', 'code', 'reasoning', 'vision']
      },
      anthropic: {
        enabled: true,
        allowCapabilities: ['chat', 'code', 'reasoning']
      }
    }
  };

  MSG.createDefaultRuntimeState = function () {
    return {
      sessionAutoSelection: null,
      lastSelection: null,
      lastAuditEvent: null
    };
  };

  MSG.clone = function (value) {
    return JSON.parse(JSON.stringify(value));
  };
})(this);
