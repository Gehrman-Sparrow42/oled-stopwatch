'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('./core');
function harness(seed = {}) {
  const values = new Map(Object.entries(seed)); const nodes = new Map(), frames = new Map(); let frameId = 0;
  const node = name => {
    if (!nodes.has(name)) nodes.set(name,{value:'',textContent:'',hidden:true,open:false,disabled:false,children:[],replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},querySelectorAll(){return [];},setAttribute(name,value){this[name]=value;},focus(){}});
    return nodes.get(name);
  };
  const storage = { getItem:key => values.get(key) ?? null, setItem(key,value) {
    if (storage.fail === key || storage.fail === '*') throw new Error('Quota exceeded'); values.set(key,value);
  } };
  const classes = new Set();
  const context = { ChronoCore:C, localStorage:storage, Date, JSON, Map, Set, performance, setTimeout, clearTimeout,
    requestAnimationFrame(callback){const id=++frameId; frames.set(id,callback); return id;},cancelAnimationFrame(id){frames.delete(id);},
    document:{readyState:'loading',hidden:false,title:'',documentElement:{dataset:{}},body:{classList:{contains:name=>classes.has(name),toggle(name,enabled){if(enabled) classes.add(name); else classes.delete(name);}}},addEventListener(){},getElementById:node,querySelectorAll:() => [],
      createElement(tag) { return {tag,dataset:{},children:[],listeners:{},textContent:'',append(...children){this.children.push(...children);},addEventListener(event,callback){this.listeners[event]=callback;}}; },
      querySelector(selector) { const match = selector.match(/data-review-(subject|date|duration)="(\d+)"/); return match ? node(match[1]+match[2]) : null; }} };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('./app.js'),'utf8'),context);
  const app = Object.create(context.ChronoStopwatch.prototype);
  Object.assign(app,{storage,stale:false,noteTimers:new Map(),dirtyNotes:new Map(),tab:'timer',renderAll(){},renderTimer(){},renderBlocks(){},
    warn(message){this.warning=message;},toast(message){this.message=message;},open(name){this.opened=name;},close(name){this.closed=name;}});
  return {app,storage,values,node,context,frames};
}
const fixture = () => C.migrate({customSubjects:['Math','Coding']});
const date = '2026-10-06';

test('animation is single-instance and stops for hidden tabs, the notebook, pause and stale state', () => {
  const data=fixture(), {app,context,frames}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.draft.running=true; let renders=0; app.renderTimer=()=>{renders++;};
  app.startFrames(); app.startFrames(); assert.equal(frames.size,1);
  const [id,callback]=frames.entries().next().value; frames.delete(id); callback();
  assert.equal(renders,1); assert.equal(frames.size,1);
  app.tab='diary'; app.startFrames(); assert.equal(frames.size,0); assert.equal(app.raf,null);
  app.tab='timer'; app.startFrames(); assert.equal(frames.size,1);
  context.document.hidden=true; app.startFrames(); assert.equal(frames.size,0);
  context.document.hidden=false; app.startFrames(); assert.equal(frames.size,1);
  app.draft.running=false; app.startFrames(); assert.equal(frames.size,0);
  app.draft.running=true; app.stale=true; app.startFrames(); assert.equal(frames.size,0);
});

test('unchanged timer renders produce no repeated text writes and hidden timers produce none', () => {
  const data=fixture(), {app,node,context}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  const render=()=>context.ChronoStopwatch.prototype.renderTimer.call(app);
  let writes=0;
  for (const id of ['primaryTime','millisTime','statusPill','btnStart','blockPreview']) {
    let value=''; Object.defineProperty(node(id),'textContent',{get:()=>value,set(next){writes++; value=next;}});
  }
  render(); assert.equal(writes,5); writes=0;
  for(let i=0;i<1000;i++) render(); assert.equal(writes,0);
  app.tab='diary'; app.draft.elapsed=5000; app.draft.blockElapsed=5000; render(); assert.equal(writes,0);
  app.tab='timer'; context.document.hidden=true; render(); assert.equal(writes,0);
  context.document.hidden=false; render(); assert.ok(writes>0);
});

test('ordinary refreshes do not build closed dialogs or the hidden notebook', () => {
  const data=fixture(), {app,node,context}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  let history=0, settings=0, subjects=0, diary=0;
  app.renderHistory=()=>history++; app.renderSettings=()=>settings++; app.renderSubjects=()=>subjects++; app.renderDiary=()=>diary++;
  context.ChronoStopwatch.prototype.renderAll.call(app);
  assert.deepEqual([history,settings,subjects,diary],[0,0,0,0]);
  node('historyModal').open=true; node('settingsModal').open=true; app.tab='diary';
  context.ChronoStopwatch.prototype.renderAll.call(app);
  assert.deepEqual([history,settings,subjects,diary],[1,1,1,1]);
});

