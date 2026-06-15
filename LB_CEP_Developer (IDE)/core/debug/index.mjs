export function describeDebugIntegration() {
  return {
    surface: "debug",
    responsibility: "Manage CEP DevTools discovery, browser launch, and future embedded inspector.",
    commands: ["debug"],
  };
}
