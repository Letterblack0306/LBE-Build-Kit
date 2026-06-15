(function (global) {
  'use strict';

  var LB = global.LetterBlack || (global.LetterBlack = {});
  var MSG = LB.ModelSelectionGovernance || (LB.ModelSelectionGovernance = {});

  function normalizeId(value) {
    return String(value || '').toLowerCase();
  }

  function inferProviderFromModel(modelId, declaredProvider) {
    var provider = normalizeId(declaredProvider);
    var id = normalizeId(modelId);
    if (provider) return provider;
    if (id.indexOf('gpt') !== -1 || id.indexOf('o1') !== -1 || id.indexOf('o3') !== -1 || id.indexOf('o4') !== -1) return 'openai';
    if (id.indexOf('gemini') !== -1) return 'google';
    if (id.indexOf('claude') !== -1) return 'anthropic';
    return 'unknown';
  }

  function buildCaps(chat, code, reasoning, vision) {
    return {
      chat: !!chat,
      code: !!code,
      reasoning: !!reasoning,
      vision: !!vision
    };
  }

  function createScoreMap(chat, code, reasoning, vision) {
    return {
      chat: typeof chat === 'number' ? chat : 0,
      code: typeof code === 'number' ? code : 0,
      reasoning: typeof reasoning === 'number' ? reasoning : 0,
      vision: typeof vision === 'number' ? vision : 0
    };
  }

  MSG.STATIC_MODEL_MAP = {
    'gpt-4o': {
      provider: 'openai',
      capabilities: buildCaps(true, true, true, true),
      scores: createScoreMap(0.92, 0.90, 0.82, 0.90),
      tier: 'primary'
    },
    'gpt-4.1': {
      provider: 'openai',
      capabilities: buildCaps(true, true, true, false),
      scores: createScoreMap(0.88, 0.91, 0.84, 0.10),
      tier: 'primary'
    },
    'gpt-4.1-mini': {
      provider: 'openai',
      capabilities: buildCaps(true, true, false, false),
      scores: createScoreMap(0.80, 0.84, 0.55, 0.05),
      tier: 'fast'
    },
    'o3': {
      provider: 'openai',
      capabilities: buildCaps(true, true, true, false),
      scores: createScoreMap(0.78, 0.90, 0.95, 0.05),
      tier: 'reasoning'
    },
    'o4-mini': {
      provider: 'openai',
      capabilities: buildCaps(true, true, true, false),
      scores: createScoreMap(0.76, 0.88, 0.89, 0.05),
      tier: 'fast-reasoning'
    },
    'gemini-1.5-pro': {
      provider: 'google',
      capabilities: buildCaps(true, true, true, true),
      scores: createScoreMap(0.87, 0.82, 0.90, 0.91),
      tier: 'primary'
    },
    'gemini-1.5-flash': {
      provider: 'google',
      capabilities: buildCaps(true, true, false, true),
      scores: createScoreMap(0.80, 0.72, 0.55, 0.88),
      tier: 'fast'
    },
    'gemini-2.5-pro': {
      provider: 'google',
      capabilities: buildCaps(true, true, true, true),
      scores: createScoreMap(0.89, 0.85, 0.92, 0.92),
      tier: 'primary'
    },
    'gemini-2.5-flash': {
      provider: 'google',
      capabilities: buildCaps(true, true, false, true),
      scores: createScoreMap(0.82, 0.76, 0.58, 0.90),
      tier: 'fast'
    },
    'claude-3.5-sonnet': {
      provider: 'anthropic',
      capabilities: buildCaps(true, true, true, false),
      scores: createScoreMap(0.90, 0.87, 0.91, 0.10),
      tier: 'primary'
    },
    'claude-3.7-sonnet': {
      provider: 'anthropic',
      capabilities: buildCaps(true, true, true, false),
      scores: createScoreMap(0.91, 0.89, 0.94, 0.10),
      tier: 'primary'
    }
  };

  MSG.getModelMeta = function (model) {
    var id = normalizeId(model && (model.id || model.name || model.model || model.value));
    var explicitProvider = model && (model.provider || model.vendor);
    var staticMeta = MSG.STATIC_MODEL_MAP[id] || null;
    var inferredProvider = inferProviderFromModel(id, explicitProvider || (staticMeta && staticMeta.provider));
    var capabilities = staticMeta ? staticMeta.capabilities : buildCaps(true, false, false, false);
    var scores = staticMeta ? staticMeta.scores : createScoreMap(0.50, 0.20, 0.20, 0.20);

    return {
      id: id,
      provider: inferredProvider,
      tier: staticMeta ? staticMeta.tier : 'unknown',
      capabilities: capabilities,
      scores: scores,
      raw: model || null
    };
  };

  MSG.listModelMeta = function (availableModels) {
    var list = [];
    var i;
    for (i = 0; i < (availableModels || []).length; i++) {
      list.push(MSG.getModelMeta(availableModels[i]));
    }
    return list;
  };
})(this);
