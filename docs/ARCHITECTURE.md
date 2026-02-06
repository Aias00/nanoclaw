# NanoClaw Architecture Documentation

## Overview

NanoClaw is a lightweight personal Claude assistant accessible via WhatsApp, Discord, and other messaging platforms. The core philosophy is "small enough to understand" - unlike OpenClaw's 52+ modules, NanoClaw delivers the same functionality in a codebase you can fully comprehend in under an hour.

### Core Principles

- **Container Isolation**: Agents run in Linux containers (Apple Container on macOS, Docker on Linux) with OS-level filesystem isolation
- **Single Process Architecture**: One Node.js process handles everything - no microservices, no message queues
- **AI-Native Development**: No installation wizards; Claude Code guides setup and debugging
- **Skills Over Features**: Contributors provide skill files (e.g., `/add-telegram`) rather than adding features directly

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     HOST (macOS/Linux)                       │
│                  Main Node.js Process                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐              ┌────────────────────┐       │
│  │  WhatsApp    │─────────────▶│   SQLite Database  │       │
│  │  (baileys)   │◀─────────────│   (messages.db)    │       │
│  └──────────────┘              └─────────┬──────────┘       │
│                                           │                  │
│  ┌──────────────┐                        │                  │
│  │   Discord    │────────────────────────┘                  │
│  │ (discord.js) │                                           │
│  └──────────────┘                                           │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────┐    ┌──────────────────┐              │
│  │  Message Loop    │    │  Scheduler Loop  │              │
│  │  (polls SQLite)  │    │  (checks tasks)  │              │
│  └────────┬─────────┘    └────────┬─────────┘              │
│           │                       │                         │
│           └───────────┬───────────┘                         │
│                       │ spawns container                    │
│                       ▼                                     │
├─────────────────────────────────────────────────────────────┤
│          CONTAINER (Apple Container or Docker)              │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Claude Agent SDK Runtime                 │  │
│  │                                                        │  │
│  │  Working dir: /workspace/group                        │  │
│  │  Volume mounts:                                        │  │
│  │    • groups/{name}/ → /workspace/group                │  │
│  │    • groups/global/ → /workspace/global (non-main)     │  │
│  │    • sessions/{group}/.claude/ → /home/node/.claude/  │  │
│  │    • ipc/{group}/ → /workspace/ipc                    │  │
│  │                                                        │  │
│  │  Tools:                                                │  │
│  │    • Bash, Read/Write/Edit, Glob, Grep                │  │
│  │    • WebSearch, WebFetch                              │  │
│  │    • nanoclaw MCP (scheduler, group management)       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
nanoclaw/
├── src/                      # Main application code
│   ├── index.ts              # Main app: WhatsApp/Discord, message routing
│   ├── config.ts             # Configuration constants (trigger, paths)
│   ├── types.ts              # TypeScript interface definitions
│   ├── db.ts                 # SQLite database operations
│   ├── container-runner.ts  # Container agent spawner
│   ├── codex-runner.ts       # Codex CLI runtime (lightweight alternative)
│   ├── discord.ts            # Discord integration
│   ├── task-scheduler.ts    # Scheduled task executor
│   ├── whatsapp-auth.ts     # WhatsApp authentication utility
│   ├── mount-security.ts    # Mount path security validation
│   ├── logger.ts            # Structured logging
│   └── utils.ts             # Utility functions
│
├── container/               # Container image and runtime
│   ├── Dockerfile            # Container image (includes Claude Code CLI)
│   ├── build.sh             # Build script
│   └── agent-runner/        # Code running inside container
│       └── src/
│           ├── index.ts      # Entrypoint (reads JSON, runs Agent SDK)
│           └── ipc-mcp.ts   # MCP server for host communication
│
├── groups/                   # Per-group isolated workspaces
│   ├── CLAUDE.md            # Global memory (all groups read, main writes)
│   ├── main/                # Main control channel (self-chat)
│   │   └── CLAUDE.md        # Main channel-specific memory
│   └── {GroupName}/         # Independent folders for other groups
│       └── CLAUDE.md        # Group-specific memory
│
├── data/                     # Application state (gitignored)
│   ├── sessions.json         # Session IDs per group
│   ├── registered_groups.json # Registered group configurations
│   ├── router_state.json     # Last processed timestamps
│   └── ipc/{group}/          # Per-group IPC namespaces
│       ├── messages/         # Outgoing messages to send
│       └── tasks/            # Task management requests
│
└── .claude/skills/           # Claude Code skills
    ├── setup/SKILL.md        # Initial setup
    ├── customize/SKILL.md    # Add capabilities
    ├── debug/SKILL.md        # Debug container issues
    ├── add-discord/SKILL.md  # Add Discord integration
    └── add-voice-transcription/SKILL.md
