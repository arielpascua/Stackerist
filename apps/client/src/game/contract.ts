/**
 * The CORE → UI contract (architecture §5.2). Types only: no runtime code lives here.
 *
 * CORE (net, game state, input, canvas, audio) implements these; UI receives the implementations by
 * dependency injection from `main.tsx` (`CoreServices`) and builds against fakes of these types.
 * Changing a shape here needs the orchestrator's OK (architecture rule 1).
 *
 * e2e reads canvas state through the `DATA_HOOKS` constant exported by `src/render/hooks.ts` (the single
 * source for the `data-*` attribute names: active, ghost, next, combo, danger, pending, fx, flash-count,
 * nudge-count, projectile-count). UI never reads or writes those attributes.
 *
 * Units: `*Ms` fields are client-local `performance.now()` ms unless stated; ticks are match ticks;
 * garbage counts are rows (architecture §3.2).
 */
import type { ActivePiece, Board, PieceKind } from '@stackerist/engine';
import type {
  CloseCodeName,
  RECOVERABLE_CLOSE_CODES,
  ErrorCode,
  GameOverMessage,
  LiveStats,
  RoomCode,
  RoomMessage,
  Seat,
  WireBestMoment,
} from '@stackerist/protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
/** A close code the server sends that the client recovers from on its own (4005, 1013). */
export type RecoverableCloseCode =
  (typeof RECOVERABLE_CLOSE_CODES)[keyof typeof RECOVERABLE_CLOSE_CODES];
export type Role = Seat | 'spectator';
/** Players: left = self, right = opponent. Spectators: left = A, right = B. */
export type Side = 'left' | 'right';
/** 'duel' from goAt (input live) for DESIGN.md's hold time. */
export type StandoffPhase = 'dim' | '3' | '2' | '1' | 'duel' | null;

export interface CountdownInfo {
  readonly kind: 'start' | 'resume';
  /** performance.now() at DUEL! */
  readonly goAtMs: number;
  readonly tick: number;
}
export interface PauseInfo {
  readonly seat: Seat;
  /** performance.now() */
  readonly graceEndsAtMs: number;
  readonly pausesLeft: number;
}
export interface HudSide {
  readonly seat: Seat;
  readonly name: string;
  readonly connected: boolean;
  readonly stats: LiveStats;
  /** rows */
  readonly pendingGarbage: number;
}

export interface ClientState {
  readonly connection: ConnectionStatus;
  readonly closedBy: CloseCodeName | null;
  readonly code: RoomCode | null;
  readonly role: Role | null;
  /** Latest `room`: status, players, spectators, series. */
  readonly room: RoomMessage | null;
  readonly countdown: CountdownInfo | null;
  readonly paused: PauseInfo | null;
  /** 0..12 (the HUD shows level + 1). */
  readonly level: number;
  readonly roundStartTick: number | null;
  /** Updated at snapshot rate. */
  readonly hud: { readonly left: HudSide | null; readonly right: HudSide | null };
  /** Latest round result; cleared at the next countdown. */
  readonly result: GameOverMessage | null;
  readonly ready: { readonly A: boolean; readonly B: boolean };
  readonly rttMs: number | null;
  /**
   * Why the socket is reconnecting, when the server closed it with a recoverable code (slow consumer,
   * try again later). Set on the drop; cleared when the rejoin succeeds, the retries run out or the
   * player leaves. The UI shows it only while `connection` is `reconnecting`.
   */
  readonly recoverableClose: RecoverableCloseCode | null;
  readonly error: { readonly code: ErrorCode; readonly message: string } | null;
}

export interface BoardModel {
  readonly seat: Seat;
  readonly board: Board;
  readonly active: ActivePiece | null;
  /** Own board only (REQ-061). */
  readonly ghost: ActivePiece | null;
  /** Own ≤ 5; opponent and spectator ≤ 1. */
  readonly next: readonly PieceKind[];
  /** rows */
  readonly pendingGarbage: number;
  /** Own: predicted; opponent: snapshot. */
  readonly combo: number;
  /** Totals since the chain started (snapshot events). */
  readonly chain: { readonly sent: number; readonly cancelled: number };
  /** stackHeight(board) + pendingGarbage ≥ tokens.danger.rows (REQ-088). */
  readonly danger: boolean;
  readonly toppedOut: boolean;
}
export type FxEvent =
  /** Own: predicted linesCleared. */
  | { readonly kind: 'flash'; readonly side: Side; readonly rows: readonly number[] }
  /** stats.garbageInserted went up. */
  | { readonly kind: 'nudge'; readonly side: Side; readonly rows: number }
  /** Snapshot `attack`. */
  | {
      readonly kind: 'projectile';
      readonly from: Side;
      readonly rows: number;
      readonly originRow: number | null;
    }
  /** Snapshot `cancel`. */
  | { readonly kind: 'burst'; readonly side: Side; readonly rows: number };
