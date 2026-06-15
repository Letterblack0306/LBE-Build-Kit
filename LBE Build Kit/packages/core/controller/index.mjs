/**
 * Controller Core - Layer 3 of 4-Layer Pipeline
 *
 * Receives validated intents from Contract Validator
 * - Signs decisions
 * - Routes to appropriate adapter
 * - Maintains audit trail
 * - Prevents bypass attempts
 *
 * Agents don't see this - they just get corrected if validation fails.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Controller Core for intent execution
 */
export class ControllerCore {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.auditLogPath = path.join(projectRoot, ".build-report", "controller-audit.ndjson");
    this.decisionSecret = options.decisionSecret || this._generateSecret();
    this.adapterRegistry = new Map();
    this.decisionLog = [];

    // Ensure audit directory exists
    const auditDir = path.dirname(this.auditLogPath);
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
  }

  /**
   * Register an adapter for an intent type
   */
  registerAdapter(intentType, adapter) {
    this.adapterRegistry.set(intentType, adapter);
  }

  /**
   * Execute validated intent through the controller
   */
  async executeIntent(validatedIntent) {
    const { intent, payload, validationResult } = validatedIntent;

    // STEP 1: Sign the decision
    const decision = this._signDecision(intent, payload, validationResult);

    // STEP 2: Log the decision
    this._logDecision(decision);

    // STEP 3: Route to appropriate adapter
    const adapter = this.adapterRegistry.get(intent);

    if (!adapter) {
      const error = {
        code: "NO_ADAPTER",
        message: `No adapter registered for intent: ${intent}`,
        availableIntents: Array.from(this.adapterRegistry.keys())
      };
      this._logError(decision.decisionId, error);
      return {
        status: "failed",
        decisionId: decision.decisionId,
        error,
        result: null
      };
    }

    // STEP 4: Execute through adapter
    try {
      const result = await adapter.execute(payload, decision);

      // STEP 5: Log success
      this._logSuccess(decision.decisionId, result);

      return {
        status: "completed",
        decisionId: decision.decisionId,
        error: null,
        result
      };
    } catch (error) {
      // STEP 6: Log failure
      this._logError(decision.decisionId, {
        code: "ADAPTER_EXECUTION_FAILED",
        message: error.message,
        stack: error.stack
      });

      return {
        status: "failed",
        decisionId: decision.decisionId,
        error: {
          code: "ADAPTER_EXECUTION_FAILED",
          message: error.message
        },
        result: null
      };
    }
  }

  /**
   * Sign a decision with HMAC
   */
  _signDecision(intent, payload, validationResult) {
    const decisionId = this._generateDecisionId();
    const timestamp = new Date().toISOString();

    const decisionData = {
      decisionId,
      timestamp,
      intent,
      intentHash: this._hashObject({ intent, payload }),
      decision: validationResult.valid ? "approved" : "rejected",
      validationResult: {
        valid: validationResult.valid,
        violations: validationResult.violations?.length || 0,
        warnings: validationResult.warnings?.length || 0
      },
      routedTo: this.adapterRegistry.get(intent)?.name || "unknown"
    };

    // Sign with HMAC
    const signature = this._hmacSign(JSON.stringify(decisionData));

    return {
      ...decisionData,
      signature
    };
  }

  /**
   * Log decision to audit trail
   */
  _logDecision(decision) {
    const entry = {
      type: "decision",
      ...decision
    };

    this._appendToAuditLog(entry);
    this.decisionLog.push(decision);
  }

  /**
   * Log successful execution
   */
  _logSuccess(decisionId, result) {
    const entry = {
      type: "execution_success",
      decisionId,
      timestamp: new Date().toISOString(),
      resultSummary: this._summarizeResult(result)
    };

    this._appendToAuditLog(entry);
  }

  /**
   * Log error
   */
  _logError(decisionId, error) {
    const entry = {
      type: "execution_error",
      decisionId,
      timestamp: new Date().toISOString(),
      error: {
        code: error.code,
        message: error.message
      }
    };

    this._appendToAuditLog(entry);
  }

  /**
   * Append to audit log (newline-delimited JSON)
   */
  _appendToAuditLog(entry) {
    try {
      const line = JSON.stringify(entry) + "\n";
      fs.appendFileSync(this.auditLogPath, line, "utf8");
    } catch (e) {
      console.error("[Controller] Failed to write audit log:", e.message);
    }
  }

  /**
   * Hash object for integrity
   */
  _hashObject(obj) {
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    return crypto.createHash("sha256").update(str).digest("hex");
  }

  /**
   * HMAC sign data
   */
  _hmacSign(data) {
    return crypto
      .createHmac("sha256", this.decisionSecret)
      .update(data)
      .digest("hex");
  }

  /**
   * Generate unique decision ID
   */
  _generateDecisionId() {
    return `dec_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  }

  /**
   * Generate or load secret
   */
  _generateSecret() {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Summarize result for logging
   */
  _summarizeResult(result) {
    if (!result) return null;

    if (typeof result === "object") {
      return {
        keys: Object.keys(result).slice(0, 10),
        hasError: !!result.error,
        success: result.success || result.ok
      };
    }

    return { type: typeof result };
  }

  /**
   * Get recent decisions
   */
  getRecentDecisions(limit = 10) {
    return this.decisionLog.slice(-limit);
  }

  /**
   * Get audit log entries
   */
  getAuditLog() {
    try {
      if (!fs.existsSync(this.auditLogPath)) return [];

      const content = fs.readFileSync(this.auditLogPath, "utf8");
      return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }
}

/**
 * Adapter base class - Layer 4
 */
export class Adapter {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.commandRegistry = new Map();
  }

  /**
   * Register a whitelisted command
   */
  registerCommand(commandName, handler) {
    this.commandRegistry.set(commandName, handler);
  }

  /**
   * Execute intent payload through adapter
   */
  async execute(payload, decision) {
    // Adapter only executes whitelisted commands
    const command = payload.command;

    if (!command) {
      throw new Error("No command specified in payload");
    }

    const handler = this.commandRegistry.get(command);

    if (!handler) {
      throw new Error(`Command '${command}' not in adapter registry. Available: ${Array.from(this.commandRegistry.keys()).join(", ")}`);
    }

    // Execute the whitelisted command
    return await handler(payload.args, decision);
  }
}

/**
 * CEP Adapter - executes CEP-specific operations
 */
export class CEPAdapter extends Adapter {
  constructor(config) {
    super("CEPAdapter", config);
    this._registerCEPCommands();
  }

  _registerCEPCommands() {
    // Whitelisted CEP operations only
    this.registerCommand("evalScript", async (args, decision) => {
      // Validate this is a safe operation
      if (!this._isSafeScript(args.script)) {
        throw new Error("Script rejected by safety filter");
      }

      return {
        executed: true,
        scriptLength: args.script?.length || 0,
        decisionId: decision.decisionId
      };
    });

    this.registerCommand("getExtensionInfo", async (args) => {
      return {
        extensionId: args.extensionId,
        version: "1.0.0"
      };
    });

    this.registerCommand("reloadExtension", async (args) => {
      return {
        reloaded: true,
        extensionId: args.extensionId
      };
    });
  }

  _isSafeScript(script) {
    if (!script || typeof script !== "string") return false;

    // Block dangerous patterns
    const dangerous = [
      /eval\s*\(/,
      /Function\s*\(/,
      /document\.write/,
      /innerHTML\s*=/
    ];

    return !dangerous.some(pattern => pattern.test(script));
  }
}

/**
 * File System Adapter - executes file operations
 */
export class FSAdapter extends Adapter {
  constructor(projectRoot, config) {
    super("FSAdapter", config);
    this.projectRoot = projectRoot;
    this._registerFSCommands();
  }

  _registerFSCommands() {
    this.registerCommand("readFile", async (args) => {
      const filePath = this._resolvePath(args.path);
      return fs.promises.readFile(filePath, "utf8");
    });

    this.registerCommand("writeFile", async (args) => {
      const filePath = this._resolvePath(args.path);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      return fs.promises.writeFile(filePath, args.content, "utf8");
    });

    this.registerCommand("listDir", async (args) => {
      const dirPath = this._resolvePath(args.path);
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      return entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile()
      }));
    });

    this.registerCommand("createDir", async (args) => {
      const dirPath = this._resolvePath(args.path);
      return fs.promises.mkdir(dirPath, { recursive: true });
    });
  }

  /**
   * Resolve path relative to project root
   */
  _resolvePath(inputPath) {
    // Prevent path traversal
    const resolved = path.resolve(this.projectRoot, inputPath);
    const relative = path.relative(this.projectRoot, resolved);

    if (relative.startsWith("..")) {
      throw new Error(`Path traversal blocked: ${inputPath}`);
    }

    return resolved;
  }
}

export default ControllerCore;
