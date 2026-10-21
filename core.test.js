'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./core');
const minute = 60000;
const date = '2026-10-06';
function fixture() { return C.migrate({ customSubjects:['Math','Coding'], studyDiary:{}, savedRuns:[] }); }
function storage(data) {
  const values = new Map([[C.KEY,JSON.stringify(data)]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) };
}

test('best day sums all subjects for the displayed week and resolves ties chronologically', () => {
  const data=fixture(), sid=data.subjects[0].id, other=data.subjects[1].id, week=new Date(2026,9,19);
  assert.equal(C.bestDay(data,week),null);
  const entry=(id,date,subjectId,duration)=>({id,date,subjectId,duration,source:'manual'});
  data.entries.push(entry('mon','2026-10-19',sid,60*minute),entry('tue1','2026-10-20',sid,90*minute),
    entry('tue2','2026-10-20',other,60*minute),entry('wed','2026-10-21',sid,150*minute),
    entry('outside','2026-10-26',sid,500*minute));
  const before=JSON.stringify(data);
  assert.deepEqual(C.bestDay(data,week),{date:'2026-10-20',total:150*minute});
  assert.deepEqual(C.bestDay(data,new Date(2026,9,26)),{date:'2026-10-26',total:500*minute});
  assert.equal(C.bestDay(data,new Date(2026,9,12)),null); assert.equal(JSON.stringify(data),before);
  data.entries.push(entry('sun','2026-10-25',sid,300*minute));
  assert.deepEqual(C.bestDay(data,week),{date:'2026-10-25',total:300*minute});
  assert.deepEqual(C.bestDay(data,new Date(2026,9,18)),{date:'2026-10-20',total:150*minute});
});

test('daily average includes elapsed calendar days, including today and days without study', () => {
  const data=fixture(), sid=data.subjects[0].id, monday=new Date(2026,9,19);
  data.entries.push({id:'mon',date:'2026-10-19',subjectId:sid,duration:120*minute,source:'manual'},
    {id:'tue',date:'2026-10-20',subjectId:sid,duration:60*minute,source:'manual'},
    {id:'future',date:'2026-10-23',subjectId:sid,duration:300*minute,source:'manual'});
  assert.deepEqual(C.weekAverage(data,monday,new Date(2026,9,19)),{days:1,total:120*minute,average:120*minute});
  assert.deepEqual(C.weekAverage(data,monday,new Date(2026,9,20,23,59)),{days:2,total:180*minute,average:90*minute});
  assert.deepEqual(C.weekAverage(data,monday,new Date(2026,9,21)),{days:3,total:180*minute,average:60*minute});
  assert.equal(C.weekAverage(data,monday,new Date(2026,9,26)).days,7);
  assert.equal(C.weekAverage(data,monday,new Date(2026,9,26)).average,480*minute/7);
  assert.deepEqual(C.weekAverage(data,monday,new Date(2026,9,18)),{days:0,total:0,average:null});
  assert.equal(C.weekAverage(fixture(),monday,new Date(2026,9,20)).average,0);
});

test('daily average respects Sunday-start weeks and calendar boundaries', () => {
  const data=fixture();
  assert.equal(C.weekAverage(data,new Date(2026,9,18),new Date(2026,9,20)).days,3);
  assert.equal(C.weekAverage(data,new Date(2025,11,29),new Date(2026,0,1)).days,4);
  assert.equal(C.weekAverage(data,new Date(2024,1,26),new Date(2024,2,1)).days,5);
  assert.equal(C.weekAverage(data,new Date(2026,2,23),new Date(2026,2,29)).days,7);
});

