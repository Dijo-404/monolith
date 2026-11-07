/*
 * A deliberately small tokenizer for documentation snippets: comments, strings, numbers,
 * keywords and shell prompts. It never evaluates code and returns plain text tokens.
 */
export type Language = 'ts' | 'sh' | 'json' | 'html' | 'text';
export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'prompt' | 'flag' | 'punct';
export interface Token { readonly kind: TokenKind; readonly text: string }

const TS_KEYWORDS = new Set([
  'import', 'from', 'export', 'const', 'let', 'await', 'async', 'if', 'return', 'type', 'interface',
  'new', 'true', 'false', 'null', 'function', 'finally', 'try', 'catch', 'readonly',
]);

const RULES: Record<Exclude<Language, 'text'>, RegExp> = {
  ts: /(\/\/[^\n]*)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|(\b\d[\d_]*\b)|([A-Za-z_$][\w$]*)|([{}()[\];:,.<>=])/g,
  json: /()("(?:\\.|[^"\\\n])*")|(\b-?\d+(?:\.\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\]:,])/g,
  sh: /(#[^\n]*)|('(?:[^'\n])*'|"(?:\\.|[^"\\\n])*")|()(^\$ |\b(?:pnpm|npm|npx|node|git|cd|cp|monolith)\b)|(--?[a-z][\w-]*)/gm,
  html: /(<!--[\s\S]*?-->)|("(?:[^"\n])*"|'(?:[^'\n])*')|()(<\/?[a-z][\w-]*|\/?>)|([=])/g,
};

export function highlight(source: string, language: Language): Token[] {
  if (language === 'text') return [{ kind: 'plain', text: source }];
  const rule = new RegExp(RULES[language].source, RULES[language].flags);
  const tokens: Token[] = [];
  let last = 0;
  const push = (kind: TokenKind, text: string) => {
    if (text.length === 0) return;
    const previous = tokens.at(-1);
    if (previous !== undefined && previous.kind === kind) tokens[tokens.length - 1] = { kind, text: previous.text + text };
    else tokens.push({ kind, text });
  };
  for (const match of source.matchAll(rule)) {
    const index = match.index;
    if (match[0].length === 0) continue;
    push('plain', source.slice(last, index));
    const [, comment, string, number, word, punct] = match;
    if (comment) push('comment', comment);
    else if (string) push('string', string);
    else if (number) push('number', number);
    else if (word !== undefined && word !== '') {
      if (language === 'sh') push(word.startsWith('$') ? 'prompt' : 'keyword', word);
      else if (language === 'json' || language === 'html') push('keyword', word);
      else push(TS_KEYWORDS.has(word) ? 'keyword' : 'plain', word);
    } else if (punct) push(language === 'sh' ? 'flag' : 'punct', punct);
    else push('plain', match[0]);
    last = index + match[0].length;
  }
  push('plain', source.slice(last));
  return tokens;
}
