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
  C.commitSession(data,'s1',[{date,subjectId:data.subjects[0].id,duration:minute}]);
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
  const data = fixture(); C.commitSession(data,'s',[{date,subjectId:data.subjects[0].id,duration:minute}]);
  data.subjects[0].hidden = true; assert.equal(C.validate(data).entries[0].subjectId,data.subjects[0].id);
  data.subjects[1].name = ' math '; assert.throws(() => C.validate(data),/subject/);
});
test('resyncing unchanged notes retains renamed subject identities', () => {
  const data=fixture(); C.applySync(data,date,C.syncEntries(data,date,'10m Math'));
  const sid=data.entries[0].subjectId; data.subjects.find(s => s.id === sid).name='Calculus';
  C.applySync(data,date,C.syncEntries(data,date,'10m Math'));
  assert.equal(data.entries[0].subjectId,sid); assert.equal(data.subjects.length,2); assert.equal(C.totals(data).total,10*minute);
});
