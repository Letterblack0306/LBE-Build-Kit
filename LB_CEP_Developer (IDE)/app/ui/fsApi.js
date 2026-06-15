/**
 * fsApi - Renderer-side file system bridge.
 * Aligned with IIFE/global validator-safe model.
 */
var fsApi = (function () {
  "use strict";

  function writeFile(path, content) {
    if (window.electronAPI && window.electronAPI.writeFile) {
      return window.electronAPI.writeFile(path, content);
    }
    console.error("electronAPI.writeFile not available");
    return Promise.reject("ELECTRON_API_MISSING");
  }

  function readFile(path) {
    if (window.electronAPI && window.electronAPI.readFile) {
      return window.electronAPI.readFile(path);
    }
    console.error("electronAPI.readFile not available");
    return Promise.reject("ELECTRON_API_MISSING");
  }

  return {
    writeFile: writeFile,
    readFile: readFile
  };
})();

// Export for ES modules if needed
if (typeof exports !== 'undefined') {
  exports.fsApi = fsApi;
}
