# Product

<!-- impeccable:product-schema 1 -->

Source of truth for every fact below: `docs/superpowers/specs/2026-11-07-stackerist-design.md`
(the "design doc", decisions confirmed by Ariel on 2026-11-07). Nothing here is invented; where the
design doc leaves something open, it is marked **open**.

## Platform

web

## Stack

Decided in the design doc and source spec (`spec (1).md` §2): TypeScript (strict), pnpm workspaces,
Vite + React for the UI shell (home, lobby, overlays), HTML `<canvas>` for the boards, Fastify +
WebSocket server, deployed on Railway (Singapore). Fonts self-hosted with `@fontsource`.

## Users

- **Ariel**, the parent: plays on a desktop, is the first tester, and judges whether it is good.
- **Ariel's daughter**, on her laptop; laptops run at 125–150% display scaling, which leaves a
  viewport of about 1280×600 CSS px once the browser's toolbars are counted.
- **Her friends**, playing from other homes on their own desktops or laptops.
- **Spectators**: anyone with the room link plus `?watch=1`, or a third person joining a full room.
  They watch both boards read-only.
- **Phones and tablets** are for opening a share link, the lobby and watching, never for playing:
  touch controls are out of scope.

The job: get two people into a head-to-head match within seconds of sharing a code, and make the
match tense, fair and fun enough that they press **Next round** and then **New series**.

## Product Purpose

Stackerist is a head-to-head online falling-block game. Two players each have a board, race to
clear lines and attack each other with garbage rows; last one standing wins the round, and the first
to win 2 rounds wins a **best-of-3 series**.

Success, in Ariel's words, is "very competitive and fun": the match gets tense when the pieces fall
faster and combos stack up. Two engines create that tension: a shared speed level that rises every
30 s, and combos whose attacks first cancel your own incoming garbage. A round ends like a broadcast
"final score": the result, both players' stats, a post-match report and each player's own best
combo moment.

## Positioning

A private duel broadcast for people who know each other. It has no accounts, no matchmaking and no
database, and nothing about a player outlives the room. Every round is staged like a live sports
broadcast: a standoff countdown, attacks you can see flying, a red danger frame when a stack nears
the top, and a final-score card with a report. It is cheat-resistant: the server is the only source
of truth.

## Operating Context

- Played at home on desktop and laptop keyboards; today on one Wi-Fi network, but it must work
  between different homes (proven with one player on a phone hotspot).
- Rooms are shared as a 6-character code or a `/g/<CODE>` link, usually over a messaging app.
- Rounds run 1–6 minutes (top speed after about 6 minutes forces an end). A series lasts 2–3 rounds;
  a drawn round is replayed.
- Keyboard only: ← → move, ↑ or X rotate, Z (or Ctrl, not on macOS) rotate back, ↓ soft drop,
  Space hard drop, M music.

## Capabilities and Constraints

- Requirements REQ-001 to REQ-092 in the design doc §9 are binding. The UI-facing ones:
  REQ-047 to REQ-062 (screens, overlays, best moment, combo callout, controls, prediction, 1280×600
  fit, Prime Time look, touch warning, Next round / New series, preview, ghost, spectators) and
  REQ-083 to REQ-091 (series, standoff countdown, garbage projectile, danger pulse, music, report).
- **Laptop fit:** the whole game screen fits 1280×600 CSS px with no scrolling, and scales down below
  that without breaking.
- **Phones:** home and lobby work at 390 px wide with no horizontal scroll; a touch-only device is
  warned before taking a seat and offered **Watch**. Any physical key press proves a keyboard.
- **Kids' data:** no accounts, no database. Names (1–16 characters, rendered as text only) live only
  in the room. The one thing stored in the browser is the music on/off preference (REQ-089), which
  holds no personal data.
- **Out of scope** (future work): accounts, matchmaking, persistence, hold piece, T-spin and
  back-to-back bonuses, touch controls, handicaps, "save best moment as image", sound effects other
  than the music.