export interface FrameModel {
  /** The rAF timestamp this frame was computed for. */
  readonly nowMs: number;
  readonly left: BoardModel | null;
  readonly right: BoardModel | null;
  /** New since the previous frame; each emitted once. */
  readonly fx: readonly FxEvent[];
  readonly level: number;
  readonly standoff: StandoffPhase;
  /** Flips in the same frame that paints DUEL! (REQ-086). */
  readonly inputLive: boolean;
}

export interface GameStore {
  /** The same object until something changes (useSyncExternalStore contract). */
  getState(): ClientState;
  subscribe(listener: () => void): () => void;
  /** Called synchronously from CORE's rAF callback with the frame it just drew. UI drives per-frame DOM
   *  (standoff numerals and DUEL!, the combo banner) imperatively through refs here, so the DUEL! paint and
   *  the input-live flip happen in the same frame. */
  subscribeFrame(listener: (frame: FrameModel) => void): () => void;
  connect(): void;
  create(name: string): void;
  join(code: RoomCode, name: string | null, asSpectator: boolean): void;
  /** Rejoin with the stored token; false when there is none. */
  resume(code: RoomCode): boolean;
  /** Sends `leave`, clears the token, unbinds. */
  leave(): void;
  /** Sends `rematch` (Next round / New series). */
  ready(): void;
  clearError(): void;
  /** (serverTick − roundStartTick) × TICK_MS; frozen while paused. */
  matchElapsedMs(nowMs: number): number | null;
}

export interface ArenaCanvases {
  readonly left: HTMLCanvasElement;
  readonly right: HTMLCanvasElement;
  readonly leftNext: HTMLCanvasElement;
  readonly rightNext: HTMLCanvasElement;
  readonly fx: HTMLCanvasElement;
}
export interface ArenaHandle {
  destroy(): void;
}
/** Starts the single rAF loop: frame() → draw boards, previews and fx → notify subscribeFrame listeners. */
export type MountArena = (
  canvases: ArenaCanvases,
  store: GameStore,
  options: { readonly reducedMotion: boolean },
) => ArenaHandle;
export type DrawBestMoment = (
  canvas: HTMLCanvasElement,
  moment: WireBestMoment,
  cellCssPx: number,
) => void;

/** DESIGN.md "Music control". */
export type MusicStatus = 'on' | 'off' | 'blocked' | 'unavailable';
/** W4 (additive): the persisted choice, independent of whether the browser has unlocked audio. */
export type MusicPreference = 'on' | 'off';
/** W4 (additive): what last toggled the music. DESIGN.md: only a key toggle is announced in the live region. */
export type MusicToggleSource = 'key' | 'button';
/** A one-shot sound on top of the music (REQ-093). Only the row clear exists. */
export type SoundEffect = 'clear';
export interface Music {
  /** Call from the Create / Join / Next round click (autoplay rules). */
  unlock(): void;
  /** At DUEL! */
  start(level: number): void;
  /** The tempo steps up per level. */
  setLevel(level: number): void;
  /** Round end, pause, leave. */
  stop(): void;
  status(): MusicStatus;
  /** The M key and the Music button; persists MUSIC_STORAGE_KEY. */
  toggle(): void;
  subscribe(listener: () => void): () => void;
  /** W4 (additive; CORE's implementation always provides it). The persisted on/off choice: 'on' while the
   *  status is 'blocked', and also known when the status is 'unavailable'. aria-pressed = preference() === 'on'. */
  preference?(): MusicPreference;
  /** W4 (additive; always provided by CORE). What caused the latest toggle, or null before any. Read it inside
   *  a `subscribe` listener: announce "Music on" / "Music off" only when it is 'key'. */
  lastToggleSource?(): MusicToggleSource | null;
  /** REQ-093 (additive; CORE's implementation always provides it). Plays a one-shot sound now, but only while
   *  the music itself is allowed to sound (a live round, preference on, audio unlocked, tab visible), so the
   *  mute button and the M key silence it too. `rows` is the number of rows cleared, 1 to 4. */
  effect?(kind: SoundEffect, rows: number): void;
}
export interface CoreServices {
  readonly store: GameStore;
  readonly mountArena: MountArena;
  readonly drawBestMoment: DrawBestMoment;
  readonly music: Music;
}
