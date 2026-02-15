# OpenCode Integration - Change Summary

## Overview
Added OpenCode CLI as a third runtime option for NanoClaw, providing users with a modern, session-aware AI coding assistant alternative to Claude Agent SDK and Codex CLI.

## Files Changed

### New Files Created

1. **src/opencode-runner.ts** (205 lines)
   - Main runner implementation for OpenCode CLI integration
   - JSON output parsing for structured responses
   - Session ID tracking for conversation continuity
   - IPC tool injection for NanoClaw integration
   - Timeout and error handling

2. **docs/OPENCODE_RUNTIME.md** (130 lines)
   - Complete documentation for OpenCode runtime
   - Configuration guide
   - Feature comparison table
   - Troubleshooting section

### Modified Files

1. **src/config.ts**
   - Updated `AgentRuntime` type: `'claude' | 'codex' | 'opencode'`
   - Added OpenCode to runtime selection logic
   - **Lines changed**: 2

2. **src/container-runner.ts**
   - Imported `runOpenCodeAgent` from opencode-runner
   - Updated `getAgentRuntime()` to validate 'opencode' option
   - Added OpenCode runtime branch in `runContainerAgent()`
   - **Lines changed**: 15

3. **.env.example**
   - Updated `AGENT_RUNTIME` comment to include 'opencode' option
   - **Lines changed**: 1

4. **CAPABILITIES.md**
   - Added OpenCode CLI section to runtime options
   - Documented session continuation feature
   - **Lines changed**: 4

## Technical Implementation

### Architecture

```
User Message
    ↓
getAgentRuntime(group)
    ↓
Runtime = 'opencode'?
    ↓
runOpenCodeAgent()
    ↓
spawn('opencode', ['run', '--format', 'json', prompt])
    ↓
Parse JSON output
    ↓
Extract assistant message + session ID
    ↓
Return ContainerOutput
```

### Key Features

1. **JSON Output Parsing**
   - Uses `--format json` flag for structured output
   - Extracts assistant messages from JSON stream
   - Handles both string and array content types

2. **Session Management**
   - Captures session ID from JSON output
   - Passes `--session` flag for continuation
   - Returns `newSessionId` in ContainerOutput

3. **IPC Integration**
   - Injects NanoClaw IPC tool guide into prompt
   - Supports message sending and task scheduling
   - Full compatibility with existing IPC system

4. **Environment Isolation**
   - Respects `NANOCLAW_GROUP_DIR` for working directory
   - Exposes `NANOCLAW_IPC_DIR` for tool access
   - Inherits process environment variables

5. **Error Handling**
   - Timeout protection with SIGKILL
   - Exit code validation
   - Empty output detection
   - Spawn error handling

## Runtime Selection Priority

1. Per-group config: `group.containerConfig.env.AGENT_RUNTIME`
2. Database setting: `settings.agent_runtime`
3. Environment variable: `process.env.AGENT_RUNTIME`
4. Default: `'claude'`

## Testing Checklist

- [x] TypeScript compilation passes
- [ ] OpenCode CLI available in PATH
- [ ] Basic message processing works
- [ ] Session continuation works
- [ ] IPC message sending works
- [ ] IPC task scheduling works
- [ ] Error handling works (timeout, spawn error)
- [ ] Runtime switching works (env, db, per-group)

## Usage Example

```bash
# In .env
AGENT_RUNTIME=opencode

# Start nanoclaw
npm run dev

# Test message
@Andy hello, what runtime are you using?
```

Expected log output:
```
Running OpenCode runtime
Spawning OpenCode CLI
```

## Comparison with Existing Runtimes

| Aspect | Claude SDK | Codex | OpenCode |
|--------|-----------|-------|----------|
| Isolation | Container | Process | Process |
| Session State | ✅ | ❌ | ✅ |
| Overhead | High | Low | Low |
| Output Format | Custom | Text | JSON |
| IPC Support | ✅ | ✅ | ✅ |

## Dependencies

No new npm dependencies required. OpenCode must be installed separately:

```bash
# Check installation
which opencode
# /Users/username/.opencode/bin/opencode
```

## Future Enhancements

1. **Model Selection**: Support `--model` flag for runtime model switching
2. **Agent Profiles**: Support `--agent` flag for specialized agent modes
3. **Format Options**: Support `--format default` for plain text output
4. **Session Pruning**: Implement session cleanup for old/unused sessions
5. **Performance Metrics**: Track token usage via OpenCode stats API

## Migration Notes

Existing installations:
1. Pull latest code
2. Set `AGENT_RUNTIME=opencode` in `.env` (optional)
3. Restart nanoclaw
4. No data migration needed

## References

- OpenCode CLI: https://opencode.dev
- OpenCode Documentation: https://docs.opencode.dev
- NanoClaw Architecture: docs/ARCHITECTURE.md
