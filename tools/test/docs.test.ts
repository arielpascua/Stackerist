import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, asRecord, asString, readJson, readText } from './helpers.ts';

// REQ-078: the README and DECISIONS.md are part of the deliverable. This file parses the REAL
// documents with a small Markdown reader (fenced blocks, headings, list items, links, inline code)
// so a heading inside a code fence or an HTML comment, or a command that only appears in a comment,
// cannot satisfy a check. Each check is a function from a parsed document to a list of problems, so
// the last describe block can run the same checks on deliberately broken copies and require red.

// ---------------------------------------------------------------------------------------------
// Markdown reader
// ---------------------------------------------------------------------------------------------

interface DocLine {
  /** The line with HTML comments removed (fenced lines are kept verbatim). */
  readonly text: string;
  readonly fenced: boolean;
}

interface Heading {
  readonly level: number;
  readonly text: string;
  /** Index into `Doc.lines`. */
  readonly line: number;
}

interface Fence {
  readonly info: string;
  readonly body: string;
  readonly closed: boolean;
  /** Index of the opening line in `Doc.lines`. */
  readonly line: number;
}

interface Doc {
  readonly lines: readonly DocLine[];
  readonly headings: readonly Heading[];
  readonly fences: readonly Fence[];
}

function stripComments(line: string, state: { inComment: boolean }): string {
  let out = '';
  let rest = line;
  while (rest.length > 0) {
    if (state.inComment) {
      const end = rest.indexOf('-->');
      if (end === -1) return out;
      rest = rest.slice(end + 3);
      state.inComment = false;
    } else {
      const start = rest.indexOf('<!--');
      if (start === -1) {
        out += rest;
        break;
      }
      out += rest.slice(0, start);
      rest = rest.slice(start + 4);
      state.inComment = true;
    }
  }
  return out;
}

function parseDoc(source: string): Doc {
  const lines: DocLine[] = [];
  const headings: Heading[] = [];
  const fences: { info: string; body: string[]; closed: boolean; line: number }[] = [];
  const comment = { inComment: false };
  let open: { char: string; length: number; fence: (typeof fences)[number] } | null = null;

  for (const raw of source.split(/\r?\n/)) {
    if (open !== null) {
      lines.push({ text: raw, fenced: true });
      const closer = new RegExp(`^ {0,3}${open.char}{${String(open.length)},}\\s*$`);
      if (closer.test(raw)) {
        open.fence.closed = true;
        open = null;
      } else {
        open.fence.body.push(raw);
      }
      continue;
    }
    const opener = /^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/.exec(raw);
    if (opener?.[1] !== undefined && !comment.inComment) {
      const fence = { info: (opener[2] ?? '').trim(), body: [], closed: false, line: lines.length };
      fences.push(fence);
      open = { char: opener[1].charAt(0), length: opener[1].length, fence };
      lines.push({ text: raw, fenced: true });
      continue;
    }
    const text = stripComments(raw, comment);
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      headings.push({ level: heading[1].length, text: heading[2], line: lines.length });
    }
    lines.push({ text, fenced: false });
  }
  return {
    lines,
    headings,
    fences: fences.map((f) => ({ ...f, body: f.body.join('\n') })),
  };
}