```

---

## Core Modules

### 1. Main Application (src/index.ts)

**Responsibilities**: Message routing, WhatsApp/Discord connection, IPC listening

**Startup Sequence**:
```typescript
main() {
  ensureContainerSystemRunning();  // Ensure container system is running
  initDatabase();                  // Initialize SQLite
  loadState();                     // Load registered groups, sessions, etc.

  if (DISCORD_TOKEN) startDiscord();
  if (authExists) connectWhatsApp();

  // Three core loops
  startMessageLoop();   // Poll for new messages (2s interval)
  startSchedulerLoop(); // Check for due tasks (60s interval)
  startIpcWatcher();    // Process container IPC requests (1s interval)
}
```

**Message Processing Flow**:
1. Check if message is from a registered group
2. Check if message starts with trigger word (e.g., `@Andy`)
3. Fetch all messages since last agent interaction (session catch-up)
4. Format as XML prompt: `<messages><message sender="..." time="...">...</message></messages>`
5. Spawn container agent to process
6. Update timestamp and send response

**Key Design Features**:
- **LID JID Translation**: WhatsApp now uses LID JIDs for self-chats, requiring mapping to phone number JIDs
- **Duplicate Loop Protection**: Prevents spawning multiple message loops on WhatsApp reconnect (using `messageLoopRunning` flag)
- **At-Least-Once Delivery**: Only advances timestamp after successful processing

### 2. Container Runner (src/container-runner.ts)

**Responsibilities**: Build mount configuration, spawn isolated agent containers

**Mount Strategy**:

```typescript
// Main group (fully trusted)
{
  '/workspace/project':  Project root (read-write)
  '/workspace/group':    groups/main/ (read-write)
  '/home/node/.claude':  Session directory (read-write)
  '/workspace/ipc':      IPC directory (read-write)
}

// Other groups (restricted)
{
  '/workspace/group':    groups/{name}/ (read-write)
  '/workspace/global':   groups/global/ (read-only)
  '/home/node/.claude':  sessions/{group}/.claude/ (read-write, isolated)
  '/workspace/ipc':      ipc/{group}/ (read-write, isolated)
  '/workspace/extra/*':  Additional mounts (validated via mount-allowlist)
}
```

**Security Features**:
- **Mount Allowlist**: Stored at `~/.config/nanoclaw/mount-allowlist.json`, never mounted into container (tamper-proof)
- **Environment Variable Filtering**: Only exposes `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY`, other `.env` contents not passed to container
- **Output Size Limits**: stdout/stderr max 10MB to prevent memory exhaustion
- **Timeout Protection**: Default 5 minutes, configurable per group

**Runtime Selection**:
- **Claude Agent SDK** (default): Full functionality, runs in container
- **Codex CLI**: Lightweight, for simple queries (via `AGENT_RUNTIME=codex` or `!runtime codex` hot-swap)

### 3. Database (src/db.ts)

**Schema**:
```sql
chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  last_message_time TEXT
)

messages (
  id TEXT,
  chat_jid TEXT,
  sender TEXT,
  sender_name TEXT,
  content TEXT,
  timestamp TEXT,
  is_from_me INTEGER
)

scheduled_tasks (
  id TEXT PRIMARY KEY,
  group_folder TEXT,
  chat_jid TEXT,
  prompt TEXT,
  schedule_type TEXT,  -- 'cron' | 'interval' | 'once'
  schedule_value TEXT,
  context_mode TEXT,   -- 'group' | 'isolated'
  next_run TEXT,
  status TEXT          -- 'active' | 'paused' | 'completed'
)

