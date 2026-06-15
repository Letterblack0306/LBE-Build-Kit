export function describeRuntimeIntegration() {
  return {
    surface: "runtime",
    responsibility: "Own sync, install, reload, and live CEP dev orchestration.",
    commands: ["dev", "watch", "sync", "reload"],
  };
}
