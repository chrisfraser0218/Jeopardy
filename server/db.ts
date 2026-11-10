import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { emptyCategories, isReady, type Game, type GameSummary, type Media } from '../shared/model.js';

export function openStore(directory: string) {
  mkdirSync(join(directory, 'uploads'), {recursive:true});
  const db = new DatabaseSync(join(directory, 'games.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const version = Number((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version);
  if (version > 1) throw new Error('This database needs a newer app version.');
  if (version < 1) db.exec(`BEGIN;
    CREATE TABLE games (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, updated_at TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL);
    CREATE TABLE media (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, filename TEXT NOT NULL UNIQUE);
    CREATE TABLE categories (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE, position INTEGER NOT NULL, name TEXT NOT NULL, UNIQUE(game_id, position));
    CREATE TABLE clues (id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE, position INTEGER NOT NULL, value INTEGER NOT NULL, text TEXT NOT NULL, image_id TEXT REFERENCES media(id), audio_id TEXT REFERENCES media(id), UNIQUE(category_id, position));
    CREATE TABLE answers (clue_id TEXT PRIMARY KEY REFERENCES clues(id) ON DELETE CASCADE, answer TEXT NOT NULL);
    PRAGMA user_version=1; COMMIT;`);
  function get(id:string): Game | undefined {
    const g = db.prepare('SELECT * FROM games WHERE id=?').get(id) as any;
    if (!g) return;
    const categories = (db.prepare('SELECT * FROM categories WHERE game_id=? ORDER BY position').all(id) as any[]).map(c => ({id:c.id, order:c.position, name:c.name, clues:(db.prepare('SELECT c.*, a.answer FROM clues c JOIN answers a ON a.clue_id=c.id WHERE category_id=? ORDER BY position').all(c.id) as any[]).map(q => ({id:q.id, order:q.position, value:q.value, text:q.text, answer:q.answer, imageId:q.image_id, audioId:q.audio_id}))}));
    return {id:g.id,title:g.title,description:g.description,updatedAt:g.updated_at,sample:Boolean(g.sample),revision:g.revision,categories};
  }
  function write(game:Game, create=false) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (create) db.prepare('INSERT INTO games VALUES (?, ?, ?, ?, ?, ?)').run(game.id,game.title,game.description,game.updatedAt,Number(game.sample),game.revision);
      else {
        const result = db.prepare('UPDATE games SET title=?,description=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').run(game.title,game.description,game.updatedAt,game.id,game.revision);
        if (!result.changes) throw Object.assign(new Error('This game changed in another tab. Reopen it before saving.'), {status:409});
        db.prepare('DELETE FROM categories WHERE game_id=?').run(game.id);
      }
      for (const c of game.categories) {
        db.prepare('INSERT INTO categories VALUES (?, ?, ?, ?)').run(c.id,game.id,c.order,c.name);
        for (const q of c.clues) {
          for (const [mediaId, kind] of [[q.imageId,'image'],[q.audioId,'audio']]) if (mediaId && !(db.prepare('SELECT id FROM media WHERE id=? AND kind=?').get(mediaId,kind))) throw Object.assign(new Error(`The selected ${kind} attachment does not exist.`), {status:400});
          db.prepare('INSERT INTO clues VALUES (?, ?, ?, ?, ?, ?, ?)').run(q.id,c.id,q.order,q.value,q.text,q.imageId,q.audioId);
          db.prepare('INSERT INTO answers VALUES (?, ?)').run(q.id,q.answer);
        }
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return get(game.id)!;
  }
  function create(title:string, description='', sample=false) {
    return write({id:crypto.randomUUID(),title,description,sample,updatedAt:new Date().toISOString(),revision:1,categories:emptyCategories()}, true);
  }
  function list():GameSummary[] {
    return (db.prepare('SELECT id FROM games ORDER BY updated_at DESC').all() as {id:string}[]).map(({id}) => {const g=get(id)!; return {id,title:g.title,description:g.description,updatedAt:g.updatedAt,sample:g.sample,ready:g.categories.flatMap(c=>c.clues).filter(isReady).length};});
  }
  if (version < 1) {
    const game = create('The curious collection', 'An editable sample of everyday wonders. Make it your own.', true);
    const samples: [string, string, string][] = [
      ['Kitchen science','This process turns a puddle into water vapor on a sunny day.','Evaporation'],['Kitchen science','A pinch of this seasoning is sodium chloride.','Salt'],['Kitchen science','These microorganisms make bread dough rise.','Yeast'],['Kitchen science','This yellow spice gives many curries their golden color.','Turmeric'],['Kitchen science','Oil and vinegar separate because oil is less dense and does not do this in water.','Dissolve'],
      ['Outside the window','These insects carry pollen between flowers while gathering nectar.','Bees'],['Outside the window','This star supplies most of Earth’s light.','The Sun'],['Outside the window','A tree’s age can often be estimated by counting these inside its trunk.','Growth rings'],['Outside the window','This force keeps a raindrop falling toward the ground.','Gravity'],['Outside the window','This green pigment helps leaves capture sunlight.','Chlorophyll'],
      ['Word workshop','Add one letter to “rain” to make the vehicle that runs on rails.','Train'],['Word workshop','This punctuation mark ends a direct question.','Question mark'],['Word workshop','“Silent” and “listen” are this kind of rearranged word pair.','Anagrams'],['Word workshop','A word with the opposite meaning of another is called this.','Antonym'],['Word workshop','This five-letter word reads the same forward and backward: a small watercraft with a double-bladed paddle.','Kayak'],
      ['On the map','This ocean lies between Africa and the Americas.','Atlantic Ocean'],['On the map','This imaginary line divides Earth into northern and southern hemispheres.','Equator'],['On the map','This country has the cities Kyoto and Osaka.','Japan'],['On the map','This mountain range forms a natural border between France and Spain.','Pyrenees'],['On the map','This African country surrounds the independent nation of Lesotho.','South Africa'],
      ['A little music','A standard modern piano has this many keys.','88'],['A little music','This instrument has strings, a neck, and typically six tuning pegs.','Guitar'],['A little music','This term tells musicians how fast to play.','Tempo'],['A little music','A group of three musicians is called this.','Trio'],['A little music','This symbol raises a written note by one semitone.','Sharp'],
      ['Made of numbers','A triangle has this many sides.','Three'],['Made of numbers','This is the result of multiplying seven by eight.','56'],['Made of numbers','A quarter of one hundred is this number.','25'],['Made of numbers','This is the only even prime number.','Two'],['Made of numbers','The angles inside a flat triangle total this many degrees.','180']
    ];
    game.categories.forEach((c,i) => {c.name=samples[i*5][0]; c.clues.forEach((q,j) => {q.text=samples[i*5+j][1];q.answer=samples[i*5+j][2];});});
    write(game);
  }
  return { db, get, write, create, list, remove:(id:string)=>db.prepare('DELETE FROM games WHERE id=?').run(id), media:(id:string)=>db.prepare('SELECT * FROM media WHERE id=?').get(id) as (Media & {filename:string}) | undefined };
}
