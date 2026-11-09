/**
 * Every user-facing string, in DESIGN.md's wording (architecture §5.7, §7.4): the single source for
 * components and e2e. Dependency-free on purpose, because e2e imports this file directly; numbers that
 * come from protocol constants are passed in by the caller.
 *
 * Voice (PRODUCT.md): a broadcast caller. On-air graphics are uppercase through CSS, so the strings
 * here stay in sentence case and screen readers never spell them out. Errors name the problem and the
 * recovery, and never apologise. The only exclamation marks are "DUEL!" and "Copied!".
 */

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export const COPY = {
  logoAlt: 'Stackerist',
  home: {
    nameLabel: 'Your name',
    codeLabel: 'Room code',
    divider: 'or join a friend',
    dividerJoinMode: 'or',
    create: 'Create game',
    creating: 'Creating…',
    join: 'Join',
    joinGame: 'Join game',
    joining: 'Joining…',
    createInstead: 'Create a new game instead',
    tryAgain: 'Try again',
  },
  keyboard: {
    title: 'Stackerist needs a keyboard',
    body: 'Each player uses a keyboard: arrow keys, X, Z and Space. Connect a keyboard and press any key to continue.',
    watchInstead: 'Watch instead',
    back: 'Back',
  },
  lobby: {
    codeLabel: 'Room code',
    shareLinkLabel: 'Invite link',
    copyLink: 'Copy link',
    copyLinkName: 'Copy invite link',
    copied: 'Copied!',
    linkCopied: 'Link copied',
    seriesIntro: 'Best of 3 · first to 2 rounds',
    playersHeading: 'Players',
    waiting: 'Waiting for opponent…',
    you: '(you)',
    reconnecting: 'reconnecting',
    leave: 'Leave',
    stopWatching: 'Stop watching',
    connectingTo: (code: string) => `Connecting to room ${code}…`,
    rejoining: (code: string) => `Rejoining ${code}…`,
    seriesLine: (round: number, nameA: string, scoreA: number, scoreB: number, nameB: string) =>
      `Round ${String(round)} · ${nameA} ${String(scoreA)} – ${String(scoreB)} ${nameB}`,
  },
  game: {
    roomLabel: 'Room',
    you: 'You',
    opponent: 'Opponent',
    next: 'Next',
    lines: 'Lines',
    sent: 'Sent',
    pieces: 'Pieces',
    vs: 'VS',
    speed: 'Speed',
    clockName: 'Match time',
    controls: 'Controls',
    replay: 'Replay',
    leave: 'Leave',
    stopWatching: 'Stop watching',
    yourBoard: 'Your board',
    boardOf: (name: string) => `${name}'s board`,
    roundTag: (round: number) => `Round ${String(round)}`,
    watching: (count: number) => `${String(count)} watching`,
    pingMs: (ms: number | null) => (ms === null ? '— ms' : `${String(ms)} ms`),
    pingName: (quality: 'good' | 'fair' | 'poor' | 'unknown', ms: number | null) =>
      quality === 'unknown' || ms === null
        ? 'Connection not measured yet'
        : `Connection ${quality}, ${plural(ms, 'millisecond', 'milliseconds')}`,
    pipsName: (name: string, won: number) => `${name}, ${plural(won, 'round', 'rounds')} won`,
    incomingGarbage: (rows: number) => `Incoming garbage: ${plural(rows, 'row', 'rows')}`,
    legend: {
      move: 'move',
      rotate: 'rotate',
      rotateBack: 'rotate back',
      softDrop: 'soft drop',
      hardDrop: 'hard drop',
      leave: 'leave',
    },
    keys: {
      left: '←',
      right: '→',
      up: '↑',
      down: '↓',
      x: 'X',
      z: 'Z',
      ctrl: 'Ctrl',
      space: 'Space',
      esc: 'Esc',
    },
  },
  combo: {
    word: 'Combo',
    count: (combo: number) => `×${String(combo)}`,
    title: (combo: number) => `Combo ×${String(combo)}`,
    sent: (rows: number) => `+${String(rows)} sent`,
    cancelled: (rows: number) => `${String(rows)} cancelled`,
  },
  leaveConfirm: {
    question: (opponent: string) => `Leave the series? ${opponent} wins the series.`,
    keepPlaying: 'Keep playing',
    leaveSeries: 'Leave series',
  },
  countdown: {
    intro: (round: number, left: string, right: string) =>
      `Round ${String(round)}. ${left} versus ${right}.`,
    duel: 'DUEL!',
    duelSpoken: 'Duel!',
  },
  disconnect: {
    title: (name: string) => `${name} disconnected`,
    seconds: (s: number) => `${String(s)} s`,
    waitingPlayer: (name: string) =>
      `Waiting for ${name} to reconnect. If they don't, you win the series.`,
    waitingSpectator: (name: string) => `Waiting for ${name} to reconnect.`,
    pausesLeft: (name: string, pauses: number) =>
      `${name} has ${plural(pauses, 'pause', 'pauses')} left this series.`,
    announceEntry: (name: string, s: number) =>
      `${name} disconnected. Waiting ${plural(s, 'second', 'seconds')}.`,
    announceLeft: (s: number) => `${plural(s, 'second', 'seconds')} left.`,
    connectionLostTitle: 'Connection lost',
    connectionLostLine: (s: number) =>
      `Reconnecting… Your seat is held for ${plural(s, 'second', 'seconds')}.`,
  },
  result: {
    final: (round: number, replay: boolean) =>
      replay ? `Round ${String(round)} · Replay · Final` : `Round ${String(round)} · Final`,
    youWin: 'You win',
    youLose: 'You lose',
    draw: 'Draw',
    wins: (name: string) => `${name} wins`,
    toppedOut: (name: string, time: string) => `${name} topped out at ${time}`,
    youToppedOut: (time: string) => `You topped out at ${time}`,
    bothToppedOut: (time: string, round: number) =>
      `You both topped out at ${time}. Round ${String(round)} will be replayed.`,
    bothPlayersToppedOut: (time: string, round: number) =>
      `Both players topped out at ${time}. Round ${String(round)} will be replayed.`,
    left: (name: string) => `${name} left the series`,
    didntReconnect: (name: string) => `${name} didn't reconnect in time`,
    seriesLabel: 'Series',
    seriesScoreName: (nameA: string, scoreA: number, scoreB: number, nameB: string) =>
      `Series: ${nameA} ${String(scoreA)}, ${nameB} ${String(scoreB)}.`,
    finalSpoken: (round: number, replay: boolean) =>
      replay ? `Round ${String(round)} replay final` : `Round ${String(round)} final`,
    /** "Round 1 final. You win. Sam topped out at 04:51. Series: Ariel 1, Sam 0." */
    summary: (parts: readonly string[]) =>
      parts.map((part) => (part.endsWith('.') ? part.slice(0, -1) : part)).join('. ') + '.',
    statsCaption: 'Round stats',
    statLabel: 'Stat',
    you: 'You',
    rows: {
      lines: 'Lines',
      garbageSent: 'Garbage sent',
      garbageReceived: 'Garbage received',
      garbageCancelled: 'Garbage cancelled',
      bestCombo: 'Best combo',
      pieces: 'Pieces',
    },
    bestComboValue: (combo: number) => (combo > 0 ? `×${String(combo)}` : '—'),
    yourBestMoment: 'Your best moment',
    bestMomentOf: (name: string) => `${name}'s best moment`,
    bestMomentBoard: (title: string) => `Board at the moment of the ${title}`,
    clearNames: ['Single', 'Double', 'Triple', 'Quad'] as const,
    nextRound: 'Next round',
    newSeries: 'New series',
    backToHome: 'Back to home',
    waitingAccept: 'Waiting for opponent to accept…',
    opponentReady: (name: string) => `${name} is ready for the next round`,
    opponentWantsSeries: (name: string) => `${name} wants a new series`,
    opponentLeft: 'Opponent left',
    opponentReconnecting: (name: string) => `Waiting for ${name} to reconnect…`,
    spectatorWaiting: 'Waiting for the next round',
    seriesOverNoReport: 'Series final',
  },
  errors: {
    nameInvalid: (max: number) => `Enter your name (1–${String(max)} characters) to play.`,
    codeInvalid: 'Room codes have 6 letters and numbers. Check the code and try again.',
    roomNotFound: (code: string) =>
      `There's no game with code ${code}. Check the code with your friend, or create a new game.`,
    roomFull:
      'This room is full — two players and eight spectators are already in. Ask for a new game code.',
    joinedAsSpectator: "That game already has two players, so you're watching.",
    serverBusy: 'Stackerist is full right now. Try again in a few minutes.',
    tooManyJoins: 'Too many wrong codes in a minute. Wait a minute, then try again.',
    tooManyCreates: "You've created a lot of games in a minute. Wait a minute, then create one.",
    rateLimited:
      'You were disconnected for sending inputs too fast. Go back to home to play again.',
    connectionLost: 'Connection lost. Reconnecting…',
    cantReach: "Can't reach Stackerist. Check your internet connection, then try again.",
    seatExpired:
      'That game has ended or your seat expired. Create a new game or join with a new code.',
    replaced: 'This seat is now open in another tab. Close this tab, or reload to play here.',
    clipboardFailed: "Couldn't copy. Select the link above and copy it.",
    generic: 'Something went wrong on our side. Reload to rejoin.',
    notInRoom: "You're no longer in this game. Go back to home to create or join one.",
    alreadyInRoom: 'This tab is already in a game. Reload to start fresh, then try again.',
    roomClosed: 'This game has closed. Create a new game or join with a new code.',
    serverRestarted:
      'Stackerist restarted, so this game has ended. Go back to home to start a new one.',
    tryAgain: 'Try again',
    reload: 'Reload',
    backToHome: 'Back to home',
  },
} as const;
