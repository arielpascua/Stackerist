/**
 * The geometry probe (design gate 9d): measures the rendered box model of a live page and reports
 * findings. The in-page function is self-contained (Playwright serialises it), so it may not close
 * over anything in this module.
 *
 * Checks: page-h-overflow, page-v-overflow (only when asked), unclipped-v-overflow, sibling-overlap,
 * small-touch-target (only when asked), overlay-offscreen, card-offscreen.
 *
 * Exclusions (all measured as such): anything inside <svg>; `.sr-only`, `[aria-hidden="true"]`,
 * `[hidden]` subtrees and sub-pixel boxes; invisible (display:none, visibility:hidden, opacity 0)
 * elements; inline links in running text (touch rule only). `[data-overlay]` roots are excluded from
 * the sibling-overlap rule only (an overlay overlaps the board by design, architecture R12); the
 * overlay and everything in it is still held to the viewport (overlay-offscreen) and to the overflow
 * rules, so an overlay cannot spill off the screen.
 *
 * Calibrations (each one documented where it is applied, none of them hides a real spill):
 * - unclipped-v-overflow excuses only the font's own content-area overshoot below the last line;
 * - the touch rule skips elements outside an open `aria-modal` dialog (they are inert), and uses
 *   DESIGN.md's 32 px floor for the HUD top bar (44 px elsewhere), after an elementFromPoint scan.
 */
import { expect, type Page } from '@playwright/test';

export type CheckName =
  | 'page-h-overflow'
  | 'page-v-overflow'
  | 'unclipped-v-overflow'
  | 'sibling-overlap'
  | 'small-touch-target'
  | 'overlay-offscreen'
  | 'card-offscreen';

export interface Finding {
  readonly check: CheckName;
  readonly where: string;
  readonly detail: string;
}

export interface MeasureOptions {
  /** Apply the 44 x 44 touch-target rule (390 px). */
  readonly touch: boolean;
  /** The document must not scroll vertically (REQ-056, 1280 x 600 game screen). */
  readonly noPageScroll: boolean;
  /** A `data-testid` whose box must sit fully inside the viewport (the result card), or null. */
  readonly mustFit: string | null;
}