test('session entry rows are created only on expansion and released on collapse', () => {
  const data=fixture(); C.commitSession(data,'saved',[{date,subjectId:data.subjects[0].id,duration:120000}]);
  const {app,node}=harness({[C.KEY]:JSON.stringify(data)}); app.load(); let builds=0, releases=0;
  app.entriesUI=entries=>{assert.equal(entries.length,1); builds++; return {remove(){releases++;}};};
  app.renderHistory(); assert.equal(builds,0);
  const details=node('historyList').children[0].children.find(child=>child.tag==='details');
  details.open=true; details.listeners.toggle(); details.listeners.toggle(); assert.equal(builds,1);
  details.open=false; details.listeners.toggle(); assert.equal(releases,1);
  details.open=true; details.listeners.toggle(); assert.equal(builds,2);
});

test('closing Sessions releases its DOM and focus reference without changing saved data', () => {
  const data=fixture(), {app,node,context}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  const before=JSON.stringify(app.data), dialog=node('historyModal'); let focused=0;
  dialog.open=true; dialog.close=()=>{dialog.open=false;}; dialog.returnFocus={isConnected:true,focus(){focused++;}};
  node('historyList').append({textContent:'Old session DOM'});
  context.ChronoStopwatch.prototype.close.call(app,'historyModal');
  assert.equal(dialog.returnFocus,null); assert.equal(node('historyList').children.length,0); assert.equal(focused,1);
  assert.equal(JSON.stringify(app.data),before);
});

test('expired Undo snapshots are released by the regular maintenance tick', () => {
  const data=fixture(), {app}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.store.undo={data:C.clone(data),label:'Old delete',until:Date.now()-1}; app.updateUndo();
  assert.equal(app.store.undo,null); assert.deepEqual(app.data,data);
});

test('leaving the notebook saves pending notes, releases its DOM and resumes timer animation', () => {
  const data=fixture(), {app,node,frames}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.draft.running=true; app.draft.startedAt=Date.now(); app.startFrames(); assert.equal(frames.size,1);
  app.renderDiary=()=>{}; app.switchTab('diary'); assert.equal(frames.size,0);
  app.dirtyNotes.set(date,'Keep these pending notes'); node('daysList').append({textContent:'Old diary DOM'});
  app.switchTab('timer'); assert.equal(app.data.notes[date],'Keep these pending notes');
  assert.equal(node('daysList').children.length,0); assert.equal(frames.size,1); assert.equal(app.draft.running,true);
});

test('failed note saves prevent leaving and clearing the notebook', () => {
  const data=fixture(), {app,node,storage}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.tab='diary'; app.dirtyNotes.set(date,'Unsaved'); node('daysList').append({textContent:'Keep editor'}); storage.fail=C.KEY;
  app.switchTab('timer'); assert.equal(app.tab,'diary'); assert.equal(node('daysList').children.length,1);
  assert.equal(app.dirtyNotes.get(date),'Unsaved');
});

test('renaming the selected subject preserves saved progress and an active draft', () => {
  const data=fixture(); C.commitSession(data,'saved',[{date,subjectId:data.subjects[0].id,duration:120000}]); data.notes[date]='Original notes';
  const {app,node,values}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.draft.elapsed=45000; app.draft.blockElapsed=45000; app.draft.running=true; app.draft.startedAt=Date.now();
  const draft=JSON.stringify(app.draft), entries=JSON.stringify(app.data.entries), sessions=JSON.stringify(app.data.sessions);
  app.editSubject(app.draft.activeSubjectId);
  assert.equal(app.opened,'subjectModal'); assert.equal(node('renameSubjectName').value,'Math');
  node('renameSubjectName').value='Calculus'; app.renameSubject({preventDefault(){}});
  assert.equal(app.subjectName(app.draft.activeSubjectId),'Calculus'); assert.equal(JSON.stringify(app.draft),draft);
  assert.equal(JSON.stringify(app.data.entries),entries); assert.equal(JSON.stringify(app.data.sessions),sessions); assert.equal(app.data.notes[date],'Original notes');
  assert.equal(JSON.parse(values.get(C.KEY)).subjects[0].name,'Calculus');
  node('renameSubjectName').value=' Coding '; app.renameSubject({preventDefault(){}});
  assert.equal(app.subjectName(app.draft.activeSubjectId),'Calculus'); assert.match(node('subjectError').textContent,/already exists/);
});

