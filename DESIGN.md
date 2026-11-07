---
name: Stackerist
description: A head-to-head falling-block duel, broadcast like prime-time sport.
colors:
  bg: "#16130F"
  panel: "#2A231B"
  line: "#3D3329"
  text: "#F2EADF"
  text-muted: "#BCA98F"
  accent: "#F5B700"
  alert: "#FF5A36"
  ok: "#7BD88F"
  well: "#0E0B08"
  grid: "#251F18"
  clock-bg: "#0B0907"
  ink: "#16130F"
  ink-soft: "#3A2C00"
  piece-i: "#F5B700"
  piece-o: "#E9E4D8"
  piece-t: "#2FBF71"
  piece-s: "#FF6A3D"
  piece-z: "#3D7BFF"
  piece-j: "#C89BFF"
  piece-l: "#12978A"
  piece-g: "#776A5D"
  piece-g-stripe: "#6A5E52"
  surface-plate: "rgba(22, 19, 15, 0.9)"
  surface-card: "rgba(14, 11, 8, 0.92)"
  surface-chip: "rgba(22, 19, 15, 0.7)"
  scrim-game: "rgba(22, 19, 15, 0.84)"
  scrim-dim: "rgba(14, 11, 8, 0.7)"
typography:
  countdown:
    fontFamily: "Big Shoulders Display, sans-serif"
    fontSize: "96px"
    fontWeight: 900
    lineHeight: 0.85
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Big Shoulders Display, sans-serif"
    fontSize: "64px"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "-0.01em"
  display-md:
    fontFamily: "Big Shoulders Display, sans-serif"
    fontSize: "44px"
    fontWeight: 900
    lineHeight: 1
  display-sm:
    fontFamily: "Big Shoulders Display, sans-serif"
    fontSize: "30px"
    fontWeight: 900
    lineHeight: 1
  title-lg:
    fontFamily: "Big Shoulders Display, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1
  title-md:
    fontFamily: "Big Shoulders Display, sans-serif"
    fontSize: "22px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.04em"
  title-sm:
    fontFamily: "Big Shoulders Display, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.05
  title-xs:
    fontFamily: "Big Shoulders Display, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.05
  body:
    fontFamily: "Archivo, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  ui:
    fontFamily: "Archivo, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.2
  small:
    fontFamily: "Archivo, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  table:
    fontFamily: "Archivo, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  meta:
    fontFamily: "Archivo, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.2
  label:
    fontFamily: "Archivo, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.16em"
rounded:
  none: "0px"
  control: "3px"
  meter: "4px"
  plate: "6px"
  round: "50%"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "28px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
  "16": "64px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    typography: "{typography.title-md}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    height: "48px"
  button-primary-disabled:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-muted}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.panel}"
  button-hud:
    backgroundColor: "{colors.surface-chip}"
    textColor: "{colors.text}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  input:
    backgroundColor: "{colors.well}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
    height: "44px"
  plate:
    backgroundColor: "{colors.surface-plate}"
    rounded: "{rounded.plate}"
    padding: "24px"
    width: "400px"
  result-card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "20px 28px"
  combo-banner:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    typography: "{typography.display-sm}"
    rounded: "{rounded.none}"
    padding: "6px 16px 6px 12px"
  standoff-plate-own:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    typography: "{typography.display-md}"
    padding: "8px 20px"
  standoff-plate-opp:
    backgroundColor: "{colors.text}"
    textColor: "{colors.ink}"
    typography: "{typography.display-md}"
    padding: "8px 20px"
---

# Design System: Stackerist

## Overview

**Creative North Star: "Prime Time Duel"**

Stackerist is a two-player duel televised like a championship fight under stadium lights. The
arena is warm graphite with amber floodlights. Every piece of information sits on a broadcast
graphic: scoreboard plates, a slanted on-air banner, a final-score card. Between those graphics the
screen stays dark and quiet, so the two boards are always the brightest thing in view.

Density is high but ordered: two boards, a VS column and a HUD all fit a 1280×600 laptop viewport
with no scrolling. Type does the broadcast work. Big Shoulders Display, a condensed stadium face,
carries names, numbers and banners; Archivo carries everything you read in sentences. Motion is
reserved for the duel's events (the standoff, an attack in flight, a cleared line, a combo, the
danger frame, the final score), and each event gets exactly one authored moment.

**Visual world decision: new visual world (greenfield), not a refinement.** There is no incumbent
UI: the repository held only the design doc, the source spec and concept art. The only visual
direction the source spec gives is "standard piece colors (I cyan, O yellow, T purple, S green,
Z red, J blue, L orange, G gray)" (`spec (1).md` §6.4). That is itself an **anti-reference**: the
design doc §1 lists "a look-alike of a famous game" as a failure. Prime Time (design doc §7, and
the approved mockups `design/concept-art/prime-time-art.html` and `best-moment.html`) replaces it
completely. The product truth and every anti-reference are in `PRODUCT.md`.

REFERENCE: TETR.IO — https://tetr.io — capture pending — orchestrator to capture via Playwright MCP (a headless Playwright attempt at 1280×720 was refused by the site's user-agent block: `design/reference/tetrio-headless-blocked.png`) — in-match HUD clarity (reading incoming garbage, combo/attack feedback, and the opponent board at a glance)

What was and was not captured: on 2026-11-07, a one-off Playwright 1.56.1 script (Chromium build
1200, headless) opened `https://tetr.io` at 1280×720. The site answered with a JSON error refusing
the user agent. That screenshot is saved as `design/reference/tetrio-headless-blocked.png`. I did
not spoof the user agent to get around the block, and I created no account. **Not captured:** the
title/menu screen and the in-game HUD. When the orchestrator captures them, the Wave 2 comparison
should answer three questions against this spec: (1) how many rows of incoming garbage can you read
in under half a second, and how does our segmented meter compare; (2) where combo and attack
feedback sits relative to the board, versus our on-air banner and projectile; (3) how legible the
opponent board is at its size, versus ours at 60%. Use the REFERENCE for those three questions only,
not for look or layout.

**Key Characteristics:**
- Warm graphite arena under a heavy scrim; amber is the only loud colour, and red means danger.
- Broadcast graphics: square-cornered plates, a slanted on-air banner with a hard black offset
  shadow, and a final-score card with a 4 px amber top rule.
- Boards are flat blocks with a 2 px inset highlight and shade. Never glossy, never glowing.
- Condensed display type for names and numbers, quiet sans for sentences, no italics.
- One authored motion per duel event; nothing moves when nothing happened.

## Colors

A warm, low-key arena palette: graphite and tan neutrals, one stadium-amber accent, one alert red,
and a categorical piece set that keeps away from the classic falling-block colours.

### Primary
- **Stadium Amber** (`--color-accent`): the one loud colour. Primary buttons, the on-air combo banner,
  VS, the match clock, the standoff numerals and DUEL!, garbage projectiles, focus rings, your line
  on the report chart, won-round pips. **The One Spotlight Rule.** Amber covers at most about 10%
  of any screen; the I piece shares the hue, and that is deliberate (the I piece is the "spotlight"
  piece).

### Secondary
- **Alarm Red** (`--color-alert`): danger only. The garbage meter fill, the danger frame, error
  copy, the destructive Leave series button and the chart's danger rule. It never decorates.
- **Pitch Green** (`--color-ok`): from the approved mockup's ping dot. Used only for "connection
  good". It is a status colour, never a series colour.

### Neutral
- **Warm Graphite** (`--color-bg`): page background, and the base colour of every scrim.
- **Locker Brown** (`--color-panel`): HUD chip hover, meter track, popover and disabled-button
  surface.
- **Seam** (`--color-line`): 1 px dividers, board frames at rest, secondary button borders.
- **Chalk** (`--color-text`): primary text. Also the opponent's standoff plate fill.
- **Tan** (`--color-text-muted`): labels, meta and placeholders, and the 1 px input border. Muted is
  tinted from the palette, never gray.
- **Well Black** (`--color-well`): the empty board well and input fields.
- **Grid Brown** (`--color-grid`): board grid lines and chart grid lines.
- **Scoreboard Black** (`--color-clock-bg`): the clock box behind the amber clock.
- **Ink** (`--color-ink`) and **Soft Ink** (`--color-ink-soft`): text on amber (and on chalk); Soft
  Ink is only the combo banner's sub-line.