/** Prose lines (not fenced, not headings) between a level-2 heading and the next level 1-2 heading. */
function sectionLines(doc: Doc, title: string): string[] | null {
  const start = doc.headings.find((h) => h.level === 2 && h.text === title);
  if (start === undefined) return null;
  const next = doc.headings.find((h) => h.line > start.line && h.level <= 2);
  const end = next?.line ?? doc.lines.length;
  return doc.lines
    .slice(start.line + 1, end)
    .filter((l) => !l.fenced && !/^#{1,6}\s/.test(l.text))
    .map((l) => l.text);
}

function sectionRange(doc: Doc, title: string): { start: number; end: number } | null {
  const start = doc.headings.find((h) => h.level === 2 && h.text === title);
  if (start === undefined) return null;
  const next = doc.headings.find((h) => h.line > start.line && h.level <= 2);
  return { start: start.line, end: next?.line ?? doc.lines.length };
}

/** Markdown outside fenced blocks, as one string (comments already removed). */
function proseOf(doc: Doc): string {
  return doc.lines
    .filter((l) => !l.fenced)
    .map((l) => l.text)
    .join('\n');
}

function inlineCode(prose: string): string[] {
  return [...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '');
}

/** GitHub-style heading anchor. */
function slug(heading: string): string {
  return heading
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .replace(/ /g, '-');
}

interface ListItem {
  readonly text: string;
  readonly line: number;
}

/** Top-level `- ` / `* ` list items outside fences, with indented continuation lines joined. */
function listItems(doc: Doc): ListItem[] {
  const items: { text: string; line: number }[] = [];
  let current: { text: string; line: number } | null = null;
  doc.lines.forEach((l, index) => {
    if (l.fenced) {
      current = null;
      return;
    }
    if (/^[-*] /.test(l.text)) {
      current = { text: l.text, line: index };
      items.push(current);
    } else if (current !== null && /^\s+\S/.test(l.text)) {
      current.text += ` ${l.text.trim()}`;
    } else {
      current = null;
    }
  });
  return items;
}

// ---------------------------------------------------------------------------------------------
// Repository facts
// ---------------------------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  '.stryker-tmp',
  'reports',
  '.claude',
]);

function walk(rel: string, out: string[]): void {
  for (const name of readdirSync(path.join(ROOT, rel))) {
    if (SKIP_DIRS.has(name)) continue;
    const child = rel === '' ? name : `${rel}/${name}`;
    out.push(child);
    if (statSync(path.join(ROOT, child)).isDirectory()) walk(child, out);
  }
}

const repoPaths: string[] = [];
walk('', repoPaths);
const repoBasenames = new Set(repoPaths.map((p) => p.slice(p.lastIndexOf('/') + 1)));

function pathExists(rel: string): boolean {
  return existsSync(path.join(ROOT, rel));
}