test('week labels describe past, current and future weeks across calendar boundaries', () => {
  const data=fixture(), {app}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  const cases = [
    ['2026-11-07','monday','2026-11-02','This week'],
    ['2026-11-07','monday','2026-10-26','Last week'],
    ['2026-11-07','monday','2026-10-19','2 weeks ago'],
    ['2026-11-07','monday','2026-11-09','Next week'],
    ['2026-11-07','monday','2026-11-16','In 2 weeks'],
    ['2026-11-08','monday','2026-11-02','This week'],
    ['2026-11-08','sunday','2026-11-01','Last week'],
    ['2026-11-08','sunday','2026-11-08','This week'],
    ['2026-11-08','sunday','2026-11-15','Next week'],
    ['2027-01-01','monday','2026-12-28','This week'],
    ['2027-01-01','monday','2026-12-21','Last week'],
    ['2027-01-01','monday','2027-01-04','Next week'],
    ['2026-03-09','monday','2026-03-02','Last week'],
    ['2026-03-02','monday','2026-03-16','In 2 weeks'],
    ['2026-11-02','monday','2026-10-19','2 weeks ago']
  ];
  const before=JSON.stringify(app.data);
  for (const [today,weekStart,viewed,expected] of cases) {
    app.data.settings.weekStart=weekStart; app.week=new Date(viewed+'T12:00:00');
    const viewedTime=app.week.getTime();
    assert.equal(app.weekLabel(new Date(today+'T12:00:00')),expected);
    assert.equal(app.week.getTime(),viewedTime);
  }
  app.data.settings.weekStart='monday'; assert.equal(JSON.stringify(app.data),before);
});

test('week labels change at the configured local week boundary', () => {
  const data=fixture(), {app}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.week=new Date('2026-11-02T00:00:00');
  assert.equal(app.weekLabel(new Date('2026-11-08T23:59:59')),'This week');
  assert.equal(app.weekLabel(new Date('2026-11-09T00:00:00')),'Last week');
  app.data.settings.weekStart='sunday'; app.week=new Date('2026-11-01T00:00:00');
  assert.equal(app.weekLabel(new Date('2026-11-07T23:59:59')),'This week');
  assert.equal(app.weekLabel(new Date('2026-11-08T00:00:00')),'Last week');
});

test('an open notebook refreshes once when the local date advances', () => {
  const data=fixture(), {app}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.tab='diary'; app.diaryDate='2000-01-01'; let refreshes=0;
  app.renderDiary=()=>{refreshes++; app.diaryDate=C.dateKey();};
  app.tick(); app.tick(); assert.equal(refreshes,1);
  app.tab='timer'; app.diaryDate='2000-01-01'; app.tick(); assert.equal(refreshes,1);
});

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
  assert.equal(group.children.length,1); group.open=true; group.listeners.toggle();
  const buttons = group.children[1].children.flatMap(row => row.children[1].children);
  assert.deepEqual(Array.from(buttons,button => button.dataset.value),['a','a','c','c']);
  assert.equal(app.groupedEntriesUI(entries,new Set([group.dataset.detail])).children[0].open,true);
  const single=list.children[1]; assert.equal(single.tag,'details'); assert.equal(single.className,group.className); assert.equal(single.open,false);
  assert.equal(single.children[0].children[0].children[1].textContent,'1 entry · View details');
  assert.equal(single.children[0].children[1].textContent,'1m');
  assert.equal(single.children.length,1); single.open=true; single.listeners.toggle();
  assert.deepEqual(Array.from(single.children[1].children[0].children[1].children,button => button.dataset.value),['b','b']);
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

test('combined timing summaries state the missing count once and retain individual statuses', () => {
  const data=fixture(), {app}=harness({[C.KEY]:JSON.stringify(data)}); app.load(); app.data.settings.showTimeRanges=true;
  const base={date,subjectId:data.subjects[0].id,duration:120000,source:'manual'};
  const entries=[{...base,id:'a'},{...base,id:'b'},{...base,id:'c',startedAt:'2026-10-06T10:00:00.000Z',endedAt:'2026-10-06T10:02:00.000Z'}];
  const group=app.groupedEntriesUI(entries).children[0], label=group.children[0].children[0].children[2].textContent;
  assert.match(label,/2 entries without recorded times/); assert.doesNotMatch(label,/Time range not recorded/);
  group.open=true; group.listeners.toggle();
  assert.equal(group.children[1].children[0].children[0].children[2].textContent,'Time range not recorded');
});

test('empty sessions disappear from history while their replay protection remains stored', () => {
  const data=fixture(); C.commitSession(data,'saved',[{date,subjectId:data.subjects[0].id,duration:120000}]); data.entries=[];
  const {app,node}=harness({[C.KEY]:JSON.stringify(data)}); app.load(); const before=JSON.stringify(app.data);
  app.renderHistory();
  assert.equal(node('historyList').children.length,1); assert.equal(node('historyList').children[0].textContent,'Saved sessions will appear here.');
  assert.equal(node('clearHistory').disabled,true); assert.equal(JSON.stringify(app.data),before);
  assert.equal(C.commitSession(app.data,'saved',[{date,subjectId:data.subjects[0].id,duration:120000}]),false);
});