- **Shadow Black** (`--color-shadow`): only for the hard on-air offset shadow.

### Pieces (categorical)
| Kind | Token | Value | Note |
|---|---|---|---|
| I | `--piece-I` | `#F5B700` | stadium amber |
| O | `--piece-O` | `#E9E4D8` | cream |
| T | `--piece-T` | `#2FBF71` | pitch green |
| S | `--piece-S` | `#FF6A3D` | flare orange |
| Z | `--piece-Z` | `#3D7BFF` | broadcast blue |
| J | `--piece-J` | `#C89BFF` | lilac |
| L | `--piece-L` | `#12978A` | **adjusted** deep teal (was `#00B3A4`) |
| G | `--piece-G` + `--piece-G-stripe` | `#776A5D` / `#6A5E52` | hatched garbage |

**Colour-vision check (item 5), with the one change.** A one-off script simulated protanopia,
deuteranopia and tritanopia with the Machado 2009 matrices (severity 1.0, linear sRGB) and measured
every pair with CIEDE2000 and OKLab. The decision rule was fixed before running: change a colour
only if a pair falls below ΔE00 6 under some vision type. The approved set failed once: **T vs L
under tritanopia, ΔE00 3.08** (OKLab 0.018), which is effectively the same colour. The smallest fix
that lifts every pair to ΔE00 ≥ 10 under every vision type darkens L in OKLCH lightness only, from
0.689 to 0.609, keeping its hue (−175°) and chroma (0.122): `#00B3A4` became `#12978A`, still a
teal, just deeper. Lightening T instead would have taken a larger shift (+0.105, to mint `#5BE291`)
and pushes toward the candy-game anti-reference. Shapes still identify pieces, and colour is a
second cue. Minimum separation after the change (ΔE00): normal 19.49, protan 11.51, deutan 10.60,
tritan 10.38.

### Surfaces and scrims
- `--surface-plate`: home form, lobby, keyboard warning, error plates. Opaque enough that text
  passes over the brightest pixel of the arena art. **No backdrop blur** (glassmorphism is an
  anti-reference): the mockup's `blur(4px)` is dropped and the opacity is raised from 0.82 to 0.9.
- `--surface-card`: the round and series result cards (from the best-moment mockup).
- `--surface-chip`: HUD buttons and the key caps in the controls legend.
- `--scrim-home-top` to `--scrim-home-bottom`: the mockup's vertical darkening of the arena art on
  home and lobby. Text there always sits on a plate.
- `--scrim-game`: one flat scrim over the arena art on the game screen. **This deviates from the
  mockup, and the reason is measured:** under the mockup's 0.30→0.72 gradient, the floodlights sit
  exactly under the top bar, and tan labels measured **1.09:1** at 1280×600, 1366×768, 1440×900 and
  1920×1080. The lightest flat scrim that keeps tan text at or above 4.5:1 over the art's brightest
  pixel at every viewport is 0.82 (4.76:1). Use 0.84 (5.11:1) for margin. The floodlights still read
  as warm glows.
- `--scrim-dim`: dims the arena (boards included) under the standoff countdown and the disconnect
  overlay.
- Lose and draw screens reuse the arena backdrop under `--scrim-game` with no confetti; only a win
  shows `win.webp`.

### Named Rules
**The Plate Rule.** Text never sits on raw art. It sits on a plate, a card, a chip or the game
scrim, and each of those was measured against the brightest pixel of the art behind it.

**The Red Means Danger Rule.** `--color-alert` appears only where something threatens you: incoming
garbage, a stack near the top, an error, a destructive action.

### Contrast table (computed)
Computed by a one-off script from the values in `tokens.css`, using WCAG 2.x relative luminance.
Translucent layers are composited in sRGB over the stated backing. "Worst art px" is the brightest
pixel of the art that can sit underneath: backdrop `(255,253,207)`, win art `(255,236,212)`. That
makes each ratio a floor for any viewport. Thresholds: text 4.5:1, large text 3:1, UI 3:1.

| Foreground | Backing (composited RGB) | Ratio | Need | Use |
|---|---|---|---|---|
| `--color-text` | bg (22,19,15) | 15.53 | 4.5 | body copy |
| `--color-text-muted` | bg (22,19,15) | 8.12 | 4.5 | labels, meta |
| `--color-text` | panel (42,35,27) | 13.00 | 4.5 | HUD chip hover, popover copy |
| `--color-text-muted` | panel (42,35,27) | 6.80 | 4.5 | disabled button label |
| `--color-text` | well (14,11,8) | 16.46 | 4.5 | typed input text |
| `--color-text-muted` | well (14,11,8) | 8.61 | 4.5 | input placeholder |
| `--color-accent` | bg (22,19,15) | 10.28 | 4.5 | amber small text (REPLAY tag, Copied!) |
| `--color-accent` | clock-bg (11,9,7) | 11.03 | 3.0 | match clock, 30 px |
| `--color-ink` | accent (245,183,0) | 10.28 | 4.5 | primary button, combo banner, DUEL! banner |
| `--color-ink-soft` | accent (245,183,0) | 7.57 | 4.5 | combo sub-line, 11 px |
| `--color-ink` | text (242,234,223) | 15.53 | 4.5 | opponent standoff plate |
| `--color-alert` | bg (22,19,15) | 5.97 | 4.5 | error copy |
| `--color-text` | plate over worst backdrop px (45,42,34) | 11.95 | 4.5 | home and lobby text |
| `--color-text-muted` | plate over worst backdrop px (45,42,34) | 6.25 | 4.5 | home and lobby labels |
| `--color-alert` | plate over worst backdrop px (45,42,34) | **4.59** | 4.5 | inline errors (lowest text pair) |
| `--color-accent` | plate over worst backdrop px (45,42,34) | 7.91 | 4.5 | Copied! |
| `--color-text` | card over worst win-art px (33,29,24) | 14.03 | 4.5 | result card text |
| `--color-text-muted` | card over worst win-art px (33,29,24) | 7.34 | 4.5 | result labels, chart axis labels |
| `--color-accent` | card over worst win-art px (33,29,24) | 9.29 | 3.0 | result headline, 64 px |
| `--color-text` | card over scrimmed backdrop (18,15,11) | 16.07 | 4.5 | lose and draw card text |
| `--color-text-muted` | card over scrimmed backdrop (18,15,11) | 8.40 | 4.5 | lose and draw labels |
| `--color-text` | game scrim over worst backdrop px (59,56,46) | 9.78 | 4.5 | HUD names, stats |
| `--color-text-muted` | game scrim over worst backdrop px (59,56,46) | 5.11 | 4.5 | HUD labels |
| `--color-accent` | game scrim over worst backdrop px (59,56,46) | 6.47 | 4.5 | VS, ROUND tag |
| `--color-text-muted` | chip on game scrim, worst (33,30,24) | 7.27 | 4.5 | controls legend |
| `--color-text` | chip on game scrim, worst (33,30,24) | 13.90 | 4.5 | key caps |
| `--color-text` | dim over game scrim, worst (28,25,19) | 14.75 | 4.5 | disconnect overlay copy |
| `--color-alert` | panel (42,35,27) | 5.00 | 4.5 | Leave series button |
| `--focus-ring-color` | bg / panel / HUD worst | 10.28 / 8.60 / 6.47 | 3.0 | focus ring |
| `--color-text-muted` | plate over worst backdrop px | 6.25 | 3.0 | 1 px input border |
| `--color-alert` | panel (42,35,27) | 5.00 | 3.0 | garbage meter fill vs track |
| `--color-alert` | game scrim worst / well | 3.76 / 6.32 | 3.0 | danger frame, both sides |
| `--color-ok` | game scrim worst | 6.70 | 3.0 | ping dot good |
| `--color-accent` | game scrim worst | 6.47 | 3.0 | ping dot fair, projectile |
| `--chart-you` / `--chart-opp` / `--chart-danger` | card over worst win-art px | 9.29 / 13.19 / 5.39 | 3.0 | chart marks |
| pieces I O T S Z J L | well | 10.89 / 15.47 / 8.23 / 6.90 / 5.12 / 8.96 / 5.44 | 3.0 | piece fill vs empty cell |
| `--piece-G` / `--piece-G-stripe` | well | **3.73 / 3.11** | 3.0 | garbage fill + hatch stripe vs empty cell (hole) |