test('goal visibility defaults off for existing records and toggles without changing progress', () => {
  const data = fixture(); delete data.settings.showGoals; data.settings.goal = 6;
  C.commitSession(data,'existing-session',[{date,duration:124*minute,subjectId:data.subjects[0].id}]);
  data.notes[date] = 'Existing daily note';
  const draft = C.newDraft(data.subjects[0].id); draft.elapsed = 10*minute; draft.blockElapsed = 10*minute;
  const {data: restored, draft: restoredDraft} = C.backup({...data, draft});
  assert.equal(restored.settings.showGoals,false);
  assert.deepEqual(restoredDraft,draft);
  const store = new C.Store(storage(restored),restored);
  for (const visible of [true,false,true]) {
    store.commit(next => { next.settings.showGoals = visible; });
    const reloaded = new C.Store(store.storage,C.validate(JSON.parse(store.storage.getItem(C.KEY))));
    assert.equal(reloaded.data.settings.showGoals,visible);
    assert.equal(reloaded.data.settings.goal,6);
    assert.deepEqual(reloaded.data.entries,data.entries);
    assert.deepEqual(reloaded.data.sessions,data.sessions);
    assert.deepEqual(reloaded.data.notes,data.notes);
  }
});
test('completed blocks stay provisional; 20 + 10 minutes commits once', () => {
  const data = fixture(), draft = C.newDraft(data.subjects[0].id), start = Date.now()-30*minute;
  draft.running = true; draft.startedAt = start;
  C.closeBlock(draft,start+20*minute);
  assert.equal(C.totals(data).total,0);
  C.pause(draft,start+30*minute); C.closeBlock(draft,start+30*minute);
  assert.equal(C.commitSession(data,draft.id,draft.blocks),true);
  assert.equal(C.totals(data).total,30*minute);
  assert.equal(C.commitSession(data,draft.id,draft.blocks),false);
  assert.equal(C.totals(data).total,30*minute);
  assert.equal(data.sessions.length,1);
});

test('timer ranges capture start and end across pauses, survive reload and backup, and keep breaks out of totals', () => {
  const data = fixture(), draft = C.newDraft(data.subjects[0].id);
  const start = Date.parse('2026-10-06T10:00:00.000Z');
  draft.running = true; draft.startedAt = start;
  C.pause(draft,start+10*minute);
  const restored = C.validateDraft(JSON.parse(JSON.stringify(draft)),data);
  restored.running = true; restored.startedAt = start+20*minute;
  C.pause(restored,start+25*minute);
  C.closeBlock(restored,start+30*minute);
  assert.equal(restored.blocks[0].startedAt,new Date(start).toISOString());
  assert.equal(restored.blocks[0].endedAt,new Date(start+25*minute).toISOString());
  assert.equal(restored.blocks[0].duration,15*minute);
  C.commitSession(data,'timed-session',restored.blocks);
  const backup = C.backup({...data,draft:restored});
  assert.equal(backup.data.entries[0].startedAt,restored.blocks[0].startedAt);
  assert.equal(backup.data.entries[0].endedAt,restored.blocks[0].endedAt);
  assert.equal(C.totals(backup.data).total,15*minute);
  data.settings.showTimeRanges = true;
  assert.equal(C.validate(data).settings.showTimeRanges,true);
  for (const range of [{startedAt:'invalid',endedAt:'invalid'}, {startedAt:new Date(start).toISOString()}, {startedAt:new Date(start).toISOString(),endedAt:new Date(start-1).toISOString()}]) {
    const invalid = C.clone(data); Object.assign(invalid.entries[0],{startedAt:undefined,endedAt:undefined},range);
    assert.throws(() => C.validate(invalid),/time range/);
  }
});

test('recovered older drafts do not invent a start time for pre-existing elapsed work', () => {
  const data = fixture(), draft = C.newDraft(data.subjects[0].id), start = Date.parse('2026-10-06T10:00:00.000Z');
  draft.elapsed = 10*minute; draft.blockElapsed = 10*minute;
  draft.running = true; draft.startedAt = start;
  C.closeBlock(draft,start+minute);
  assert.equal(draft.blocks[0].duration,11*minute);
  assert.equal(draft.blocks[0].startedAt,undefined);
  assert.equal(draft.blocks[0].endedAt,undefined);
  C.closeBlock(draft,start+3*minute);
  assert.equal(draft.blocks[1].startedAt,new Date(start+minute).toISOString());
  assert.equal(draft.blocks[1].endedAt,new Date(start+3*minute).toISOString());
});
test('discarding a draft with completed blocks never touches committed records', () => {
  const data = fixture(), original = C.clone(data), draft = C.newDraft(data.subjects[0].id);
  draft.running = true; draft.startedAt = Date.now()-20*minute; C.closeBlock(draft);
  const reset = C.newDraft(draft.activeSubjectId);
  assert.equal(C.draftTimes(reset).total,0); assert.deepEqual(data,original);
});
test('subject transitions preserve attribution and pause excludes break time', () => {
  const data = fixture(), draft = C.newDraft(data.subjects[0].id), start = Date.now()-100*minute;
  draft.running = true; draft.startedAt = start;
  C.closeBlock(draft,start+20*minute); draft.activeSubjectId = data.subjects[1].id;
  C.pause(draft,start+30*minute);
  assert.equal(C.draftTimes(draft,start+90*minute).total,30*minute);
  draft.running = true; draft.startedAt = start+90*minute;
  C.pause(draft,start+100*minute); C.closeBlock(draft,start+100*minute);
  C.commitSession(data,draft.id,draft.blocks);
  assert.deepEqual([...C.totals(data).bySubject.values()],[20*minute,20*minute]);
  assert.equal(C.totals(data).total,40*minute);
});

