export function createAfterEffectsAdapter() {
  return {
    target: "After Effects",
    capabilities: ["jsx-execution", "host-detection", "restart-boundary-awareness"],
  };
}