- **Terminology:** "round", "series", "combo", "garbage", "cancelled", "best moment", "speed", "Next
  round", "New series", "Back to home". A four-line clear is a **Quad**. Never use the word
  "Tetris" or any other trademarked game name anywhere in the product.
- **Open:** whether the music keeps playing on the result card (the design doc only says it starts
  at DUEL!). DESIGN.md assumes it stops when the round ends.

## Brand Commitments

- Name: **Stackerist**. Logo: the approved generated wordmark (`design/concept-art/pt-logo.png`,
  production version `design/assets/logo.webp`). Do not redraw or regenerate it.
- Look: **Prime Time**, a sports-broadcast scoreboard direction approved by Ariel ("good for the UI
  for now"). The duel is the event being broadcast.
- Voice: a broadcast caller, short and direct. Headlines and graphics are punchy uppercase
  (`YOU WIN`, `COMBO ×4`, `DUEL!`); help text, errors and controls are plain sentence case. Errors name the
  problem and the recovery and never apologize. No exclamation marks except the on-air graphics
  `DUEL!` and `Copied!`.
- Fonts: Big Shoulders Display (display) and Archivo (body), self-hosted.

### Anti-references (what Stackerist must never look like)

1. **The classic falling-block guideline look:** cyan I, yellow O, purple T, green S, red Z, blue J,
   orange L, with glossy bevels. The source spec's "standard piece colors" (`spec (1).md` §6.4) are
   recorded here as an anti-reference, replaced by the Prime Time piece set.
2. **Generic neon-on-black arcade:** glowing outlines, bloom, scanlines, synthwave grids.
3. **Purple or violet gradients**, and gradients as decoration generally.
4. **Cyan-on-dark** "tech" UI.
5. **Inter, Roboto or system-font UI** (including Arial, Helvetica, Segoe UI and San Francisco as the
   visible face).
6. **Glassmorphism:** frosted translucent panels with background blur.
7. **Candy or casual mobile-game look:** jelly buttons, bubbly rounded type, sparkles, rainbow
   rewards, bouncy easing.
8. **Borrowed trade dress** of any famous falling-block game: its name, logo, sounds or menus.

## Evidence on Hand

- Approved mockups: `design/concept-art/prime-time-art.html` (home, game, win) and
  `design/concept-art/best-moment.html` (result card with best moment).
- Approved art: `design/concept-art/pt-logo.png`, `pt-backdrop.png` (arena), `pt-win.png` (win
  burst). Optimized versions are in `design/assets/`.
- REFERENCE product for in-match HUD clarity: TETR.IO (design doc Q7). Capture status is recorded in
  DESIGN.md.
- Absent, and not to be fabricated: player testimonials, usage numbers, a soundtrack file (the music
  is synthesized in the browser), sound effects, an icon library.

## Product Principles

1. **Input is sacred.** Nothing visual ever delays, blocks or eats a game key: no animation gates
   input, and no button sits under the keys you are hammering.
2. **Readable at a glance under pressure.** Incoming garbage, combo/attack feedback, danger and the
   opponent's board must be legible in a split second at top speed on a laptop.
3. **Broadcast the duel.** Every round is an event: a standoff, visible attacks and a final score.
   Spend the drama on those moments and keep everything else quiet.
4. **Our own look.** Genre-standard mechanics, never a famous game's trade dress.
5. **Nothing kept.** No accounts and no stored player data; the room is the whole world.

## Accessibility & Inclusion

- WCAG 2.2 AA for every DOM surface: text 4.5:1, large text and UI 3:1, visible focus, full keyboard
  operation of every menu, live regions for countdown, disconnect and result.
- Players include children; copy stays short and plain.
- `prefers-reduced-motion` gets an authored alternative for every animation, never just "off".
- Piece colours must stay distinguishable under protan, deutan and tritan simulation; shapes and
  labels carry identity too, so meaning never rests on colour alone.
