export const highlighter = {
  detectLanguage(path) {
    const ext = path.split('.').pop().toLowerCase();
    const map = {
      js: 'javascript', mjs: 'javascript', ts: 'typescript',
      json: 'json', html: 'html', css: 'css', md: 'markdown',
      txt: 'plain', xml: 'xml', mxf: 'xml', jsx: 'javascript', tsx: 'typescript'
    };
    return map[ext] ?? 'plain';
  },

  highlight(code, language) {
    if (language === 'plain') return this.escapeHTML(code);

    // Process line by line to avoid cross-line span corruption in the pre overlay
    return code.split('\n').map(line => this.highlightLine(line, language)).join('\n');
  },

  highlightLine(line, language) {
    if (!line) return '';
    const tokens = this.tokenize(line, language);
    return tokens.map(token => {
      if (typeof token === 'string') return this.escapeHTML(token);
      return `<span class="token-${token.type}">${this.escapeHTML(token.value)}</span>`;
    }).join('');
  },

  tokenize(code, language) {
    // Basic tokenizer using regex
    let tokens = [code];

    const patterns = {
      javascript: [
        { type: 'comment', regex: /\/\/.*/g },
        { type: 'string', regex: /(["'`])(?:\\.|(?!\1)[^\\])*\1/g },
        { type: 'keyword', regex: /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|extends|new|this|await|async|try|catch|finally|throw|break|continue|default|case|switch|type|interface|enum|public|private|protected)\b/g },
        { type: 'number', regex: /\b\d+(\.\d+)?\b/g },
        { type: 'function', regex: /\b\w+(?=\()/g },
        { type: 'operator', regex: /[\+\-\*\/=<>!&|?^~%]/g },
        { type: 'bracket', regex: /[\[\]\(\)\{\}]/g }
      ],
      json: [
        { type: 'keyword', regex: /\b(true|false|null)\b/g },
        { type: 'number', regex: /\b\d+(\.\d+)?\b/g },
        { type: 'string', regex: /"(?:\\.|[^"\\])*"/g },
        { type: 'operator', regex: /[:]/g },
        { type: 'bracket', regex: /[\[\]\{\}]/g }
      ],
      html: [
        { type: 'comment', regex: /<!--[\s\S]*?-->/g },
        { type: 'tag', regex: /<[^>]+>/g }
      ],
      css: [
        { type: 'comment', regex: /\/\/.*/g },
        { type: 'keyword', regex: /@[\w-]+/g },
        { type: 'type', regex: /var\(--[\w-]+\)/g },
        { type: 'string', regex: /(["'])(?:\\.|(?!\1)[^\\])*\1/g },
        { type: 'number', regex: /\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch|ex|cm|mm|pt|pc)?\b/g },
        { type: 'selector', regex: /^([.#:*]?[\w-]+(?:[.#:[\s>+~][\w-"'=]+)*)\s*(?=\{)/gm },
        { type: 'property', regex: /\b(color|background(?:-color|-image|-size|-position|-repeat)?|margin(?:-top|-right|-bottom|-left)?|padding(?:-top|-right|-bottom|-left)?|font(?:-size|-weight|-family|-style|-variant)?|display|position|width|height|min-width|max-width|min-height|max-height|border(?:-radius|-color|-width|-style)?|flex(?:-direction|-wrap|-grow|-shrink|-basis)?|grid(?:-template|-column|-row|-gap|-area)?|transform|transition|animation|opacity|z-index|overflow(?:-x|-y)?|cursor|top|left|right|bottom|box-shadow|text-align|text-decoration|justify-content|align-items|align-self|gap|line-height|letter-spacing|content|visibility|pointer-events|outline|list-style|white-space|word-break|vertical-align|float|clear|resize|object-fit)\b/g },
        { type: 'bracket', regex: /[\{\}]/g }
      ],
      typescript: [
        { type: 'comment', regex: /\/\/.*/g },
        { type: 'string', regex: /(["'`])(?:\\.|(?!\1)[^\\])*\1/g },
        { type: 'keyword', regex: /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|extends|new|this|await|async|try|catch|finally|throw|break|continue|default|case|switch|type|interface|enum|public|private|protected|readonly|declare|namespace|abstract|implements|as|keyof|typeof|infer|never|unknown|any|void|null|undefined)\b/g },
        { type: 'type', regex: /\b([A-Z][A-Za-z0-9_]*)\b/g },
        { type: 'number', regex: /\b\d+(\.\d+)?\b/g },
        { type: 'function', regex: /\b\w+(?=\()/g },
        { type: 'operator', regex: /[\+\-\*\/=<>!&|?^~%:]/g },
        { type: 'bracket', regex: /[\[\]\(\)\{\}]/g }
      ],
      markdown: [
        { type: 'keyword', regex: /^#{1,6}\s.+$/gm },
        { type: 'string', regex: /`[^`]+`/g },
        { type: 'comment', regex: /^\s*>.+$/gm },
        { type: 'function', regex: /\[([^\]]+)\]\([^)]+\)/g },
        { type: 'operator', regex: /^[\*\-\+]\s/gm },
        { type: 'number', regex: /^\d+\.\s/gm }
      ]
    };

    const activePatterns = patterns[language] || [];

    activePatterns.forEach(pattern => {
      let nextTokens = [];
      tokens.forEach(token => {
        if (typeof token !== 'string') {
          nextTokens.push(token);
          return;
        }

        let lastIndex = 0;
        let match;
        pattern.regex.lastIndex = 0; // Reset regex
        while ((match = pattern.regex.exec(token)) !== null) {
          if (match.index > lastIndex) {
            nextTokens.push(token.substring(lastIndex, match.index));
          }
          nextTokens.push({ type: pattern.type, value: match[0] });
          lastIndex = pattern.regex.lastIndex;
        }
        if (lastIndex < token.length) {
          nextTokens.push(token.substring(lastIndex));
        }
      });
      tokens = nextTokens;
    });

    return tokens;
  },

  // Returns an array of highlighted HTML strings — one per source line.
  // Used by code folding to independently show/hide lines in the pre overlay.
  // Large files (>800 lines) skip tokenization — plain escaped display to avoid
  // malformed HTML from truncated regex spans corrupting the overlay.
  highlightLines(code, language) {
    const lineCount = (code.match(/\n/g) || []).length;
    if (lineCount > 800) {
      return code.split('\n').map(line => this.escapeHTML(line));
    }
    const full = this.highlight(code, language);
    return full.split('\n');
  },

  escapeHTML(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
};
