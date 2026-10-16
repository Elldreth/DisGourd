// Syntax highlighting for code blocks. Loaded on demand (dynamic import from
// markdown.jsx) the first time a code block names a known language, so it
// isn't in the main bundle.
import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, go, java, javascript, json, python, rust, sql, typescript, xml, yaml,
});
lowlight.registerAlias({
  bash: ['sh', 'shell', 'zsh', 'console'],
  cpp: ['c++', 'hpp', 'cc', 'cxx'],
  csharp: ['cs', 'c#'],
  go: ['golang'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  python: ['py'],
  rust: ['rs'],
  typescript: ['ts', 'tsx'],
  xml: ['html', 'svg', 'xhtml'],
  yaml: ['yml'],
});

// The highlighted tree for `code`, or null if `lang` isn't one we know.
export function highlight(code, lang) {
  const name = String(lang || '').toLowerCase();
  if (!name || !lowlight.registered(name)) return null;
  return lowlight.highlight(name, code);
}
