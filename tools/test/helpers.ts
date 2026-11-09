import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Repository root (this file is tools/test/helpers.ts). */
export const ROOT = path.resolve(import.meta.dirname, '..', '..');

export function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

export function readJson(rel: string): unknown {
  return JSON.parse(readText(rel));
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Narrow to an object or fail the test with a readable message. */
export function asRecord(v: unknown, what: string): Record<string, unknown> {
  if (!isRecord(v)) throw new Error(`${what} is not an object`);
  return v;
}

export function asArray(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${what} is not an array`);
  return v as unknown[];
}

export function asString(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`${what} is not a string`);
  return v;
}

/** Every file under `rel` (posix paths relative to the repo root), skipping node_modules. */
export function listFiles(rel: string): string[] {
  const out: string[] = [];
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules') continue;
    const childRel = `${rel}/${name}`;
    if (statSync(path.join(ROOT, childRel)).isDirectory()) out.push(...listFiles(childRel));
    else out.push(childRel);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Dockerfile
// ---------------------------------------------------------------------------------------------

export interface DockerInstruction {
  readonly op: string;
  readonly args: string;
  /** Index of the stage (FROM) this instruction belongs to; -1 before the first FROM. */
  readonly stage: number;
}

export interface DockerStage {
  readonly index: number;
  readonly name: string | null;
  /** Base image or earlier stage name, with ARG defaults substituted. */
  readonly from: string;
}

export interface Dockerfile {
  readonly instructions: readonly DockerInstruction[];
  readonly stages: readonly DockerStage[];
}

/** Parses instructions: comment lines dropped, `\` continuations joined, ARG defaults applied. */
export function parseDockerfile(source: string): Dockerfile {
  const logical: string[] = [];
  let current = '';
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    if (current === '' && line === '') continue;
    if (line.endsWith('\\')) {
      current += `${line.slice(0, -1).trim()} `;
    } else {
      logical.push(`${current}${line}`.trim());
      current = '';
    }
  }
  if (current.trim() !== '') logical.push(current.trim());

  const argDefaults = new Map<string, string>();
  const substitute = (s: string): string =>
    s.replace(/\$\{(\w+)\}|\$(\w+)/g, (_m, a: string | undefined, b: string | undefined) => {
      return argDefaults.get(a ?? b ?? '') ?? '';
    });

  const instructions: DockerInstruction[] = [];
  const stages: DockerStage[] = [];
  for (const text of logical) {
    const space = text.search(/\s/);
    const op = (space === -1 ? text : text.slice(0, space)).toUpperCase();
    const args = space === -1 ? '' : text.slice(space).trim();
    if (op === 'ARG' && stages.length === 0) {
      const eq = args.indexOf('=');
      if (eq !== -1) argDefaults.set(args.slice(0, eq), args.slice(eq + 1));
    }
    if (op === 'FROM') {
      const m = /^(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?$/i.exec(args);
      if (m?.[1] === undefined) throw new Error(`unparseable FROM: ${text}`);
      stages.push({ index: stages.length, name: m[2] ?? null, from: substitute(m[1]) });
    }
    instructions.push({ op, args, stage: stages.length - 1 });
  }
  return { instructions, stages };
}

export interface CopyInstruction {
  readonly stage: number;
  readonly from: string | null;
  readonly sources: readonly string[];
  readonly dest: string;
  /** Position among all instructions, for "before RUN pnpm build" ordering checks. */
  readonly order: number;
}

export function copyInstructions(d: Dockerfile): CopyInstruction[] {
  const out: CopyInstruction[] = [];
  d.instructions.forEach((ins, order) => {
    if (ins.op !== 'COPY') return;
    const tokens = ins.args.split(/\s+/).filter((t) => t !== '');
    let from: string | null = null;
    while (tokens[0]?.startsWith('--') === true) {
      const flag = tokens.shift() ?? '';
      if (flag.startsWith('--from=')) from = flag.slice('--from='.length);
    }
    const dest = tokens.pop() ?? '';
    out.push({ stage: ins.stage, from, sources: tokens, dest, order });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// .dockerignore (moby/patternmatcher semantics: anchored at the context root, last match wins,
// a file is also matched through its parent directories)
// ---------------------------------------------------------------------------------------------

interface IgnorePattern {
  readonly exclusion: boolean;
  readonly re: RegExp;
}

function compilePattern(raw: string): IgnorePattern {
  const exclusion = raw.startsWith('!');
  const body = path.posix.normalize(exclusion ? raw.slice(1) : raw).replace(/^\//, '');
  let re = '^';
  for (let i = 0; i < body.length; i++) {
    const c = body.charAt(i);
    if (c === '*') {
      if (body.charAt(i + 1) === '*') {
        while (body.charAt(i + 1) === '*') i++;
        if (body.charAt(i + 1) === '/') {
          i++;
          re += '(.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('.$()+{}|^[]\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return { exclusion, re: new RegExp(`${re}$`) };
}

/** Returns `included(relPosixPath)`: true when the file reaches the Docker build context. */
export function dockerignoreMatcher(source: string): (rel: string) => boolean {
  const patterns = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map(compilePattern);
  return (rel) => {
    const parts = rel.split('/');
    let excluded = false;
    for (const p of patterns) {
      let hit = p.re.test(rel);
      for (let i = 0; !hit && i < parts.length - 1; i++) {
        hit = p.re.test(parts.slice(0, i + 1).join('/'));
      }
      if (hit) excluded = !p.exclusion;
    }
    return !excluded;
  };
}

// ---------------------------------------------------------------------------------------------
// Minimal YAML reader for the CI workflow: block maps, block sequences, scalars, `|`/`>` block
// scalars and comments. Flow collections and anchors are rejected, never silently misread.
// ---------------------------------------------------------------------------------------------

interface YamlLine {
  readonly indent: number;
  readonly text: string;
  readonly raw: string;
}

function stripComment(s: string): string {
  if (s.startsWith("'") || s.startsWith('"')) return s.trim();
  const i = s.search(/\s#/);
  return (i === -1 ? s : s.slice(0, i)).trim();
}

function yamlScalar(s: string): unknown {
  const v = stripComment(s);
  if (/^[[{&*!]/.test(v)) throw new Error(`unsupported YAML value: ${v}`);
  if (/^"(.*)"$/.test(v) || /^'(.*)'$/.test(v)) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  return v;
}

export function parseYaml(source: string): unknown {
  const lines: YamlLine[] = source.split(/\r?\n/).map((raw) => ({
    indent: raw.length - raw.trimStart().length,
    text: raw.trim(),
    raw,
  }));
  let pos = 0;
  const skipTrivia = (): void => {
    while (pos < lines.length) {
      const t = lines[pos]?.text ?? '';
      if (t !== '' && !t.startsWith('#')) break;
      pos++;
    }
  };
  const keyValue = /^("[^"]*"|'[^']*'|[^\s:#'"][^:]*?):(?:\s+(.*))?$/;

  const parseBlockScalar = (parentIndent: number, style: string): string => {
    const body: string[] = [];
    let blockIndent = -1;
    while (pos < lines.length) {
      const l = lines[pos];
      if (l === undefined) break;
      if (l.text !== '' && l.indent <= parentIndent) break;
      if (l.text !== '' && blockIndent === -1) blockIndent = l.indent;
      body.push(l.text === '' ? '' : l.raw.slice(Math.min(blockIndent, l.indent)));
      pos++;
    }
    while (body.at(-1) === '') body.pop();
    return style.startsWith('>') ? body.join(' ') : body.join('\n');
  };

  const parseNode = (): unknown => {
    skipTrivia();
    const line = lines[pos];
    if (line === undefined) return null;
    return line.text === '-' || line.text.startsWith('- ')
      ? parseSeq(line.indent)
      : parseMap(line.indent);
  };

  const parseMap = (indent: number): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    for (skipTrivia(); pos < lines.length; skipTrivia()) {
      const line = lines[pos];
      if (line === undefined || line.indent !== indent || line.text.startsWith('- ')) break;
      const m = keyValue.exec(line.text);
      if (m?.[1] === undefined) throw new Error(`unsupported YAML line: ${line.raw}`);
      const key = /^["']/.test(m[1]) ? m[1].slice(1, -1) : m[1];
      const rest = m[2] === undefined ? '' : stripComment(m[2]);
      pos++;
      if (rest === '') {
        skipTrivia();
        const next = lines[pos];
        const nested =
          next !== undefined &&
          (next.indent > indent || (next.indent === indent && next.text.startsWith('- ')));
        obj[key] = nested ? parseNode() : null;
      } else if (/^[|>][+-]?$/.test(rest)) {
        obj[key] = parseBlockScalar(indent, rest);
      } else {
        obj[key] = yamlScalar(rest);
      }
    }
    return obj;
  };

  const parseSeq = (indent: number): unknown[] => {
    const arr: unknown[] = [];
    for (skipTrivia(); pos < lines.length; skipTrivia()) {
      const line = lines[pos];
      if (line === undefined || line.indent !== indent) break;
      if (line.text !== '-' && !line.text.startsWith('- ')) break;
      const rest = line.text.slice(1).trimStart();
      const childIndent = indent + (line.text.length - rest.length);
      if (rest === '') {
        pos++;
        arr.push(parseNode());
      } else if (keyValue.test(rest)) {
        // "- key: value" starts a map whose keys sit at the column after the dash.
        lines[pos] = { indent: childIndent, text: rest, raw: ' '.repeat(childIndent) + rest };
        arr.push(parseMap(childIndent));
      } else {
        arr.push(yamlScalar(rest));
        pos++;
      }
    }
    return arr;
  };

  return parseNode();
}