/** Runs in the page. Self-contained: no closures over module scope. */
function measureInPage(options: MeasureOptions): Finding[] {
  const findings: Finding[] = [];
  const add = (check: CheckName, where: string, detail: string): void => {
    findings.push({ check, where, detail });
  };
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const vh = doc.clientHeight;
  const round = (n: number): string => String(Math.round(n * 10) / 10);

  const describe = (el: Element): string => {
    const id = el.id === '' ? '' : `#${el.id}`;
    const testId = el.getAttribute('data-testid');
    const tid = testId === null ? '' : `[data-testid=${testId}]`;
    const cls =
      typeof el.className === 'string' && el.className.trim() !== ''
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    return `${el.tagName.toLowerCase()}${id}${cls}${tid}`;
  };

  const invisible = (el: Element): boolean => {
    if (el.getClientRects().length === 0) return true;
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
      if (Number(style.opacity) < 0.01) return true;
    }
    return false;
  };

  const subPixel = (rect: DOMRect): boolean => rect.width < 1 || rect.height < 1;

  const excluded = (el: Element): boolean => {
    if (el.closest('svg') !== null) return true;
    if (el.closest('.sr-only') !== null) return true;
    if (el.closest('[aria-hidden="true"]') !== null) return true;
    if (el.closest('[hidden]') !== null) return true;
    return subPixel(el.getBoundingClientRect());
  };

  const inOverlay = (el: Element): boolean => el.closest('[data-overlay]') !== null;

  const all = Array.from(document.body.querySelectorAll('*')).filter(
    (el) => !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(el.tagName),
  );
  const measured = all.filter((el) => !excluded(el) && !invisible(el));

  // page-h-overflow: the document is wider than its viewport (never innerWidth: a mobile-emulated
  // Chrome widens innerWidth to fit the overflow, so that comparison can never fail).
  const hOverflow = doc.scrollWidth - doc.clientWidth;
  if (hOverflow > 0) {
    const offenders = measured
      .filter((el) => el.getBoundingClientRect().right > vw + 0.5)
      .slice(0, 12)
      .map((el) => `${describe(el)} right=${round(el.getBoundingClientRect().right)}`);
    add(
      'page-h-overflow',
      'document',
      `scrollWidth ${String(doc.scrollWidth)} - clientWidth ${String(doc.clientWidth)} = ${String(hOverflow)}px; offenders: ${offenders.join(' | ') || 'none found'}`,
    );
  }

  // page-v-overflow: the game screen never scrolls (REQ-056).
  const vOverflow = doc.scrollHeight - doc.clientHeight;
  if (options.noPageScroll && vOverflow > 0) {
    const offenders = measured
      .filter((el) => el.getBoundingClientRect().bottom > vh + 0.5)
      .slice(0, 12)
      .map((el) => `${describe(el)} bottom=${round(el.getBoundingClientRect().bottom)}`);
    add(
      'page-v-overflow',
      'document',
      `scrollHeight ${String(doc.scrollHeight)} - clientHeight ${String(doc.clientHeight)} = ${String(vOverflow)}px; offenders: ${offenders.join(' | ') || 'none found'}`,
    );
  }

  // unclipped-v-overflow: content spills out of a box that neither scrolls nor clips. A display
  // face with a tight line-height (Big Shoulders at 1.04) has a glyph content area taller than its
  // line box, and Chrome counts that content area in scrollHeight although nothing is visible
  // there. That metric overshoot, (ascent + descent - line-height) / 2 below the last line, is the
  // only thing excused: any real spill is far larger.
  const measureContext = document.createElement('canvas').getContext('2d');
  const ownTextOvershoot = (el: Element): number => {
    const hasText = Array.from(el.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    );
    if (!hasText || measureContext === null) return 0;
    const style = getComputedStyle(el);
    measureContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = measureContext.measureText('Hg');
    const contentArea = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    const lineHeight = style.lineHeight === 'normal' ? contentArea : parseFloat(style.lineHeight);
    return Math.max(0, (contentArea - lineHeight) / 2);
  };
  const textMetricOvershoot = (el: Element): number => {
    let most = ownTextOvershoot(el);
    for (const inner of Array.from(el.querySelectorAll('*'))) {
      most = Math.max(most, ownTextOvershoot(inner));
    }
    return most;
  };
  for (const el of measured) {
    if (el === document.body) continue;
    const style = getComputedStyle(el);
    if (style.display === 'inline' || style.display === 'contents') continue;
    if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) continue;
    if (el.scrollHeight > el.clientHeight + 1 + textMetricOvershoot(el)) {
      add(
        'unclipped-v-overflow',
        describe(el),
        `scrollHeight ${String(el.scrollHeight)} > clientHeight ${String(el.clientHeight)} with overflow-y ${style.overflowY}`,
      );
    }
  }

  // sibling-overlap: in-flow (static / relative) siblings whose boxes intersect.
  const parents = new Set<Element>();
  for (const el of measured) if (el.parentElement !== null) parents.add(el.parentElement);
  for (const parent of parents) {
    const kids = Array.from(parent.children).filter((kid) => {
      if (!measured.includes(kid)) return false;
      if (kid.hasAttribute('data-overlay')) return false;
      const style = getComputedStyle(kid);
      if (style.position !== 'static' && style.position !== 'relative') return false;
      return style.display !== 'inline' && style.display !== 'contents';
    });
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const first = kids[i];
        const second = kids[j];
        if (first === undefined || second === undefined) continue;
        const a = first.getBoundingClientRect();
        const b = second.getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 0 && h > 0 && w * h > 1) {
          add(
            'sibling-overlap',
            `${describe(first)} x ${describe(second)}`,
            `intersect by ${round(w)} x ${round(h)} px (parent ${describe(parent)})`,
          );
        }
      }
    }
  }

  // overlay-offscreen: an overlay and everything in it stays inside the viewport. Elements that are
  // aria-hidden are still held to this (it is a containment rule, not a text rule).
  for (const el of all) {
    if (!inOverlay(el) || invisible(el)) continue;
    if (el.closest('svg') !== null || el.closest('.sr-only') !== null) continue;
    if (el.closest('[hidden]') !== null) continue;
    const rect = el.getBoundingClientRect();
    if (subPixel(rect)) continue;
    if (rect.left < -0.5 || rect.top < -0.5 || rect.right > vw + 0.5 || rect.bottom > vh + 0.5) {
      add(
        'overlay-offscreen',
        describe(el),
        `box ${round(rect.left)},${round(rect.top)} to ${round(rect.right)},${round(rect.bottom)} outside ${String(vw)} x ${String(vh)}`,
      );
    }
  }

  // card-offscreen: the result card sits fully inside the viewport (architecture R6).
  if (options.mustFit !== null) {
    const card = document.querySelector(`[data-testid="${options.mustFit}"]`);
    if (card === null) {
      add('card-offscreen', options.mustFit, 'element not found');
    } else {
      const rect = card.getBoundingClientRect();
      if (rect.left < -0.5 || rect.top < -0.5 || rect.right > vw + 0.5 || rect.bottom > vh + 0.5) {
        add(
          'card-offscreen',
          describe(card),
          `box ${round(rect.left)},${round(rect.top)} to ${round(rect.right)},${round(rect.bottom)} outside ${String(vw)} x ${String(vh)}`,
        );
      }
    }
  }

  // small-touch-target: candidates under 44 x 44, then hit-tested with elementFromPoint.
  if (options.touch) {
    const selector =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], summary';
    // An open modal makes everything outside it inert: no touch target there can be tapped.
    const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).find(
      (candidate) => !invisible(candidate),
    );
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (excluded(el) || invisible(el)) continue;
      if (modal !== undefined && !modal.contains(el)) continue;
      // DESIGN.md "Hit targets": 44 px on home, lobby and result; 32 px in the HUD (top bar).
      const MIN = el.closest('header.topbar') === null ? 44 : 32;
      const style = getComputedStyle(el);
      if (
        el.tagName === 'A' &&
        style.display === 'inline' &&
        el.closest('p, li, blockquote, figcaption') !== null
      ) {
        continue;
      }
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      if (rect.width >= MIN && rect.height >= MIN) continue;
      const labels = 'labels' in el ? Array.from((el as HTMLInputElement).labels ?? []) : [];
      const owns = (x: number, y: number): boolean => {
        const hit = document.elementFromPoint(x, y);
        if (hit === null) return false;
        return el === hit || el.contains(hit) || labels.some((label) => label.contains(hit));
      };
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (!owns(cx, cy)) {
        const top = document.elementFromPoint(cx, cy);
        add(
          'small-touch-target',
          describe(el),
          `${round(rect.width)} x ${round(rect.height)} and its centre is covered by ${top === null ? 'nothing' : describe(top)}`,
        );
        continue;
      }
      let left = 0;
      while (left < 60 && owns(cx - left - 1, cy)) left += 1;
      let right = 0;
      while (right < 60 && owns(cx + right + 1, cy)) right += 1;
      let up = 0;
      while (up < 60 && owns(cx, cy - up - 1)) up += 1;
      let down = 0;
      while (down < 60 && owns(cx, cy + down + 1)) down += 1;
      const effectiveW = left + right + 1;
      const effectiveH = up + down + 1;
      if (effectiveW < MIN || effectiveH < MIN) {
        add(
          'small-touch-target',
          describe(el),
          `box ${round(rect.width)} x ${round(rect.height)}, hit-tested target ${String(effectiveW)} x ${String(effectiveH)} (< ${String(MIN)})`,
        );
      }
    }
    window.scrollTo(0, 0);
  }

  return findings;
}