test('timer minimum is exact and discarded blocks leave a valid zeroed draft', () => {
  const data = fixture(), start = Date.parse('2026-10-20T10:00:00.000Z');
  for (const duration of [1,119999,120000,120001]) {
    const draft = C.newDraft(data.subjects[0].id); draft.running=true; draft.startedAt=start;
    assert.equal(C.closeBlock(draft,start+duration),duration>=120000);
    assert.equal(draft.elapsed,duration>=120000 ? duration : 0);
    assert.equal(draft.blockElapsed,0); assert.equal(draft.blockStartedAt,undefined);
    assert.equal(draft.blocks.length,duration>=120000 ? 1 : 0);
    assert.equal(C.validateDraft(draft,data).running,true);
  }
});

test('short subject switches never transfer time or timestamps into the next subject', () => {
  const data = fixture(), draft = C.newDraft(data.subjects[0].id), start = Date.parse('2026-10-20T10:00:00.000Z');
  draft.running=true; draft.startedAt=start;
  assert.equal(C.closeBlock(draft,start+45000),false);
  draft.activeSubjectId=data.subjects[1].id;
  C.closeBlock(draft,start+45000+5*minute);
  draft.activeSubjectId=data.subjects[0].id;
  C.pause(draft,start+45000+7*minute); C.closeBlock(draft,start+45000+7*minute);
  C.commitSession(data,draft.id,draft.blocks);
  assert.deepEqual(data.entries.map(e => [e.subjectId,e.duration]),[[data.subjects[1].id,5*minute],[data.subjects[0].id,2*minute]]);
  assert.equal(data.entries[0].startedAt,new Date(start+45000).toISOString());
  assert.equal(C.totals(data).total,7*minute);
  assert.equal(C.validateDraft(draft,data).elapsed,7*minute);
});

test('pause and resume accumulate toward the minimum while breaks never count', () => {
  const data = fixture(), draft = C.newDraft(data.subjects[0].id), start = Date.parse('2026-10-20T10:00:00.000Z');
  draft.running=true; draft.startedAt=start; C.pause(draft,start+minute);
  const restored=C.validateDraft(JSON.parse(JSON.stringify(draft)),data);
  restored.running=true; restored.startedAt=start+4*minute;
  assert.equal(C.closeBlock(restored,start+5*minute),true);
  assert.equal(restored.blocks[0].duration,2*minute);
  assert.equal(restored.blocks[0].endedAt,new Date(start+5*minute).toISOString());
});