Minimums: text **4.59**, large text **9.29**, UI **3.11**, all passing.

**Resolved (orchestrator, 2026-11-07): garbage lightened to clear 3:1.** The first pass kept the
approved `#4A4037` / `#3F362E` at 1.94:1 against the well, legible only through the 2 px bevel
edge. The garbage **hole** is the one cell a player must find fast to dig out, so both were
lightened one step — fill `#776A5D`, stripe `#6A5E52` — keeping the warm-gray hatch that reads as
"dead" rows behind the saturated pieces. Same class of legibility fix as the L-piece colour-vision
adjustment; the owner can revert.

**Informational: ghost outline vs well** (piece colour at `--ghost-alpha`): I 3.91, O 5.15, T 3.15,
S 2.78, Z 2.27, J 3.38, L 2.37. The ghost is a deliberate faint hint (design §7: about 55% opacity)
and carries no information you can't get elsewhere.

## Typography

**Display Font:** Big Shoulders Display 700 / 800 / 900 (`--font-display`)
**Body Font:** Archivo 400 / 600 (`--font-body`)

**Character:** a condensed stadium-signage face for anything shouted (names, numbers, banners),
paired with a sturdy grotesque for anything read. The contrast between them is the hierarchy.

**Self-hosting (frontend wires the imports).** Verified with an `npm pack` dry run against version
5.3.0 of both packages: `@fontsource/big-shoulders-display` ships `700.css`, `800.css` and
`900.css` and **no italic files**; `@fontsource/archivo` ships `400.css` and `600.css`. Import the
full weight files, not `latin-*.css`: their `unicode-range` subsets download only what a name needs,
and kids' names include accents. Fonts are never loaded from Google at runtime.

**The No Faux Italic Rule.** Big Shoulders Display has no italic. The mockups' italic headline and
VS were browser-synthesized obliques, which differ from engine to engine. Set `font-synthesis: none`
globally (this also stops faux bold, because Archivo ships no 700) and draw every "italic"
broadcast element as `font-style: normal` with `transform: skewX(var(--skew-onair))` on an
inline-block. That gives the same −12° slant as the combo banner.

### Hierarchy
| Role | Token(s) | Font / weight | Size | Line-height | Tracking | Where |
|---|---|---|---|---|---|---|
| Countdown, DUEL! | `--text-display-xl` | Display 900 | 96 px (6rem, the cap) | `--leading-countdown` 0.85 | `--tracking-countdown` −0.02em | standoff numerals, DUEL! banner |
| Headline | `--text-display-lg` | Display 900, skewed | 64 px | `--leading-headline` 0.9 | `--tracking-headline` −0.01em | YOU WIN / YOU LOSE / DRAW, lobby room code (800, `--tracking-room-code`) |
| Display md | `--text-display-md` | Display 900 | 44 px | 1 | 0 | VS, standoff name plates, series headline, final series score, disconnect timer |
| Display sm | `--text-display-sm` | Display 900 (speed and clock 800) | 30 px | 1 | clock `--tracking-clock` 0.06em | combo banner, speed number, match clock, series score, overlay titles |
| Title lg | `--text-title-lg` | Display 800 | 24 px | 1 / `--leading-stat` 1.05 | 0 | own name plate, own stat values |
| Title md | `--text-title-md` | Display 900 | 22 px | 1 | `--tracking-button` 0.04em | primary button labels; code input (800, `--tracking-code-input` 0.3em) |
| Title sm | `--text-title-sm` | Display 800 | 18 px | 1.05 | 0 | opponent name, opponent stats, result table numbers, series bug names |
| Title xs | `--text-title-xs` | Display 700 | 16 px | 1.05 | `--tracking-room-code` (room code) | HUD room code, round chips |
| Body | `--text-body` | Archivo 400 | 16 px | `--leading-body` 1.5 | 0 | inputs (16 px stops iOS zoom), keyboard warning prose |
| UI | `--text-ui` | Archivo 600 | 15 px | 1.2 | 0 | secondary buttons (Join, Back to home) |
| Small | `--text-small` | Archivo 400 | 14 px | `--leading-small` 1.45 | 0 | reason line, errors, status lines |
| Table | `--text-table` | Archivo 400 | 13 px | 1.45 | 0 | result table labels, best-moment caption (`--tracking-caption`), share link |
| Meta | `--text-meta` | Archivo 600 | 12 px | `--leading-label` 1.2 | 0 | top-bar meta, ping, legend, key caps, HUD buttons |
| Label | `--text-label` | Archivo 600, uppercase | 11 px (the floor) | 1.2 | `--tracking-label` 0.16em (FINAL: `--tracking-final` 0.24em) | field labels, NEXT / LINES / SPEED, sub-lines |

Weights in tokens: `--weight-display-bold`, `--weight-display-heavy`, `--weight-display-black`,
`--weight-body`, `--weight-body-strong`. Nothing goes below 11 px; the mockup's 10 px labels are
raised to 11 px for laptops at 125% scaling. Tracking never goes below −0.02em (the floor is
−0.04em). Prose (keyboard warning, error copy, reason lines) is capped at `--measure-prose` (65ch).
All numerals get `font-variant-numeric: tabular-nums`; clock, ping and stat boxes also get a
`min-width` in `ch` so changing values never shift the layout.

**The Shout and Speak Rule.** Display face for anything a stadium announcer would shout (names,
numbers, verdicts); Archivo for anything a person reads. Never set a sentence in the display face.

## Layout

Spatial model: a centred stage on a 4 px rhythm (`--space-1` to `--space-16`: 4, 8, 12, 16, 20,
24, 28, 32, 40, 48, 64 px). Groups are tight (4–8 px), separations generous (12–32 px).

### Game screen: 1280×600 minimum, no scrolling
```
+--------------------------------------------------------------------------------------------+
| [logo 160w] ROOM K7QM4X                     2 watching  (o) 38 ms  [Music M]  [Leave]       | top bar 40
| Ariel YOU [#][ ]                      ROUND 2                      [#][#] Sam OPPONENT      | plates 32
| | +----------+  NEXT                    VS                 | +------+  NEXT                |
| | |          |  [T]                    SPEED               | | opp  |  [J]                  |
| | |  own     |  [S]                      6                 | | 13px |  LINES 22             |
| | |  22 px   |  [O]                   [03:12]              | +------+  SENT 9               |
| | |  cells   |  [L]                                                    PIECES 91           |
| | |          |  [Z]   LINES 34 / SENT 21 / PIECES 96                                       |
| | +----------+                                                                            |
|   <- -> move   up X rotate   Z Ctrl rotate back   down soft drop   Space hard drop   M  Esc  | legend 24
+--------------------------------------------------------------------------------------------+
  "|" left of each board is the garbage meter
```
Vertical stack: page padding 12, top bar 40, gap 12, name-plate row 32, board, gap 12, legend 24,
padding 12, giving `--layout-chrome-v` = 152 px (149 used, 3 px slack). Horizontally the stage holds
the page padding (`--page-pad` × 2), each meter (`--meter-width`, `--meter-width-opp`) and its gap,
the own side column (96 px), the VS column (112 px), the opponent side column (72 px) and two 32 px
column gaps, giving `--layout-chrome-h` = 448 px.

**Cell formula** (implemented once as `computeCellSizes()` in `tokens.ts`; the canvas and the DOM
both use it):
```
cellOwn  = clamp(--cell-min, min(floor((viewportH - --layout-chrome-v) / 20),
                                 floor((viewportW - --layout-chrome-h) / 16)), --cell-max)   [CSS px]
cellOpp  = round(cellOwn × --cell-opp-ratio)                                                   [CSS px]
cellNext = max(--cell-next-min, round(cellOwn × --cell-next-ratio))                            [CSS px]
board outer = (10 × cell + 1 + 2 × --board-frame-width) × (20 × cell + 1 + 2 × --board-frame-width)
```
The 16 in the width term is 10 own columns plus 10 × 0.6 opponent columns. The cell is the pitch:
each cell draws a `--board-grid-width` grid line on its leading edges, plus one closing line. Results
from `computeCellSizes`: 1280×600 gives 22 / 13 / 10 px, matching the approved mockup; 1366×768
gives 30 / 18 / 14; 1920×1080 gives 40 / 24 / 18 (capped); 800×450 gives 14 / 8 / 6 (compact).
Canvas backing size = CSS size × `devicePixelRatio`.

