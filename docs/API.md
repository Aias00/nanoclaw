# NanoClaw API Reference

This document provides detailed API reference for NanoClaw's core modules.

---

## Table of Contents

1. [Database API](#database-api)
2. [Container Runner API](#container-runner-api)
3. [IPC API](#ipc-api)
4. [Task Scheduler API](#task-scheduler-api)
5. [Channel APIs](#channel-apis)
6. [Type Definitions](#type-definitions)

---

## Database API

Located in `src/db.ts`

### initDatabase()

Initializes the SQLite database and creates tables.

```typescript
function initDatabase(): void
```

**Tables Created**:
- `chats`: Chat metadata (jid, name, last_message_time)
- `messages`: Full message content for registered groups
- `scheduled_tasks`: Task definitions and schedule info
- `task_run_logs`: Execution history for tasks
- `settings`: Key-value store for runtime settings

**Usage**:
```typescript
import { initDatabase } from './db.js';

initDatabase();
```

### storeChatMetadata()

Store or update chat metadata without storing message content.

```typescript
function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string
): void
```

**Parameters**:
- `chatJid`: Chat identifier (e.g., `123456@g.us`, `discord:guild:channel`)
- `timestamp`: ISO 8601 timestamp
- `name`: Optional chat name

**Usage**:
```typescript
storeChatMetadata('123456@g.us', new Date().toISOString(), 'Family Chat');
```

### storeMessage()

Store full message content for a registered group.

```typescript
function storeMessage(
  msg: proto.IWebMessageInfo,
  chatJid: string,
  isFromMe: boolean,
  senderName?: string
): void
```

**Parameters**:
- `msg`: WhatsApp message object from baileys
- `chatJid`: Chat identifier
- `isFromMe`: Whether message is from the bot
- `senderName`: Display name of sender

### storeDiscordMessage()

Store Discord message to database.

```typescript
function storeDiscordMessage(params: {
  id: string;
  chatJid: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
}): void
```

### getNewMessages()

Get unprocessed messages for registered groups.

```typescript
function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  assistantName: string
): {
  messages: NewMessage[];
  lastTimestamp: string;
}
```

**Parameters**:
- `jids`: Array of chat JIDs to query
- `lastTimestamp`: ISO timestamp of last processed message
- `assistantName`: Name to exclude from results (bot's own messages)

**Returns**:
- `messages`: Array of new messages
- `lastTimestamp`: Latest timestamp in batch (for next query)

**Usage**:
```typescript
const { messages, lastTimestamp: newTimestamp } = getNewMessages(
  ['123456@g.us'],
  lastTimestamp,
  'Andy'
);
```

### getMessagesSince()

Get all messages since a timestamp (for conversation catch-up).

```typescript
function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  assistantName: string
): Array<{
  id: string;
  sender_name: string;
  content: string;
  timestamp: string;
}>
```

**Returns**: Array of messages formatted for prompts

### Task Management Functions

```typescript
function createTask(task: ScheduledTask): void

function updateTask(
  taskId: string,
  updates: Partial<ScheduledTask>
): void

function deleteTask(taskId: string): void

function getTaskById(taskId: string): ScheduledTask | undefined

function getAllTasks(): ScheduledTask[]

function getDueTasks(): ScheduledTask[]
```

### Settings Functions

```typescript
function getSetting(key: string): string | null

function setSetting(key: string, value: string): void

function deleteSetting(key: string): void
```

**Example: Runtime switching**:
```typescript
setSetting('agent_runtime', 'codex'); // Switch to Codex
getSetting('agent_runtime'); // Returns 'codex'
```

---

## Container Runner API

Located in `src/container-runner.ts`

### runContainerAgent()

Spawn an isolated container to run the Claude Agent SDK.

```typescript
async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput
): Promise<ContainerOutput>
```

**Parameters**:

```typescript
interface ContainerInput {
  prompt: string;           // User message(s) formatted as XML
  sessionId?: string;       // Claude session ID for continuity
  groupFolder: string;      // Group folder name (e.g., 'main', 'family-chat')
  chatJid: string;          // Chat identifier for context
  isMain: boolean;          // Whether this is the main control group
  isScheduledTask?: boolean; // Whether this is a scheduled task execution
}
```

**Returns**:

```typescript
interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;     // Agent's response text
  newSessionId?: string;     // Updated session ID
  error?: string;            // Error message if status='error'
}
```

**Usage**:
```typescript
const output = await runContainerAgent(group, {
  prompt: '<messages><message sender="John">Hello</message></messages>',
  sessionId: 'session-abc123',
  groupFolder: 'main',
  chatJid: '123456@g.us',
  isMain: true
});

if (output.status === 'success') {
  console.log('Response:', output.result);
  // Save new session ID
  sessions[group.folder] = output.newSessionId;
}
```

### writeTasksSnapshot()

Write current tasks to IPC directory for container to read.

```typescript
function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: TaskSnapshot[]
): void
```

**Purpose**: Allows MCP `list_tasks` tool to see current tasks without database access.

### writeGroupsSnapshot()

Write available groups to IPC directory.

```typescript
function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>
): void
```

**Purpose**: Allows MCP `register_group` tool to see available groups.

---

## IPC API

Located in `container/agent-runner/src/ipc-mcp.ts`

MCP tools available inside containers:

### schedule_task

Schedule a recurring or one-time task.

```typescript
schedule_task(args: {
  prompt: string;              // Task instruction
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;      // Cron expr, ms interval, or ISO timestamp
  context_mode?: 'group' | 'isolated';  // Default: 'isolated'
  groupFolder?: string;        // Target group (main only)
}): Promise<{ success: boolean }>
```

**Examples**:
```typescript
// Cron (every Monday at 9am)
await schedule_task({
  prompt: 'Send weekly reminder',
  schedule_type: 'cron',
  schedule_value: '0 9 * * 1'
});

// Interval (every hour)
await schedule_task({
  prompt: 'Check server status',
  schedule_type: 'interval',
  schedule_value: '3600000'
});

// Once (specific time)
await schedule_task({
  prompt: 'Birthday reminder',
  schedule_type: 'once',
  schedule_value: '2024-12-25T09:00:00Z'
});
```

### list_tasks

List scheduled tasks.

```typescript
list_tasks(): Promise<{
  tasks: Array<{
    id: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>
}>
```

**Authorization**:
- Main group: sees all tasks
- Other groups: only see their own tasks

### get_task

Get detailed task info including run history.

```typescript
get_task(args: {
  taskId: string;
}): Promise<{
  task: ScheduledTask;
  recent_runs: TaskRunLog[];
}>
```

### pause_task / resume_task / cancel_task

```typescript
pause_task(args: { taskId: string }): Promise<{ success: boolean }>
resume_task(args: { taskId: string }): Promise<{ success: boolean }>
cancel_task(args: { taskId: string }): Promise<{ success: boolean }>
```

**Authorization**: Only main or task owner can modify.

### send_message

Send a message to a chat.

```typescript
send_message(args: {
  chatJid: string;
  text: string;
}): Promise<{ success: boolean }>
```

**Authorization**:
- Main: can send to any chat
- Other groups: can only send to their own chat

### refresh_groups

Force sync WhatsApp group metadata.

```typescript
refresh_groups(): Promise<{ success: boolean }>
```

**Authorization**: Main group only

### register_group

Register a new group/chat.

```typescript
register_group(args: {
  jid: string;
  name: string;
  folder: string;
  trigger: string;
  containerConfig?: ContainerConfig;
}): Promise<{ success: boolean }>
```

**Authorization**: Main group only

**Example**:
```typescript
await register_group({
  jid: '123456@g.us',
  name: 'Dev Team',
  folder: 'dev-team',
  trigger: '@Andy',
  containerConfig: {
    additionalMounts: [{
      hostPath: '~/projects/webapp',
      containerPath: 'webapp',
      readonly: false
    }]
  }
});
```

---

## Task Scheduler API

Located in `src/task-scheduler.ts`

### startSchedulerLoop()

Start the task scheduler loop.

```typescript
function startSchedulerLoop(deps: {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Session;
}): void
```

**Behavior**:
- Polls every 60 seconds
- Executes tasks where `next_run <= now`
- Logs execution to `task_run_logs` table
- Updates `next_run` for recurring tasks
- Marks `once` tasks as completed

**Usage**:
```typescript
startSchedulerLoop({
  sendMessage: async (jid, text) => {
    await sock.sendMessage(jid, { text });
  },
  registeredGroups: () => registeredGroups,
  getSessions: () => sessions
});
```

---

## Channel APIs

### WhatsApp (src/index.ts)

WhatsApp integration uses `@whiskeysockets/baileys`.

**Key Functions**:

```typescript
async function connectWhatsApp(): Promise<void>
```

**Events Handled**:
- `connection.update`: Handle connect/disconnect/QR
- `creds.update`: Save authentication state
- `messages.upsert`: Store incoming messages

### Discord (src/discord.ts)

Discord integration uses `discord.js`.

#### startDiscord()

```typescript
async function startDiscord(options: {
  onIncomingMessage: (msg: DiscordIncomingMessage) => void | Promise<void>;
  logger?: Logger;
}): Promise<void>
```

**Configuration** (via .env):
```bash
DISCORD_TOKEN=your_bot_token
DISCORD_MAIN_CHANNEL_ID=channel_id_for_main
DISCORD_ALLOWED_GUILD_IDS=guild1,guild2
DISCORD_ALLOWED_CHANNEL_IDS=channel1,channel2
```

#### sendDiscordMessage()

```typescript
async function sendDiscordMessage(
  scopeId: string,
  text: string
): Promise<void>
```

**Scope ID Format**:
- Guild channel: `discord:{guildId}:{channelId}`
- DM: `discord:dm:{userId}`

#### setDiscordTyping()

```typescript
async function setDiscordTyping(
  scopeId: string,
  isTyping: boolean
): Promise<void>
```

---

## Type Definitions

### RegisteredGroup

```typescript
interface RegisteredGroup {
  name: string;                    // Display name
  folder: string;                  // Folder name in groups/
  trigger: string;                 // Trigger pattern (e.g., '@Andy')
  added_at: string;               // ISO timestamp
  containerConfig?: ContainerConfig;
}

interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;               // Container timeout in ms
  env?: Record<string, string>;  // Environment variables
}

interface AdditionalMount {
  hostPath: string;               // Absolute path on host
  containerPath: string;          // Path inside container (under /workspace/extra/)
  readonly?: boolean;             // Default: true
}
```

### ScheduledTask

```typescript
interface ScheduledTask {
  id: string;                     // Unique task ID
  group_folder: string;           // Owner group folder
  chat_jid: string;              // Chat to send results to
  prompt: string;                // Task instruction
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;        // Cron expr, ms, or ISO timestamp
  context_mode: 'group' | 'isolated';
  next_run: string | null;       // ISO timestamp
  last_run: string | null;       // ISO timestamp
  last_result: string | null;    // Last execution result
  status: 'active' | 'paused' | 'completed';
  created_at: string;            // ISO timestamp
}
```

### NewMessage

```typescript
interface NewMessage {
  id: string;                    // Message ID
  chat_jid: string;             // Chat identifier
  sender: string;               // Sender phone number or ID
  sender_name: string;          // Display name
  content: string;              // Message text
  timestamp: string;            // ISO timestamp
}
```

### Session

```typescript
interface Session {
  [folder: string]: string;     // Maps group folder to Claude session ID
}
```

**Example**:
```json
{
  "main": "session-abc123",
  "family-chat": "session-def456"
}
```

### AvailableGroup

```typescript
interface AvailableGroup {
  jid: string;                  // Chat JID
  name: string;                 // Chat name
  lastActivity: string;         // ISO timestamp
  isRegistered: boolean;        // Whether currently registered
}
```

### DiscordIncomingMessage

```typescript
interface DiscordIncomingMessage {
  id: string;                   // Message ID
  scopeId: string;             // Scope identifier (see format above)
  timestamp: string;           // ISO timestamp
  authorId: string;            // User ID
  authorName: string;          // Display name
  content: string;             // Message text
  isDM: boolean;               // Whether direct message
  isMainChannel: boolean;      // Whether main control channel
  isMentioned: boolean;        // Whether bot was @mentioned
  channelName?: string;        // Channel name (if not DM)
  guildId?: string;            // Guild ID (if not DM)
  channelId?: string;          // Channel ID (if not DM)
}
```

---

## Configuration Reference

### Environment Variables

```bash
# Required: Claude authentication (choose one)
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional: Customization
ASSISTANT_NAME=Andy                    # Trigger word (default: Andy)
AGENT_RUNTIME=claude                   # claude or codex (default: claude)
CONTAINER_IMAGE=nanoclaw-agent:latest  # Container image name
CONTAINER_TIMEOUT=300000               # 5 minutes
CONTAINER_MAX_OUTPUT_SIZE=10485760     # 10MB

# Optional: Discord
DISCORD_TOKEN=your_bot_token
DISCORD_MAIN_CHANNEL_ID=channel_id
DISCORD_ALLOWED_GUILD_IDS=guild1,guild2
DISCORD_ALLOWED_CHANNEL_IDS=channel1,channel2

# Optional: Logging
LOG_LEVEL=info                         # debug, info, warn, error
```

### Mount Allowlist Format

`~/.config/nanoclaw/mount-allowlist.json`:

```json
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    }
  ],
  "blockedPatterns": [".ssh", ".gnupg", "*.key", ".env"],
  "nonMainReadOnly": true
}
```

### Registered Groups Format

`data/registered_groups.json`:

```json
{
  "123456@g.us": {
    "name": "Family Chat",
    "folder": "family-chat",
    "trigger": "@Andy",
    "added_at": "2024-01-31T12:00:00Z",
    "containerConfig": {
      "additionalMounts": [
        {
          "hostPath": "/Users/user/photos",
          "containerPath": "photos",
          "readonly": true
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

---

## Error Handling

### Container Errors

When `runContainerAgent()` fails:

```typescript
const output = await runContainerAgent(group, input);

if (output.status === 'error') {
  console.error('Container error:', output.error);

  // Common errors:
  // - "Container exited with code 1" - Check logs
  // - "Container timed out" - Increase timeout
  // - "Failed to parse container output" - Check stdout format
}
```

### Database Errors

```typescript
try {
  createTask(task);
} catch (err) {
  if (err.message.includes('UNIQUE constraint')) {
    console.error('Task ID already exists');
  } else if (err.message.includes('FOREIGN KEY constraint')) {
    console.error('Invalid chat_jid reference');
  }
}
```

### IPC Errors

IPC errors are logged and files moved to `data/ipc/errors/`:

```bash
# Check for IPC errors
ls -la data/ipc/errors/

# Read error file
cat data/ipc/errors/main-schedule-1234567890.json
```

---

## Performance Considerations

### Database Queries

```typescript
// BAD: Query in loop
for (const jid of jids) {
  const messages = getNewMessages([jid], timestamp);
}

// GOOD: Single query with all JIDs
const messages = getNewMessages(jids, timestamp);
```

### Container Spawning

```typescript
// Expensive: Full Claude Agent SDK
AGENT_RUNTIME=claude

// Cheap: Lightweight Codex CLI
AGENT_RUNTIME=codex

// Hot-swap at runtime
!runtime codex
```

### Session Management

```typescript
// Context mode affects memory and performance
schedule_task({
  prompt: 'Simple calculation',
  context_mode: 'isolated'  // Faster, no context
});

schedule_task({
  prompt: 'Continue our discussion',
  context_mode: 'group'     // Slower, full context
});
```

---

## Debugging API Calls

### Enable Debug Logging

```bash
LOG_LEVEL=debug npm run dev
```

### Trace Container Execution

```typescript
// Container logs written to:
// groups/{folder}/logs/container-{timestamp}.log

// With LOG_LEVEL=debug, includes:
// - Full input JSON
// - Container args
// - All mounts
// - Complete stdout/stderr
```

### Monitor Database

```bash
# Watch messages table
watch -n 2 'sqlite3 store/messages.db "SELECT COUNT(*) FROM messages;"'

# Watch task execution
watch -n 2 'sqlite3 store/messages.db "SELECT id, next_run, status FROM scheduled_tasks;"'
```

---

## Migration Guide

### Adding New Database Columns

```typescript
// In initDatabase()
try {
  db.exec(`ALTER TABLE messages ADD COLUMN new_field TEXT`);
} catch {
  // Column already exists
}
```

### Changing IPC Format

1. Update `ipc-mcp.ts` tool signature
2. Update `index.ts` processTaskIpc handler
3. Rebuild container: `./container/build.sh`
4. Version the IPC format if breaking change:

```typescript
// Old format still supported
if (data.version === 1) {
  // Handle old format
} else {
  // Handle new format
}
```

---

## See Also

- [Architecture Documentation](./ARCHITECTURE.md)
- [Developer Guide](./DEVELOPER_GUIDE.md)
- [Security Documentation](./SECURITY.md)