function globToRegExp(glob: string): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*') {
      if (glob.charAt(i + 1) === '*') {
        i++;
        re += '.*';
      } else re += '[^/]*';
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${re}$`);
}

const pkg = asRecord(readJson('package.json'), 'package.json');
const scripts = asRecord(pkg.scripts, 'package.json scripts');
const enginesNode = asString(asRecord(pkg.engines, 'engines').node, 'engines.node');
const packageManager = asString(pkg.packageManager, 'packageManager');

const readmeSource = readText('README.md');
const decisionsSource = readText('DECISIONS.md');

// ---------------------------------------------------------------------------------------------
// README checks
// ---------------------------------------------------------------------------------------------

const REQUIRED_HEADINGS = [
  'Pitch',
  'How to run',
  'How to play',
  'Architecture',
  'How we prevent cheating',
  'How the rules are tested',
  'Design decisions',
  'Deploying',
  'Known limitations',
  'Future work',
] as const;

/** Each required level-2 heading appears exactly once, and in the required order. */
function headingProblems(doc: Doc): string[] {
  const problems: string[] = [];
  const h2 = doc.headings.filter((h) => h.level === 2);
  let previous = -1;
  for (const title of REQUIRED_HEADINGS) {
    const hits = h2.filter((h) => h.text === title);
    if (hits.length === 0) {
      problems.push(`missing heading "## ${title}"`);
      continue;
    }
    if (hits.length > 1)
      problems.push(`heading "## ${title}" appears ${String(hits.length)} times`);
    const line = hits[0]?.line ?? -1;
    if (line < previous) problems.push(`heading "## ${title}" is out of order`);
    previous = Math.max(previous, line);
  }
  return problems;
}

/** Every required section has real prose, and the pitch is one paragraph. */
function sectionProblems(doc: Doc): string[] {
  const problems: string[] = [];
  for (const title of REQUIRED_HEADINGS) {
    const lines = sectionLines(doc, title);
    if (lines === null) continue; // reported by headingProblems
    const text = lines.join('\n').trim();
    if (text.replace(/\s+/g, ' ').length < 40) problems.push(`section "${title}" is empty`);
  }
  const pitch = sectionLines(doc, 'Pitch');
  if (pitch !== null) {
    const paragraphs = pitch
      .join('\n')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p !== '');
    if (paragraphs.length !== 1) {
      problems.push(`the pitch must be one paragraph, found ${String(paragraphs.length)}`);
    } else if (/^([-*|>]|\d+\.)\s/.test(paragraphs[0] ?? '')) {
      problems.push('the pitch is a list or table, not a paragraph');
    }
  }
  return problems;
}

const PNPM_BUILTINS = new Set(['install', 'i', 'exec', 'dlx', 'add', 'remove', 'update', 'run']);
const REQUIRED_COMMANDS = ['install', 'build', 'start', 'dev', 'test', 'typecheck', 'lint', 'e2e'];

/** `pnpm <word>` commands from inline code and fenced sh blocks (never from plain prose). */
function pnpmCommands(doc: Doc): string[] {
  const snippets = [
    ...inlineCode(proseOf(doc)),
    ...doc.fences.filter((f) => /^(sh|bash|shell|console)?$/.test(f.info)).map((f) => f.body),
  ];
  const found: string[] = [];
  for (const snippet of snippets) {
    for (const m of snippet.matchAll(/(?:^|[\s;&|])pnpm\s+(?:run\s+)?([a-z][\w:-]*)/g)) {
      found.push(m[1] ?? '');
    }
  }
  return found;
}

function commandProblems(doc: Doc): string[] {
  const problems: string[] = [];
  const found = pnpmCommands(doc);
  for (const name of found) {
    if (!PNPM_BUILTINS.has(name) && typeof scripts[name] !== 'string') {
      problems.push(`README lists "pnpm ${name}" but package.json has no "${name}" script`);
    }
  }
  for (const name of REQUIRED_COMMANDS) {
    if (!found.includes(name)) problems.push(`README does not list "pnpm ${name}"`);
  }
  const run = sectionLines(doc, 'How to run');
  const runText = (run ?? []).join('\n');
  const nodeMajor = /(\d+)/.exec(enginesNode)?.[1];
  if (nodeMajor === undefined || !new RegExp(`Node ${nodeMajor}\\b`).test(runText)) {
    problems.push(`How to run does not state Node ${nodeMajor ?? '?'} (package.json engines)`);
  }
  const pnpmMajor = /^pnpm@(\d+)/.exec(packageManager)?.[1];
  if (pnpmMajor === undefined || !new RegExp(`pnpm ${pnpmMajor}\\b`).test(runText)) {
    problems.push(
      `How to run does not state pnpm ${pnpmMajor ?? '?'} (package.json packageManager)`,
    );
  }
  if (!/\bPORT\b/.test(runText) || !/\b3000\b/.test(runText)) {
    problems.push('How to run does not mention PORT and the default port 3000');
  }
  return problems;
}

/** The Architecture section holds a closed ```mermaid fence with a real diagram in it. */
function mermaidProblems(doc: Doc): string[] {
  const problems: string[] = [];
  const range = sectionRange(doc, 'Architecture');
  const blocks = doc.fences.filter((f) => f.info.toLowerCase() === 'mermaid');
  if (blocks.length === 0) return ['no ```mermaid fenced block'];
  const inSection = blocks.filter(
    (f) => range !== null && f.line > range.start && f.line < range.end,
  );
  if (inSection.length === 0) problems.push('the mermaid block is not inside "## Architecture"');
  for (const block of blocks) {
    if (!block.closed) problems.push('a mermaid fence is never closed');
    if (
      !/^\s*(flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|C4Context)\b/.test(
        block.body,
      )
    ) {
      problems.push('the mermaid block does not start with a diagram type');
    }
    if (!/-->|->>/.test(block.body)) problems.push('the mermaid block has no edges');
  }
  return problems;
}

const KNOWN_EXTENSIONS = /\.(md|ts|tsx|json|ya?ml|js|mjs|css|html)$/;
const TOP_DIRS = /^(apps|packages|e2e|tools|docs|design|\.github)\//;