**Scale-down below 1280×600:** cells keep shrinking by the formula down to `--cell-min` (12 px). At
that floor the stage is drawn at its natural size and scaled uniformly with
`transform: scale(min(1, vw / naturalW, vh / naturalH))`, origin top centre, with `overflow: hidden`
on the page. There is never a scrollbar, horizontal or vertical. Below `--cell-compact-below`
(16 px) the side columns go compact: stat values drop to `--text-title-sm` and gaps to `--space-2`,
so the NEXT ×5 queue plus three stats still fit the board height.

**Spectator layout:** both boards at `cellOwn` (fair to both), each with NEXT ×1; the width term
uses 20 columns for that view.

### Home and lobby: down to 390 px
- Home: logo `min(620px, 92vw)` wide, 28 px gap, plate `--plate-width` (400 px) or full width minus
  `--page-pad-narrow` at 390 px. Content is centred vertically, and the page scrolls vertically only
  if the viewport is shorter than the content (home is not under the game's no-scroll rule).
  There is never horizontal scroll.
- Lobby: logo at 240 px, plate `--lobby-width` (440 px). At 390 px the room code drops from 64 px to
  `--text-display-md`.
- Hit targets: every button and input on home, lobby and the result card is at least `--hit-min`
  (44 px) tall; HUD buttons are `--hit-hud` (32 px), above the WCAG 2.2 AA minimum of 24 px.

### Result card: report, best moment and table on one screen
Decision: **one card with three panels side by side** (stats-and-report table, stack-height chart,
best moment). **No tabs.** Tabs would hide half the story behind a click on the one screen where
both players compare. Arithmetic at 1280×600: overlay padding 24, card height 513 px for a round
card (535 px for a series card with a two-line headline) ≤ 552 px available. Card width 870 px
(spectators 1032 px, two best moments) ≤ `--result-card-max`.
```
+== 4 px amber rule ==========================================================================+
| ROUND 1 · FINAL                                                SERIES                        |
| YOU WIN                                                        ARIEL  1 – 0  SAM             |
| Sam topped out at 04:51                                                                      |
|----------------------------------------------------------------------------------------------|
|                 YOU    SAM  | STACK HEIGHT  -- You -- Sam --- Danger | YOUR BEST MOMENT      |
| Lines            48     31  | 20 +                                   |   [ COMBO x6 ]        |
| Garbage sent     29     14  | 16 + - - - - - - - - - - - - - - - - - |   +--------+          |
| Garbage received 14     29  | 10 +            ____/\                 |   | 9 px   |          |
| Garbage cancelled 7      3  |    +     ______/                       |   | board  |          |
| Best combo       x6     x3  |  0 +-----+------+------+------+--      |   +--------+          |
| Pieces / second 1.84  1.71  |   0:00   1:00   2:00   3:00  4:51      | Triple · +5 sent ·    |
| Actions / min     96    88  |                                        | 04:12                 |
|----------------------------------------------------------------------------------------------|
| Waiting for opponent to accept…                               [ NEXT ROUND ] [Back to home]  |
+==============================================================================================+
```
Best-moment cell = `clamp(--bm-cell-min, floor((viewportH - --bm-chrome-v) / 20), --bm-cell-max)`
(`computeBestMomentCell()`): 9 px at 600, 12 px from 648 up. Below the card's natural size the
whole overlay scales uniformly, using the same rule as the stage. It never scrolls.

### Z-layers
`--z-backdrop` (art) < `--z-stage` (boards) < `--z-board-fx` (combo banner) < `--z-projectiles`
(arena effects canvas) < `--z-hud` (top bar) < `--z-overlay` (standoff, disconnect; covers the arena
only, so the top bar stays usable) < `--z-result` (round and series cards; full viewport) <
`--z-dialog` (Leave confirm) < `--z-banner` (connection-lost banner).

## Elevation & Depth

Flat by default, with depth from tonal layering: well < bg < panel, and the scrims. Shadows are
structural and few.

### Shadow Vocabulary
- **Board lift** (`--shadow-board`): under each board, so it floats off the arena.
- **Popover** (`--shadow-popover`): the Leave confirm.
- **On-air** (`--shadow-onair`, `--shadow-onair-sm`): the hard black offset shadow under broadcast
  graphics only: combo banner, DUEL! banner, standoff plates, the result headline (as
  `text-shadow`), and the best-moment title (small). This hard offset is the approved mockup's
  broadcast-graphics language, so it is chosen here, not a default. It appears nowhere else.

### Named Rules
**The No Glow Rule.** Nothing glows: no blur halos, no bloom, no neon. Emphasis comes from amber, a
hard offset shadow or a red frame. The best-moment mockup's cleared-row glow (an 8 px blur) becomes
a crisp 1 px `--bm-clear-outline`.

## Shapes

- Corners: controls `--radius-control` (3 px); home and lobby plates `--radius-plate` (6 px); the
  meter track `--radius-meter`; the ping dot `--radius-round`. Broadcast graphics (boards, result
  card, banners, standoff plates, chips) are square, `--radius-none`.
- Slant: every on-air graphic is skewed by `--skew-onair` (−12°). Text inside keeps the skew, which
  stands in for italics.
- Blocks: flat fill, then `--bevel-highlight` along the top edge and `--bevel-shade` along the
  bottom, each `--bevel-width` thick (`--bevel-width-small` below `--bevel-small-below` cells).
  Garbage is hatched at 135° in `--garbage-stripe-width` stripes of `--piece-G` and
  `--piece-G-stripe` (`--garbage-stripe-width-small` on small cells).
- Board frame: `--board-frame-width` in `--color-line`, red when in danger.
- Borders: 1 px only. No coloured side borders on anything.

## Components

Every interactive component lists its states. "Focus" always means `:focus-visible`: an outline of
`--focus-ring-width` in `--focus-ring-color` at `--focus-ring-offset`. On the amber primary button
the offset gap shows the background, so the ring stays visible. Transitions on colour use
`--dur-hover` with `--ease-standard`. Nothing transitions layout.

### Motion system (one authored moment per event)
All easings have control points with y in [0, 1]: none overshoots, so there is no bounce or elastic.
The canvas reads the same values from `tokens.ts` (`easing`, `motion`).

| Event | The one moment | Duration / easing | Reduced-motion alternative |
|---|---|---|---|
| Button press | `translateY(1px)` | `--dur-press`, `--ease-standard` | none (colour change only) |
| Line clear | Bands of `--flash-color` at `--flash-alpha` over each cleared row's former position, fading to 0; the board underneath already shows the post-clear state | `--dur-flash` (150 ms), `--ease-out-expo`; **never delays input** | static band at reduced `--flash-alpha` (0.35) for 150 ms, no fade |
| Garbage inserted | Board nudges up by `min(--nudge-max, rows × --nudge-per-row)`, then settles | out `--dur-nudge-out`, back `--dur-nudge-back`, both `--ease-out-quart` | no movement; the meter emptying and the rows appearing are the cue |
| Combo starts (reaches ×2) | Banner wipes in left to right (clip-path) while sliding `--banner-slide` | `--dur-banner-in`, `--ease-out-expo` | opacity 0→1 over `--dur-reduced` |
| Combo grows | Only the "×N" numeral swaps (new value rises 40% into place) | `--dur-swap`, `--ease-out-expo` | instant swap |
| Combo breaks | Holds `--dur-banner-hold` showing the final count, then wipes out to the right | `--dur-banner-out`, `--ease-out-quart` | holds, then opacity out over `--dur-reduced` |
| Speed level up | Speed number swaps (rises into place) | `--dur-speed-swap`, `--ease-out-expo` | instant swap |
| Standoff countdown | see Standoff countdown below | `--standoff-total` (3000 ms) | see below |
| Garbage sent | Projectile flight, see below | `--dur-projectile` (350 ms), `--ease-in-quad` | see below |
| Garbage cancelled | Meter burst, see below | `--dur-burst`, `--ease-out-expo` | see below |
| Danger | Ring pulse, see below | `--dur-danger-period` loop, `--ease-in-out-sine` | steady red frame |
| Round ends | Losing board dims to 50% over `--dur-result-delay`; then the art fades in (`--dur-art-in`) and the card rises `--card-rise` while fading in | card `--dur-card-in`, `--ease-out-expo`, starting 120 ms after the art | opacity only over `--dur-reduced`, no rise, no dim animation |
| Copy link | Label swaps to "Copied!" | holds `--dur-copied`, then swaps back | same (text only) |

`tokens.css` carries the reduced-motion overrides under `prefers-reduced-motion: reduce`; the
canvas reads `matchMedia` once and on change, and uses the reduced values in `tokens.ts`.

### Buttons
- **Primary** (one per view): `--color-accent` fill, `--color-ink` label in `--text-title-md`
  uppercase, height 48 px, `--radius-control`. Hover: the fill stays amber and gains a 1 px inset
  `--color-ink-soft` ring (no new colour). Active: press motion. Focus: ring. Disabled:
  `--color-panel` fill, `--color-text-muted` label, `cursor: not-allowed`. Loading: label becomes
  "Creating…" or "Joining…", the button keeps its width (min-width set from the idle label) and is
  `aria-disabled` with `aria-busy`.
- **Secondary**: transparent, 1 px `--color-line` border, `--color-text`, `--text-ui`, 44 px. Hover:
  `--color-panel` fill. Disabled: `--color-text-muted`, border unchanged.
- **HUD button** (Music, Leave): `--surface-chip`, 1 px `--color-line`, `--text-meta`, height
  `--hit-hud`. Hover: `--color-panel`, border `--color-text-muted`.
- **Destructive** (Leave series): transparent, 1 px `--color-alert` border and label; hover
  `--color-panel` fill.

### Inputs
- `--color-well` fill, 1 px `--color-text-muted` border (passes the 3:1 boundary rule over the
  plate), `--radius-control`, `--text-body`, 44 px tall, `caret-color: var(--color-accent)`.
  Placeholder `--color-text-muted`. Hover: border `--color-text`. Focus: ring and border
  `--color-accent`. Error: border `--color-alert`, `aria-invalid="true"`, and the message linked by
  `aria-describedby`. Disabled (while submitting): text `--color-text-muted`.
- **Name**: label "Your name", `maxlength="16"`, `autocomplete="nickname"`, trimmed on submit.
- **Code**: label "Room code" (visually the "or join a friend" divider plus a visible label),
  `--text-title-md` Display 800 with `--tracking-code-input`, uppercase as you type, accepts lowercase,
  strips spaces and hyphens, `maxlength="6"`, `autocapitalize="characters"`, `spellcheck="false"`,
  `inputmode="text"`.

### Home
- Default: name field, **CREATE GAME** (primary), the divider "or join a friend", then code field
  plus **Join** (secondary) on one row.
- `/g/:code`: the code is pre-filled and **focus goes to the name field**. The hierarchy flips:
  **JOIN GAME** becomes the primary button directly under the name, and "Create a new game instead"
  becomes secondary.
- Enter: in the name field it triggers the screen's primary button (Create on `/`, Join on
  `/g/:code`); in the code field it triggers Join.
