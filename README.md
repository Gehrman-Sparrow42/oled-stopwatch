# CHRONO FOCUS

A private study stopwatch and weekly notebook with a pitch-black OLED interface. Plain JavaScript, CSS, and a small Python static server. No accounts, telemetry, external fonts, or frontend dependencies.

## Start

Use `C:\Tools\LAUNCHERS\Launch_OLED_Stopwatch.bat`, or run:

```powershell
& C:\Tools\.venv\Scripts\python.exe server.py
```

The server binds to `http://127.0.0.1:8110`. You can also open `index.html` directly. Browser storage belongs to its origin: direct-file mode, `localhost`, `127.0.0.1`, and different ports may have separate records. Use the same address consistently, or transfer a backup.

## Study sessions

Start study, pause during breaks, and choose Next block when you finish a topic. Changing the subject closes the previous block under its original subject. All blocks remain in a recoverable draft until you finish the session.

End session opens a review with editable subjects, dates, and durations. Save commits the session exactly once to the notebook and session archive. Discard removes the unfinished session without changing recorded diary totals. Whole-session duration adjustment preserves the proportions of the reviewed blocks. Each block defaults to its local completion date; sessions are not automatically split at midnight.

Preferences can enable immediate saving, but recovered drafts and timing anomalies always require review. The warning threshold measures session duration, not detected user inactivity.

Elapsed time uses timestamps rather than counting worker ticks. HTTP mode uses a one-second background worker; direct-file mode uses a regular ticker. Browsers can suspend either mechanism. Reloaded running drafts include the time while the page was closed, so review long sessions before saving. Clock changes detected during use pause the timer for review. Timestamps are wall-clock values, not a monotonic precision clock; timing cannot be guaranteed through every sleep or OS clock change.

## Notebook and subjects

The weekly notebook retains seven chronological days, daily goals, subject totals, and autosaved freeform notes. Expand Entries to edit duration, date, or subject. Linked session totals update from those entries. Subject badges retain a remove-time control with Undo. Day actions offers manual time, note sync, summary stamping, and clearing time. Clearing time preserves notes. Manual time accepts durations or shorthand such as `120 dk Math`.

Preferences supports adding, renaming, and removing subjects. Renaming updates historical labels and drafts through stable IDs without altering note text. Removing hides a subject from selection and retains its recorded history. Duplicate names and removal of the last selectable subject are prevented.

Deleting an entry, a day's time, or one session offers ten seconds of Undo. Another committed edit invalidates Undo. Deleting a session removes its linked diary entries. Deleting the entire archive requires confirmation; manual entries, imports, legacy daily totals, and notes remain.

## Notes, imports, and exports

Durations accept `120 dk`, `90m`, `1.5h`, `1,5h`, and seconds such as `30s`. A bare number always means minutes. Notes also accept shorthand such as `40 dk molbio diff eq tekrar`; the longest existing subject prefix takes precedence.

Sync notes previews what will be recorded and replaces only that day's previous note-generated entries. Repeating a sync does not add time again. Imported lines and stamped study summaries are excluded. Editing a synced entry manually can be superseded by a later sync of its source notes.

Paste diary accepts dates such as `06/10`, `06/10/2026`, or `2026-10-06`, followed by study lines or ordinary notes. Short dates follow Preferences' date format. Invalid calendar dates prevent the entire import. Changing the text, year, or format invalidates its preview. Applying identical text with the same year and format again is a no-op. Distinct imported batches add records; intentional corrections should be made in Entries.

Copy or export the current week as Markdown. Completed draft blocks can be copied or exported as CSV from the collapsible block section. Subjects and notes containing HTML are displayed literally.

## Backup and recovery

Preferences → Download backup exports all entries, notes, sessions, subjects, preferences, and the active draft. Download a backup regularly: clearing browser data removes local records.

Restore validates the complete JSON file and previews its contents before replacing current data. Finish or discard an active session before replacement. Both current v2 backups and the original app's unversioned JSON exports are supported. Drafts from restored backups reopen paused for review. A Previous snapshot download in Preferences provides the data from before the most recent successful restore attempt.

Data and the restored draft are replaced in one localStorage write. Quota or access failures leave committed state intact and display an error. Notes remain marked unsaved on failure and are included in downloaded backups. Another tab changing data or the draft pauses this tab and requires reload before editing.

### Upgrade from the earlier app

Existing daily subject totals become editable entries labeled Legacy daily total. Recorded daily totals are preserved; inconsistent subject breakdowns are scaled to match their stored daily total. Old archive sessions remain historical references and do not add time to the diary again. Historical double-counting cannot be reliably corrected automatically.

An older active draft reopens paused. Its completed blocks were already credited by the earlier app, so only its unfinished/new blocks can be saved. The original `chrono_*` storage keys are retained, untouched, for recovery. The v2 committed document is `chrono_focus_data_v2`; the draft is `chrono_focus_draft_v2`.

## Minimal display and keyboard access

Focus view shows the subject, timer, status, and essential controls. Exit focus view remains visible. Fullscreen is independent. Accent and precision choices live in Preferences. The UI uses system fonts, visible focus outlines, native modal dialogs, and no decorative animation.

| Key | Action |
| --- | --- |
| Space | Start / pause (focused buttons retain normal Space activation) |
| L / B | Next block |
| R | End session |
| N | Switch timer / notebook |
| P | Preferences |
| M / H | Sessions |
| F | Fullscreen |
| S | Toggle sound |
| 2 / 3 | Hundredths / milliseconds |
| Escape | Close dialog or exit focus view |

Timer shortcuts are suppressed inside dialogs and editable fields. Tab selects controls; Left/Right arrows change the selected main tab.

## Validation

```powershell
node --test core.test.js app.test.js
node --check core.js
node --check app.js
node --check worker.js
& C:\Tools\.venv\Scripts\python.exe -m py_compile server.py test_health.py
& C:\Tools\.venv\Scripts\python.exe test_health.py
```

The health test runs the production static handler on an available loopback port, checks the HTML and all application assets, then closes its server.
