/**
 * Source scans for rules a type checker cannot see. Runs under tsconfig.node.json (Node types), so it
 * reads files and never imports the UI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HIT_MIN_PX } from '../../src/ui/layout.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(entry) ? [path] : [];
  });
}

function offenders(paths: readonly string[], pattern: RegExp): string[] {
  return paths.flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, i) =>
        pattern.test(line) ? [`${relative(SRC, path)}:${String(i + 1)}: ${line.trim()}`] : [],
      ),
  );
}

const uiSources = [
  ...files(join(SRC, 'ui'), /\.(ts|tsx)$/),
  join(SRC, 'App.tsx'),
  join(SRC, 'main.tsx'),
];

describe('REQ-044 names render only as text', () => {
  it('REQ-044 no innerHTML, outerHTML, insertAdjacentHTML or dangerouslySetInnerHTML in the UI', () => {
    expect(
      offenders(uiSources, /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/),
    ).toEqual([]);
  });
});

describe('REQ-057 Prime Time styling comes from the tokens only', () => {
  it('REQ-057 no raw hex colour anywhere in apps/client/src', () => {
    expect(offenders(files(SRC, /\.(ts|tsx|css)$/), /#[0-9A-Fa-f]{6}\b/)).toEqual([]);
  });

  it('REQ-057 no invisible bidi control characters in the UI sources (Trojan Source)', () => {
    // Code points, not escapes: an escape typed through an editor can itself become the character.
    const codePoints = [0x200e, 0x200f, 0x061c, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e];
    codePoints.push(0x2066, 0x2067, 0x2068, 0x2069);
    const bidi = new RegExp(`[${String.fromCodePoint(...codePoints)}]`, 'u');
    expect(offenders([...uiSources, ...files(join(SRC, 'styles'), /\.css$/)], bidi)).toEqual([]);
  });

  it('REQ-057 no concept-art PNG is referenced; art comes from design/assets', () => {
    expect(
      offenders(files(SRC, /\.(ts|tsx|css)$/), /concept-art|pt-(logo|backdrop|win)\.png/),
    ).toEqual([]);
  });
});

describe('REQ-048 hit areas', () => {
  const tokens = readFileSync(
    fileURLToPath(new URL('../../../../design/tokens/tokens.css', import.meta.url)),
    'utf8',
  );
  const pages = readFileSync(join(SRC, 'styles', 'pages.css'), 'utf8');

  it('REQ-050 HIT_MIN_PX mirrors --hit-min in tokens.css', () => {
    expect(tokens).toContain(`--hit-min: ${String(HIT_MIN_PX)}px;`);
  });

  it('REQ-048 the lobby share link is a real 44 px tall box (--hit-min), not a bleed', () => {
    expect(pages).toMatch(/\.share-link\s*\{[^}]*min-height: var\(--hit-min\)/);
  });

  it('REQ-050 result card buttons take min-height from --result-hit-min (scale-aware) and --hit-min', () => {
    const result = readFileSync(join(SRC, 'styles', 'result.css'), 'utf8');
    expect(result).toMatch(/max\(var\(--hit-min\), var\(--result-hit-min, 0px\)\)/);
    expect(result).toMatch(/max\(var\(--space-12\), var\(--result-hit-min, 0px\)\)/);
  });
});

describe('REQ-048 e2e single sources stay dependency-free (architecture §7.4)', () => {
  it('REQ-048 copy.ts and testIds.ts import nothing', () => {
    for (const name of ['copy.ts', 'testIds.ts']) {
      expect(offenders([join(SRC, 'ui', name)], /^\s*import\s/)).toEqual([]);
    }
  });
});