- Loading: the pressed button shows "Creating…" or "Joining…"; the other controls are disabled.
- Errors appear inline under the control they concern, in `--text-small` `--color-alert`, with
  `role="alert"`. The user's input is kept. Copy is in the error catalogue below.

### Lobby
- Plate content, top to bottom: label "Room code"; the code in `--text-display-lg` Display 800,
  `--tracking-room-code`, selectable; the share link in `--text-table` `--color-text-muted`;
  **COPY LINK** (primary); a divider; the series line ("Best of 3 · first to 2 rounds" before round
  1, otherwise the series bug, e.g. "Round 2 · Ariel 1 – 0 Sam"); the player list; the status text
  "Waiting for opponent…"; the spectator count ("1 watching", hidden at 0); a footer with Music
  (HUD button) on the left and Leave (secondary) on the right.
- Player list: two rows, seat A then seat B. Name in `--text-title-sm`, "(you)" in label style.
  The empty seat shows "Waiting for opponent…" in `--color-text-muted` with a 6 px amber dot that
  fades between 1 and 0.35 opacity every 1.6 s (reduced motion: steady dot). A disconnected player
  shows "reconnecting" in `--color-text-muted`.
- Copy link: success swaps the label to "Copied!" for `--dur-copied` and announces "Link copied"
  through a polite live region. Failure: "Couldn't copy. Select the link above and copy it." The
  link text gets focus and is selected.
- Loading: "Connecting to room K7QM4X…" (or "Rejoining K7QM4X…" after a refresh) replaces the player
  list. Text only, no spinner.
- Leave: goes home immediately before a series starts. Once a round has been played it uses the
  Leave confirm, because leaving forfeits the series.

### Game HUD
- **Top bar** (40 px): logo wordmark (`logo.webp` at 160 px wide, `alt="Stackerist"`); "ROOM" label
  plus code in `--text-title-xs`; then, right-aligned with 12 px gaps: spectators ("2 watching",
  `--text-meta` `--color-text-muted`, hidden at 0), ping, Music, Leave.
- **Ping**: 8 px dot plus "38 ms" (`--text-meta`, tabular, min-width 6ch). Thresholds come from
  `pingQuality()` in `tokens.ts`: **good** under 80 ms (`--color-ok`), **fair** 80–149 ms
  (`--color-accent`), **poor** 150 ms or more (`--color-alert`; prediction is only guaranteed up to
  150 ms, REQ-069). Before the first measurement: a hollow 1.5 px `--color-text-muted` ring and
  "— ms". The number always accompanies the dot, so colour is never the only cue. The accessible
  name is, for example, "Connection good, 38 milliseconds".
- **Name plates** (32 px row): own name `--text-title-lg` plus "YOU" label; opponent name
  `--text-title-sm` plus "OPPONENT" label. Names truncate with an ellipsis (`min-width: 0`) and the
  full name goes in `title`. **Series pips** follow each name: two squares (10 px own, 8 px
  opponent, 4 px gap). A won round is filled `--color-accent`; a round still to win is a 1 px
  `--color-text-muted` outline. The accessible name is, for example, "Ariel, 1 round won".
  **Round tag**, centred in the plate row above the VS column: "ROUND 2" in label style; a replayed
  draw adds a second line "REPLAY" in `--color-accent`.
- **Garbage meter**: a track (`--color-panel`, `--meter-width` own and `--meter-width-opp` opponent,
  `--radius-meter`) beside each board, as tall as the board's inner height. The fill
  (`--color-alert`) grows from the bottom, **one segment per pending row, each segment exactly one
  board cell tall**, separated by 1 px `--color-grid` lines. You read the number of rows that will
  push your stack up by comparing it with the board. Capped at 20 rows. Empty: track only.
- **NEXT queue**: label "Next", 5 minis (own) or 1 mini (opponent) at `cellNext`, drawn with the
  block style on transparent. The first mini is the next piece.
- **Stats**: Lines, Sent, Pieces. Label style, value in `--text-title-lg` (own) or `--text-title-sm`
  (opponent). Compact below 16 px cells.
- **VS column**: VS (`--text-display-md`, amber, skewed); "Speed" label plus number
  (`--text-display-sm` 800, shows engine level + 1, so 1 to 13); match clock (`--text-display-sm`
  800 amber on `--color-clock-bg` with a 1 px `--color-line` border, mm:ss derived from ticks,
  tabular).
- **Legend**: key caps (`--surface-chip`, 1 px `--color-line`, `--radius-control`, `--text-meta`
  `--color-text`) with action text in `--color-text-muted`. Shown: ← → move · ↑ X rotate · Z Ctrl
  rotate back (macOS: Z only) · ↓ soft drop · Space hard drop · M music · Esc leave. One line, never
  wraps; below 1100 px viewport width the M and Esc items hide (their controls are in the top bar).
