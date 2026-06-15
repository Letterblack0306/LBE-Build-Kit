const MONACO_BASE = "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min";
const MONACO_LOADER = `${MONACO_BASE}/vs/loader.min.js`;

let _monacoReady = null;

function mapLanguage(filePath = "") {
    const ext = String(filePath).split(".").pop()?.toLowerCase() || "";
    const map = {
        js: "javascript",
        mjs: "javascript",
        cjs: "javascript",
        ts: "typescript",
        jsx: "javascript",
        tsx: "typescript",
        json: "json",
        md: "markdown",
        html: "html",
        css: "css",
        scss: "scss",
        less: "less",
        xml: "xml",
        yml: "yaml",
        yaml: "yaml",
        py: "python",
        java: "java",
        cs: "csharp",
        cpp: "cpp",
        c: "c",
        h: "cpp",
        go: "go",
        rs: "rust",
        php: "php",
        sh: "shell",
        ps1: "powershell",
    };
    return map[ext] || "plaintext";
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(s);
    });
}

async function ensureMonaco() {
    if (_monacoReady) return _monacoReady;
    _monacoReady = (async () => {
        if (window.monaco?.editor) return window.monaco;
        if (!window.require) {
            await loadScript(MONACO_LOADER);
        }
        await new Promise((resolve, reject) => {
            try {
                window.require.config({ paths: { vs: `${MONACO_BASE}/vs` } });
                window.require(["vs/editor/editor.main"], () => resolve(), reject);
            } catch (err) {
                reject(err);
            }
        });
        if (!window.monaco?.editor) throw new Error("Monaco failed to initialize");
        return window.monaco;
    })();
    return _monacoReady;
}

export const editorAdapter = {
    _instances: new Map(),

    async create(containerEl, { path, content, readOnly = false, onChange, onCursorChange, onFocus }) {
        const monaco = await ensureMonaco();
        const language = mapLanguage(path);

        const modelUri = monaco.Uri.parse(`file://${String(path).replace(/\\/g, "/")}`);
        const existing = monaco.editor.getModel(modelUri);
        const model = existing || monaco.editor.createModel(content || "", language, modelUri);
        if (existing && existing.getValue() !== (content || "")) {
            existing.pushEditOperations([], [{ range: existing.getFullModelRange(), text: content || "" }], () => null);
        }

        const editor = monaco.editor.create(containerEl, {
            model,
            theme: "vs-dark",
            readOnly,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderWhitespace: "selection",
            fontSize: 12,
            lineHeight: 19,
            tabSize: 2,
            detectIndentation: false,
            roundedSelection: false,
            guides: { indentation: true },
            bracketPairColorization: { enabled: true },
        });

        const disposables = [];
        if (typeof onChange === "function") {
            disposables.push(editor.onDidChangeModelContent(() => {
                onChange(model.getValue());
            }));
        }
        if (typeof onCursorChange === "function") {
            disposables.push(editor.onDidChangeCursorPosition((e) => {
                onCursorChange({
                    line: e.position.lineNumber,
                    col: e.position.column,
                    offset: model.getOffsetAt(e.position),
                });
            }));
        }
        if (typeof onFocus === "function") {
            disposables.push(editor.onDidFocusEditorText(() => onFocus()));
        }

        const api = {
            kind: "monaco",
            path,
            getContent: () => model.getValue(),
            setContent: (val) => {
                const text = String(val ?? "");
                if (model.getValue() !== text) {
                    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
                }
            },
            getCursor: () => {
                const p = editor.getPosition() || { lineNumber: 1, column: 1 };
                return { line: p.lineNumber, col: p.column, offset: model.getOffsetAt(p) };
            },
            setCursor: (line, col = 1) => {
                const pos = { lineNumber: Math.max(1, Number(line) || 1), column: Math.max(1, Number(col) || 1) };
                editor.setPosition(pos);
                editor.revealPositionInCenter(pos);
            },
            focus: () => editor.focus(),
            runFind: () => editor.getAction("actions.find")?.run(),
            runReplace: () => editor.getAction("editor.action.startFindReplaceAction")?.run(),
            dispose: () => {
                disposables.forEach((d) => d?.dispose?.());
                editor.dispose();
            },
        };

        this._instances.set(path, api);
        return api;
    },

    get(path) {
        return this._instances.get(path) || null;
    },

    dispose(path) {
        const inst = this._instances.get(path);
        if (!inst) return;
        inst.dispose?.();
        this._instances.delete(path);
    },

    disposeAll() {
        for (const inst of this._instances.values()) inst.dispose?.();
        this._instances.clear();
    },
};