test('saving filters new short blocks without modifying existing history or creating empty sessions', () => {
  const data = fixture(), sid=data.subjects[0].id;
  data.entries.push({id:'old-short',date,subjectId:sid,duration:1000,source:'manual'});
  const before=C.clone(data);
  assert.equal(C.commitSession(data,'all-short',[{date,subjectId:sid,duration:119999}]),false);
  assert.deepEqual(data,before);
  assert.equal(C.commitSession(data,'mixed',[{date,subjectId:sid,duration:119999},{date,subjectId:sid,duration:120000}]),true);
  assert.equal(data.entries.length,2); assert.equal(C.totals(data).total,121000);
  assert.equal(C.validate(data).entries[0].duration,1000);
});
test('draft persistence and restoration do not count checkpoint time twice', () => {
  const data = fixture(), draft = C.newDraft(data.subjects[0].id), now = Date.now();
  draft.running = true; draft.startedAt = now-10*minute;
  C.checkpoint(draft,now-5*minute);
  const restored = C.validateDraft(JSON.parse(JSON.stringify(draft)),data);
  assert.equal(C.draftTimes(restored,now).total,10*minute);
  C.pause(restored,now); assert.equal(C.draftTimes(restored,now+minute).total,10*minute);
});
test('negative clock intervals never subtract elapsed time', () => {
  const d = C.newDraft('subject'); d.elapsed = minute; d.blockElapsed = minute; d.running = true; d.startedAt = Date.now()+minute;
  C.pause(d); assert.equal(d.elapsed,minute);
});
test('whole-session adjustment preserves proportions and exact rounded total', () => {
  assert.deepEqual(C.allocate(15*minute,[20*minute,10*minute]),[10*minute,5*minute]);
  assert.equal(C.allocate(1001,[1,1,1]).reduce((a,b) => a+b,0),1001);
  assert.throws(() => C.allocate(1,[1,1]));
});
test('legacy migration keeps recorded daily totals and never adds archives', () => {
  const original = {customSubjects:['Math'], studyDiary:{[date]:{totalMs:30*minute,subjects:{Math:30*minute},notes:'My notes'}},
    savedRuns:[{totalTime:30*minute,subject:'Math',date:'06/10/2026',time:'10:00',laps:[]}]};
  const data = C.migrate(original);
  assert.equal(C.totals(data).total,30*minute); assert.equal(data.notes[date],'My notes'); assert.equal(data.entries[0].source,'legacy');
  assert.equal(data.sessions[0].legacy,true); assert.equal(original.studyDiary[date].totalMs,30*minute);
});
test('inconsistent legacy subject totals are scaled to preserve the recorded daily total', () => {
  const data = C.migrate({customSubjects:['Math','Coding'],studyDiary:{[date]:{totalMs:30*minute,subjects:{Math:30*minute,Coding:30*minute}}}});
  assert.equal(C.totals(data).total,30*minute); assert.deepEqual(data.entries.map(e => e.duration),[15*minute,15*minute]);
});
test('backup round trip includes settings, notes, IDs, entries, and paused-capable draft', () => {
  const data = fixture(); data.settings.theme = 'violet'; data.notes[date] = '<b>literal</b>';
  C.commitSession(data,'s1',[{date,subjectId:data.subjects[0].id,duration:2*minute}]);
  const draft = C.newDraft(data.subjects[1].id);
  const result = C.backup(JSON.parse(JSON.stringify({...data,draft})));
  assert.deepEqual(result.data,data); assert.deepEqual(result.draft,draft);
  assert.equal(C.backup({studyDiary:{},savedRuns:[]}).data.version,2);
});
test('invalid backups, references, dates, and drafts are rejected', () => {
  assert.throws(() => C.backup({version:3}));
  const data = fixture(); data.entries.push({id:'bad',date:'2026-02-30',subjectId:data.subjects[0].id,duration:minute,source:'manual'});
  assert.throws(() => C.backup(data)); data.entries[0].date = date; data.entries[0].duration = Infinity; assert.throws(() => C.backup(data));
  data.entries[0].duration = minute; data.entries[0].subjectId = 'missing'; assert.throws(() => C.backup(data));
  const clean = fixture(), draft = C.newDraft(clean.subjects[0].id); draft.elapsed = minute;
  assert.throws(() => C.backup({...clean,draft}));
});
test('duration parsing is predictable and rejects zero, negatives, NaN, and huge values', () => {
  for (const text of ['45','45m','45 min','45 dk']) assert.equal(C.duration(text),45*minute);
  assert.equal(C.duration('1.5h'),90*minute); assert.equal(C.duration('1,5h'),90*minute);
  assert.equal(C.duration('93.395s'),93395); assert.equal(C.duration('0.001s'),1);
  for (const text of ['0','-1m','NaN','Infinity','1e99h','99999999999999999999m','45m garbage']) assert.equal(C.duration(text),null);
  assert.equal(C.studyLine('100dk Math',['Math']).duration,100*minute);
  assert.equal(C.studyLine('40 dk molbio diff eq tekrar',['molbio']).subject,'molbio');
});
test('calendar parser supports leap dates, ISO and both date formats', () => {
  assert.equal(C.parseDate('2024-02-29',2026,'DD/MM'),'2024-02-29');
  assert.equal(C.parseDate('29/02',2026,'DD/MM'),null); assert.equal(C.parseDate('31/04',2026,'DD/MM'),null);
  assert.equal(C.parseDate('10/06',2026,'MM/DD'),date); assert.equal(C.parseDate('06/10/26',2000,'DD/MM'),date);
});
test('repeat imports and syncing imported lines do not duplicate time', () => {
  const data = fixture(), parsed = C.parseImport('06/10\n20m Math\n10m Coding\nrest',2026,'DD/MM',['Math','Coding']);
  assert.equal(C.applyImport(data,parsed),true); assert.equal(C.applyImport(data,parsed),false);
  assert.equal(C.totals(data).total,30*minute);
  C.applySync(data,date,C.syncEntries(data,date,data.notes[date])); assert.equal(C.totals(data).total,30*minute);
  const synced = C.syncEntries(data,date,data.notes[date]+'\n5m Math'); C.applySync(data,date,synced); C.applySync(data,date,synced);
  assert.equal(C.totals(data).total,35*minute);
});
test('note sync replaces only generated entries and ignores stamped summaries', () => {
  const data = fixture(); data.entries.push({id:C.id(),date,subjectId:data.subjects[0].id,duration:minute,source:'manual'});
  C.applySync(data,date,C.syncEntries(data,date,'10m Math')); C.applySync(data,date,C.syncEntries(data,date,'20m Math\n[Study summary] Math: 21m'));
  assert.equal(C.totals(data).total,21*minute); assert.equal(data.entries.filter(e => e.source === 'manual').length,1);
  C.applySync(data,date,C.syncEntries(data,date,'plain notes')); assert.equal(C.totals(data).total,minute);
});
test('invalid multi-day imports cannot partially commit', () => {
  const data = fixture(), original = C.clone(data), parsed = C.parseImport('06/10\n20m Math\n31/02\n10m Coding',2026,'DD/MM');
  assert.ok(parsed.errors.length); assert.throws(() => C.applyImport(data,parsed)); assert.deepEqual(data,original);
});
test('rename, entry edits, date moves, deletion and undo keep derived totals consistent', () => {
  const data = fixture(); C.commitSession(data,'s1',[{date,subjectId:data.subjects[0].id,duration:30*minute}]); data.notes[date] = 'retain me';
  const memory = storage(data), store = new C.Store(memory,data);
  store.commit(d => { d.subjects[0].name = 'Calculus'; d.entries[0].duration = 20*minute; d.entries[0].date = '2026-10-07'; });
  assert.equal(C.totals(store.data,date).total,0); assert.equal(C.totals(store.data,'2026-10-07').total,20*minute);
  store.commit(d => { d.entries = []; },'Cleared'); assert.equal(C.totals(store.data).total,0); assert.equal(store.data.notes[date],'retain me');
  store.undoLast(); assert.equal(C.totals(store.data).total,20*minute); assert.equal(store.data.subjects[0].name,'Calculus');
});
test('new mutations invalidate undo and stale revisions cannot overwrite data', () => {
  const data = fixture(), memory = storage(data), store = new C.Store(memory,data), stale = new C.Store(memory,C.clone(data));
  store.commit(d => { d.notes[date] = 'updated'; },'Change'); assert.throws(() => stale.commit(d => { d.notes[date] = 'overwrite'; }),/another tab/);
  store.commit(d => { d.notes[date] = 'newer'; }); assert.equal(store.undo,null);
  assert.throws(() => store.undoLast(),/expired/); assert.equal(JSON.parse(memory.getItem(C.KEY)).notes[date],'newer');
});
test('storage failures leave committed data and in-memory state unchanged', () => {
  const data = fixture(), memory = storage(data), store = new C.Store(memory,data), before = memory.getItem(C.KEY);
  memory.setItem = () => { throw new Error('Quota exceeded'); };
  assert.throws(() => store.commit(d => { d.notes[date] = 'unsaved'; }),/Quota/); assert.deepEqual(store.data,data); assert.equal(memory.getItem(C.KEY),before);
});
test('duplicate subjects are rejected, removed subjects retain historical references', () => {
  const data = fixture(); C.commitSession(data,'s',[{date,subjectId:data.subjects[0].id,duration:2*minute}]);
  data.subjects[0].hidden = true; assert.equal(C.validate(data).entries[0].subjectId,data.subjects[0].id);
  data.subjects[1].name = ' math '; assert.throws(() => C.validate(data),/subject/);
});
test('resyncing unchanged notes retains renamed subject identities', () => {
  const data=fixture(); C.applySync(data,date,C.syncEntries(data,date,'10m Math'));
  const sid=data.entries[0].subjectId; data.subjects.find(s => s.id === sid).name='Calculus';
  C.applySync(data,date,C.syncEntries(data,date,'10m Math'));
  assert.equal(data.entries[0].subjectId,sid); assert.equal(data.subjects.length,2); assert.equal(C.totals(data).total,10*minute);
});
