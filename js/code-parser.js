/* ==========================================================
   Code tokenizer for structural comparison
   Strips comments, collapses whitespace, tokenizes so that
   `pinMode(4, INPUT);` === `pinMode (4 , INPUT) ;`
   ========================================================== */
function tokenizeCode(src, lang = 'javascript') {
  let code = String(src == null ? '' : src);
  const hash = ['python', 'ruby', 'bash', 'php'].includes(lang);
  const slash = !['python', 'ruby', 'bash', 'sql', 'html'].includes(lang);
  if (slash || lang === 'sql') code = code.replace(/\/\*[\s\S]*?\*\//g, '');
  if (slash) code = code.replace(/\/\/[^\n]*/g, '');
  if (hash) code = code.replace(/#[^\n]*/g, '');
  if (lang === 'sql') code = code.replace(/--[^\n]*/g, '');
  if (lang === 'html') code = code.replace(/<!--[\s\S]*?-->/g, '');
  // tokenize: strings, numbers, identifiers, operators, punctuation
  const re = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*)|([+\-*/%=<>!&|^~?:]+)|([{}()\[\],;.])/g;
  const tokens = [];
  let m;
  while ((m = re.exec(code))) {
    if (m[1]) tokens.push({ t: 'str', v: m[1].slice(1, -1) });
    else if (m[2]) tokens.push({ t: 'num', v: m[2] });
    else if (m[3]) tokens.push({ t: 'id', v: m[3] });
    else if (m[4]) tokens.push({ t: 'op', v: m[4] });
    else if (m[5]) tokens.push({ t: 'p', v: m[5] });
  }
  return tokens;
}

function tokenString(tokens) {
  return tokens.map((tk) => tk.t + ':' + tk.v).join('|');
}

/* Structural equality | ignore whitespace, comments, string contents */
function codeEquivalent(a, b, lang) {
  const ta = tokenizeCode(a, lang);
  const tb = tokenizeCode(b, lang);
  // compare tokens; for strings, compare emptiness only (ignore literal content)
  const norm = (toks) => toks.map((tk) => tk.t === 'str' ? { t: 'str', v: '' } : tk);
  return tokenString(norm(ta)) === tokenString(norm(tb));
}