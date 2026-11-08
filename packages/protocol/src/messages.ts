/**
 * Wire types, each derived from its schema with `z.infer` (architecture §3.1). Never hand-write one.
 * `ErrorCode` and `CloseCodeName` come from the constant lists in `constants.ts`.
 */
import type * as z from 'zod';
import type {
  ActionSchema,
  ClientMessageSchema,
  CountdownMessageSchema,
  CreatedMessageSchema,
  CreateMessageSchema,
  ErrorMessageSchema,
  GameOverMessageSchema,
  GameOverReasonSchema,
  InputMessageSchema,
  JoinedMessageSchema,
  JoinMessageSchema,
  LeaveMessageSchema,
  LiveStatsSchema,
  OwnViewSchema,
  PausedMessageSchema,
  PieceKindSchema,
  PingMessageSchema,
  PlayerInfoSchema,
  PlayerStatsSchema,
  PongMessageSchema,
  PublicViewSchema,
  RejoinMessageSchema,
  RematchMessageSchema,
  RematchStatusMessageSchema,
  ResumedMessageSchema,
  RoleSchema,
  RoomCodeSchema,
  RoomMessageSchema,
  RoomStatusSchema,
  RotationSchema,
  RoundReportSchema,
  RoundSummarySchema,
  SeatSchema,
  SeriesEndReasonSchema,
  SeriesViewSchema,
  ServerMessageSchema,
  SnapshotEventSchema,
  SnapshotMessageSchema,
  WireActivePieceSchema,
  WireBestMomentSchema,
  WireCellSchema,
  WireGarbageAttackSchema,
} from './schemas.js';

// ---- Shared shapes ----
export type Seat = z.infer<typeof SeatSchema>;
export type Role = z.infer<typeof RoleSchema>;
/** 6 characters of ROOM_CODE_ALPHABET, upper case (the output of `normalizeRoomCode`). */
export type RoomCode = z.infer<typeof RoomCodeSchema>;
export type RoomStatus = z.infer<typeof RoomStatusSchema>;
export type GameOverReason = z.infer<typeof GameOverReasonSchema>;
export type SeriesEndReason = z.infer<typeof SeriesEndReasonSchema>;
export type WirePieceKind = z.infer<typeof PieceKindSchema>;
export type WireRotation = z.infer<typeof RotationSchema>;
export type WireAction = z.infer<typeof ActionSchema>;
export type WireCell = z.infer<typeof WireCellSchema>;
export type WireActivePiece = z.infer<typeof WireActivePieceSchema>;
export type WireGarbageAttack = z.infer<typeof WireGarbageAttackSchema>;
export type PlayerInfo = z.infer<typeof PlayerInfoSchema>;
export type LiveStats = z.infer<typeof LiveStatsSchema>;
export type PublicView = z.infer<typeof PublicViewSchema>;
export type OwnView = z.infer<typeof OwnViewSchema>;
export type WireBestMoment = z.infer<typeof WireBestMomentSchema>;
export type PlayerStats = z.infer<typeof PlayerStatsSchema>;
export type RoundReport = z.infer<typeof RoundReportSchema>;
export type RoundSummary = z.infer<typeof RoundSummarySchema>;
export type SeriesView = z.infer<typeof SeriesViewSchema>;
export type SnapshotEvent = z.infer<typeof SnapshotEventSchema>;

// ---- Client → server ----
export type CreateMessage = z.infer<typeof CreateMessageSchema>;
export type JoinMessage = z.infer<typeof JoinMessageSchema>;
export type RejoinMessage = z.infer<typeof RejoinMessageSchema>;
export type InputMessage = z.infer<typeof InputMessageSchema>;
export type LeaveMessage = z.infer<typeof LeaveMessageSchema>;
export type RematchMessage = z.infer<typeof RematchMessageSchema>;
export type PongMessage = z.infer<typeof PongMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ClientMessageType = ClientMessage['type'];

// ---- Server → client ----
export type CreatedMessage = z.infer<typeof CreatedMessageSchema>;
export type JoinedMessage = z.infer<typeof JoinedMessageSchema>;
export type RoomMessage = z.infer<typeof RoomMessageSchema>;
export type CountdownMessage = z.infer<typeof CountdownMessageSchema>;
export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;
export type PausedMessage = z.infer<typeof PausedMessageSchema>;
export type ResumedMessage = z.infer<typeof ResumedMessageSchema>;
export type GameOverMessage = z.infer<typeof GameOverMessageSchema>;
export type RematchStatusMessage = z.infer<typeof RematchStatusMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type ServerMessageType = ServerMessage['type'];
