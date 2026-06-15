import { runDoctor } from "./doctor.mjs";
import { runCheck } from "./check.mjs";
import { runVerify } from "./verify.mjs";
import { runReleaseIntegrity } from "./integrity.mjs";

export async function runSimulate(config, deps) {
  const doctor = runDoctor(config, deps);
  const check = runCheck(config, deps);
  const verify = runVerify(config, deps);
  const integrity = runReleaseIntegrity(config, deps);

  return {
    ok: doctor.ok && check.ok && verify.ok && integrity.ok,
    message: doctor.ok && check.ok && verify.ok && integrity.ok ? "Simulate completed." : "Simulate failed.",
    checks: [...doctor.checks, ...check.checks, ...verify.checks, ...integrity.checks],
    artifacts: integrity.artifacts.length > 0 ? integrity.artifacts : verify.artifacts,
    diff: verify.diff,
    version: integrity.version ?? verify.version ?? check.version ?? null,
    git: integrity.git,
  };
}