test('short sessions end automatically without a review or phantom saved session', () => {
  for (const confirm of ['always','auto']) {
    const data=fixture(), {app}=harness({[C.KEY]:JSON.stringify(data)}); app.load(); app.data.settings.confirm=confirm;
    app.draft.elapsed=119999; app.draft.blockElapsed=119999; app.endSession();
    assert.equal(app.draft.elapsed,0); assert.equal(app.data.entries.length,0); assert.equal(app.data.sessions.length,0);
    assert.equal(app.opened,undefined); assert.match(app.message,/under 2 minutes discarded/);
  }
});

test('a short final block never discards a qualifying earlier subject', () => {
  for (const confirm of ['always','auto']) {
    const data=fixture(), {app}=harness({[C.KEY]:JSON.stringify(data)}); app.load(); app.data.settings.confirm=confirm;
    app.renderReview=()=>{};
    app.draft.elapsed=120000; app.draft.blockElapsed=120000; C.closeBlock(app.draft);
    app.draft.activeSubjectId=data.subjects[1].id; app.draft.elapsed+=45000; app.draft.blockElapsed=45000;
    app.endSession();
    if (confirm==='always') { assert.equal(app.opened,'reviewModal'); app.saveSession(false); }
    assert.equal(app.data.entries.length,1); assert.equal(app.data.entries[0].subjectId,data.subjects[0].id);
    assert.equal(C.totals(app.data).total,120000); assert.equal(app.draft.elapsed,0);
  }
});

test('switching subjects while paused discards only the short old block and persists the new subject', () => {
  const data=fixture(), {app,values}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.draft.elapsed=45000; app.draft.blockElapsed=45000;
  app.chooseSubject(data.subjects[1].id);
  assert.equal(app.draft.running,false); assert.equal(app.draft.elapsed,0); assert.equal(app.draft.blocks.length,0);
  assert.equal(app.draft.activeSubjectId,data.subjects[1].id);
  const reload=harness(Object.fromEntries(values)); reload.app.load();
  assert.equal(reload.app.draft.activeSubjectId,data.subjects[1].id); assert.equal(reload.app.draft.elapsed,0);
});

test('review adjustments below the minimum are filtered after validation', () => {
  const data=fixture(), {app,node}=harness({[C.KEY]:JSON.stringify(data)}); app.load();
  app.reviewBlocks=[{date,subjectId:data.subjects[0].id,duration:120000},{date,subjectId:data.subjects[1].id,duration:120000}];
  app.reviewBlocks.forEach((b,i)=>{node('subject'+i).value=b.subjectId; node('date'+i).value=date; node('duration'+i).value=i ? '2m' : '119.999s';});
  app.saveSession(); assert.equal(app.data.entries.length,1); assert.equal(app.data.entries[0].subjectId,data.subjects[1].id); assert.equal(C.totals(app.data).total,120000);
  assert.match(app.message,/under 2 minutes discarded/);
});

test('moving a timed entry preserves its observed range and displays its original dates', () => {
  const data = fixture();
  C.commitSession(data,'timed',[{date,subjectId:data.subjects[0].id,duration:120000,startedAt:'2026-10-06T10:00:00.000Z',endedAt:'2026-10-06T10:02:00.000Z'}]);
  const {app,node} = harness({[C.KEY]:JSON.stringify(data)}); app.load(); app.entryId = data.entries[0].id;
  node('entryDuration').value = '1m'; node('entrySubject').value = data.subjects[0].id; node('entryDate').value = '2026-10-07';
  app.saveEntry({preventDefault(){}});
  assert.equal(app.data.entries[0].startedAt,'2026-10-06T10:00:00.000Z'); assert.equal(app.data.entries[0].endedAt,'2026-10-06T10:02:00.000Z');
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
  app.draft.elapsed=120000; app.draft.blockElapsed=120000; C.closeBlock(app.draft); app.persistDraft();
  app.reviewBlocks=C.clone(app.draft.blocks); storage.fail = C.DRAFT_KEY; app.saveSession(false);
  assert.equal(C.totals(app.data).total,120000); assert.equal(app.data.sessions.length,1);
  const reload = harness(Object.fromEntries(values)); reload.app.load(); assert.equal(C.draftTimes(reload.app.draft).total,0); assert.equal(C.totals(reload.app.data).total,120000);
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
  C.commitSession(restored,'restored-session',[{date,duration:120000,subjectId:restored.subjects[0].id}]);
  restored.entries[0].duration=60000; // Historical short records remain valid on restore.
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
