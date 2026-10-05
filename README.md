# CHRONO OLED - High-Precision Browser Stopwatch

A specialized, true OLED-black (`#000000`) digital stopwatch engineered for power efficiency, zero eye strain, and millisecond accuracy. Built with a continuous background ticker and persistent memory.

---

## Key Features

- **True Pitch Black OLED Theme**: Pure `#000000` background ensures individual pixel shutdown on OLED and AMOLED screens.
- **Continuous Background Operation (Tab Minimization Proof)**:
  - **Zero-drift arithmetic**: Calculates elapsed time using wall-clock delta offsets (`Date.now()`), eliminating drift caused by browser throttling or OS sleep.
  - **Dedicated Web Worker**: Keeps high-frequency clock pulses alive even when the browser tab is minimized or switched to the background.
  - **Live Tab Title**: Displays live ticking time directly on the browser tab title (e.g. `⏱ 01:24.32 - CHRONO OLED`).
  - **Auto-Sync Visibility API**: Seamlessly recalculates and resumes smooth animation frames when re-entering the tab.
- **Lap & Split Delta Analytics**:
  - Live split time, total elapsed time, and timestamp for each recorded lap.
  - Automatic identification of **▲ Best Lap** (green highlight) and **▼ Slowest Lap** (red highlight) with delta comparisons.
  - Live summary card: Fastest Lap, Slowest Lap, Average Lap, and Total Laps.
  - Quick export: Copy formatted laps to clipboard or download as CSV file.
- **Persistent Session Memory**:
  - **Auto-Persistence**: Active state is saved continuously in `localStorage`. If you accidentally close the tab or reload, the stopwatch resumes exactly where you left off.
  - **Archived Runs Drawer**: Save completed sessions to permanent history with timestamp, total duration, lap count, and best lap.
  - **Backup & Restore**: Export history to JSON or restore previous laps onto the main board.
- **Audio Synthesizer (Web Audio API)**:
  - Toggleable subtle mechanical click feedback on Start, Stop, Lap, and Reset without external audio file dependencies.
- **OLED Color Customization**:
  - Matrix Emerald (`#00ff88`)
  - Cyber Cyan (`#00f3ff`)
  - Solar Amber (`#ffaa00`)
  - Pure Ghost White (`#ffffff`)
  - Crimson Red (`#ff3344`)
  - Neon Violet (`#bd00ff`)
- **Configurable Precision**:
  - Toggle between `.00s` (1/100th second) and `.000s` (1/1000th millisecond).

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Space** | Start / Pause |
| **L** | Record Lap / Split |
| **R** | Reset Stopwatch (with auto-archive safeguard) |
| **M** or **H** | Open / Close Memory & Archived Runs Drawer |
| **S** | Toggle Audio Click Tones |
| **F** | Toggle Fullscreen OLED Mode |
| **2** / **3** | Switch Precision between 2 and 3 decimal places |
| **Esc** | Close Modals |

---

## Quick Launch

- **Via Launcher**: Run [Launch_OLED_Stopwatch.bat](file:///c:/Tools/LAUNCHERS/Launch_OLED_Stopwatch.bat) in `C:\Tools\LAUNCHERS\`.
- **Via Direct File**: Double click [index.html](file:///c:/Tools/oled-stopwatch/index.html) to open in your default browser.
- **Via Local Server**: Run [start.bat](file:///c:/Tools/oled-stopwatch/start.bat) to launch `server.py` at `http://127.0.0.1:8110`.