- **Ghost piece**: a `--ghost-width` inset outline in the piece colour at `--ghost-alpha`, no fill.
- **Focus during play**: the game surface (`tabindex="-1"`, `aria-label="Your board"`) holds focus.
  While a round is live, game keys (arrows, Space, X, Z, Ctrl) always go to the game, even when Tab
  has moved focus onto Music or Leave; those buttons then activate with Enter or a click. Space can
  never trigger a HUD button mid-round.
- **Leave + confirm**: Leave (or Esc) opens a popover under the button: `--color-panel`,
  `--shadow-popover`, focus trapped. Copy: "Leave the series? Sam wins the series." Buttons:
  **Keep playing** (secondary, focused by default) and **Leave series** (destructive). Esc or Keep
  playing closes it and returns focus to the board. The match keeps running while it is open.
  Spectators get "Stop watching" with no confirm.

### Music control
- **Place:** the game top bar's right cluster, between ping and Leave. The lobby footer has the same
  control, so players can mute before the first DUEL!.
- **Anatomy:** HUD button with an authored 16 px SVG icon (1.75 px stroke, round caps,
  `currentColor`: a speaker with two waves for on, a speaker with an × for off), the label "Music",
  and a "M" key cap. Element: `<button aria-pressed>` with the constant accessible name "Music".
- **States:** **On** (the default): waves icon, `--color-text`, `aria-pressed="true"`. **Off**:
  × icon, label `--color-text-muted`, `aria-pressed="false"`. **Blocked** (music is on but the
  browser has not allowed audio yet): waves icon with a 6 px `--color-accent` dot badge, and
  `aria-describedby` hint text "Press M or click to start the music." The next click or M starts it.
  **Unavailable** (no Web Audio): `aria-disabled="true"`, `--color-text-muted`, hint "Music isn't
  supported in this browser." Hover, focus and active as for the HUD button.
- **M key:** toggles on game, lobby and result screens, ignores `event.repeat`, and never fires
  while focus is in a text input. A key toggle announces "Music on" or "Music off" in a polite live
  region; a button toggle needs no announcement, because `aria-pressed` reports it.
- **Persistence:** `localStorage` key `stackerist:music` = `on` or `off`, default `on`. This is a
  device preference, not player data. To satisfy autoplay rules, the frontend unlocks the audio
  context on the Create, Join or Next round click. Music starts at DUEL! and stops when the round
  ends.

### Combo banner
- Shown on a board while that player's combo is ×2 or more (REQ-052), on both boards and for
  spectators. Own board: `--color-accent` fill, "COMBO ×N" in `--text-display-sm` `--color-ink`,
  padding per the frontmatter, skewed `--skew-onair`, `--shadow-onair`, hanging 14 px past the
  board's left edge at 25% of the board's height, at `--z-board-fx`. Sub-line in `--text-label`
  `--weight-body-strong` `--color-ink-soft`: the chain's running totals "+3 SENT · 1 CANCELLED"
  (each part only when above 0), summed from the attack and cancel events since the chain started.
  Opponent board: `--text-title-sm`, no sub-line. No live-region announcements (too frequent).

### Standoff countdown (REQ-086)
- **Trigger:** `countdown` (round start) or `resumed` (after a pause). Timeline T = 0 at
  `startsAt − 3000 ms` on the estimated server clock. **The numerals and DUEL! are driven by the
  same clock check that enables input, never by animation callbacks or timers.** The frame that
  enables input is the frame that paints DUEL!; key presses before that frame are not sent.
- **Layout** (arena only; the top bar stays visible): `--scrim-dim` over the arena and boards. Two
  standoff plates centred at 38% of the arena height, 24 px apart, with VS between them
  (`--text-display-md`, amber). Own plate on the left: `--color-accent` fill, name in
  `--text-display-md` `--color-ink`, series pips in ink. Opponent plate on the right: `--color-text`
  fill, `--color-ink` name. For spectators, seat A is on the left. Both plates are skewed
  `--skew-onair` with `--shadow-onair` and a max width of 40% of the arena (ellipsis). Above them,
  the round tag "ROUND 2" (or "ROUND 2 · REPLAY") in label style. The numeral sits at 62% of the
  arena height in `--text-display-xl` amber.
- **Motion:** T 0: the dim fades in over `--dur-dim`, and the plates slide in from
  ±`--standoff-offset` with opacity 0→1 over `--dur-standoff-in` (`--ease-out-expo`). Numeral "3"
  at T 0, "2" at T 1000, "1" at T 2000: each enters from `--numeral-scale-from` to 1 with opacity
  over `--dur-numeral-in` (`--ease-out-expo`), and leaves with opacity over `--dur-numeral-out`
  starting 120 ms before the next. At **T 3000 (input live)**: **DUEL!** slams in as an amber
  on-air banner (`--text-display-xl` `--color-ink` on `--color-accent`, skewed, `--shadow-onair`),
  scaling from `--duel-scale-from` to 1 with opacity over `--dur-duel-slam` (`--ease-out-expo`). In
  the same frame the dim and the plates fade out over `--dur-dim`. DUEL! holds `--dur-duel-hold`,
  then fades over `--dur-duel-out`, with `pointer-events: none` so it never blocks a key. The
  countdown is 3000 ms; DUEL! lingers 740 ms into live play over the empty boards.
- **Resume** uses the same sequence with the plates static (no slide).
- **Reduced motion:** the dim appears without travel (opacity over `--dur-reduced`); plates are
  static; numerals swap without scale; DUEL! appears at T 3000 without scale, holds 500 ms and fades
  over `--dur-reduced`.
- **Live region:** one polite `role="status"`: "Round 1. Ariel versus Sam.", then "3", "2", "1",
  "Duel!". The visual numerals are `aria-hidden`.

### Garbage projectile and cancel burst (REQ-087)
- **Source of truth:** attack and cancel events in server snapshots only. Visual only; the meters
  follow snapshot truth.
- **Projectile:** spawned when a snapshot reports a sent attack (the leftover after cancelling;
  none when 0). An amber square of edge `projectileSizePx(rows)` = min(`--projectile-max`,
  `--projectile-base` + rows × `--projectile-per-row`), i.e. 12 px for 1 row and 24 px for 4 rows,
  filled `--projectile-color` with the block bevel, skewed `--skew-onair`. No trail, no glow. It
  flies from the sender board (centre x, y of the topmost cleared row, or the board's middle if
  unknown) to the receiver's meter at its current fill top, along a quadratic curve whose control
  point is lifted by `--projectile-arc` × distance, over `--dur-projectile` with `--ease-in-quad`
  (accelerating into the hit). Drawn on the arena effects canvas at `--z-projectiles`. On landing,
  the receiver's meter fill grows to the new value over `--dur-meter-grow`. If a later snapshot
  changes the meter first, the meter jumps to the truth and the projectile still lands. At most 4
  projectiles in flight per direction; extra ones are skipped visually, and the meter still updates.
- **Cancel burst:** when a player's attack cancels their own pending rows, the top N segments of
  their meter break into two fragments each (meter width × half a cell), coloured `--burst-color`
  (your attack destroyed them). The fragments travel ±`--burst-distance` sideways and 8 px up,
  rotate up to 30° and fade out over `--dur-burst` (`--ease-out-expo`). The meter shrinks
  immediately.
- **Reduced motion:** no flight. The receiver's meter updates at once and its new top segments get a
  2 px `--color-accent` outline for `--dur-flash`. For the burst, the removed segments fade out in
  place over `--dur-reduced` with no travel.

### Danger pulse (REQ-088)
- **Condition:** stack height (rows from the floor to the highest filled cell) + pending garbage ≥
  `--danger-rows` (16). Evaluated on every displayed state for both boards (own from the displayed
  board, opponent from snapshots) and shown to spectators.
- **Look:** the board frame turns `--color-alert` (steady), and a `--danger-ring-width` ring just
  outside the frame (outline, no layout shift) pulses its alpha between 1 and
  `--danger-ring-min-alpha` on a `--dur-danger-period` cycle with `--ease-in-out-sine`, alternating.
  About 1.1 Hz and confined to the frame, so it is far below the three-flashes-per-second limit.
- **Exit:** the frame returns to `--color-line` over `--dur-swap` and the ring stops.
- **Reduced motion:** `--danger-ring-min-alpha` becomes 1, giving a steady 4 px red frame.

