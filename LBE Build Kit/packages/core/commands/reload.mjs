export function runReload(config, options = {}, deps) {
  const { toPosix, detectReloadAction, createCheck } = deps;

  const changedFiles = options.changed
    ? String(options.changed)
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
        .map(toPosix)
    : [];

  const decision = detectReloadAction(config, changedFiles, deps);
  const modePrefix =
    config.dev.liveMode === "dist-live"
      ? decision.action === "no-reload"
        ? ""
        : "Rebuild dist first. "
      : "";
  const checks = [
    createCheck("reload.action", true, `${decision.action}: ${decision.message}`, {
      changedFiles,
      matches: decision.matches,
      liveMode: config.dev.liveMode,
    }),
  ];

  if (decision.action === "panel-reload") {
    checks.push(createCheck("reload.debug-url", true, `${modePrefix}${config.dev.browserUrl}`));
  }

  if (decision.action === "ae-restart") {
    checks.push(
      createCheck(
        "reload.restart-rule",
        true,
        `${modePrefix}restart AE, then reopen the panel`,
      ),
    );
  }

  return {
    ok: true,
    message: `${modePrefix}${decision.message}`.trim(),
    checks,
    artifacts: [],
    diff: null,
    version: null,
    reload: decision,
  };
}
