# CHRONO FOCUS ⏱️📓

> **A true OLED pitch-black study companion combining a zero-drift precision timer with a physical-paper-inspired Weekly Study Notebook & Diary.**

![OLED Pitch Black](https://img.shields.io/badge/Theme-True%20OLED%20%23000000-00f3ff)
![Zero Drift](https://img.shields.io/badge/Precision-Background%20Web%20Worker-00ff66)
![Storage](https://img.shields.io/badge/Persistence-Client--Side%20LocalStorage-ffaa00)
![Offline Ready](https://img.shields.io/badge/Architecture-100%25%20Offline%20%26%20Zero--Dependency-blueviolet)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

---

## 🌟 Highlights

- **Pitch-Black OLED Interface (`#000000`)**: Designed specifically for late-night focus sessions with zero eye strain and maximal battery savings on OLED / AMOLED displays.
- **Physical-Notebook Study Diary**: Emulates the natural habit of keeping a physical paper notebook diary with chronological 7-day pages (`Mon` through `Sun`), day-by-day notes, and subject breakdowns.
- **Smart Note Parser & Quick-Paste**: Write or paste natural shorthand notes like `120 dk diff`, `70 dk molbio`, or `40 dk molbio diff eq tekrar` and have the app automatically parse minutes, register subjects, and log daily hours!
- **Dynamic Subject Manager**: You are never locked into predefined subjects. Add, rename, or delete subjects (`diff`, `molbio`, `mass`, `biomaterial`, `coding`, `reading`, etc.) on the fly with a single click.
- **Customizable Daily Study Goals**: Set your daily focus target (1h to 10h/day). Every day card features a live dynamic progress bar visualizing your progress.
- **Zero-Drift Background Continuity**: Powered by monotonic wall-clock arithmetic (`Date.now()`) and an inline Web Worker ticker that never slows down or drifts when tabs are minimized or the OS throttles timers.
- **100% Private & Offline**: All data stays locally in your browser's `localStorage`. No accounts, no cloud tracking, no cookies, zero external network dependencies.

---

## 📓 Weekly Study Notebook & Diary

### 1. Natural Paper-Style Logging
Students and knowledge workers often jot down notes in notebooks like this:

```text
06/04
120 dk diff
07/04
55 dk diff
70 dk molbio
08/04
100dk molbio
09/04
40 dk molbio diff eq tekrar
130 dk mass
10/04
170dk mass
11/04
nothin
```

CHRONO FOCUS treats this shorthand as a first-class citizen:
- **`⚡ Sync Note` Button**: Type or paste lines like `120 dk diff` directly into any day's note block, click `⚡ Sync Note`, and the app immediately parses durations (`dk`, `min`, `m`, `h`), totals the hours, extracts the subject, and updates that day's progress bar.
- **`📥 Paste Diary` (Multi-Day Batch Importer)**: Paste an entire exam week or month of notes into the Quick-Paste modal. The app parses every date, detects rest days (`nothin`), creates new subjects automatically, and loads the week into your diary.
- **`+ Add Time` Modal**: Supports offline study logging with flexible natural inputs (`120 dk`, `90m`, `1.5h`, or quick shorthand `120 dk diff`).

### 2. 7-Day Chronological Weekly Layout
- Displays your full week (`Mon` to `Sun` or `Sun` to `Sat`).
- Highlights **TODAY** with a glowing cyan OLED badge.
- Navigate across weeks with `← Prev Week` and `Next Week →`, or jump instantly to current week with `Today`.
- Auto-saves every keystroke continuously to `localStorage` with a subtle visual indicator.
- **`+ Stamp Hours`**: One-click stamps a clean summary of that day's studied subjects directly into your diary notes.

### 3. Weekly Summary & Export
- Live ribbon summarizing **Total Focus Hours**, **Daily Average**, and **Top Studied Subject**.
- **`📋 Copy Diary`**: One-click copies the full formatted week to clipboard for archiving or sending.
- **`↓ Export .md`**: Downloads a clean Markdown file formatted for Obsidian, Notion, or personal logs.

---

## ⏱️ Live Study Timer

- **Active Subject Picker**: Quick-select chips or type custom subjects on the fly. Time elapsed is credited automatically to that subject.
- **Study Blocks & Topic Splits**: Tap <kbd>L</kbd> or `Next Block` as you finish chapters or topics. A live block preview tracks split times.
- **Browser Tab Live Mirroring**: The browser tab title updates continuously (e.g. `⏱ 45:12.00 - [diff] CHRONO FOCUS`), allowing you to track progress even when the tab is in the background.
- **Audio Feedback**: Subtle synthesized web-audio clicks and optional periodic interval chimes (25m Pomodoro, 30m, 45m, 50m, 60m).
- **Session Archive Drawer (<kbd>M</kbd>)**: Review past stopwatch sessions, inspect individual lap blocks, export JSON backups, or export CSV tables.

---

## ⚙️ Preferences & Customization (<kbd>P</kbd>)

| Setting | Options / Description |
| :--- | :--- |
| **Manage Subjects** | Create any custom subject chip; delete any subject with `✕`. |
| **Daily Study Goal** | Select daily target from `1h` to `10h/day` (default `4h`). |
| **Week Starts On** | `Monday (Mon - Sun)` or `Sunday (Sun - Sat)`. |
| **Date Display Format** | `DD/MM` (e.g. `06/04`) or `MM/DD` (e.g. `04/06`). |
| **Periodic Focus Chimes** | `Off`, `25m (Pomodoro)`, `30m`, `45m`, `50m`, or `60m`. |
| **Theme Accents** | Emerald Cyan, Cyber Blue, Solar Gold, Crimson, Obsidian Mono. |
| **Timer Precision** | `1/100s` (<kbd>2</kbd>) or `1/1000s` (<kbd>3</kbd>). |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Space</kbd> | Start Study / Take Break |
| <kbd>L</kbd> or <kbd>B</kbd> | Log Next Study Block / Topic Split |
| <kbd>R</kbd> | End Session (Saves to Today's Notebook) |
| <kbd>N</kbd> | Switch between **Live Timer** and **Weekly Notebook** |
| <kbd>P</kbd> | Open **Preferences & Subject Manager** |
| <kbd>M</kbd> or <kbd>H</kbd> | Open Past Sessions Archive |
| <kbd>S</kbd> | Toggle Soft Audio Cues |
| <kbd>F</kbd> | Toggle Fullscreen OLED Focus Mode |
| <kbd>2</kbd> / <kbd>3</kbd> | Toggle Precision (1/100s vs 1/1000s) |
| <kbd>Esc</kbd> | Close any open modal |

---

## 🚀 Getting Started

### Option 1: Standalone Browser File (Zero Setup)
Simply double-click [index.html](file:///c:/Tools/oled-stopwatch/index.html) in any modern browser (Chrome, Edge, Firefox, Brave, Safari). No installation, build steps, or internet connection required.

### Option 2: Windows Desktop Launcher
Run the dedicated launcher from `C:\Tools\LAUNCHERS\`:
```cmd
C:\Tools\LAUNCHERS\Launch_OLED_Stopwatch.bat
```

### Option 3: Local Python HTTP Server
```bash
python server.py
# Opens automatically at http://127.0.0.1:8110
```

---

## 🔒 Privacy & Architecture

- **100% Local**: No external telemetry, no remote servers, no third-party CDNs.
- **Web Worker Ticker**: Prevents browser throttling during background execution.
- **Data Export & Portability**: Full JSON backup/restore and Markdown exports guarantee you always own your study data.

---

*Crafted for distraction-free deep work and disciplined study habits.*