/** Does this inline-code token look like a file or folder in the repository? */
function pathCandidates(span: string): string[] {
  const whole = span.trim();
  if (whole.startsWith('/') || /^[a-z]+:\/\//.test(whole)) return [];
  if (pathExists(whole) && whole !== '') return [whole];
  return whole
    .split(/\s+/)
    .filter((t) => /^[\w.@()*/-]+$/.test(t))
    .filter(
      (t) =>
        KNOWN_EXTENSIONS.test(t) ||
        TOP_DIRS.test(t) ||
        t === 'Dockerfile' ||
        /^\.[a-z][\w.-]*$/.test(t),
    )
    .filter((t) => !/(^|\/)dist(\/|$)/.test(t)); // build output exists only after `pnpm build`
}

function pathExistsLoose(token: string): boolean {
  if (token.includes('*')) {
    const re = globToRegExp(token.replace(/^\.\//, ''));
    return repoPaths.some((p) => re.test(p));
  }
  const clean = token.replace(/^\.\//, '').replace(/\/$/, '');
  if (!clean.includes('/')) return pathExists(clean) || repoBasenames.has(clean);
  return pathExists(clean);
}

/** Relative links (and `#anchors`) in the prose of `doc`, resolved against `fromFile`. */
function linkProblems(doc: Doc, fromFile: string, ownDoc: Doc): string[] {
  const problems: string[] = [];
  const prose = proseOf(doc).replace(/`[^`\n]*`/g, '');
  for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1] ?? '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:
    const hash = target.indexOf('#');
    const filePart = decodeURIComponent(hash === -1 ? target : target.slice(0, hash));
    const anchor = hash === -1 ? null : target.slice(hash + 1);
    const resolved =
      filePart === '' ? fromFile : path.posix.join(path.posix.dirname(fromFile), filePart);
    if (!pathExists(resolved)) {
      problems.push(`dead link: ${target} (${resolved} does not exist)`);
      continue;
    }
    if (anchor !== null && anchor !== '') {
      const targetDoc =
        resolved === fromFile
          ? ownDoc
          : /\.md$/.test(resolved)
            ? parseDoc(readText(resolved))
            : null;
      if (targetDoc !== null && !targetDoc.headings.some((h) => slug(h.text) === anchor)) {
        problems.push(`dead anchor: ${target} (no heading "${anchor}" in ${resolved})`);
      }
    }
  }
  return problems;
}

function pathMentionProblems(doc: Doc): string[] {
  const problems: string[] = [];
  for (const span of inlineCode(proseOf(doc))) {
    for (const token of pathCandidates(span)) {
      if (!pathExistsLoose(token)) problems.push(`mentions a path that does not exist: ${token}`);
    }
  }
  return problems;
}

/** Known limitations: three named caveats, each inside a list item of that section. */
function limitationProblems(doc: Doc): string[] {
  const range = sectionRange(doc, 'Known limitations');
  if (range === null) return ['no "Known limitations" section'];
  const items = listItems(doc).filter((i) => i.line > range.start && i.line < range.end);
  const need: [string, RegExp][] = [
    ['the 31-bit piece seed', /31-bit/],
    ['the seed can be recovered by a scripted client', /\bseed\b[\s\S]*\brecover/i],
    ['the Docker image has never been built with Docker', /Docker[\s\S]*never been built/i],
    ['the X-Real-IP dependency', /X-Real-IP/],
  ];
  const problems: string[] = [];
  for (const [what, re] of need) {
    if (!items.some((i) => re.test(i.text)))
      problems.push(`Known limitations does not state: ${what}`);
  }
  return problems;
}

function decisionsLinkProblems(doc: Doc): string[] {
  const range = sectionRange(doc, 'Design decisions');
  if (range === null) return [];
  const body = doc.lines
    .slice(range.start, range.end)
    .map((l) => l.text)
    .join('\n');
  return /\]\(DECISIONS\.md\)/.test(body)
    ? []
    : ['"Design decisions" does not link to DECISIONS.md'];
}

// ---------------------------------------------------------------------------------------------
// DECISIONS.md checks
// ---------------------------------------------------------------------------------------------

const MIN_DECISIONS = 40;

function decisionProblems(doc: Doc): string[] {
  const items = listItems(doc);
  const problems: string[] = [];
  if (items.length < MIN_DECISIONS) {
    problems.push(
      `only ${String(items.length)} list items, need at least ${String(MIN_DECISIONS)}`,
    );
  }
  for (const item of items) {
    const m = /^[-*] \*\*(.+?)\*\*(.*)$/.exec(item.text);
    if (m === null) {
      problems.push(`line ${String(item.line + 1)}: not "- **Decision.** Reason."`);
      continue;
    }
    const decision = (m[1] ?? '').trim();
    const reason = (m[2] ?? '').trim();
    if (decision.length < 3 || !/\p{L}/u.test(decision)) {
      problems.push(`line ${String(item.line + 1)}: the bold decision is empty`);
    }
    if (!decision.endsWith('.')) {
      problems.push(`line ${String(item.line + 1)}: the bold decision does not end with a period`);
    }
    if (reason.length < 3 || !/\p{L}/u.test(reason)) {
      problems.push(`line ${String(item.line + 1)}: "${decision}" has no reason after it`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------------

const readme = parseDoc(readmeSource);
const decisions = parseDoc(decisionsSource);

describe('REQ-078 README.md', () => {
  it('REQ-078 has every required heading once, in the required order', () => {
    expect(headingProblems(readme)).toEqual([]);
  });

  it('REQ-078 every required section has content, and the pitch is one paragraph', () => {
    expect(sectionProblems(readme)).toEqual([]);
  });

  it('REQ-078 the commands it lists are scripts in package.json, and all the required ones are listed', () => {
    expect(commandProblems(readme)).toEqual([]);
  });

  it('REQ-078 has a closed Mermaid block with a real diagram inside the Architecture section', () => {
    expect(mermaidProblems(readme)).toEqual([]);
  });

  it('REQ-078 every relative link and anchor resolves', () => {
    expect(linkProblems(readme, 'README.md', readme)).toEqual([]);
  });

  it('REQ-078 every file or folder path it mentions exists in the repository', () => {
    expect(pathMentionProblems(readme)).toEqual([]);
  });

  it('REQ-078 links to DECISIONS.md from the Design decisions section', () => {
    expect(decisionsLinkProblems(readme)).toEqual([]);
  });

  it('REQ-078 Known limitations states the seed, Docker and X-Real-IP caveats', () => {
    expect(limitationProblems(readme)).toEqual([]);
  });
});

describe('REQ-078 DECISIONS.md', () => {
  it('REQ-078 has at least 40 list items, each a bold decision followed by a reason', () => {
    expect(decisionProblems(decisions)).toEqual([]);
  });

  it('REQ-078 every relative link resolves', () => {
    expect(linkProblems(decisions, 'DECISIONS.md', decisions)).toEqual([]);
  });
});

describe('REQ-078 the checks can fail', () => {
  // The same check functions, run on broken copies of the real files: each must go red.
  const broken = (source: string): Doc => parseDoc(source);

  it('REQ-078 a deleted required heading is reported', () => {
    const text = readmeSource.replace(/^## Deploying$/m, '');
    expect(headingProblems(broken(text))).toContain('missing heading "## Deploying"');
  });

  it('REQ-078 swapped sections are reported as out of order', () => {
    const text = readmeSource
      .replace(/^## Future work$/m, '## TEMP')
      .replace(/^## Pitch$/m, '## Future work')
      .replace(/^## TEMP$/m, '## Pitch');
    expect(headingProblems(broken(text)).join('\n')).toMatch(/out of order/);
  });

  it('REQ-078 a heading that only appears in a code fence or an HTML comment does not count', () => {
    const fenced = readmeSource.replace(/^## Deploying$/m, '```md\n## Deploying\n```');
    expect(headingProblems(broken(fenced))).toContain('missing heading "## Deploying"');
    const commented = readmeSource.replace(/^## Deploying$/m, '<!-- ## Deploying -->');
    expect(headingProblems(broken(commented))).toContain('missing heading "## Deploying"');
  });

  it('REQ-078 an emptied section is reported', () => {
    const range = sectionRange(readme, 'Future work');
    expect(range).not.toBeNull();
    const lines = readmeSource.split('\n');
    const cut = [...lines.slice(0, (range?.start ?? 0) + 1), ''].join('\n');
    expect(sectionProblems(broken(cut))).toContain('section "Future work" is empty');
  });

  it('REQ-078 a two-paragraph pitch is reported', () => {
    const text = readmeSource.replace(/^## Pitch\n\n/m, '## Pitch\n\nA first paragraph.\n\n');
    expect(sectionProblems(broken(text)).join('\n')).toMatch(/pitch must be one paragraph/);
  });

  it('REQ-078 a command with no matching package.json script is reported', () => {
    const text = readmeSource.replaceAll('pnpm typecheck', 'pnpm typecheckk');
    const problems = commandProblems(broken(text));
    expect(problems).toContain(
      'README lists "pnpm typecheckk" but package.json has no "typecheckk" script',
    );
    expect(problems).toContain('README does not list "pnpm typecheck"');
  });

  it('REQ-078 a command that only appears in an HTML comment does not count', () => {
    const text = readmeSource
      .replace('`pnpm lint`', '<!-- `pnpm lint` -->')
      .replace(/pnpm lint/g, 'pnpm lnt');
    expect(commandProblems(broken(text))).toContain('README does not list "pnpm lint"');
  });

  it('REQ-078 a missing, unclosed or edge-less Mermaid block is reported', () => {
    const none = readmeSource.replace('```mermaid', '```text');
    expect(mermaidProblems(broken(none))).toContain('no ```mermaid fenced block');
    const noEdges = readmeSource.replace(/-->/g, '---').replace(/-- "([^"]*)" ---/g, '--- ');
    expect(mermaidProblems(broken(noEdges))).toContain('the mermaid block has no edges');
    // Drop the closing fence and everything after it, so no later code fence in the README can close it.
    const unclosed = readmeSource.replace(/(```mermaid[\s\S]*?)\n```\n[\s\S]*$/, '$1\n');
    expect(mermaidProblems(broken(unclosed)).join('\n')).toMatch(/never closed|not inside/);
  });

  it('REQ-078 a dead link, a dead anchor and a missing path are reported', () => {
    const text = `${readmeSource}\nSee [gone](docs/no-such-file.md), [bad](#no-such-heading) and \`apps/server/src/nope.ts\`.\n`;
    const doc = broken(text);
    expect(linkProblems(doc, 'README.md', doc).join('\n')).toMatch(
      /dead link: docs\/no-such-file\.md/,
    );
    expect(linkProblems(doc, 'README.md', doc).join('\n')).toMatch(/dead anchor: #no-such-heading/);
    expect(pathMentionProblems(doc)).toContain(
      'mentions a path that does not exist: apps/server/src/nope.ts',
    );
  });

  it('REQ-078 a missing Known limitations caveat is reported', () => {
    const noSeed = readmeSource.replace(/31-bit/g, 'small');
    expect(limitationProblems(broken(noSeed))).toContain(
      'Known limitations does not state: the 31-bit piece seed',
    );
    const noDocker = readmeSource.replace(/never been built/g, 'was built');
    expect(limitationProblems(broken(noDocker)).join('\n')).toMatch(/Docker image/);
    const noIp = readmeSource.replace(/X-Real-IP/g, 'a header');
    expect(limitationProblems(broken(noIp))).toContain(
      'Known limitations does not state: the X-Real-IP dependency',
    );
  });

  it('REQ-078 an emptied reason, a missing bold decision and a short list are reported', () => {
    const firstLine = decisionsSource.split('\n').find((l) => l.startsWith('- **')) ?? '';
    const decision = /^- (\*\*.+?\*\*)/.exec(firstLine)?.[1] ?? '';
    const emptied = decisionsSource.replace(firstLine, `- ${decision}`);
    expect(decisionProblems(broken(emptied)).join('\n')).toMatch(/has no reason after it/);
    const unbold = decisionsSource.replace(firstLine, firstLine.replace(/\*\*/g, ''));
    expect(decisionProblems(broken(unbold)).join('\n')).toMatch(
      /not "- \*\*Decision\.\*\* Reason\."/,
    );
    const few = decisionsSource.split('\n').slice(0, 20).join('\n');
    expect(decisionProblems(broken(few)).join('\n')).toMatch(/need at least 40/);
  });

  it('REQ-078 the reader treats fenced text and comments as non-content', () => {
    const doc = parseDoc(
      '# T\n\n```sh\n- **Not a decision.** fenced\n```\n\n<!-- - **Hidden.** no -->\n',
    );
    expect(listItems(doc)).toEqual([]);
    expect(doc.fences).toHaveLength(1);
    expect(doc.fences[0]?.closed).toBe(true);
  });
});