### Overlays
- **Opponent disconnected** (REQ-031): arena-only `--scrim-dim`. Title "SAM DISCONNECTED"
  (`--text-display-sm`); a live seconds timer in `--text-display-md` amber ("17 s"), tabular, from
  `graceEndsAt` with server-clock correction; the line "Waiting for Sam to reconnect. If they
  don't, you win the series." (`--text-small`); and "Sam has 2 pauses left this series."
  (`--text-table` `--color-text-muted`). Live region (polite): announces on entry ("Sam
  disconnected. Waiting 20 seconds."), then at 10 s and at 5 s; the per-second digits are
  `aria-hidden`.
- **Your connection lost** (in a match): the same overlay. Title "CONNECTION LOST", line
  "Reconnecting… Your seat is held for 20 seconds." Then the resume countdown.
- **Result: round card** (REQ-050/051/059/083/091): full viewport at `--z-result`. Win: `win.webp`
  cover. Lose and draw: the arena under `--scrim-game`. Card: `--surface-card`, a 4 px top rule
  (`--color-accent` on a win, `--color-line` on lose or draw), square. Header: the label "Round 1 ·
  Final" (`--tracking-final`) and, for a replay, "Round 2 · Replay · Final"; the headline YOU WIN
  (amber), YOU LOSE or DRAW (`--color-text`), skewed, with the on-air text shadow; spectators see
  "ARIEL WINS". Reason line in `--text-small`: "Sam topped out at 04:51" · "You topped out at
  04:51" · "You both topped out at 03:10. Round 2 will be replayed." · "Sam left the series" ·
  "Sam didn't reconnect in time". The series bug sits on the right: label "Series", then names in
  `--text-title-sm` with the score in `--text-display-sm` ("ARIEL 1 – 0 SAM"; seat A on the left).
- **Report table** (left panel): columns "You" and "{opponent}" (spectators: both names). Rows:
  Lines · Garbage sent · Garbage received · Garbage cancelled · Best combo (×N) · Pieces per second
  (2 decimals) · Actions per minute (integer). PPS = `piecesPlaced / (durationTicks / 60)`, APM =
  `actions × 60 / (durationTicks / 60)`; under one second of play these show "—". Labels in
  `--text-table` `--color-text-muted`, values in `--text-title-sm`, tabular, right-aligned.
- **Stack-height chart** (centre panel; see Report chart).
- **Best moment** (right panel, REQ-051): label "Your best moment"; title banner (amber, skewed,
  `--shadow-onair-sm`): "COMBO ×N" when the combo is 2 or more, otherwise the clear name in
  uppercase ("SINGLE", "DOUBLE", "TRIPLE", "QUAD"). Then the mini board at the best-moment cell,
  using the block style, with cleared rows outlined 1 px in `--bm-clear-outline` and the finishing
  piece outlined 2 px in `--bm-finisher-outline` (inset). Caption (`--text-table`,
  `--tracking-caption`): "Triple · +5 sent · 1 cancelled · 04:12" (cancelled only when above 0).
  **Empty:** `bestMoment` is null, so the panel is hidden and the grid collapses to two panels.
  Spectators see both players' best moments.
- **Actions row:** status text on the left (`--text-small`, polite live region); **NEXT ROUND**
  (primary) and **Back to home** (secondary) on the right. States: idle; pressed, so the button is
  disabled and the status reads "Waiting for opponent to accept…"; opponent pressed first, so the
  status reads "Sam is ready for the next round" and the button stays enabled; opponent left, so
  the view switches to the series card (leaving forfeits the series). Spectators get Back to home
  only, with the status "Waiting for the next round".
- **Focus and guard:** after the entrance, focus moves to the card heading (`tabindex="-1"`), never
  to a button, and buttons ignore activation for the first 500 ms, so a hard-drop Space hammered at
  top-out cannot press Next round. The heading is in an `aria-live="assertive"` region that reads,
  for example, "Round 1 final. You win. Sam topped out at 04:51. Series: Ariel 1, Sam 0."
- **Result: series card** (REQ-084): the same skeleton and entrance. Label "Series final"; headline
  "ARIEL WINS THE SERIES 2–1" in `--text-display-md`, amber, skewed, up to 2 lines with
  `text-wrap: balance`. Reason line: "You won 2 rounds to 1." · "Sam won 2 rounds to 1." · "Sam left,
  so the series is yours." · "Sam didn't reconnect in time, so the series is yours." On the right:
  the final score in `--text-display-md` plus the **round chips**, one per played round including
  replays: square chips, 1 px `--color-line`, `--color-bg` fill, "R1" in label style followed by the
  winner's name in `--text-title-xs`. A replay chip reads "R2 · Draw, replayed" in
  `--color-text-muted`. The body is the deciding round's report (table, chart, best moment). If a
  forfeit ended the series mid-round and no report arrived, the body is hidden. Actions: **NEW
  SERIES** (primary) and Back to home. States: "Waiting for opponent to accept…" · "Sam wants a new
  series" · **"Opponent left"** with New series disabled. Win art for the series winner and for
  spectators; the scrimmed arena for the loser.

### Report chart (REQ-091)
Method: the `dataviz` skill is **not installed on this machine** (no `dataviz` SKILL.md,
`validate_palette.js` or `palette.md` under `~/.claude`). This spec applies the method recorded from
that skill in `~/.claude/vault/learnings.md`: validate the palette numerically (lightness,
colour-vision separation, contrast); keep status colours out of the series; never rely on colour
alone; build hand-rolled SVG with `role="img"`, a title and description, and a table fallback.
- **Form:** a line chart, 2 series, inline SVG `viewBox="0 0 300 180"` at `--chart-width` ×
  `--chart-height`. Plot margins: left 24, right 8, top 8, bottom 20 px.
- **Marks:** one polyline per player from `heightSamples` (one sample per 30 ticks, 0.5 s),
  `--chart-line-width`, round joins and caps, `vector-effect: non-scaling-stroke`. Each line ends
  in a 5 px square (the block motif). Your line is drawn last, on top.
- **Colours:** `--chart-you` (amber) for you, `--chart-opp` (cream) for the opponent; spectators get
  seat A amber and seat B cream. Measured: amber vs cream vs the danger red ΔE00 ≥ 11.98 under
  normal, protan, deutan and tritan vision. Contrast against the card is 9.29 and 13.19 (≥ 3:1).
  Ping green is never a series colour.
- **Axes:** y is fixed at 0–20 rows (never auto-scaled, so rounds compare), with labels 0, 10 and 20
  in `--text-label` size `--chart-label`, tabular. Grid lines at 5, 10, 15 and 20 in `--chart-grid`;
  the baseline in `--color-line`. **Danger rule** at 16 rows: 1 px `--chart-danger`, dashed 4/3,
  labelled "16" in `--chart-danger` at the axis, matching the danger pulse threshold. x runs from
  0 to the round's playing time (pauses excluded): "0:00" at the start, the final time at the end,
  and whole minutes between when at least 48 px apart.
- **Legend:** one row above the plot (`--text-meta`): a 16×2 px swatch plus "You", the same for
  "Sam", and a dashed swatch plus "Danger". Names plus line order identify the series, not colour
  alone.
- **Accessibility:** `role="img"` with `aria-labelledby` pointing to the `<title>` ("Stack height
  over round 1") and the `<desc>` ("Ariel peaked at 12 rows at 3:40. Sam peaked at 20 rows at 4:51
  and topped out."). A visually hidden table follows, with columns Player · Peak height · At ·
  Average height.
- **Empty:** fewer than 2 samples, so the axes are drawn and "Round too short to chart" sits centred
  in `--text-table` `--color-text-muted`.

### Keyboard-needed warning (REQ-058)
- Shown before a touch-only device takes a seat: no fine pointer and no hover, until the first
  physical `keydown`, which counts as proof of a keyboard and continues the action.
- Replaces the plate content. Title "Stackerist needs a keyboard" (`--text-display-sm`); body
  (`--text-body`, `--measure-prose`): "Each player uses a keyboard: arrow keys, X, Z and Space.
  Connect a keyboard and press any key to continue." On Join: **WATCH INSTEAD** (primary, joins as
  a spectator) and Back (secondary). On Create there is nothing to watch, so only Back. Focus moves
  to the title (`tabindex="-1"`); the container is `role="status"`.

### Error catalogue (problem + recovery)
| Situation | Where | Copy |
|---|---|---|
| Name empty | under name | "Enter your name (1–16 characters) to play." |
| Code not 6 valid characters | under code | "Room codes have 6 letters and numbers. Check the code and try again." |
| Room not found | under code row | "There's no game with code K7QM4X. Check the code with your friend, or create a new game." |
| Room full (no spectating available) | under code row | "That game already has two players. Ask for a new code, or create your own game." |
| Joined a full room as a spectator | lobby or game | "That game already has two players, so you're watching." |
| Server busy (500-room cap) | home plate | "Stackerist is full right now. Try again in a few minutes." plus **Try again** |
| Rate-limited, joins | home plate | "Too many wrong codes in a minute. Wait a minute, then try again." |
| Rate-limited, creates | home plate | "You've created a lot of games in a minute. Wait a minute, then create one." |
| Disconnected, `RATE_LIMITED` (inputs) | full-screen plate | "You were disconnected for sending inputs too fast. Go back to home to play again." plus Back to home |
| Connection lost (home, lobby, result) | top banner at `--z-banner` | "Connection lost. Reconnecting…", then after 3 failed tries "Can't reach Stackerist. Check your internet connection, then try again." plus Try again and Back to home |
| Seat expired / room gone on rejoin | home plate | "That game has ended or your seat expired. Create a new game or join with a new code." |
| Seat taken by another tab (`REPLACED`) | full-screen plate | "This seat is now open in another tab. Close this tab, or reload to play here." |
| Clipboard failed | lobby | "Couldn't copy. Select the link above and copy it." |

Protocol errors that only a bug or a cheat can cause (`BAD_MESSAGE`, `BAD_TICK`, `NOT_PLAYING`,
`NOT_A_PLAYER`) are logged, never shown. The room-not-found code name is set by the protocol
package.

### Accessibility contract
- **Contrast:** see the computed table under Colors (minimums: text 4.59, large 9.29, UI 3.76; one
  documented exception, G fill).
- **Focus rings:** `--focus-ring-color`, `--focus-ring-width`, `--focus-ring-offset` on every
  focusable element via `:focus-visible`. Never removed.
- **Keyboard-only menus:** focus order. Home: name → primary → code → Join (on `/g/:code`: name →
  Join game → code → Create a new game instead). Lobby: Copy link → Music → Leave. Game: board
  surface → Music → Leave (Esc opens Leave). Result: heading → primary → Back to home. Leave
  confirm: focus trapped, Keep playing first, Esc closes. No positive `tabindex`.
- **Live regions:** countdown (polite, 4 updates), disconnect (polite, at entry, 10 s and 5 s),
  result headline (assertive, once), action status ("Waiting for opponent to accept…", polite),
  Copied ("Link copied", polite), music key toggle (polite), errors (`role="alert"`).
- **Labels:** the code field has a visible "Room code" label; Copy link's accessible name is "Copy
  invite link" with the visible label "Copy link"; the share link text is a real, selectable link;
  the room code in the lobby is readable text (not an image); meters have `role="img"` with names
  like "Incoming garbage: 4 rows"; the logo image has `alt="Stackerist"`.
- **Reduced motion:** every moment in the motion table has its alternative; nothing is just
  switched off without a cue.
- **Hit targets:** 44 px on home, lobby and result; 32 px in the HUD.
- **Browser surfaces:** `::selection` uses `--color-accent` background with `--color-ink` text;
  `caret-color: var(--color-accent)`; `color-scheme: dark`; scrollbars (lobby list only, if it ever
  overflows) use `scrollbar-color: var(--color-line) var(--color-bg)`; link underline offset 3 px.

## Do's and Don'ts

### Do:
- **Do** take every colour, size, space, radius, shadow, z-index and duration from `tokens.css`
  (DOM) or `tokens.ts` (canvas). If a value is missing, add it to both.
- **Do** keep text on a plate, card, chip or the game scrim (The Plate Rule).
- **Do** drive the countdown, DUEL! and input from the same server-clock estimate.
- **Do** use the slant (`--skew-onair`) and the hard on-air shadow only on broadcast graphics.
- **Do** use the art from `design/assets/` (`logo.webp`, `backdrop.webp`, `win.webp`), never the
  1.2–1.6 MB concept PNGs.
- **Do** call a four-line clear a "Quad".

### Don't:
- **Don't** use the classic falling-block colours (cyan I, yellow O, purple T, green S, red Z, blue
  J, orange L), glossy bevels, neon glows, purple or violet gradients, cyan-on-dark, or
  glassmorphism blur (all anti-references in `PRODUCT.md`).
