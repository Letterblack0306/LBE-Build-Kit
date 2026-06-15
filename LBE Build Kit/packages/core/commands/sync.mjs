import { runWorkspaceSync } from "../../adapters/workspace-sync/index.mjs";
import { runDistLiveSync } from "../../adapters/dist-live/index.mjs";

export function runSync(config, options = {}, deps) {
  if (config.dev.liveMode === "workspace-sync") {
    return runWorkspaceSync(config, options, deps);
  }

  if (config.dev.liveMode === "dist-live") {
    return runDistLiveSync(config, options, deps);
  }

  throw new Error(`Unknown liveMode: ${config.dev.liveMode}`);
}