task_run_logs (
  task_id TEXT,
  run_at TEXT,
  duration_ms INTEGER,
  status TEXT,
  result TEXT
)
```

**Key Features**:
- **Group Discovery**: Stores metadata for all chats (without message content) for `refresh_groups` tool
- **Full Messages Only for Registered Groups**: Sensitive content only persisted for registered groups
- **Group Sync Cache**: 24-hour interval for syncing WhatsApp group metadata

### 4. IPC System (container/agent-runner/src/ipc-mcp.ts)

Agents inside containers communicate with the host via filesystem:

**MCP Tools** (available inside container):
```typescript
schedule_task(prompt, schedule_type, schedule_value, context_mode?, groupFolder?)
pause_task(taskId)
resume_task(taskId)
cancel_task(taskId)
list_tasks() → Current group's tasks (main sees all tasks)
get_task(taskId) → Task details and run history
send_message(chatJid, text) → Send message (only to current group or from main)
refresh_groups() → Force sync WhatsApp group metadata (main only)
register_group(jid, name, folder, trigger, containerConfig?) → Register new group (main only)
```

**Authorization Model**:
- IPC files isolated by `data/ipc/{groupFolder}/`
- Host verifies identity based on directory (prevents forging `sourceGroup`)
- Non-main groups can only:
  - Schedule tasks for themselves
  - Pause/resume/cancel their own tasks
  - Send messages to their own chats
- Main group can:
  - Schedule tasks for any group
  - Manage all tasks
  - Register new groups
  - Refresh group metadata

### 5. Task Scheduler (src/task-scheduler.ts)

**Schedule Types**:
1. **Cron**: `0 9 * * 1` (Every Monday at 9:00 AM)
2. **Interval**: `3600000` (Every hour, in milliseconds)
3. **Once**: `2024-12-25T09:00:00Z` (One-time execution)

**Context Modes**:
- **Isolated** (default): New session, no historical context
- **Group**: Shares group's session ID (continues conversation)

**Execution Flow**:
```
Check tasks with next_run < now
  ↓
Generate prompt: "Execute scheduled task: {prompt}"
  ↓
runContainerAgent(group, prompt, sessionId?)
  ↓
Log run (duration, status, result)
  ↓
Calculate next run time (cron/interval) or mark completed (once)
```

---

## Security Model

### 1. Container Isolation
- **Filesystem**: Agents only see mounted directories
- **Bash Safety**: Commands execute inside container, not on host
- **Non-root User**: Container runs as `node` user (uid 1000)
- **Process Isolation**: Container processes cannot affect host

### 2. Cross-Group Isolation
- **Session Directories**: Each group has independent `.claude/` directory
- **IPC Namespaces**: Each group has independent IPC directory
- **Working Directories**: Each group has independent `groups/{name}/` folder

### 3. Privilege Tiers
- **Main Group Privileges**:
  - Write global memory (`groups/CLAUDE.md`)
  - Schedule tasks for any group
  - Register new groups
  - Configure additional mounts
- **Other Groups**:
  - Read-only global memory
  - Manage only their own tasks
  - Cannot send cross-group messages (unless via main)

### 4. Mount Security
- **Allowlist Validation**: `~/.config/nanoclaw/mount-allowlist.json`
- **Blocklist Pattern**: Blocks `.ssh`, `.gnupg`, and other sensitive paths
- **Forced Read-Only**: Non-main groups' additional mounts forced read-only (if `nonMainReadOnly: true`)

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| WhatsApp | @whiskeysockets/baileys | WhatsApp Web protocol |
| Discord | discord.js | Discord Bot API |
| Database | better-sqlite3 | Message and task storage |
| Container Runtime | Apple Container / Docker | Isolated Linux VMs |
| Agent | @anthropic-ai/claude-agent-sdk | Claude with tools and MCP |
| Alternative Runtime | Codex CLI | Lightweight executor |
| Scheduler | cron-parser | Cron expression parsing |
| Logging | pino | Structured logging |

---

## Message Flow Example

```
User sends in WhatsApp: "@Andy remind me to review metrics every Monday at 9am"
  ↓
baileys receives → stores to SQLite
  ↓
Message loop polls → trigger word matches
  ↓
Fetch all messages since last interaction (session catch-up)
  ↓
