import type { Game } from './model.js';
import type { RoundName, DailyDoubleState, PublicDailyDouble, FinalStage, FinalPublic, FinalSubmission, FinalOwn } from './rounds.js';

export type LiveSession = {
  id: string;
  game: Game;
  revision: number;
  currentClueId: string | null;
  revealed: boolean;
  completed: string[];
  paused: boolean;
  joiningOpen: boolean;
  joinOrigin: string | null;
  showJoinQr: boolean;
  buzzer: BuzzerState;
  buzzerMode?: 'manual' | 'automatic';
  timerSeconds: number | null;
  currentAttemptId: string | null;
  finished: boolean;
  results: GameResults | null;
  round: RoundName;
  dailyDouble: DailyDoubleState | null;
  final: FinalStage | null;
};
export type PublicClue = { id: string; order: number; value: number; text: string; imageId: string | null; audioId: string | null; answer?: string };
export type PublicSession = Omit<LiveSession, 'game'|'dailyDouble'|'final'> & {
  dailyDouble:PublicDailyDouble|null; final:FinalStage|null;
  game: { title: string; categories: {id: string; order: number; name: string; attemptPolicy?:'repeat'|'one'; clues: PublicClue[]}[] };
};
export type AudioStatus = { ownerId: string | null; ready: boolean; playback: 'stopped' | 'playing' | 'paused'; error: string | null };
export type LiveState = { session: PublicSession | null; audio: AudioStatus; players: PlayerPublic[]; joinOrigins?: string[]; attempt: ResponseAttempt | null; serverNow: number; ledger?: LedgerEntry[]; attempts?: ResponseAttempt[]; allPlayers?: (PlayerPublic & {removed:boolean})[]; progress:{resolved:number;total:number;hasNext:boolean}; final:FinalPublic|null; finalSubmissions?:FinalSubmission[]; dailyDoubleLimits?:Record<string,number> };
export type ActionName = 'select' | 'reopen' | 'reveal' | 'complete' | 'board' | 'end' | 'resume' | 'play' | 'pause' | 'replay' | 'joining-open' | 'joining-close' | 'join-address' | 'qr-show' | 'qr-hide' | 'remove-player' | 'buzz-open' | 'buzz-close' | 'buzz-clear' | 'buzz-exclude' | 'eligibility-reset' | 'judge-correct' | 'judge-incorrect' | 'dismiss-attempt' | 'finish-clue' | 'finish-game' | 'timer-pause' | 'timer-resume' | 'score-adjust' | 'judgment-correct' | 'advance-round' | 'skip-round' | 'dd-player' | 'dd-wager' | 'dd-reveal' | 'dd-correct' | 'final-wager' | 'final-zero-missing' | 'final-reveal-clue' | 'final-pause' | 'final-resume' | 'final-close' | 'final-judge' | 'final-reveal-player' | 'final-reveal-answer';
export type HostAction = { sessionId: string; expectedRevision: number; commandId: string; type: ActionName; clueId?: string; playerId?: string; origin?: string; attemptId?: string; amount?: number; reason?: string; outcome?: Outcome; finalId?:string };
export type ActionResult = { ok: boolean; error?: string };
export type AudioCommand = { sessionId: string; clueId: string; revision: number; commandId: string; type: 'play' | 'pause' | 'replay'; expiresAt: number };
export type Setup = { session: {id: string; title: string; paused: boolean; completed: number; finished: boolean} | null; hostToken: string | null; origins: string[] };

export type BuzzerState = { clueId: string | null; windowId: string | null; open: boolean; winnerId: string | null; excludedIds: string[]; attemptedIds: string[] };
export type PlayerPublic = { id: string; name: string; connected: boolean; score: number };
export type PlayerState = { sessionId: string; title: string; paused: boolean; joiningOpen: boolean; currentClueId: string | null; revealed: boolean; buzzer: BuzzerState; players: PlayerPublic[]; self: PlayerPublic | null; activeTab: boolean; finished: boolean; results: GameResults | null; attempt: ResponseAttempt | null; serverNow: number; attemptPolicy?:'repeat'|'one'; ownAttemptCount?:number; buzzerMode?:'manual'|'automatic'; round:RoundName; dailyDouble:PublicDailyDouble|null; final:FinalPublic|null; finalOwn:FinalOwn|null };
export type PlayerIdentity = { sessionId: string; player: { id: string; name: string }; credential: string };

export type Outcome = 'correct' | 'incorrect' | 'dismissed';
export type ResponseTimer = { state:'disabled'|'running'|'paused'|'expired'|'stopped'; deadline:number|null; remainingMs:number; timedOut:boolean };
export type ResponseAttempt = { id:string; sessionId:string; playerId:string; clueId:string; value:number; acceptedAt:string; status:'pending'|Outcome; effectiveOutcome:Outcome|null; timer:ResponseTimer; kind?:'standard'|'daily-double'|'final' };
export type LedgerEntry = { id:string; sessionId:string; playerId:string; playerName:string; clueId:string|null; attemptId:string|null; amount:number; kind:'judgment'|'manual'|'reversal'|'correction'; reason:string; createdAt:string; referenceId:string|null };
export type Standing = { id:string; name:string; score:number; rank:number };
export type GameResults = { finishedAt:string; reason:'complete'|'early'; standings:Standing[] };
