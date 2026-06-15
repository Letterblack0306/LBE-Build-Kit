# Model Selection Governance Layer — Integration Notes

## Fit
- Global/IIFE only
- No ES module syntax
- Intended for your current `settingsStore.js`, `providerRegistry.js`, `app.js`, `aiClient.js` stack

## Files
- `modelSelectionTypes.js` — defaults and runtime state shape
- `providerCapabilityMap.js` — provider/model capability metadata
- `modelSelectionContract.js` — contract and validation rules
- `modelSelectionFallback.js` — deterministic fallback chain resolver
- `modelSelectionAudit.js` — audit + timeline projection
- `modelSelectionManager.js` — runtime orchestrator used by `app.js`

## Required host hooks
You still need to connect these on your side:
- `appendAuditLog(event)` or equivalent
- `appendTimelineItem(item)` or equivalent
- `updateModelBadge(text, state)` or equivalent
- `availableModels` source from your provider registry / discovery layer
- `createStructuredError(code, message, extra)` if you want normalized failures

## Required load order
Load after your common utilities and before `app.js`:
1. `modelSelectionTypes.js`
2. `providerCapabilityMap.js`
3. `modelSelectionContract.js`
4. `modelSelectionFallback.js`
5. `modelSelectionAudit.js`
6. `modelSelectionManager.js`
7. `app.js`

## Settings additions
Your settings object should include:
```js
smartModelSelection: true,
modelSelectionGovernance: {
  sessionLockEnabled: true,
  requireCapabilityMatch: true,
  requireProviderAllowlist: true
}
```

## Expected behavior
- Build/Fix → `code`
- Plan → `reasoning`
- Chat → `chat`
- Request-scoped override only
- Session lock keeps same auto-selected model for same provider+capability lane until lane changes
- Badge displays `auto: model` or `auto: model (fallback)`
- Audit event emitted per request