Generate XML prompt:
<messages>
  <message sender="John" time="2024-01-31T14:32:00Z">@Andy remind me to review metrics every Monday at 9am</message>
</messages>
  ↓
Spawn container agent (groups/family-chat/.claude/ session)
  ↓
Agent calls MCP tool: schedule_task({
  prompt: "Send a reminder to review weekly metrics. Be encouraging!",
  schedule_type: "cron",
  schedule_value: "0 9 * * 1"
})
  ↓
Write to IPC: data/ipc/family-chat/tasks/schedule.json
  ↓
IPC watcher processes → creates task in SQLite
  ↓
Agent returns: "Done! I'll remind you every Monday at 9am."
  ↓
Send WhatsApp message: "Andy: Done! I'll remind you every Monday at 9am."
```

---

## Key Design Decisions

### 1. Why Filesystem IPC?
- **Simplicity**: No network protocols or Unix sockets needed
- **Security**: Permissions controlled by directory ownership
- **Debuggability**: Can directly inspect IPC files

### 2. Why SQLite Instead of In-Memory?
- **Persistence**: Messages and tasks survive restarts
- **Simplicity**: No separate database server needed
- **Queryability**: Direct SQL queries for debugging

### 3. Why Polling Instead of Webhooks?
- **Reliability**: No lost messages during network issues
- **Simplicity**: No public IP or tunneling required
- **Control**: Batching and rate limiting possible

### 4. Why Single Process?
- **Simplicity**: No inter-process coordination
- **Resource Efficiency**: One Node.js instance
- **Debuggability**: All logs in one place

---

## Unique Features

### 1. Session Catch-Up
Agent receives all messages since last interaction, even if not mentioned in every message:
```
[2:32 PM] John: should we do pizza tonight?
[2:33 PM] Sarah: sounds good to me
[2:35 PM] John: @Andy what toppings do you recommend?
```
Agent sees all three messages and understands context.

### 2. Hot-Swap Runtime
```
!runtime codex   → Switch to Codex CLI (fast)
!runtime claude  → Switch back to Claude Agent SDK (full-featured)
!runtime status  → Show current runtime
```

### 3. Voice Transcription
WhatsApp voice messages automatically transcribed via OpenAI Whisper API, allowing agent to read and respond to audio.

### 4. X (Twitter) Integration
Post tweets, like, retweet, reply via skill system.

---

## Configuration Examples

### Registered Group Config (`data/registered_groups.json`)
```json
{
  "1234567890@g.us": {
    "name": "Dev Team",
    "folder": "dev-team",
    "trigger": "@Andy",
    "added_at": "2024-01-31T12:00:00Z",
    "containerConfig": {
      "additionalMounts": [
        {
          "hostPath": "~/projects/webapp",
          "containerPath": "webapp",
          "readonly": false
        }
      ],
      "timeout": 600000,
      "env": {
        "AGENT_RUNTIME": "claude"
      }
    }
  }
}
```

### Mount Allowlist (`~/.config/nanoclaw/mount-allowlist.json`)
```json
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    },
    {
      "path": "/var/repos",
      "allowReadWrite": false,
      "description": "Read-only repositories"
    }
  ],
  "blockedPatterns": [".ssh", ".gnupg", "*.key"],
  "nonMainReadOnly": true
}
```

---

## Performance Characteristics

- **Message Polling**: 2-second interval
- **Scheduler Polling**: 60-second interval
- **IPC Polling**: 1-second interval
- **Container Timeout**: 5 minutes (configurable)
- **Max Output**: 10MB (prevents memory exhaustion)
- **Group Sync**: 24-hour cache

---

## Summary

NanoClaw demonstrates a minimalist yet powerful personal AI assistant framework built on these principles:

1. **Comprehensibility First**: Entire codebase understandable in under an hour
2. **Security Through Isolation**: OS-level containers instead of application-level permission checks
3. **Simplicity Over Flexibility**: Single process, filesystem IPC, polling
4. **AI-Native**: Assumes you have Claude Code as a development partner
5. **Skill System**: Extend via skills, not feature bloat

This architecture is ideal for technical users who need a personal AI assistant and value transparency and control over out-of-the-box convenience.
