# CHRONO FOCUS - OLED Study Timer & Weekly Notebook Diary

A zero-distraction, true OLED-black (`#000000`) study companion combining a high-precision study timer with a **Weekly Study Notebook & Diary** inspired by physical paper note-taking.

---

## 📓 Weekly Study Notebook & Diary

Designed specifically for students and knowledge workers who love keeping a daily study diary in their physical notebooks:

- **Weekly 7-Day Pages (Mon - Sun)**:
  - Organizes your week chronologically:
    `Mon (05/10)`, `Tue (06/10)`, `Wed (07/10)`, `Thur (08/10)`, `Fri (09/10)`, `Sat (10/10)`, `Sun (11/10)`.
  - Automatically highlights **TODAY** with a glowing OLED badge.
  - Navigate effortlessly across past and future weeks with `← Prev Week` and `Next Week →`.
- **Subject-Specific Study Hours**:
  - Automatically logs study time under chosen subjects (e.g. `Math: 2h 15m`, `Coding: 3h 40m`, `Reading: 1h`, `Overall Work`).
  - Total daily hours are calculated and displayed on each day's header.
  - **`+ Add Time`**: Easily log offline study or reading hours away from the computer.
- **Digital OLED Notebook Notes**:
  - Write notes, chapters covered, problem sets solved, or reflections for every day of the week.
  - **Auto-Saves Continuously**: Every keystroke is saved directly into `localStorage`.
  - **`+ Stamp Hours`**: One-click stamps a clean summary of that day's studied subjects directly into your diary notes.
- **Weekly Summary & Export**:
  - Displays total week focus time, daily average, and top studied subject.
  - **`📋 Copy Diary`**: Copies the entire week's notes and study hours to clipboard.
  - **`↓ Export .md`**: Exports a clean Markdown notebook file.

---

## ⏱ Live Study Timer

- **Active Subject / Task Selector**:
  - Switch between subjects on the fly (`Math`, `Coding`, `Reading`, `Overall Work`, or custom).
  - Time is automatically credited to the selected subject in your notebook diary.
- **True OLED Pitch Black (`#000000`)**:
  - Zero eye strain during late-night study sessions; saves battery on OLED/AMOLED screens.
- **Continuous Background Operation**:
  - Monotonic wall-clock arithmetic (`Date.now()`) with an inline Web Worker ticker ensures 100% accuracy when tabs are minimized or laptop sleeps.
  - Shows live time directly on the browser tab title: `⏱ 45:12.00 - [Math] CHRONO FOCUS`.

---

## ⚙️ Fully Configurable Experience (<kbd>P</kbd>)

You are never locked into default subjects or rigid setups:

- **Dynamic Study Subjects**:
  - Add, rename, or delete any subjects (e.g. `Bioinformatics`, `Physics`, `History`, `Thesis Writing`, `Japanese`, `Guitar`).
  - Delete default subjects (`Math`, `Coding`, etc.) with a single click `✕` if you do not need them.
  - Quick `+ Add` button directly in the timer view for on-the-fly subject creation without opening settings.
  - All custom subjects immediately sync across the Live Timer chips, active subject inputs, Manual Time entry dialogs, and Weekly Diary summaries.
- **Customizable Daily Study Goals**:
  - Set your daily target from 1 to 10 hours per day (default 4h).
  - Each day card in the Weekly Notebook displays a live dynamic progress bar (`.day-goal-bar`) showing completion percentage against your target.
- **Flexible Calendar & Date Formatting**:
  - Choose whether your week starts on **Monday** or **Sunday**.
  - Choose between European `DD/MM` and US `MM/DD` date formats.
- **Periodic Focus Chimes**:
  - Optional ambient audio chime interval (25m Pomodoro, 30m, 45m, 50m, 60m, or Off).

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Space</kbd> | Start Study / Take Break |
| <kbd>L</kbd> or <kbd>B</kbd> | Log Next Study Block / Topic Split |
| <kbd>R</kbd> | End Session (Saves to Today's Notebook) |
| <kbd>N</kbd> | Switch between **Live Timer** and **Weekly Notebook** |
| <kbd>P</kbd> | Open **Preferences & Subject Manager** |
| <kbd>M</kbd> | Open Past Sessions Archive |
| <kbd>S</kbd> | Toggle Soft Audio Cues |
| <kbd>F</kbd> | Toggle Fullscreen OLED Focus Mode |
| <kbd>2</kbd> / <kbd>3</kbd> | Toggle Precision (1/100s or 1/1000s) |

---

## 🚀 How to Launch

- **Direct Browser File**: Double-click [index.html](file:///c:/Tools/oled-stopwatch/index.html) in your browser. Completely self-contained and offline-ready.
- **Launcher**: Run [Launch_OLED_Stopwatch.bat](file:///c:/Tools/LAUNCHERS/Launch_OLED_Stopwatch.bat) from `C:\Tools\LAUNCHERS\`.

