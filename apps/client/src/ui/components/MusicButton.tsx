/**
 * The Music control (REQ-089 UI side; DESIGN.md "Music control"): a HUD button with an authored icon, the
 * constant name "Music" and an "M" key cap. `aria-pressed` reports the persisted preference. States: on,
 * off, blocked (on, but the browser has not allowed audio yet: a dot badge and a hint) and unavailable
 * (no Web Audio: `aria-disabled` and a hint). The M key itself is CORE's binding; this component only
 * announces a key toggle in a polite live region (a button toggle announces itself through aria-pressed).
 */
import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import type { Music, MusicPreference, MusicStatus } from '../../game/contract.ts';
import { COPY } from '../copy.ts';
import { TEST_IDS } from '../testIds.ts';
import { Button } from './common.tsx';

/** A speaker, with two waves when the music is on and an × when it is off. */
function Icon({ muted }: { readonly muted: boolean }) {
  return (
    <svg
      className="music-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 6h2.5L8 3v10L4.5 10H2z" />
      {muted ? (
        <path d="M10.5 6.5l3.5 3.5M14 6.5L10.5 10" />
      ) : (
        <>
          <path d="M10.5 6a3 3 0 0 1 0 4" />
          <path d="M12.5 4.5a5.5 5.5 0 0 1 0 7" />
        </>
      )}
    </svg>
  );
}

function preferenceOf(music: Music, status: MusicStatus): MusicPreference {
  return music.preference?.() ?? (status === 'off' ? 'off' : 'on');
}

export function MusicButton({ music }: { readonly music: Music }) {
  const subscribe = useCallback((listener: () => void) => music.subscribe(listener), [music]);
  const readStatus = () => music.status();
  const status = useSyncExternalStore(subscribe, readStatus, readStatus);
  const readPreference = () => preferenceOf(music, music.status());
  const preference = useSyncExternalStore(subscribe, readPreference, readPreference);
  const hintId = useId();
  const liveRef = useRef<HTMLParagraphElement>(null);

  // A key toggle is announced once; a click needs no announcement (aria-pressed reports it).
  const lastPreference = useRef(preference);
  useEffect(() => {
    lastPreference.current = preferenceOf(music, music.status());
    return music.subscribe(() => {
      const next = preferenceOf(music, music.status());
      const changed = next !== lastPreference.current;
      lastPreference.current = next;
      if (changed && music.lastToggleSource?.() === 'key' && liveRef.current !== null) {
        liveRef.current.textContent =
          next === 'on' ? COPY.music.announceOn : COPY.music.announceOff;
      }
    });
  }, [music]);

  const unavailable = status === 'unavailable';
  const blocked = status === 'blocked';
  const hint = unavailable ? COPY.music.unavailableHint : blocked ? COPY.music.blockedHint : null;

  const onClick = () => {
    if (unavailable) return;
    // Blocked means on but silent: the click is the gesture that starts it (toggling would mute it).
    if (blocked) music.unlock();
    else music.toggle();
  };

  return (
    <>
      <Button
        variant="hud"
        className="music-btn"
        onClick={onClick}
        aria-pressed={preference === 'on'}
        aria-disabled={unavailable ? true : undefined}
        aria-describedby={hint === null ? undefined : hintId}
        title={hint ?? undefined}
        data-state={status}
        data-testid={TEST_IDS.music.button}
      >
        <Icon muted={preference === 'off' || unavailable} />
        <span className="music-btn__label">{COPY.music.name}</span>
        {blocked ? <span className="music-btn__badge" aria-hidden="true" /> : null}
        <kbd className="music-btn__key" aria-hidden="true">
          {COPY.music.key}
        </kbd>
      </Button>
      {hint === null ? null : (
        <span id={hintId} className="sr-only" data-testid={TEST_IDS.music.hint}>
          {hint}
        </span>
      )}
      <p ref={liveRef} className="sr-only" aria-live="polite" data-testid={TEST_IDS.music.live} />
    </>
  );
}