export async function measure(page: Page, options: MeasureOptions): Promise<Finding[]> {
  return page.evaluate(measureInPage, options);
}

export function formatFindings(label: string, findings: readonly Finding[]): string {
  if (findings.length === 0) return `${label}: no findings`;
  return [
    `${label}: ${String(findings.length)} finding(s)`,
    ...findings.map((f) => `  [${f.check}] ${f.where} :: ${f.detail}`),
  ].join('\n');
}

interface Health {
  readonly rules: number;
  readonly elements: number;
  readonly fontFamily: string;
  readonly fontsStatus: string;
  readonly loadedFaces: readonly string[];
}

/**
 * Fixture health guard: HTTP 200 is not proof the app rendered. Aborts loudly when the page has no
 * rules, almost no elements, the Times New Roman fallback, or our fonts did not load.
 */
export async function assertHealthy(page: Page, label: string): Promise<void> {
  const health = await page.evaluate(async (): Promise<Health> => {
    await document.fonts.ready;
    let rules = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        rules += sheet.cssRules.length;
      } catch {
        // a cross-origin sheet: not ours
      }
    }
    const loadedFaces = Array.from(document.fonts)
      .filter((face) => face.status === 'loaded')
      .map((face) => face.family.replace(/["']/g, ''));
    return {
      rules,
      elements: document.body.querySelectorAll('*').length,
      fontFamily: getComputedStyle(document.body).fontFamily,
      fontsStatus: document.fonts.status,
      loadedFaces,
    };
  });
  const problems: string[] = [];
  if (health.rules <= 0) problems.push('document.styleSheets has no cssRules (CSS did not load)');
  if (health.elements < 6) problems.push(`only ${String(health.elements)} elements in <body>`);
  if (!/archivo|big shoulders/i.test(health.fontFamily)) {
    problems.push(
      `body font-family is "${health.fontFamily}", not Archivo / Big Shoulders Display`,
    );
  }
  if (/times/i.test(health.fontFamily)) problems.push('body font-family is Times New Roman');
  if (health.fontsStatus !== 'loaded')
    problems.push(`document.fonts.status is ${health.fontsStatus}`);
  if (!health.loadedFaces.some((family) => /archivo/i.test(family))) {
    problems.push('no Archivo face loaded');
  }
  if (!health.loadedFaces.some((family) => /big shoulders/i.test(family))) {
    problems.push('no Big Shoulders Display face loaded');
  }
  expect(problems, `FIXTURE UNHEALTHY (${label}): ${problems.join('; ')}`).toEqual([]);
}

/** Waits for every finite animation to finish, so the box model is measured at rest. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}
