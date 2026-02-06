# NanoClaw Developer Guide

This guide helps you understand how to develop, debug, and extend NanoClaw.

---

## Table of Contents

1. [Development Setup](#development-setup)
2. [Running Locally](#running-locally)
3. [Understanding the Code Flow](#understanding-the-code-flow)
4. [Debugging](#debugging)
5. [Writing Skills](#writing-skills)
6. [Adding New Features](#adding-new-features)
7. [Testing](#testing)
8. [Common Issues](#common-issues)

---

## Development Setup

### Prerequisites

- Node.js 20+
- [Claude Code](https://claude.ai/download)
- Apple Container (macOS) or Docker (Linux)
- Git

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/gavrielc/nanoclaw.git
cd nanoclaw

# Install dependencies
npm install

# Install container agent dependencies
cd container/agent-runner
npm install
cd ../..

# Build container image
./container/build.sh

# Create .env file with authentication
cat > .env << EOF
CLAUDE_CODE_OAUTH_TOKEN=your_token_here
# OR
ANTHROPIC_API_KEY=your_api_key_here

# Optional: Discord integration
DISCORD_TOKEN=your_discord_token
DISCORD_MAIN_CHANNEL_ID=your_main_channel_id
EOF

# Run initial setup via Claude Code
claude
# Then in Claude Code: /setup
```

### Project Structure for Development

```
nanoclaw/
├── src/                    # Host application (edit here)
│   └── *.ts               # TypeScript source files
├── container/
│   ├── Dockerfile         # Container image definition
│   └── agent-runner/
│       └── src/           # Container runtime code (edit here)
├── dist/                  # Compiled JavaScript (auto-generated)
├── groups/                # Group workspaces (created at runtime)
├── data/                  # Application state (gitignored)
├── store/                 # WhatsApp auth + database (gitignored)
└── logs/                  # Runtime logs (gitignored)
```

---

## Running Locally

### Development Mode (with hot reload)

```bash
# Terminal 1: Watch and rebuild TypeScript
npm run dev

# This runs: tsx src/index.ts
# Changes to src/*.ts are automatically reloaded
```

### Production Mode

```bash
# Build TypeScript
npm run build

# Run compiled JavaScript
npm start

# Or install as macOS service
cp launchd/com.nanoclaw.plist ~/Library/LaunchAgents/
# Edit {{PLACEHOLDERS}} first!
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

### Container Development

When you modify container code:

```bash
# Rebuild container image
./container/build.sh

# Restart NanoClaw to use new image
# (if running via launchd)
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

---

## Understanding the Code Flow

### Message Processing Flow

```typescript
// 1. Message arrives (WhatsApp or Discord)
sock.ev.on('messages.upsert', ({ messages }) => {
  storeMessage(msg, chatJid, isFromMe, senderName);
});

// 2. Message loop polls database (every 2s)
while (true) {
  const { messages } = getNewMessages(jids, lastTimestamp);
  for (const msg of messages) {
    await processMessage(msg);
  }
  await sleep(POLL_INTERVAL);
}

// 3. processMessage checks trigger and permissions
if (!isMainGroup && !TRIGGER_PATTERN.test(content)) return;

// 4. Build conversation context (catch-up)
const missedMessages = getMessagesSince(chatJid, lastAgentTimestamp);
const prompt = formatAsXML(missedMessages);

// 5. Spawn container agent
const output = await runContainerAgent(group, {
  prompt,
  sessionId,
  groupFolder,
  chatJid,
  isMain
});

// 6. Send response
await sendMessage(chatJid, `${ASSISTANT_NAME}: ${output.result}`);
```

### Container Agent Flow

```typescript
// Inside container (agent-runner/src/index.ts)

// 1. Read input from stdin
const input: ContainerInput = JSON.parse(await readStdin());

// 2. Load MCP server configuration
const mcpServers = {
  nanoclaw: {
    command: "node",
    args: ["/app/dist/ipc-mcp.js"],
    env: {
      GROUP_FOLDER: input.groupFolder,
      IS_MAIN: String(input.isMain)
    }
  }
};

// 3. Run Claude Agent SDK
const result = await run({
  prompt: input.prompt,
  cwd: '/workspace/group',
  settingSources: ['project'], // Loads CLAUDE.md files
  resume: input.sessionId,
  mcpServers
});

// 4. Write output to stdout (with sentinels)
console.log('---NANOCLAW_OUTPUT_START---');
console.log(JSON.stringify({
  status: 'success',
  result: result.response,
  newSessionId: result.sessionId
}));
console.log('---NANOCLAW_OUTPUT_END---');
```

### IPC Flow (Container → Host)

```typescript
// Inside container (ipc-mcp.ts)
export const schedule_task = async (args: {
  prompt: string;
  schedule_type: string;
  schedule_value: string;
}) => {
  const requestFile = path.join(
    IPC_DIR,
    'tasks',
    `schedule-${Date.now()}.json`
  );

  fs.writeFileSync(requestFile, JSON.stringify({
    type: 'schedule_task',
    prompt: args.prompt,
    schedule_type: args.schedule_type,
    schedule_value: args.schedule_value,
    groupFolder: GROUP_FOLDER
  }));

  return { success: true };
};

// On host (index.ts)
const processIpcFiles = async () => {
  const taskFiles = fs.readdirSync(tasksDir);
  for (const file of taskFiles) {
    const data = JSON.parse(fs.readFileSync(filePath));
    await processTaskIpc(data, sourceGroup, isMain);
    fs.unlinkSync(filePath);
  }
};
```

---

## Debugging

### Enable Debug Logging

```bash
# Set environment variable
LOG_LEVEL=debug npm run dev

# Or in .env file
LOG_LEVEL=debug
```

This enables:
- Verbose container logs
- Full stdin/stdout in container log files
- Detailed mount configuration
- IPC file operations

### View Logs

```bash
# Host logs (stdout)
tail -f logs/nanoclaw.log

# Host logs (stderr)
tail -f logs/nanoclaw.error.log

# Container logs (per-execution)
ls -lt groups/main/logs/
tail -f groups/main/logs/container-2024-01-31T14-32-00-123Z.log
```

### Inspect Application State

```bash
# View registered groups
cat data/registered_groups.json | jq

# View sessions
cat data/sessions.json | jq

# View router state
cat data/router_state.json | jq

# Query database
sqlite3 store/messages.db "SELECT * FROM scheduled_tasks;"
sqlite3 store/messages.db "SELECT * FROM messages ORDER BY timestamp DESC LIMIT 10;"
```

### Debug Container Issues

```bash
# Run /debug skill in Claude Code
claude
# Then: /debug

# Or manually check container system
container system status

# Test container manually
echo '{"prompt":"test","groupFolder":"main","chatJid":"test","isMain":true}' | \
  container run -i --rm \
  -v $(pwd)/groups/main:/workspace/group \
  nanoclaw-agent:latest
```

### Common Debug Patterns

**Problem: Agent not responding**
```bash
# Check if service is running
launchctl list | grep nanoclaw

# Check recent logs
tail -20 logs/nanoclaw.log

# Check if container system is running
container system status
```

**Problem: Session not continuing**
```bash
# Check sessions file
cat data/sessions.json

# Check if session directory exists and is mounted
ls -la data/sessions/main/.claude/

# Check container logs for session errors
grep -r "session" groups/main/logs/
```

**Problem: IPC not working**
```bash
# Check IPC directory permissions
ls -la data/ipc/main/

# Watch IPC directory for activity
watch -n 1 'ls -lht data/ipc/main/tasks/ | head -10'

# Check for errors in IPC error directory
ls -la data/ipc/errors/
```

---

## Writing Skills

Skills are markdown files that teach Claude Code how to perform tasks.

### Skill File Structure

```markdown
---
name: my-skill
description: Brief description (shown in skill list)
---

# Skill Name

Brief overview of what this skill does.

## When to Use

- Trigger condition 1
- Trigger condition 2

## Steps

1. **Step 1 Title**
   - Substep details
   - Code examples

2. **Step 2 Title**
   - More details

## Examples

Example usage scenarios.

## Verification

How to verify the skill worked.
```

### Example: Creating a New Integration Skill

```markdown
---
name: add-telegram
description: Add Telegram as a messaging channel
---

# Add Telegram Integration

This skill adds Telegram bot support to NanoClaw.

## Steps

1. **Install Dependencies**
   ```bash
   npm install telegraf
   ```

2. **Create Telegram Module**
   Create `src/telegram.ts`:
   ```typescript
   import { Telegraf } from 'telegraf';

   export async function startTelegram(options: {
     token: string;
     onMessage: (msg: TelegramMessage) => void;
   }) {
     const bot = new Telegraf(options.token);
     bot.on('text', (ctx) => {
       options.onMessage({
         id: ctx.message.message_id,
         chatId: ctx.chat.id,
         text: ctx.message.text,
         sender: ctx.from.username
       });
     });
     await bot.launch();
   }
   ```

3. **Integrate in Main App**
   Edit `src/index.ts`:
   ```typescript
   import { startTelegram } from './telegram.js';

   // In main():
   if (process.env.TELEGRAM_TOKEN) {
     await startTelegram({
       token: process.env.TELEGRAM_TOKEN,
       onMessage: processTelegramMessage
     });
   }
   ```

4. **Update Environment Variables**
   Add to `.env`:
   ```
   TELEGRAM_TOKEN=your_bot_token
   ```

## Verification

1. Send a message to your Telegram bot
2. Check logs: `tail -f logs/nanoclaw.log`
3. Agent should respond in Telegram
```

### Skill Best Practices

1. **Be Specific**: Provide exact file paths and line numbers when possible
2. **Include Verification**: Always tell user how to verify it worked
3. **Handle Errors**: Include common failure modes and fixes
4. **Show Examples**: Real code snippets, not pseudocode
5. **State Dependencies**: List all prerequisites upfront

---

## Adding New Features

### Adding a New Message Channel

1. **Create Channel Module** (`src/my-channel.ts`)
   ```typescript
   export async function startMyChannel(options: {
     onIncomingMessage: (msg: IncomingMessage) => void;
     logger: Logger;
   }): Promise<void> {
     // Connect to channel
     // Listen for messages
     // Call options.onIncomingMessage(...)
   }

   export async function sendMyChannelMessage(
     chatId: string,
     text: string
   ): Promise<void> {
     // Send message to channel
   }
   ```

2. **Integrate in Main App** (`src/index.ts`)
   ```typescript
   import { startMyChannel, sendMyChannelMessage } from './my-channel.js';

   // In main():
   if (process.env.MY_CHANNEL_TOKEN) {
     await startMyChannel({
       onIncomingMessage: processMyChannelMessage,
       logger
     });
   }

   // Update sendMessage():
   async function sendMessage(jid: string, text: string) {
     if (jid.startsWith('mychannel:')) {
       await sendMyChannelMessage(jid, text);
     } else if (jid.startsWith('discord:')) {
       await sendDiscordMessage(jid, text);
     } else {
       await sock.sendMessage(jid, { text });
     }
   }
   ```

3. **Add Message Handler**
   ```typescript
   async function processMyChannelMessage(msg: MyChannelMessage) {
     // Store to database
     storeChatMetadata(msg.scopeId, msg.timestamp);
     storeMyChannelMessage(msg);

     // Process with agent
     const prompt = buildPromptFromMessages(msg.scopeId, lastTimestamp);
     const response = await runAgent(MY_CHANNEL_GROUP, prompt, msg.scopeId);

     // Send response
     await sendMessage(msg.scopeId, `${ASSISTANT_NAME}: ${response}`);
   }
   ```

### Adding a New MCP Tool

1. **Edit Container IPC MCP** (`container/agent-runner/src/ipc-mcp.ts`)
   ```typescript
   export const my_new_tool = async (args: {
     param1: string;
     param2: number;
   }) => {
     // Write IPC request
     const requestFile = path.join(
       IPC_DIR,
       'tasks',
       `my-tool-${Date.now()}.json`
     );

     fs.writeFileSync(requestFile, JSON.stringify({
       type: 'my_new_tool',
       param1: args.param1,
       param2: args.param2
     }));

     return { success: true };
   };

   // Add to tool definitions
   const tools = {
     my_new_tool: {
       description: 'Does something useful',
       inputSchema: {
         type: 'object',
         properties: {
           param1: { type: 'string' },
           param2: { type: 'number' }
         },
         required: ['param1', 'param2']
       }
     }
   };
   ```

2. **Handle IPC on Host** (`src/index.ts`)
   ```typescript
   async function processTaskIpc(data, sourceGroup, isMain) {
     switch (data.type) {
       case 'my_new_tool':
         if (data.param1 && data.param2) {
           // Perform action
           doSomething(data.param1, data.param2);
           logger.info({ sourceGroup }, 'my_new_tool executed');
         }
         break;
       // ... other cases
     }
   }
   ```

3. **Rebuild Container**
   ```bash
   ./container/build.sh
   ```

---

## Testing

### Manual Testing Workflow

```bash
# 1. Start in dev mode
npm run dev

# 2. Send test message via WhatsApp
# "Testing: @Andy what's 2+2?"

# 3. Watch logs
tail -f logs/nanoclaw.log

# 4. Check container logs
tail -f groups/main/logs/container-*.log

# 5. Verify response received
```

### Testing Scheduled Tasks

```bash
# 1. Create a test task via WhatsApp
# "@Andy schedule a task to run in 2 minutes: say hello"

# 2. Watch scheduler logs
tail -f logs/nanoclaw.log | grep -i scheduler

# 3. Check task was created
sqlite3 store/messages.db "SELECT * FROM scheduled_tasks ORDER BY created_at DESC LIMIT 1;"

# 4. Wait for execution
# (scheduler checks every 60s)

# 5. Verify task ran
sqlite3 store/messages.db "SELECT * FROM task_run_logs ORDER BY run_at DESC LIMIT 1;"
```

### Testing Container Isolation

```bash
# Create a file in main group
echo "test" > groups/main/test.txt

# Create a file in another group
echo "secret" > groups/family-chat/secret.txt

# Send message from main: "@Andy read test.txt"
# Should succeed

# Send message from main: "@Andy read ../family-chat/secret.txt"
# Should fail (not mounted)

# Send message from family-chat: "@Andy read secret.txt"
# Should succeed

# Send message from family-chat: "@Andy read ../main/test.txt"
# Should fail (main not mounted for non-main groups)
```

### Database Testing

```bash
# Interactive SQL console
sqlite3 store/messages.db

# Common queries
sqlite> .tables
sqlite> .schema messages
sqlite> SELECT COUNT(*) FROM messages;
sqlite> SELECT * FROM scheduled_tasks WHERE status='active';
sqlite> SELECT * FROM task_run_logs ORDER BY run_at DESC LIMIT 10;
```

---

## Common Issues

### Issue: Container fails to start

**Symptoms**: "Container exited with code 1"

**Diagnosis**:
```bash
# Check container system
container system status

# Try manual container run
echo '{"prompt":"test","groupFolder":"main","chatJid":"test","isMain":true}' | \
  container run -i --rm nanoclaw-agent:latest

# Check container logs
tail -f groups/main/logs/container-*.log
```

**Solutions**:
- Ensure Apple Container is installed: `brew install container`
- Start container system: `container system start`
- Rebuild container image: `./container/build.sh`
- Check mount paths are absolute (not relative)

### Issue: Session not continuing

**Symptoms**: Agent doesn't remember previous conversation

**Diagnosis**:
```bash
# Check session file exists
cat data/sessions.json

# Check session directory mounted correctly
ls -la data/sessions/main/.claude/

# Check container logs for session errors
grep -i session groups/main/logs/container-*.log
```

**Solutions**:
- Ensure session directory exists: `mkdir -p data/sessions/main/.claude`
- Check mount path is `/home/node/.claude` (not `/root/.claude`)
- Verify container runs as `node` user (uid 1000)

### Issue: IPC not working

**Symptoms**: Tasks not scheduling, messages not sending

**Diagnosis**:
```bash
# Check IPC directory exists
ls -la data/ipc/main/

# Check for stuck files
ls -la data/ipc/main/tasks/

# Check for errors
ls -la data/ipc/errors/
```

**Solutions**:
- Ensure IPC directories exist: `mkdir -p data/ipc/main/{tasks,messages}`
- Check file permissions: `chmod -R 755 data/ipc`
- Clear stuck files: `rm data/ipc/main/tasks/*.json`
- Check IPC watcher is running: `grep "IPC watcher" logs/nanoclaw.log`

### Issue: High memory usage

**Symptoms**: Node process using excessive RAM

**Diagnosis**:
```bash
# Check process memory
ps aux | grep node

# Check container output size
du -sh groups/*/logs/
```

**Solutions**:
- Increase `CONTAINER_MAX_OUTPUT_SIZE` limit
- Clean old container logs: `find groups/*/logs -name "*.log" -mtime +7 -delete`
- Check for runaway agents in logs
- Restart service: `launchctl unload/load`

### Issue: WhatsApp disconnects frequently

**Symptoms**: QR code requests, connection closed messages

**Diagnosis**:
```bash
# Check auth state
ls -la store/auth/

# Check logs for disconnect reason
grep -i disconnect logs/nanoclaw.log
```

**Solutions**:
- Delete auth state and re-authenticate: `rm -rf store/auth/`
- Run `/setup` again in Claude Code
- Check network stability
- Ensure only one instance running (no duplicate processes)

---

## Performance Tips

### Optimize Message Processing

```typescript
// Bad: Process messages one-by-one
for (const msg of messages) {
  await processMessage(msg);
}

// Better: Process in parallel (if order doesn't matter)
await Promise.all(messages.map(processMessage));

// Best: Batch with controlled concurrency
const pLimit = await import('p-limit');
const limit = pLimit(3); // Max 3 concurrent
await Promise.all(messages.map(msg => limit(() => processMessage(msg))));
```

### Reduce Container Startup Time

```typescript
// Use Codex runtime for simple queries
// Set in .env:
AGENT_RUNTIME=codex

// Or per-group in registered_groups.json:
{
  "containerConfig": {
    "env": {
      "AGENT_RUNTIME": "codex"
    }
  }
}
```

### Database Optimization

```sql
-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp
  ON messages(chat_jid, timestamp);

-- Vacuum database periodically
sqlite3 store/messages.db "VACUUM;"

-- Delete old messages (keep last 30 days)
DELETE FROM messages
WHERE timestamp < datetime('now', '-30 days');
```

### Log Management

```bash
# Rotate logs automatically (add to cron)
find logs/ -name "*.log" -mtime +7 -delete
find groups/*/logs/ -name "*.log" -mtime +7 -delete

# Or use logrotate
cat > /etc/logrotate.d/nanoclaw << EOF
/path/to/nanoclaw/logs/*.log {
  daily
  rotate 7
  compress
  missingok
  notifempty
}
EOF
```

---

## Additional Resources

- [Architecture Documentation](./ARCHITECTURE.md) - System design and data flow
- [Security Documentation](./SECURITY.md) - Security model and threat analysis
- [API Reference](./API.md) - Function signatures and interfaces
- [Contributing Guide](../CONTRIBUTING.md) - How to contribute

---

## Getting Help

- **GitHub Issues**: Report bugs or request features
- **Discussions**: Ask questions and share ideas
- **Claude Code**: Run `/debug` skill for automated diagnostics

Remember: NanoClaw is designed to be understood and modified. When in doubt, read the source code - it's small enough to comprehend in an hour.
