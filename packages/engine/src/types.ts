/** The seven tetrominoes. */
export type PieceKind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

/** A filled board cell: a piece letter, or 'G' for garbage. */
export type CellKind = PieceKind | 'G';

/**
 * Exactly BOARD_HEIGHT (20) strings of exactly BOARD_WIDTH (10) characters, each '.' (empty) or a CellKind.
 * board[0] is the top row (y = 0); board[y][x] is column x. Immutable by convention: never mutate;
 * every change returns a new array (strings are immutable, so a row edit rebuilds one string and a
 * copy is 20 references). This IS the serialized form: parseBoard/serializeBoard, fixtures and the wire.
 */
export type Board = readonly string[];

/** Rotation state: 0 = spawn, 1 = R (one CW turn), 2 = 180°, 3 = L (one CCW turn). */
export type Rotation = 0 | 1 | 2 | 3;

/** Board coordinates in cells: x = column 0..9 (left→right), y = row 0..19 (top→bottom). */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** The falling piece. (x, y) = top-left of its n×n bounding box on the board; may be negative. */
export interface ActivePiece {
  readonly kind: PieceKind;
  readonly rotation: Rotation;
  readonly x: number;
  readonly y: number;
}

/** One incoming attack: `rows` (≥ 1) garbage rows, all with the empty cell at `holeColumn` (0..9). */
export interface GarbageAttack {
  readonly rows: number;
  readonly holeColumn: number;
}

/** Pure 7-bag state. Server-only: never serialized to any client. */
export interface BagState {
  /** mulberry32 state, uint32. */
  readonly rng: number;
  /** Pieces left in the current shuffled bag, next first (0..7 entries). */
  readonly remaining: readonly PieceKind[];
}

/** The clearing lock with the highest combo; ties → higher attack, then earlier (design §5.4). */
export interface BestMoment {
  /** 20 rows with the finishing piece written, BEFORE full rows were removed. */
  readonly board: Board;
  /** y indices of the cleared rows in `board`, ascending, 1..4 entries. */
  readonly clearedRows: readonly number[];
  /** The finishing piece's 4 cells, in `board` coordinates. */
  readonly pieceCells: readonly Cell[];
  /** Combo count after this lock (≥ 1). */
  readonly combo: number;
  /** Rows cleared by this lock (1..4). */
  readonly linesCleared: number;
  /** LINE_ATTACK[linesCleared] + comboBonus(combo), before cancelling. Rows. */
  readonly attack: number;
  /** Rows sent to the opponent after cancelling. */
  readonly sent: number;
  /** Rows of own pending garbage cancelled by this lock. */
  readonly cancelled: number;
  /** Match tick at which the lock happened (the tick being processed). */
  readonly tick: number;
}

/** Per-seat round stats carried by gameOver (design §6). */
export interface PlayerStats {
  readonly linesCleared: number;
  readonly garbageSent: number;
  readonly garbageCancelled: number;
  readonly piecesPlaced: number;
  readonly bestCombo: number;
  readonly bestMoment: BestMoment | null;
}

export interface PlayerState {
  /** Match tick this state is AT = the next tick `tick()` will process. Integer ≥ 0. */
  readonly tick: number;
  readonly board: Board;
  /** null when topped out, or (prediction only) when the queue ran dry ("starved"). */
  readonly active: ActivePiece | null;
  /** Upcoming pieces after `active`, next first. Server: exactly PREVIEW_COUNT after every spawn. */
  readonly queue: readonly PieceKind[];
  /** Refill source. Server: a bag. Client prediction: null (queue = the preview it was sent). */
  readonly bag: BagState | null;
  /** Incoming attacks, oldest first. */
  readonly pendingGarbage: readonly GarbageAttack[];
  readonly softDrop: boolean;
  /** Ticks counted toward the next gravity row (0 ≤ n < current fall interval). */
  readonly gravityCounter: number;
  /** Consecutive grounded ticks (0..LOCK_DELAY_TICKS). */
  readonly lockCounter: number;
  /** Lock-delay resets used since lowestY last increased (0..MAX_LOCK_RESETS). */
  readonly lockResets: number;
  /** Largest box-origin y the active piece has reached since it spawned. Rows. */
  readonly lowestY: number;
  /** Consecutive clearing locks; 0 after a non-clearing lock. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly linesCleared: number;
  /** Rows sent after cancelling. */
  readonly garbageSent: number;
  /** Rows of own pending garbage cancelled by own attacks. */
  readonly garbageCancelled: number;
  /** Rows routed in through receiveGarbage, whether later cancelled, inserted or still pending (design §5.7). */
  readonly garbageReceived: number;
  /** Rows actually inserted into the board (drives the garbage nudge). */
  readonly garbageInserted: number;
  readonly piecesPlaced: number;
  readonly bestMoment: BestMoment | null;
  readonly toppedOut: boolean;
}

export type Action =
  | { readonly type: 'moveLeft' }
  | { readonly type: 'moveRight' }
  | { readonly type: 'rotateCW' }
  | { readonly type: 'rotateCCW' }
  | { readonly type: 'softDropStart' }
  | { readonly type: 'softDropStop' }
  | { readonly type: 'hardDrop' };

export type ActionType = Action['type'];

/** An input stamped with the match tick it was made for (design §6.1). */
export interface StampedInput {
  /** ≥ 1, strictly increasing per seat binding per round. */
  readonly seq: number;
  /** Match tick to apply it at: applied at the first processed tick ≥ this. */
  readonly tick: number;
  readonly action: Action;
}

export type TopOutReason = 'SPAWN_BLOCKED' | 'GARBAGE_OVERFLOW';

export type EngineEvent =
  | { readonly type: 'moved'; readonly dx: -1 | 1 }
  | { readonly type: 'rotated'; readonly rotation: Rotation; readonly kickIndex: number }
  | { readonly type: 'locked'; readonly kind: PieceKind; readonly cells: readonly Cell[] }
  | { readonly type: 'linesCleared'; readonly count: number; readonly rows: readonly number[] }
  | { readonly type: 'combo'; readonly count: number }
  | { readonly type: 'garbageCancelled'; readonly rows: number }
  | { readonly type: 'attack'; readonly rows: number }
  | { readonly type: 'garbageInserted'; readonly rows: number }
  | { readonly type: 'spawned'; readonly kind: PieceKind }
  | { readonly type: 'starved' }
  | { readonly type: 'toppedOut'; readonly reason: TopOutReason };

export interface StepResult {
  readonly state: PlayerState;
  readonly events: readonly EngineEvent[];
}

export interface TickedEvent {
  /** The match tick being processed when the event happened. */
  readonly tick: number;
  readonly event: EngineEvent;
}

export interface SimulateResult {
  /** State at `reachedTick`. */
  readonly state: PlayerState;
  /** = state.tick; equals the requested toTick unless stopped early. */
  readonly reachedTick: number;
  readonly stoppedBy: 'none' | 'starved' | 'toppedOut';
  readonly events: readonly TickedEvent[];
  /** seq of every input applied, in application order. */
  readonly appliedSeqs: readonly number[];
}
