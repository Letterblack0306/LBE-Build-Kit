(function (global) {
  'use strict';

  var LB = global.LetterBlack || (global.LetterBlack = {});
  var MSG = LB.ModelSelectionGovernance || (LB.ModelSelectionGovernance = {});

  function nowIso() {
    return new Date().toISOString();
  }

  function clone(value) {
    return MSG.clone ? MSG.clone(value) : JSON.parse(JSON.stringify(value));
  }

  function hashString(input) {
    var str = String(input || '');
    var hash = 2166136261;
    var i;
    for (i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }

  function safeCall(fn, args) {
    try {
      return fn && fn.apply(null, args || []);
    } catch (err) {
      return null;
    }
  }

  MSG.createAuditEvent = function (payload) {
    var event = clone(payload || {});
    event.timestamp = event.timestamp || nowIso();
    event.eventType = event.eventType || 'model_selection';
    event.eventId = event.eventId || ('mse_' + hashString(JSON.stringify(event) + '|' + event.timestamp));
    return event;
  };

  MSG.recordAuditEvent = function (payload, hooks) {
    var event = MSG.createAuditEvent(payload);
    var h = hooks || {};

    safeCall(h.appendAuditLog, [event]);
    safeCall(h.appendTimelineItem, [{
      type: 'model-selection',
      timestamp: event.timestamp,
      title: 'Model Selection',
      detail: event.selectionMode + ': ' + event.selectedModel + ' (' + event.capability + ')',
      meta: event
    }]);

    return event;
  };
})(this);
