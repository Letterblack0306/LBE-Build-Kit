export function createCepAdapter() {
  return {
    target: "CEP",
    capabilities: ["debug-port", "panel-reload", "extension-install"],
  };
}
