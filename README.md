# CHRONO FOCUS - OLED Study & Productivity Timer

A standalone, true OLED-black (`#000000`) timer engineered specifically for deep work, study sessions, and focus intervals. Built with zero-drift background tracking, study block logging, and persistent session memory.

---

## Study-Centric Features

- **True Pitch Black OLED Design**: Pure `#000000` background ensures zero eye strain during late-night study sessions and saves power on OLED/AMOLED screens.
- **Continuous Background Operation (Tab Minimization & Sleep Proof)**:
  - **Zero-drift arithmetic**: Calculates elapsed time using monotonic wall-clock delta offsets (`Date.now()`), so time never freezes or drifts when the tab is backgrounded or your laptop sleeps.
  - **Dedicated Web Worker**: Runs a background clock thread so title notifications and intervals keep ticking without main-thread browser throttling.
  - **Live Tab Study Clock**: Displays active study time directly on your browser tab (e.g. `⏱ 45:12.00 - CHRONO FOCUS`), letting you keep track of your study session while reading in other tabs.
- **Study Block & Interval Tracking**:
  - Log study blocks (chapters, topics, Pomodoro intervals, problem sets) with split durations and cumulative study time.
  - Live session metrics:
    - **Total Study Time**: Overall time spent studying in the active session.
    - **Active Block**: Live timer for your current study block.
    - **Average Block**: Average duration of your study blocks.
    - **Blocks Logged**: Total study intervals completed.
- **Persistent Study Memory & Daily Log**:
  - Automatically preserves active study sessions across page refreshes and browser restarts.
  - Ending a study session archives it to the **Study Log & History Drawer** with date, time, total focus time, and completed blocks.
  - Quick export options: Copy formatted study log to clipboard, download CSV, or backup all study history as JSON.
- **OLED Ambient Color Themes**:
  - Matrix Emerald, Cyber Cyan, Solar Amber, Pure Ghost White, Crimson Red, and Neon Violet.
- **Subtle Audio Cues**:
  - Toggleable soft audio chimes on Study Start, Break/Pause, Next Block, and Session End.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Space</kbd> | Start Study / Take Break |
| <kbd>L</kbd> or <kbd>B</kbd> | Log Next Study Block / Topic Split |
| <kbd>R</kbd> | End Session (Auto-Archives to Study Log) |
| <kbd>M</kbd> or <kbd>H</kbd> | Open / Close Study History Drawer |
| <kbd>S</kbd> | Toggle Audio Cues |
| <kbd>F</kbd> | Toggle Fullscreen OLED Focus Mode |
| <kbd>2</kbd> / <kbd>3</kbd> | Switch Precision between 2 and 3 decimal places |

---

## How to Use

- **Standalone File**: Double-click [index.html](file:///c:/Tools/oled-stopwatch/index.html) in any web browser. Completely offline, zero install.
- **Launcher**: Run [Launch_OLED_Stopwatch.bat](file:///c:/Tools/LAUNCHERS/Launch_OLED_Stopwatch.bat) from `C:\Tools\LAUNCHERS\`.
