'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('./core');
function harness(seed = {}) {
  const values = new Map(Object.entries(seed)); const nodes = new Map();
  const node = name => {
    if (!nodes.has(name)) nodes.set(name,{value:'',textContent:'',hidden:true,open:false,disabled:false,replaceChildren(){},append(){},focus(){}});
    return nodes.get(name);
  };
  const storage = { getItem:key => values.get(key) ?? null, setItem(key,value) {
    if (storage.fail === key || storage.fail === '*') throw new Error('Quota exceeded'); values.set(key,value);
  } };
  const context = { ChronoCore:C, localStorage:storage, Date, JSON, Map, Set, performance, setTimeout, clearTimeout,
    document:{readyState:'loading',addEventListener(){},getElementById:node,querySelectorAll:() => [],
      createElement(tag) { return {tag,dataset:{},children:[],textContent:'',append(...children){this.children.push(...children);}}; },
      querySelector(selector) { const match = selector.match(/data-review-(subject|date|duration)="(\d+)"/); return match ? node(match[1]+match[2]) : null; }} };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('./app.js'),'utf8'),context);
  const app = Object.create(context.ChronoStopwatch.prototype);
  Object.assign(app,{storage,stale:false,noteTimers:new Map(),dirtyNotes:new Map(),tab:'timer',renderAll(){},renderTimer(){},renderBlocks(){},
    warn(message){this.warning=message;},toast(message){this.message=message;},open(name){this.opened=name;},close(name){this.closed=name;}});
  return {app,storage,values,node};
}
const fixture = () => C.migrate({customSubjects:['Math','Coding']});
const date = '2026-10-06';

test('notebook combines repeated subjects while retaining every original edit target', () => {
  const data = fixture(), {app} = harness({[C.KEY]:JSON.stringify(data)}); app.load();
  const entries = [
    {id:'a',date,subjectId:data.subjects[0].id,duration:24*60000,source:'manual'},
    {id:'b',date,subjectId:data.subjects[1].id,duration:60000,source:'manual'},
    {id:'c',date,subjectId:data.subjects[0].id,duration:10*60000,source:'manual'}
  ];
  const before = JSON.stringify(entries), list = app.groupedEntriesUI(entries);
  assert.equal(list.children.length,2);
  const group = list.children[0]; assert.equal(group.tag,'details'); assert.equal(group.open,false);
  assert.equal(group.children[0].children[1].textContent,'34m');
  const buttons = group.children[1].children.flatMap(row => row.children[1].children);
  assert.deepEqual(Array.from(buttons,button => button.dataset.value),['a','a','c','c']);
  assert.equal(app.groupedEntriesUI(entries,new Set([group.dataset.detail])).children[0].open,true);
  assert.equal(JSON.stringify(entries),before);
  assert.equal(app.groupedEntriesUI([]).children[0].textContent,'No saved study entries.');
});

test('time ranges are opt-in and missing historical timestamps are never inferred', () => {
  const data = fixture(), {app} = harness({[C.KEY]:JSON.stringify(data)}); app.load();
  const entry = {id:'timed',date,subjectId:data.subjects[0].id,duration:60000,source:'manual',startedAt:'2026-10-06T10:00:00.000Z',endedAt:'2026-10-06T10:01:00.000Z'};
  assert.equal(app.entriesUI([entry]).children[0].children[0].children.length,2);
  app.data.settings.showTimeRanges = true;
  assert.equal(app.entriesUI([entry]).children[0].children[0].children.length,3);
  assert.match(app.timeRange(entry),/\d{2}:\d{2} – \d{2}:\d{2}/);
  assert.equal(app.timeRange({duration:60000}),'Time range not recorded');
});

