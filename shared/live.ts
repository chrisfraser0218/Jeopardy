import type { Game } from './model.js';

export type LiveSession = {
  id: string;
  game: Game;
  revision: number;
  currentClueId: string | null;
  revealed: boolean;
  completed: string[];
  paused: boolean;
};
export type PublicClue = { id: string; order: number; value: number; text: string; imageId: string | null; audioId: string | null; answer?: string };
export type PublicSession = Omit<LiveSession, 'game'> & {
  game: { title: string; categories: {id: string; order: number; name: string; clues: PublicClue[]}[] };
};
export type AudioStatus = { ownerId: string | null; ready: boolean; playback: 'stopped' | 'playing' | 'paused'; error: string | null };
export type LiveState = { session: PublicSession | null; audio: AudioStatus };
export type ActionName = 'select' | 'reopen' | 'reveal' | 'complete' | 'board' | 'end' | 'resume' | 'play' | 'pause' | 'replay';
export type HostAction = { sessionId: string; expectedRevision: number; commandId: string; type: ActionName; clueId?: string };
export type ActionResult = { ok: boolean; error?: string };
export type AudioCommand = { sessionId: string; clueId: string; revision: number; commandId: string; type: 'play' | 'pause' | 'replay'; expiresAt: number };
export type Setup = { session: {id: string; title: string; paused: boolean; completed: number} | null; hostToken: string | null; origins: string[] };
