import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { emptyCategories, enabledClues, isReady, type Game, type GameSummary, type Media } from '../shared/model.js';

export function openStore(directory: string) {
  mkdirSync(join(directory, 'uploads'), {recursive:true});
  const db = new DatabaseSync(join(directory, 'games.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const version = Number((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version);
  if (version > 7) throw new Error('This database needs a newer app version.');
  if (version < 1) db.exec(`BEGIN;
    CREATE TABLE games (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, updated_at TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL);
    CREATE TABLE media (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, filename TEXT NOT NULL UNIQUE);
    CREATE TABLE categories (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE, position INTEGER NOT NULL, name TEXT NOT NULL, UNIQUE(game_id, position));
    CREATE TABLE clues (id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE, position INTEGER NOT NULL, value INTEGER NOT NULL, text TEXT NOT NULL, image_id TEXT REFERENCES media(id), audio_id TEXT REFERENCES media(id), UNIQUE(category_id, position));
    CREATE TABLE answers (clue_id TEXT PRIMARY KEY REFERENCES clues(id) ON DELETE CASCADE, answer TEXT NOT NULL);
    PRAGMA user_version=1; COMMIT;`);
  if (version < 2) db.exec(`BEGIN;
    CREATE TABLE live_session (slot INTEGER PRIMARY KEY CHECK(slot=1), state TEXT NOT NULL, host_token TEXT NOT NULL, commands TEXT NOT NULL);
    PRAGMA user_version=2; COMMIT;`);
  if (version < 3) db.exec(`BEGIN;
    CREATE TABLE session_players (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, removed INTEGER NOT NULL DEFAULT 0, UNIQUE(session_id, name_key));
    PRAGMA user_version=3; COMMIT;`);
  if (version < 4) db.exec(`BEGIN;
    CREATE TABLE response_attempts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, player_id TEXT NOT NULL REFERENCES session_players(id), clue_id TEXT NOT NULL, value INTEGER NOT NULL CHECK(typeof(value)='integer'), accepted_at TEXT NOT NULL, status TEXT NOT NULL, effective_outcome TEXT, timer TEXT NOT NULL);
    CREATE TABLE score_ledger (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, player_id TEXT NOT NULL REFERENCES session_players(id), clue_id TEXT, attempt_id TEXT REFERENCES response_attempts(id), amount INTEGER NOT NULL CHECK(typeof(amount)='integer'), kind TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, reference_id TEXT REFERENCES score_ledger(id));
    CREATE UNIQUE INDEX one_judgment_per_attempt ON score_ledger(attempt_id) WHERE kind='judgment';
    CREATE INDEX ledger_by_session ON score_ledger(session_id,player_id);
    CREATE INDEX attempts_by_session ON response_attempts(session_id);
    CREATE TABLE session_results (session_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    PRAGMA user_version=4; COMMIT;`);
  if(version<5){
    db.exec('BEGIN');
    try{
      if(!(db.prepare('PRAGMA table_info(clues)').all() as any[]).some(c=>c.name==='daily_double'))db.exec('ALTER TABLE clues ADD COLUMN daily_double INTEGER NOT NULL DEFAULT 0');
      if(!(db.prepare('PRAGMA table_info(response_attempts)').all() as any[]).some(c=>c.name==='kind'))db.exec("ALTER TABLE response_attempts ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard'");
      db.exec(`CREATE TABLE IF NOT EXISTS game_rounds (game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE, definition TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS round_answers (clue_id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE, answer TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS final_submissions (session_id TEXT NOT NULL, player_id TEXT NOT NULL REFERENCES session_players(id), starting_score INTEGER NOT NULL, wager INTEGER, wager_reason TEXT, wager_command_id TEXT, response TEXT NOT NULL DEFAULT '', response_revision INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, judgment TEXT, revealed INTEGER NOT NULL DEFAULT 0, attempt_id TEXT REFERENCES response_attempts(id), response_command_id TEXT, PRIMARY KEY(session_id,player_id));
        PRAGMA user_version=5;`);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(version<6){
    db.exec('BEGIN');
    try{
      if(!(db.prepare('PRAGMA table_info(categories)').all() as any[]).some(c=>c.name==='attempt_policy'))db.exec("ALTER TABLE categories ADD COLUMN attempt_policy TEXT NOT NULL DEFAULT 'one'");
      for(const row of db.prepare('SELECT game_id,definition FROM game_rounds').all() as {game_id:string;definition:string}[]){const definition=JSON.parse(row.definition);for(const c of definition.doubleJeopardy?.categories||[])c.attemptPolicy??='one';db.prepare('UPDATE game_rounds SET definition=? WHERE game_id=?').run(JSON.stringify(definition),row.game_id);}
      for(const row of db.prepare('SELECT slot,state FROM live_session').all() as {slot:number;state:string}[]){const s=JSON.parse(row.state);s.buzzerMode??='manual';for(const c of [...s.game.categories,...(s.game.doubleJeopardy?.categories||[])])c.attemptPolicy??='one';db.prepare('UPDATE live_session SET state=? WHERE slot=?').run(JSON.stringify(s),row.slot);}
      db.exec('PRAGMA user_version=6; COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(version<7){
    if(!(db.prepare('PRAGMA table_info(media)').all() as any[]).some(c=>c.name==='attribution'))db.exec("ALTER TABLE media ADD COLUMN attribution TEXT NOT NULL DEFAULT ''");
    db.exec('PRAGMA user_version=7');
  }
  function get(id:string): Game | undefined {
    const g = db.prepare('SELECT * FROM games WHERE id=?').get(id) as any;
    if (!g) return;
    const categories = (db.prepare('SELECT * FROM categories WHERE game_id=? ORDER BY position').all(id) as any[]).map(c => ({id:c.id, order:c.position, name:c.name, attemptPolicy:c.attempt_policy||'one', clues:(db.prepare('SELECT c.*, a.answer FROM clues c JOIN answers a ON a.clue_id=c.id WHERE category_id=? ORDER BY position').all(c.id) as any[]).map(q => ({id:q.id, order:q.position, value:q.value, text:q.text, answer:q.answer, imageId:q.image_id, audioId:q.audio_id,...(q.daily_double?{dailyDouble:true}:{})}))}));
    const optionRow=db.prepare('SELECT definition FROM game_rounds WHERE game_id=?').get(id) as {definition:string}|undefined;
    const options=optionRow?JSON.parse(optionRow.definition):{};
    const answers=new Map((db.prepare('SELECT clue_id,answer FROM round_answers WHERE game_id=?').all(id) as {clue_id:string;answer:string}[]).map(r=>[r.clue_id,r.answer]));
    if(options.doubleJeopardy){options.doubleJeopardy.categories.sort((a:any,b:any)=>a.order-b.order);for(const c of options.doubleJeopardy.categories){c.clues.sort((a:any,b:any)=>a.order-b.order);for(const q of c.clues)q.answer=answers.get(q.id)||'';}}
    if(options.finalJeopardy)options.finalJeopardy.clue.answer=answers.get(options.finalJeopardy.clue.id)||'';
    return {...options,id:g.id,title:g.title,description:g.description,updatedAt:g.updated_at,sample:Boolean(g.sample),revision:g.revision,categories};
  }
  function write(game:Game, create=false, insideTransaction=false) {
    if(!insideTransaction)db.exec('BEGIN IMMEDIATE');
    try {
      if (create) db.prepare('INSERT INTO games VALUES (?, ?, ?, ?, ?, ?)').run(game.id,game.title,game.description,game.updatedAt,Number(game.sample),game.revision);
      else {
        const result = db.prepare('UPDATE games SET title=?,description=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').run(game.title,game.description,game.updatedAt,game.id,game.revision);
        if (!result.changes) throw Object.assign(new Error('This game changed in another tab. Reopen it before saving.'), {status:409});
        db.prepare('DELETE FROM categories WHERE game_id=?').run(game.id);
      }
      for (const c of game.categories) {
        db.prepare('INSERT INTO categories VALUES (?, ?, ?, ?, ?)').run(c.id,game.id,c.order,c.name,c.attemptPolicy||'one');
        for (const q of c.clues) {
          for (const [mediaId, kind] of [[q.imageId,'image'],[q.audioId,'audio']]) if (mediaId && !(db.prepare('SELECT id FROM media WHERE id=? AND kind=?').get(mediaId,kind))) throw Object.assign(new Error(`The selected ${kind} attachment does not exist.`), {status:400});
          db.prepare('INSERT INTO clues VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(q.id,c.id,q.order,q.value,q.text,q.imageId,q.audioId,Number(Boolean(q.dailyDouble)));
          db.prepare('INSERT INTO answers VALUES (?, ?)').run(q.id,q.answer);
        }
      }
      db.prepare('DELETE FROM round_answers WHERE game_id=?').run(game.id);
      const options=JSON.parse(JSON.stringify({doubleJeopardy:game.doubleJeopardy,finalJeopardy:game.finalJeopardy}));
      const optionalClues=[...(options.doubleJeopardy?.categories.flatMap((c:any)=>c.clues)||[]),...(options.finalJeopardy?[options.finalJeopardy.clue]:[])];
      for(const q of optionalClues){
        for(const [mediaId,kind] of [[q.imageId,'image'],[q.audioId,'audio']])if(mediaId&&!db.prepare('SELECT id FROM media WHERE id=? AND kind=?').get(mediaId,kind))throw Object.assign(new Error(`The selected ${kind} attachment does not exist.`),{status:400});
        db.prepare('INSERT INTO round_answers VALUES (?,?,?)').run(q.id,game.id,q.answer);delete q.answer;
      }
      db.prepare('INSERT OR REPLACE INTO game_rounds VALUES (?,?)').run(game.id,JSON.stringify(options));
      if(!insideTransaction)db.exec('COMMIT');
    } catch (error) { if(!insideTransaction)db.exec('ROLLBACK'); throw error; }
    return get(game.id)!;
  }
  function create(title:string, description='', sample=false) {
    return write({id:crypto.randomUUID(),title,description,sample,updatedAt:new Date().toISOString(),revision:1,categories:emptyCategories()}, true);
  }
  function list():GameSummary[] {
    return (db.prepare('SELECT id FROM games ORDER BY updated_at DESC').all() as {id:string}[]).map(({id}) => {const g=get(id)!; return {id,title:g.title,description:g.description,updatedAt:g.updatedAt,sample:g.sample,ready:enabledClues(g).filter(isReady).length,total:enabledClues(g).length};});
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
  return { db, get, write, create, list, remove:(id:string)=>db.prepare('DELETE FROM games WHERE id=?').run(id), media:(id:string)=>db.prepare('SELECT * FROM media WHERE id=?').get(id) as (Media & {filename:string;attribution:string}) | undefined };
}
