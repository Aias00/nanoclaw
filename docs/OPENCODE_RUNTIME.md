# OpenCode Runtime Support

OpenCode has been added as a third runtime option for Nanoclaw, alongside Claude Agent SDK and Codex CLI.

## Features

- **Session Management**: OpenCode supports persistent sessions across conversations
- **JSON Output**: Provides structured JSON output for easier parsing
- **Modern CLI**: Full-featured AI coding assistant with advanced capabilities
- **IPC Integration**: Full support for NanoClaw's IPC tools (messaging, task scheduling)

## Configuration

### Option 1: Environment Variable

Add to your `.env` file:

```bash
AGENT_RUNTIME=opencode
```

### Option 2: Per-Group Configuration

Each group can override the runtime in their configuration. Set it in the database:

```sql
INSERT OR REPLACE INTO settings (key, value) VALUES ('agent_runtime', 'opencode');
```

### Option 3: Hot-Swap Runtime

You can change the runtime on the fly from your main channel:

```
@Andy switch to opencode runtime
```

## Available Runtimes

1. **claude** (default) - Claude Agent SDK in containers (most capable, secure)
2. **codex** - Codex CLI (lightweight, fast)
3. **opencode** - OpenCode CLI (modern, session-aware)

## Runtime Selection Priority

The system selects runtime in this order:

1. Per-group container config (`containerConfig.env.AGENT_RUNTIME`)
2. Database setting (`agent_runtime`)
3. Environment variable (`AGENT_RUNTIME`)
4. Default (`claude`)

## Session Continuity

OpenCode supports session IDs for conversation continuity:

- Sessions are automatically tracked per group
- Each message continues the previous conversation
- Session state is preserved across runs

## Installation

Make sure OpenCode is installed and available in your PATH:

```bash
which opencode
# Should output: /Users/[username]/.opencode/bin/opencode
```

If not installed, visit: https://opencode.dev

## Testing

To test OpenCode runtime:

1. Set `AGENT_RUNTIME=opencode` in `.env`
2. Restart nanoclaw: `npm run dev`
3. Send a message: `@Andy hello, are you using OpenCode?`

The logs will show: `Running OpenCode runtime`

## Comparison

| Feature | Claude SDK | Codex | OpenCode |
|---------|-----------|-------|----------|
| Container Isolation | ✅ | ❌ | ❌ |
| Session Continuity | ✅ | ❌ | ✅ |
| Lightweight | ❌ | ✅ | ✅ |
| IPC Tools | ✅ | ✅ | ✅ |
| File Access | ✅ | ✅ | ✅ |
| Speed | Medium | Fast | Fast |

## Troubleshooting

### OpenCode not found

If you get "Failed to spawn opencode", ensure it's installed:

```bash
opencode --version
```

### Empty output

Check the logs in `groups/[group-name]/logs/` for detailed error messages.

### Session not continuing

OpenCode sessions are captured automatically. If sessions aren't continuing, check that:
- OpenCode is returning session IDs in its JSON output
- The `newSessionId` is being captured correctly in logs
