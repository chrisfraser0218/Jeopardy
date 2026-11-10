import { z } from 'zod';
const id = z.uuid();
export const clueSchema = z.object({ id, order: z.number().int().min(0).max(4), value: z.number().int().min(0).max(1000000), text: z.string().max(10000), answer: z.string().max(5000), imageId: id.nullable(), audioId: id.nullable() });
export const categorySchema = z.object({ id, order: z.number().int().min(0).max(5), name: z.string().max(120), clues: z.array(clueSchema).length(5) });
export const gameInput = z.object({ title: z.string().trim().min(1, 'Give your game a title.').max(200), description: z.string().max(2000), categories: z.array(categorySchema).length(6), revision: z.number().int().min(1) }).superRefine((g, ctx) => {
  const ids = g.categories.flatMap(c => [c.id, ...c.clues.map(q => q.id)]);
  if (new Set(ids).size !== ids.length || new Set(g.categories.map(c => c.order)).size !== 6 || g.categories.some(c => new Set(c.clues.map(q => q.order)).size !== 5)) ctx.addIssue({code:'custom',message:'Category and clue IDs and positions must be unique.'});
});
export type Clue = z.infer<typeof clueSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Game = z.infer<typeof gameInput> & { id: string; updatedAt: string; sample: boolean };
export type GameSummary = Pick<Game, 'id' | 'title' | 'description' | 'updatedAt' | 'sample'> & { ready: number };
export type Media = { id: string; kind: 'image' | 'audio'; name: string; mime: string; size: number };
export const isReady = (c: Clue) => Boolean(c.answer.trim() && (c.text.trim() || c.imageId || c.audioId));
export function emptyCategories(): Category[] {
  return Array.from({length:6}, (_, i) => ({id: crypto.randomUUID(), order:i, name:`Category ${i+1}`, clues:Array.from({length:5}, (_, j) => ({id:crypto.randomUUID(), order:j, value:(j+1)*200, text:'', answer:'', imageId:null, audioId:null}))}));
}