- **Don't** use Inter, Roboto, Arial, Helvetica, Segoe UI or San Francisco as a visible face, or
  synthesize italic or bold.
- **Don't** add gradients beyond the two approved ones: the home scrim's darkening and the garbage
  hatch.
- **Don't** use bounce, elastic or overshooting easings, or animate layout properties.
- **Don't** let any animation delay, gate or swallow a game key.
- **Don't** move focus onto a button while a round is live or right as it ends.
- **Don't** convey state by colour alone: the ping has its number, pips are filled or outlined, the
  chart has a legend, and danger also shows in the stack.
- **Don't** use the word "Tetris" or any other famous game's name, logo or sounds.

## Assets

| File | Size | Notes |
|---|---|---|
| `design/assets/logo.webp` | 1469×301, 56,848 B | Transparent background. The flat `#140F0D` background was keyed out: flood fill from the border (distance ≤ 16), with the edge band un-mixed against the amber stroke `(246,181,3)`. Fringe check: 0 dark pixels in the edge band over white; checked at 8× zoom over white and magenta. Lossless WebP. |
| `design/assets/backdrop.webp` | 1536×1024, 67,924 B | Arena. Native width (not upscaled), WebP q90. |
| `design/assets/win.webp` | 1536×1024, 112,052 B | Win burst, WebP q90. |

Display: the home logo at `min(620px, 92vw)` (1240 device px at 2×, under the asset's 1469); the
HUD wordmark at 160 px. Backdrop and win art as `background-size: cover`; the backdrop at
`center 30%`.

## Verification

**Token parity check** (run from the repo root; Node 24 strips the types from `tokens.ts`). It
confirms that every custom property named in this file exists in `tokens.css`, and that every value
`tokens.ts` mirrors (`CSS_VARS`, `CSS_VARS_REDUCED_MOTION`) equals the `tokens.css` value, with
`var()` resolved:
```sh
node -e "import fs from 'node:fs';const css=fs.readFileSync('design/tokens/tokens.css','utf8');const [base,red]=css.split('@media');const vars=b=>Object.fromEntries([...b.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));const B=vars(base),R=vars(red);const res=v=>{const m=/^var\((--[\w-]+)\)$/.exec(v);return m?res(B[m[1]]):v};const md=fs.readFileSync('DESIGN.md','utf8');const refs=[...new Set(md.match(/--[a-zA-Z][\w-]*/g))];const missing=refs.filter(r=>!(r in B));const t=await import('./design/tokens/tokens.ts');const diff=(map,src)=>Object.entries(map).filter(([k,v])=>!(k in src)||res(src[k]).toLowerCase()!==String(v).toLowerCase()).map(([k,v])=>k+' ts='+v+' css='+src[k]);const d1=diff(t.CSS_VARS,B),d2=diff(t.CSS_VARS_REDUCED_MOTION,R);console.log('DESIGN.md token refs:',refs.length,'missing in tokens.css:',missing.length?missing.join(','):'none');console.log('tokens.ts CSS_VARS:',Object.keys(t.CSS_VARS).length,'mismatches:',d1.length?d1.join('; '):'none');console.log('reduced-motion overrides:',Object.keys(t.CSS_VARS_REDUCED_MOTION).length,'mismatches:',d2.length?d2.join('; '):'none');process.exit(missing.length||d1.length||d2.length?1:0)"
```
The contrast, colour-vision and asset scripts were one-off tools in the session scratchpad and are
not shipped. Their outputs are recorded above. Not written: the `.impeccable/design.json` sidecar,
which is outside this contract's paths. Motion and shadow tokens live in `tokens.css` instead.
