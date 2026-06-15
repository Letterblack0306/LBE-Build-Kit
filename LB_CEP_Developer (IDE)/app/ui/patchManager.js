export const patchManager = {
  /**
   * Parses AI response for PATCH blocks with strict metadata
   */
  parse(text) {
    const patches = [];
    // Regex matches the file header and then everything up to the first // ---
    const patchRegex = /\/\/ PATCH: ([^\n]+)\n([\s\S]*?)\/\/ ---\n([\s\S]*?)\n\/\/ ---/g;
    let match;

    while ((match = patchRegex.exec(text)) !== null) {
      const filePath = match[1].trim();
      const metaStr = match[2];
      const content = match[3];

      const meta = {};
      metaStr.split("\n").forEach(line => {
        const parts = line.split(":");
        if (parts.length >= 2) {
          meta[parts[0].replace("// ", "").trim()] = parts[1].trim();
        }
      });

      patches.push({
        relativePath: filePath,
        action: meta.ACTION || "replace",
        target: meta.TARGET || null,
        start: meta.START ? parseInt(meta.START, 10) : null,
        end: meta.END ? parseInt(meta.END, 10) : null,
        proposedContent: content
      });
    }
    return patches;
  },

  /**
   * Applies patch based on TARGET (function) or START/END (lines)
   */
  applyPatch(originalContent, patch) {
    if (patch.target) {
      return this.applyFunctionPatch(originalContent, patch.target, patch.proposedContent);
    } else if (patch.start !== null && patch.end !== null) {
      return this.applyLinePatch(originalContent, patch.start, patch.end, patch.proposedContent);
    }
    throw new Error("Patch missing both TARGET and START/END range.");
  },

  applyFunctionPatch(originalContent, targetFunctionName, newFunctionContent) {
    const patterns = [
      new RegExp(`function\\s+${targetFunctionName}\\s*\\(`, 'm'),
      new RegExp(`${targetFunctionName}\\s*[:=]\\s*function\\s*\\(`, 'm'),
      new RegExp(`${targetFunctionName}\\s*\\([^)]*\\)\\s*\\{`, 'm')
    ];

    let match = null;
    for (const pattern of patterns) {
      match = originalContent.match(pattern);
      if (match) break;
    }

    if (!match) throw new Error(`Function "${targetFunctionName}" not found.`);

    const startIdx = match.index;
    let firstBrace = originalContent.indexOf('{', startIdx);
    if (firstBrace === -1) throw new Error(`No opening brace for "${targetFunctionName}"`);

    let braceCount = 1;
    let endIdx = -1;
    for (let i = firstBrace + 1; i < originalContent.length; i++) {
      if (originalContent[i] === '{') braceCount++;
      if (originalContent[i] === '}') braceCount--;
      if (braceCount === 0) { endIdx = i + 1; break; }
    }

    if (endIdx === -1) throw new Error(`No closing brace for "${targetFunctionName}"`);

    return originalContent.substring(0, startIdx) + newFunctionContent + originalContent.substring(endIdx);
  },

  applyLinePatch(originalContent, start, end, newContent) {
    const lines = originalContent.split("\n");
    // Convert 1-based to 0-based indexing
    const startIdx = start - 1;
    const endIdx = end; // slice is exclusive

    if (startIdx < 0 || startIdx >= lines.length) throw new Error(`Start line ${start} out of range.`);
    
    const prefix = lines.slice(0, startIdx);
    const suffix = lines.slice(endIdx);
    
    return [...prefix, newContent, ...suffix].join("\n");
  },

  validate(patchContent) {
    const forbidden = ["import ", "require("];
    for (const term of forbidden) {
      if (patchContent.includes(term)) {
        return { ok: false, error: `Forbidden term: ${term}` };
      }
    }
    return { ok: true };
  }
};
