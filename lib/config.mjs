import { AppError, hash } from './catalog.mjs';

// Locate the root key without rewriting TOML or interpreting table contents.
// String scanning prevents [table] text inside multiline values being mistaken for a table.
function scanStrings(line, state) {
  let { mode, depth } = state;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (mode === 'basic3') {
      if (ch === '\\') { i++; continue; }
      if (line.slice(i, i + 3) === '"""') {
        while (line[i + 3] === '"') i++;
        i += 2; mode = null;
      }
    } else if (mode === 'literal3') {
      if (line.slice(i, i + 3) === "'''") {
        while (line[i + 3] === "'") i++;
        i += 2; mode = null;
      }
    } else if (mode === 'basic') {
      if (ch === '\\') i++;
      else if (ch === '"') mode = null;
    } else if (mode === 'literal') {
      if (ch === "'") mode = null;
    } else {
      if (ch === '#') break;
      if (line.slice(i, i + 3) === '"""') { mode = 'basic3'; i += 2; }
      else if (line.slice(i, i + 3) === "'''") { mode = 'literal3'; i += 2; }
      else if (ch === '"') mode = 'basic';
      else if (ch === "'") mode = 'literal';
      else if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;
    }
  }
  return { mode, depth };
}

function rootRecords(text) {
  const records = [];
  let state = { mode: null, depth: 0 };
  let provider = 'openai';
  let insertion = text.length;
  let offset = 0;
  for (const wholeLine of text.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
    const line = wholeLine.replace(/\r?\n$/u, '');
    if (!state.mode && state.depth === 0 && /^\s*\[/u.test(line)) { insertion = offset; break; }
    if (!state.mode && state.depth === 0) {
      const match = line.match(/^\s*([A-Za-z0-9_-]+|"(?:\\.|[^"\\])*"|'[^']*')\s*=\s*/u);
      if (match) {
        const rawKey = match[1];
        const key = rawKey.startsWith('"') || rawKey.startsWith("'") ? readStringAt(rawKey, 0, rawKey.length).value : rawKey;
        const valueStart = offset + match[0].length;
        if (key === 'model_catalog_json') records.push({ start: offset, end: offset + wholeLine.length, valueStart, lineEnd: offset + line.length });
        if (key === 'model_provider') provider = readStringAt(text, valueStart, offset + line.length).value;
      }
    }
    state = scanStrings(line, state);
    offset += wholeLine.length;
  }
  if (records.length > 1) throw new AppError('config.toml 中存在重复的顶层 model_catalog_json，需先修正配置。');
  return { record: records[0] ?? null, insertion, provider };
}

function readStringAt(text, start, lineEnd) {
  const quote = text[start];
  if (quote !== '"' && quote !== "'") throw new AppError('model_catalog_json 必须是一个 TOML 字符串路径。');
  if (text.slice(start, start + 3) === quote.repeat(3)) throw new AppError('现有 model_catalog_json 使用了多行字符串，请先改为单行路径。');
  let end = start + 1;
  for (; end < lineEnd; end++) {
    if (quote === '"' && text[end] === '\\') { end++; continue; }
    if (text[end] === quote) break;
  }
  if (text[end] !== quote || end >= lineEnd) throw new AppError('config.toml 中的 model_catalog_json 字符串未闭合。');
  if (!/^\s*(#.*)?$/u.test(text.slice(end + 1, lineEnd))) throw new AppError('model_catalog_json 后存在无效内容。');
  const raw = text.slice(start, end + 1);
  let value;
  if (quote === "'") value = raw.slice(1, -1);
  else {
    try {
      const inner = raw.slice(1, -1);
      const escapes = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
      value = '';
      for (let i = 0; i < inner.length; i++) {
        if (inner[i] !== '\\') { value += inner[i]; continue; }
        const escape = inner[++i];
        if (Object.hasOwn(escapes, escape)) value += escapes[escape];
        else if (escape === 'u' || escape === 'U') {
          const length = escape === 'u' ? 4 : 8, digits = inner.slice(i + 1, i + 1 + length);
          if (digits.length !== length || !/^[0-9A-Fa-f]+$/u.test(digits)) throw new Error('Invalid Unicode');
          const point = parseInt(digits, 16);
          if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error('Invalid Unicode');
          value += String.fromCodePoint(point); i += length;
        } else throw new Error('Invalid escape');
      }
    } catch { throw new AppError('model_catalog_json 中的字符串转义无效。'); }
  }
  return { raw, value, end: end + 1 };
}

export function inspectConfig(buffer) {
  const bytes = buffer ?? Buffer.alloc(0);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) throw new AppError('config.toml 需要使用 UTF-8 编码。');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes); }
  catch { throw new AppError('config.toml 不是有效的 UTF-8 文件。'); }
  const { record, insertion, provider } = rootRecords(text);
  const value = record ? readStringAt(text, record.valueStart, record.lineEnd) : null;
  return {
    text, hasBom, record, insertion, value,
    fingerprint: buffer === null ? 'missing' : hash(bytes),
    newline: text.includes('\r\n') ? '\r\n' : '\n',
    provider
  };
}

export function patchCatalog(buffer, value, { rawValue = false } = {}) {
  const info = inspectConfig(buffer);
  let next = info.text;
  if (value === null) {
    if (info.record) {
      const comment = info.text.slice(info.value.end, info.record.lineEnd).match(/#.*$/u)?.[0];
      const suffix = info.text.slice(info.record.lineEnd, info.record.end);
      next = info.text.slice(0, info.record.start) + (comment ? comment + suffix : '') + info.text.slice(info.record.end);
    }
  } else {
    const literal = rawValue ? value : JSON.stringify(value.replaceAll('\\', '/'));
    // Validate even internally saved original literals before inserting them.
    readStringAt(literal, 0, literal.length);
    if (info.record) next = info.text.slice(0, info.record.valueStart) + literal + info.text.slice(info.value.end);
    else {
      let prefix = info.text.slice(0, info.insertion);
      if (prefix.length && !prefix.endsWith('\n')) prefix += info.newline;
      next = prefix + 'model_catalog_json = ' + literal + info.newline + info.text.slice(info.insertion);
    }
  }
  return Buffer.concat([info.hasBom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(next, 'utf8')]);
}

