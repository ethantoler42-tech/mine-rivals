# Mine Rivals

Two-player real-time Minesweeper PvP. Each player plants 100 secret mines, then clears the shared 100×100 grid while trying not to trigger either player's traps.

## Run locally

Use Node 18+:

```powershell
node server.js
```

Open `http://localhost:3000` in two browser tabs (or two devices on the same network using the host machine's IP address). The first connection becomes Player 1; the second becomes Player 2. Add `?room=anything` to create a separate room.

## Put it online with Render

1. Create a GitHub repository and upload this entire folder.
2. Create a free account at Render and choose **New → Blueprint**.
3. Connect the GitHub repository. Render reads `render.yaml` and configures the app automatically.
4. Click **Apply**. When the deploy completes, Render gives you a public `onrender.com` address to share.

This free setup is for testing with friends. It can sleep after inactivity and game rooms reset if the server restarts.

## Current rules

- Place exactly 100 mines, then lock in. Mines are secret during setup.
- Both players clear in real time. Any mine costs the clicking player one of three lives.
- Clearing a safe tile earns one point; surrounding-number clues count all mines.
- Flags are private notes. Each player has two five-by-five scans and one reveal ability.
