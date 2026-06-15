export const autocomplete = {
  keywords: {
    javascript: [
      'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
      'import', 'export', 'from', 'class', 'extends', 'new', 'this', 'await',
      'async', 'try', 'catch', 'finally', 'throw', 'break', 'continue', 'default',
      'case', 'switch', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined',
      'console', 'window', 'document', 'fetch', 'JSON', 'Math', 'Array', 'Object',
      'Promise', 'Error', 'setTimeout', 'setInterval'
    ],
    html: [
      'div', 'span', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
      'form', 'input', 'button', 'select', 'textarea', 'label', 'table', 'tr', 'td',
      'th', 'thead', 'tbody', 'tfoot', 'script', 'link', 'style', 'meta', 'head',
      'body', 'html', 'img', 'svg', 'canvas', 'section', 'article', 'aside', 'nav',
      'footer', 'header', 'main'
    ],
    css: [
      'display', 'position', 'flex', 'grid', 'margin', 'padding', 'border', 'width',
      'height', 'color', 'background', 'font', 'overflow', 'opacity', 'visibility',
      'z-index', 'cursor', 'transition', 'animation', 'transform', 'top', 'left',
      'right', 'bottom', 'justify-content', 'align-items', 'flex-direction',
      'gap', 'border-radius', 'box-shadow', 'text-align', 'font-size', 'font-weight'
    ]
  },

  // Snippets: prefix -> expanded text with $1, $2 cursor stops
  snippets: {
    javascript: {
      'fn':    'function ${1:name}(${2:params}) {\n  ${3}\n}',
      'afn':   'async function ${1:name}(${2:params}) {\n  ${3}\n}',
      'arr':   'const ${1:name} = (${2:params}) => {\n  ${3}\n}',
      'aarr':  'const ${1:name} = async (${2:params}) => {\n  ${3}\n}',
      'if':    'if (${1:condition}) {\n  ${2}\n}',
      'ife':   'if (${1:condition}) {\n  ${2}\n} else {\n  ${3}\n}',
      'for':   'for (let ${1:i} = 0; ${1:i} < ${2:arr}.length; ${1:i}++) {\n  ${3}\n}',
      'fore':  'for (const ${1:item} of ${2:items}) {\n  ${3}\n}',
      'wh':    'while (${1:condition}) {\n  ${2}\n}',
      'class': 'class ${1:Name} {\n  constructor(${2:params}) {\n    ${3}\n  }\n}',
      'imp':   "import ${1:module} from '${2:path}';",
      'exp':   'export default ${1:value};',
      'expn':  'export const ${1:name} = ${2:value};',
      'try':   'try {\n  ${1}\n} catch (err) {\n  ${2}\n}',
      'log':   'console.log(${1});',
      'err':   'console.error(${1});',
      'qs':    "document.querySelector('${1}');",
      'qsa':   "document.querySelectorAll('${1}');",
      'ae':    "${1:element}.addEventListener('${2:click}', (e) => {\n  ${3}\n});",
      'pr':    'new Promise((resolve, reject) => {\n  ${1}\n});',
      'sw':    'switch (${1:value}) {\n  case ${2}:\n    ${3}\n    break;\n  default:\n    ${4}\n}',
      'td':    '// TODO: ${1}',
    }
  },

  getSuggestions(prefix, language) {
    if (!prefix) return [];
    const lowerPrefix = prefix.toLowerCase();
    const list = this.keywords[language] || [];
    return list
      .filter(k => k.toLowerCase().startsWith(lowerPrefix))
      .slice(0, 10);
  },

  // Returns snippet body if prefix exactly matches a snippet key, else null
  getSnippet(prefix, language) {
    const lang = language === 'typescript' ? 'javascript' : language;
    const map = this.snippets[lang] || {};
    return map[prefix] || null;
  },

  // Expand snippet: replace $1..$N with sequential stops, return { text, firstStopOffset }
  expandSnippet(snippetBody) {
    // Find first $N position before substitution
    const firstStop = snippetBody.indexOf('${1');
    // Replace all ${N:default} with their default text
    const expanded = snippetBody.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d+/g, '');
    return { text: expanded, cursorOffset: firstStop >= 0 ? firstStop : expanded.length };
  }
};
