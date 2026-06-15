export const projectContext = {
  data: {
    platform: "CEP",
    extensionId: null,
    version: null,
    cepVersion: null,
    hosts: [],
    dependencies: [],
    scripts: [],
    constraints: [
      "Target Environment: Adobe Host Application (After Effects, Premiere, etc.)",
      "Engine: ExtendScript (ES5 subset, no ES6+ modules, no async/await)",
      "UI: HTML/CSS/JS (Chromium Embedded Framework)",
      "Scripting: Use .jsx or .jsxbin for host logic, .js for UI logic",
      "Bridge: Communicate via CSInterface.evalScript",
      "No Node.js APIs in ExtendScript (use Folder, File, Socket instead)"
    ]
  },

  async refresh(projectRoot) {
    if (!window.ide) return;

    // 1. Parse package.json
    try {
      const pkgPath = `${projectRoot}/package.json`.replace(/\\/g, '/');
      const res = await window.ide.readFile(pkgPath);
      if (res.ok) {
        const pkg = JSON.parse(res.content);
        this.data.version = pkg.version || this.data.version;
        this.data.dependencies = Object.keys(pkg.dependencies || {});
        this.data.scripts = Object.keys(pkg.scripts || {});
      }
    } catch (e) {
      console.warn("Failed to parse package.json for context", e);
    }

    // 2. Parse CSXS/manifest.xml
    try {
      const manifestPath = `${projectRoot}/CSXS/manifest.xml`.replace(/\\/g, '/');
      const res = await window.ide.readFile(manifestPath);
      if (res.ok) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(res.content, "text/xml");
        
        const extension = xmlDoc.querySelector("ExtensionList > Extension");
        if (extension) this.data.extensionId = extension.getAttribute("Id");

        const hostList = xmlDoc.querySelectorAll("HostList > Host");
        this.data.hosts = Array.from(hostList).map(h => h.getAttribute("Name"));

        const requiredRuntime = xmlDoc.querySelector("RequiredRuntimeList > RequiredRuntime");
        if (requiredRuntime && requiredRuntime.getAttribute("Name") === "CSXS") {
          this.data.cepVersion = requiredRuntime.getAttribute("Version");
        }
      }
    } catch (e) {
      console.warn("Failed to parse manifest.xml for context", e);
    }
  },

  getSystemPromptSnippet() {
    const d = this.data;
    let context = `\n\n[PROJECT CONTEXT]\n`;
    context += `Environment:\n- Platform: ${d.platform}\n`;
    if (d.extensionId) context += `- Extension ID: ${d.extensionId}\n`;
    if (d.version) context += `- Version: ${d.version}\n`;
    if (d.cepVersion) context += `- CEP Version: ${d.cepVersion}\n`;
    if (d.hosts.length) context += `- Target Hosts: ${d.hosts.join(", ")}\n`;
    
    if (d.dependencies.length) {
      context += `\nDependencies:\n- ${d.dependencies.join(", ")}\n`;
    }

    context += `\nConstraints:\n- ${d.constraints.join("\n- ")}\n`;
    
    return context;
  }
};
