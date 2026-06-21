import { runDoctor } from "./doctor.mjs";
import { runCheck } from "./check.mjs";
import { runES3Check } from "./es3-check.mjs";
import { runVerify } from "./verify.mjs";

export async function runSimulate(config, deps) {
  const doctor = runDoctor(config, deps);
  const check = runCheck(config, deps);
  const es3 = await runES3Check(config, deps);
  const verify = await runVerify(config, deps);

  const ok = doctor.ok && check.ok && es3.ok && verify.ok;
  return {
    ok,
    message: ok ? "Simulate completed." : "Simulate failed.",
    checks: [...doctor.checks, ...check.checks, ...es3.checks, ...verify.checks],
    artifacts: verify.artifacts,
    diff: verify.diff,
    version: verify.version ?? check.version ?? null,
  };
}