test('moving a timed entry preserves its observed range and displays its original dates', () => {
  const data = fixture();
  C.commitSession(data,'timed',[{date,subjectId:data.subjects[0].id,duration:60000,startedAt:'2026-10-06T10:00:00.000Z',endedAt:'2026-10-06T10:01:00.000Z'}]);
  const {app,node} = harness({[C.KEY]:JSON.stringify(data)}); app.load(); app.entryId = data.entries[0].id;
  node('entryDuration').value = '1m'; node('entrySubject').value = data.subjects[0].id; node('entryDate').value = '2026-10-07';
  app.saveEntry({preventDefault(){}});
  assert.equal(app.data.entries[0].startedAt,'2026-10-06T10:00:00.000Z'); assert.equal(app.data.entries[0].endedAt,'2026-10-06T10:01:00.000Z');
  assert.match(app.timeRange(app.data.entries[0]),/06\/10/);
  assert.equal(app.data.entries[0].duration,60000); assert.equal(app.data.entries[0].sessionId,'timed');
});
test('app migration reads the corrected end-session preference and preserves original keys', () => {
  const raw = JSON.stringify({[date]:{totalMs:60000,subjects:{Math:60000},notes:'original'}});
  const {app,storage} = harness({chrono_study_diary_v1:raw,chrono_focus_confirm_end:'auto'});
  app.load(); assert.equal(app.settings.confirm,'auto'); assert.equal(C.totals(app.data).total,60000);
  assert.equal(storage.getItem('chrono_study_diary_v1'),raw);
});
test('older active blocks are marked already credited and only unfinished time saves', () => {
  const old = {accumulatedTime:30*60000,accumulatedLapTime:10*60000,running:false,activeSubject:'Math',
    laps:[{duration:20*60000,subject:'Math',timestamp:new Date(date+'T12:00:00').getTime()}]};
  const {app} = harness({chrono_study_diary_v1:JSON.stringify({[date]:{totalMs:20*60000,subjects:{Math:20*60000}}}),chrono_focus_active_session:JSON.stringify(old)});
  app.load(); assert.equal(app.draft.running,false); assert.equal(app.draft.legacyNotice,true);
  assert.equal(app.draft.blocks[0].legacyCredited,true); assert.equal(app.draft.blockElapsed,10*60000);
  C.closeBlock(app.draft); const blocks = app.draft.blocks.filter(b => !b.legacyCredited);
  C.commitSession(app.data,app.draft.id,blocks); assert.equal(C.totals(app.data).total,30*60000);
});
test('failed discard preserves the recoverable draft and does not report success', () => {
  const data = fixture(), {app,storage} = harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.draft.elapsed=60000; app.draft.blockElapsed=60000; app.persistDraft();
  const original = storage.getItem(C.DRAFT_KEY); storage.fail = C.DRAFT_KEY; app.discard();
  assert.equal(app.draft.elapsed,60000); assert.equal(storage.getItem(C.DRAFT_KEY),original); assert.match(app.warning,/could not be saved/); assert.equal(app.closed,undefined);
});
test('save commits once even when clearing its persisted draft fails', () => {
  const data = fixture(), {app,storage,values} = harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.draft.elapsed=60000; app.draft.blockElapsed=60000; C.closeBlock(app.draft); app.persistDraft();
  app.reviewBlocks=C.clone(app.draft.blocks); storage.fail = C.DRAFT_KEY; app.saveSession(false);
  assert.equal(C.totals(app.data).total,60000); assert.equal(app.data.sessions.length,1);
  const reload = harness(Object.fromEntries(values)); reload.app.load(); assert.equal(C.draftTimes(reload.app.draft).total,0); assert.equal(C.totals(reload.app.data).total,60000);
});
test('session review validates adjusted inputs and preserves per-block subjects', () => {
  const data = fixture(), {app,node} = harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.reviewBlocks=[{date,duration:20*60000,subjectId:data.subjects[0].id},{date,duration:10*60000,subjectId:data.subjects[1].id}];
  app.reviewBlocks.forEach((b,i) => { node('subject'+i).value=b.subjectId; node('date'+i).value=b.date; node('duration'+i).value=b.duration/60000+'m'; });
  node('adjustTotal').value='15m'; app.saveSession(); assert.equal(C.totals(app.data).total,15*60000); assert.deepEqual(app.data.entries.map(e => e.duration),[10*60000,5*60000]);
  const before = C.clone(app.data); node('duration0').value='garbage'; app.saveSession(); assert.deepEqual(app.data,before); assert.match(node('reviewError').textContent,/valid date/);
});
test('restore persists replacement and draft atomically; reload keeps the restored draft paused', () => {
  const old = fixture(), restored = fixture(), {app,storage,values} = harness({[C.KEY]:JSON.stringify(old)}); app.load();
  C.commitSession(restored,'restored-session',[{date,duration:60000,subjectId:restored.subjects[0].id}]);
  const draft=C.newDraft(restored.subjects[1].id); draft.elapsed=30000; draft.blockElapsed=30000; draft.needsReview=true;
  app.pendingRestore={data:restored,draft}; storage.fail=C.DRAFT_KEY; app.confirmRestore();
  assert.equal(C.totals(app.data).total,60000); assert.equal(app.draft.elapsed,30000); assert.equal(app.draft.running,false);
  assert.equal(JSON.parse(storage.getItem(C.KEY)).restoredDraft.elapsed,30000);
  assert.equal(JSON.parse(storage.getItem('chrono_focus_pre_restore')).subjects[0].id,old.subjects[0].id);
  const reload=harness(Object.fromEntries(values)); reload.app.load(); assert.equal(reload.app.draft.elapsed,30000); assert.equal(reload.app.draft.running,false);
});
test('failed replacement leaves current committed records intact', () => {
  const old=fixture(), {app,storage,node}=harness({[C.KEY]:JSON.stringify(old)}); app.load(); const before=storage.getItem(C.KEY);
  app.pendingRestore={data:fixture(),draft:null}; storage.fail=C.KEY; app.confirmRestore();
  assert.equal(storage.getItem(C.KEY),before); assert.equal(app.data.subjects[0].id,old.subjects[0].id); assert.match(node('restoreError').textContent,/did not complete/);
});
test('malformed files and active-session restore attempts preserve data', async () => {
  const data=fixture(), {app,storage}=harness({[C.KEY]:JSON.stringify(data)}); app.load(); const before=storage.getItem(C.KEY);
  await app.readBackup({text:async () => '{invalid'}); assert.equal(app.pendingRestore,undefined); assert.match(app.message,/not restored/);
  app.draft.elapsed=60000; app.draft.blockElapsed=60000;
  await app.readBackup({text:async () => JSON.stringify(fixture())}); assert.match(app.message,/active session/); assert.equal(storage.getItem(C.KEY),before);
});
test('unsaved notes remain unsaved after write failure and are included in backup', () => {
  const data=fixture(), {app,storage}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.dirtyNotes.set(date,'<b>literal unsaved note</b>'); storage.fail=C.KEY;
  assert.equal(app.flushNotes(),false); assert.equal(app.data.notes[date],undefined); assert.equal(app.backupObject().notes[date],'<b>literal unsaved note</b>');
});
test('manual-time shorthand chooses its subject without switching the active timer', () => {
  const data=fixture(), {app,node}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  const active=app.draft.activeSubjectId;
  node('entryDuration').value='120 dk Coding'; node('entryDate').value=date; node('entrySubject').value=active;
  app.saveEntry({preventDefault(){}});
  assert.equal(app.data.entries[0].duration,120*60000); assert.equal(app.subjectName(app.data.entries[0].subjectId),'Coding'); assert.equal(app.draft.activeSubjectId,active);
});
