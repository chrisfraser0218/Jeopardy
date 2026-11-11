import { z } from 'zod';
import { clueSchema, categorySchema } from './model.js';
const path=z.string().regex(/^media\/(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:jpg|jpeg|png|webp|mp3|wav)$/,'Use a relative media/filename with a supported extension.').refine(s=>!s.includes('..'),'Parent path segments are forbidden.');
export const portableClue=clueSchema.omit({id:true,imageId:true,audioId:true}).extend({image:path.nullable(),audio:path.nullable()}).strict();
export const portableCategory=categorySchema.omit({id:true,clues:true}).extend({attemptPolicy:z.enum(['repeat','one']),clues:z.array(portableClue).length(5)}).strict();
export const manifestSchema=z.object({format:z.literal('jeopardy-game'),version:z.literal(1),game:z.object({title:z.string().trim().min(1).max(200),description:z.string().max(2000),categories:z.array(portableCategory).length(6),doubleJeopardy:z.object({enabled:z.boolean(),categories:z.array(portableCategory).length(6)}).strict().nullable().optional(),finalJeopardy:z.object({enabled:z.boolean(),category:z.string().max(120),clue:portableClue}).strict().nullable().optional()}).strict(),media:z.array(z.object({path,name:z.string().min(1).max(255),attribution:z.string().max(2000).optional()}).strict()).max(122)}).strict();
export type Manifest=z.infer<typeof manifestSchema>;
export const transferLimits={archive:64*1024*1024,expanded:256*1024*1024,fileCount:130,manifest:2*1024*1024};
