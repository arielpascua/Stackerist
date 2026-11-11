/**
 * Lobby (REQ-048; DESIGN.md "Lobby"): the big room code, the share link with Copy link → "Copied!",
 * the series line, the player list with the waiting seat, and Leave.
 */
import {
  otherSeat,
  type RoomCode,
  type RoomMessage,
  type Seat,
  shareUrl,
} from '@stackerist/protocol';
import { useEffect, useId, useRef, useState } from 'react';
import { motion } from '../../../../../design/tokens/tokens.ts';
import type { Music, Role } from '../../game/contract.ts';
import { Bdi, withNames } from '../components/Bdi.tsx';
import { ArenaPage, Button, Logo } from '../components/common.tsx';
import { LeaveConfirm } from '../components/LeaveConfirm.tsx';
import { MusicButton } from '../components/MusicButton.tsx';
import { COPY } from '../copy.ts';
import type { ErrorPresentation } from '../errors.ts';
import type { SeatNames } from '../result.ts';
import { TEST_IDS } from '../testIds.ts';

export interface LobbyProps {
  readonly code: RoomCode;
  readonly role: Role | null;
  readonly room: RoomMessage | null;
  readonly names: SeatNames;
  /** "Connecting to room K7QM4X…" or "Rejoining K7QM4X…" until the first `room` arrives. */
  readonly loadingText: string | null;
  readonly notice: string | null;
  readonly error: ErrorPresentation | null;
  readonly origin: string;
  readonly copyText: (text: string) => Promise<void>;
  readonly onLeave: () => void;
  readonly music: Music;
}

const SEATS: readonly Seat[] = ['A', 'B'];

export function seriesLine(room: RoomMessage, names: SeatNames): string {
  const { series } = room;
  if (series.rounds.length === 0 && series.round === 1 && !series.replay) {
    return COPY.lobby.seriesIntro;
  }
  return COPY.lobby.seriesLine(series.round, names.A, series.score.A, series.score.B, names.B);
}

type CopyState = 'idle' | 'copied' | 'failed';

export function Lobby(props: LobbyProps) {
  const { code, role, room, names } = props;
  const url = shareUrl(props.origin, code);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [confirming, setConfirming] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const ids = { link: useId(), copyError: useId() };

  useEffect(() => {
    if (copyState !== 'copied') return undefined;
    const timer = window.setTimeout(() => {
      setCopyState('idle');
      if (liveRef.current !== null) liveRef.current.textContent = '';
    }, motion.copiedMs);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const selectLink = () => {
    const link = linkRef.current;
    if (link === null) return;
    link.focus();
    window.getSelection()?.selectAllChildren(link);
  };

  const copy = () => {
    props.copyText(url).then(
      () => {
        setCopyState('copied');
        if (liveRef.current !== null) liveRef.current.textContent = COPY.lobby.linkCopied;
      },
      () => {
        setCopyState('failed');
        selectLink();
      },
    );
  };

  const seriesStarted = room !== null && (room.series.rounds.length > 0 || room.series.round > 1);
  const opponentSeat = role === 'A' || role === 'B' ? otherSeat(role) : null;
  const opponentName = opponentSeat !== null ? (room?.players[opponentSeat]?.name ?? null) : null;

  const leave = () => {
    if (role !== 'spectator' && seriesStarted && opponentName !== null) setConfirming(true);
    else props.onLeave();
  };

  const keep = () => {
    setConfirming(false);
    leaveRef.current?.focus();
  };

  return (
    <ArenaPage testId={TEST_IDS.lobby.screen} className="lobby">
      <h1 className="lobby__brand">
        <Logo className="lobby__logo" />
      </h1>
      <section className="plate plate--lobby" aria-labelledby={ids.link}>
        {props.error !== null && props.error.placement === 'plate' ? (
          <p className="plate-error" role="alert">
            {props.error.text}
          </p>
        ) : null}
        <div className="lobby__code-block">
          <p className="label" id={ids.link}>
            {COPY.lobby.codeLabel}
          </p>
          <p className="room-code" data-testid={TEST_IDS.lobby.code}>
            {code}
          </p>
          <a
            ref={linkRef}
            className="share-link"
            href={url}
            onClick={(event) => {
              event.preventDefault();
              selectLink();
            }}
            data-testid={TEST_IDS.lobby.shareLink}
          >
            {url}
          </a>
        </div>
        <Button
          variant="primary"
          className="btn--block"
          onClick={copy}
          aria-describedby={copyState === 'failed' ? ids.copyError : undefined}
          data-copied={copyState === 'copied' ? 'true' : undefined}
          data-testid={TEST_IDS.lobby.copyButton}
        >
          <span className="btn__labels">
            <span className="btn__label btn__label--idle" aria-hidden={copyState === 'copied'}>
              {COPY.lobby.copyLink}
            </span>
            <span className="btn__label btn__label--busy" aria-hidden={copyState !== 'copied'}>
              {COPY.lobby.copied}
            </span>
          </span>
        </Button>
        {copyState === 'failed' ? (
          <p
            id={ids.copyError}
            className="field-error"
            role="alert"
            data-testid={TEST_IDS.lobby.copyError}
          >
            {COPY.errors.clipboardFailed}
          </p>
        ) : null}
        <p ref={liveRef} className="sr-only" aria-live="polite" />
        <hr className="rule" />
        {props.notice !== null ? (
          <p className="notice" role="status" data-testid={TEST_IDS.lobby.notice}>
            {props.notice}
          </p>
        ) : null}
        {room === null || role === null ? (
          <p className="status-line" role="status" data-testid={TEST_IDS.lobby.loading}>
            {props.loadingText}
          </p>
        ) : (
          <>
            <p className="series-line" data-testid={TEST_IDS.lobby.seriesLine}>
              {withNames(seriesLine(room, names), [names.A, names.B])}
            </p>
            <ul
              className="players"
              aria-label={COPY.lobby.playersHeading}
              data-testid={TEST_IDS.lobby.playerList}
            >
              {SEATS.map((seat) => {
                const player = room.players[seat];
                return (
                  <li
                    key={seat}
                    className="player"
                    data-seat={seat}
                    data-testid={TEST_IDS.lobby.player}
                  >
                    {player !== undefined ? (
                      <>
                        <span className="player__name" title={player.name}>
                          <Bdi>{player.name}</Bdi>
                        </span>
                        {role === seat ? <span className="label">{COPY.lobby.you}</span> : null}
                        {!player.connected ? (
                          <span className="player__state">{COPY.lobby.reconnecting}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="player__waiting" data-testid={TEST_IDS.lobby.waiting}>
                        <span className="waiting-dot" aria-hidden="true" />
                        {COPY.lobby.waiting}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {room.spectators > 0 ? (
              <p className="meta" data-testid={TEST_IDS.lobby.spectators}>
                {COPY.game.watching(room.spectators)}
              </p>
            ) : null}
          </>
        )}
        <footer className="lobby__footer">
          <MusicButton music={props.music} />
          <div className="lobby__leave">
            <Button
              ref={leaveRef}
              variant="secondary"
              onClick={leave}
              aria-expanded={confirming ? true : undefined}
              data-testid={TEST_IDS.lobby.leaveButton}
            >
              {role === 'spectator' ? COPY.lobby.stopWatching : COPY.lobby.leave}
            </Button>
            {confirming && opponentName !== null ? (
              <LeaveConfirm opponent={opponentName} onKeep={keep} onLeave={props.onLeave} />
            ) : null}
          </div>
        </footer>
      </section>
    </ArenaPage>
  );
}
