# Remote Access Guide: Claude Code from Your iPhone

This guide covers how to control the CT Collection Threshold Learning project
from your iPhone using Claude Code's **Remote Control** and **Dispatch** features.

---

## Quick Reference

| Feature | Purpose | How to Activate |
|---------|---------|----------------|
| **Remote Control** | Continue an active session from your phone (approve permissions, send messages) | Type `/remote-control` inside a Claude Code session |
| **Dispatch** | Send brand-new tasks from your phone to your PC | Managed through the Claude Desktop app |

---

## Feature 1: Remote Control

### What It Does

Remote Control syncs your active Claude Code terminal session to your iPhone.
You can:

- **Approve "allow access" permission prompts** from your phone
- **Send follow-up messages** to the same conversation
- **Monitor progress** of long-running tasks
- **Resume interaction** from anywhere

### How to Use

#### Step-by-Step

1. **Start Claude Code** (double-click `launch_claude.bat` or open a terminal):
   ```
   cd F:\Master_Python_Scripts\CT_Collection_Threshold_Learning
   claude
   ```

2. **Inside the Claude Code session**, type:
   ```
   /remote-control
   ```

3. A **QR code** appears in your terminal

4. **On your iPhone:**
   - Open your Camera app
   - Point at the QR code
   - Tap the notification to open in the Claude app
   - (Make sure you're signed into the same Anthropic account)

5. **You're connected!** The session now syncs between your terminal and phone

#### Typical Workflow

1. **At your desk:** Start a complex task in Claude Code
   ```
   > Refactor the biomarker extraction system and update all 41 mappers
   ```

2. **Enable remote control before walking away:**
   ```
   /remote-control
   ```

3. **Scan the QR code** with your iPhone

4. **Walk away from your desk**

5. **On your iPhone:** Permission prompts appear — tap to approve them

6. **Come back to your desk:** Terminal shows everything that happened

#### Important Notes

- Your **PC must stay on** and the terminal must stay open
- The session is the **same conversation** — not a copy
- Messages you send from your phone appear in the terminal and vice versa
- If your phone disconnects, type `/remote-control` again for a fresh QR code
- The QR code is tied to your Anthropic account — only you can use it

---

## Feature 2: Dispatch

### What It Does

Dispatch lets you send **new, independent tasks** to your PC from your iPhone
via the Claude Desktop app. Think of it as a remote command center.

### Prerequisites

- **Claude Desktop app** installed on your PC (separate from Claude Code CLI)
  - Download from: https://claude.ai/download
- **Claude app** installed on your iPhone
- **Same Anthropic account** signed in on both

### How to Use

1. **Open Claude Desktop** on your PC
2. Dispatch is available in the **Cowork tab**
3. **On your iPhone**, open the Claude app
4. Go to the **Cowork tab**
5. Send a task:
   ```
   Run python scripts/import_civic_evidence.py in my CT Pipeline project
   ```
6. Dispatch routes the task to your PC and executes it
7. Results stream back to your phone

#### Example Tasks from Your iPhone via Dispatch

```
How many biomarker-therapy associations are in the database?

Run pytest tests/ and tell me if anything fails

Show me git status for the CT Pipeline project

What's the current TCGA patient count with MGMT data?
```

---

## Convenience Launchers

Two batch files are in the project root — double-click to use:

### `launch_claude.bat` — Claude Code Only

- Activates the Python virtual environment
- Launches Claude Code in the project directory
- Displays a reminder to type `/remote-control` for iPhone access

### `launch_claude_server.bat` — Full Stack

Starts everything in separate windows:

1. **FastAPI backend** server (port 8000)
2. **React frontend** dev server (port 5173)
3. **Claude Code** session (main window)

---

## Session Lifecycle & Restarting

### Q: If I close Claude Code, do I need to set up Remote Control again?

**Yes.** Remote Control is tied to the active session:

- **Close Claude Code** → Remote Control disconnects, phone loses connection
- **Reopen Claude Code** → Type `/remote-control` again → scan new QR code
- The **launcher script** opens Claude Code for you; you just need to type
  `/remote-control` and scan

### Q: What about my conversation history?

- **Conversation history** is preserved between sessions. Use `claude -c` or
  `claude --resume` to pick up where you left off.
- **Remote Control connections** do NOT persist — you need a new QR scan each time.

### Q: What if my PC goes to sleep?

- Both features require your PC to be awake and running
- If your PC sleeps, Claude Code pauses
- When it wakes up, the terminal session resumes but you'll need to type
  `/remote-control` again and rescan

### Q: Can I use Remote Control and Dispatch at the same time?

Yes. They serve different purposes:

| Scenario | Use This |
|----------|----------|
| Started a task on laptop, need to approve permissions from phone | **Remote Control** |
| Away from desk entirely, want to kick off a new task from phone | **Dispatch** |
| At your desk, working normally | **Terminal** (as usual) |

---

## First-Time Setup Checklist

### On Your PC

1. **Claude Code CLI** installed:
   ```
   npm install -g @anthropic-ai/claude-code
   ```
   Verify: `claude --version` should show a version number

2. **Claude Desktop app** installed (for Dispatch):
   - Download from https://claude.ai/download

3. **Signed in** to your Anthropic account in both

### On Your iPhone

1. **Claude app** installed from the App Store
2. **Signed in** with the **same Anthropic account** as your PC

### First Test

1. Double-click `launch_claude.bat`
2. Claude Code starts in the terminal
3. Type: `/remote-control`
4. QR code appears
5. Scan with iPhone → opens in Claude app
6. Send a test message from your phone: "What directory are we in?"
7. You should see the message and response in both your terminal and phone

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Launcher window closes immediately | Fixed — previous version used invalid flags. Re-download the updated `launch_claude.bat` |
| No QR code after `/remote-control` | Make sure Claude Code is up to date: `claude update` |
| Phone can't connect after scanning | Verify same Anthropic account on both devices |
| Permission prompt not on phone | Make sure you ran `/remote-control` and scanned before starting the task |
| Session disconnected on phone | Type `/remote-control` again in terminal, scan new QR |
| "claude" not recognized | Run `npm install -g @anthropic-ai/claude-code` |
