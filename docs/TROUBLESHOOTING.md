# NanoClaw Troubleshooting Guide

Common issues and their solutions.

---

## Table of Contents

1. [Installation Issues](#installation-issues)
2. [WhatsApp Issues](#whatsapp-issues)
3. [Discord Issues](#discord-issues)
4. [Container Issues](#container-issues)
5. [Session Issues](#session-issues)
6. [Task Scheduler Issues](#task-scheduler-issues)
7. [IPC Issues](#ipc-issues)
8. [Performance Issues](#performance-issues)
9. [Debug Techniques](#debug-techniques)

---

## Installation Issues

### Apple Container not found

**Error**: `container: command not found`

**Solution**:
```bash
# Install Apple Container
brew install container

# Or download from GitHub
# https://github.com/apple/container/releases

# Verify installation
container system status
```

### Container system won't start

**Error**: `Failed to start Apple Container system`

**Diagnosis**:
```bash
# Check if system is running
container system status

# Try manual start
container system start

# Check system logs
log show --predicate 'subsystem == "com.apple.container"' --last 5m
```

**Solutions**:
- Ensure you have admin permissions
- Restart your Mac
- Reinstall Apple Container
- Check disk space (containers need space)

### Node.js version mismatch

**Error**: `Error: The module was compiled against a different Node.js version`

**Solution**:
```bash
# Check Node.js version (must be 20+)
node --version

# Install correct version via nvm
nvm install 20
nvm use 20

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Build errors in container

**Error**: `error TS2304: Cannot find name 'X'`

**Solution**:
```bash
# Rebuild TypeScript
npm run build

# Rebuild container agent
cd container/agent-runner
npm install
npm run build
cd ../..

# Rebuild container image
./container/build.sh
```

---

## WhatsApp Issues

### QR code not appearing

**Error**: Service starts but no QR code shown

**Diagnosis**:
```bash
# Check logs
tail -f logs/nanoclaw.log

# Look for "WhatsApp authentication required"
grep -i "authentication required" logs/nanoclaw.log
```

**Solution**:
```bash
# Stop service
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# Run setup again
npm run dev
# In another terminal:
claude
# Then: /setup
```

### Connection keeps closing

**Error**: `Connection closed, reason: 428`

**Common Reasons**:
- Logged out from WhatsApp (reason: 401)
- Too many clients connected (reason: 409)
- WhatsApp Web session expired (reason: 428)

**Solution**:
```bash
# Delete auth state and re-authenticate
rm -rf store/auth/
npm run dev
# Then authenticate via QR code
```

### Messages not being received

**Diagnosis**:
```bash
# Check if messages are being stored
sqlite3 store/messages.db "SELECT COUNT(*) FROM messages WHERE timestamp > datetime('now', '-1 hour');"

# Check if group is registered
sqlite3 store/messages.db "SELECT * FROM chats;"
cat data/registered_groups.json | jq
```

**Solution**:
```bash
# Ensure group is registered
# Send from main chat: "@Andy add group 'Family Chat'"

# Or manually register in data/registered_groups.json
# Then restart service
```

### Bot responds to own messages

**Symptom**: Infinite loop of responses

**Diagnosis**:
```bash
# Check message logs
sqlite3 store/messages.db "SELECT sender_name, content FROM messages ORDER BY timestamp DESC LIMIT 20;"
```

**Solution**: This should not happen due to `assistantName` filtering in queries. If it does:

```typescript
// Verify this logic in src/db.ts getNewMessages():
WHERE sender_name != ?
// and
WHERE sender_name IS NULL OR sender_name != ?
```

---

## Discord Issues

### Bot not connecting

**Error**: `Discord client error: Incorrect login credentials`

**Solution**:
```bash
# Verify token in .env
cat .env | grep DISCORD_TOKEN

# Test token validity
curl -H "Authorization: Bot YOUR_TOKEN" \
  https://discord.com/api/v10/users/@me
```

### Bot not responding in channels

**Diagnosis**:
```bash
# Check logs for "Message not allowed"
grep "not allowed" logs/nanoclaw.log

# Verify channel configuration
cat .env | grep DISCORD_ALLOWED
```

**Solution**:
```bash
# Option 1: Allow specific channels
DISCORD_ALLOWED_CHANNEL_IDS=channel_id1,channel_id2

# Option 2: Allow all channels in guild
DISCORD_ALLOWED_GUILD_IDS=guild_id

# Option 3: Set main channel (restrictive)
DISCORD_MAIN_CHANNEL_ID=your_main_channel_id
# (Only main channel + DMs allowed by default)
```

### Bot missing message content

**Error**: `message.content` is empty

**Cause**: Missing `MessageContent` intent

**Solution**: Enable "Message Content Intent" in Discord Developer Portal:
1. Go to https://discord.com/developers/applications
2. Select your application
3. Go to "Bot" section
4. Enable "Message Content Intent"
5. Restart bot

---

## Container Issues

### Container exits with code 1

**Common Causes**:
1. Container system not running
2. Invalid mount paths
3. Missing authentication
4. Container image not built

**Diagnosis**:
```bash
# Check container system
container system status

# Check container logs
tail -f groups/main/logs/container-*.log

# Try manual container run
echo '{"prompt":"test","groupFolder":"main","chatJid":"test","isMain":true}' | \
  container run -i --rm \
  -v $(pwd)/groups/main:/workspace/group \
  nanoclaw-agent:latest
```

**Solutions**:

**If container system not running**:
```bash
container system start
```

**If mount paths invalid**:
```bash
# Ensure paths are absolute
pwd  # Use this as PROJECT_ROOT

# Check registered_groups.json
cat data/registered_groups.json | jq
# All hostPath values must be absolute
```

**If authentication missing**:
```bash
# Ensure .env has auth token
cat .env | grep -E "CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY"

# Token should be copied to data/env/env
cat data/env/env
```

**If image not built**:
```bash
# Build container image
./container/build.sh

# Verify image exists
container image list | grep nanoclaw
```

### Container times out

**Error**: `Container timed out after 300000ms`

**Cause**: Task takes longer than timeout limit

**Solution**:
```bash
# Option 1: Increase global timeout in .env
CONTAINER_TIMEOUT=600000  # 10 minutes

# Option 2: Increase per-group timeout
# In data/registered_groups.json:
{
  "123456@g.us": {
    "containerConfig": {
      "timeout": 900000  // 15 minutes
    }
  }
}
```

### Output truncated

**Warning**: `Container stdout truncated due to size limit`

**Cause**: Output exceeds 10MB limit

**Solution**:
```bash
# Increase limit in .env
CONTAINER_MAX_OUTPUT_SIZE=52428800  # 50MB

# Or tell agent to produce less output
# "@Andy please summarize instead of full output"
```

### Permission denied in container

**Error**: `EACCES: permission denied`

**Cause**: File ownership mismatch (container runs as uid 1000)

**Diagnosis**:
```bash
# Check file ownership
ls -la groups/main/

# Should be owned by current user or uid 1000
```

**Solution**:
```bash
# Option 1: Fix ownership
sudo chown -R $(id -u):$(id -g) groups/

# Option 2: Make world-writable (less secure)
chmod -R 777 groups/

# Option 3: Run container as current user (requires Dockerfile change)
```

---

## Session Issues

### Session not continuing

**Symptom**: Agent doesn't remember previous conversation

**Diagnosis**:
```bash
# Check sessions file
cat data/sessions.json

# Should have entry like:
# {"main": "session-abc123"}

# Check session directory exists
ls -la data/sessions/main/.claude/

# Check container logs for session errors
grep -i session groups/main/logs/container-*.log
```

**Solutions**:

**If sessions.json empty**:
```bash
# Delete and let it regenerate
rm data/sessions.json
# Next conversation will create new session
```

**If session directory doesn't exist**:
```bash
# Create directory
mkdir -p data/sessions/main/.claude/
```

**If mount path wrong**:
```bash
# Verify mount in container logs
grep ".claude" groups/main/logs/container-*.log

# Should be: /home/node/.claude (NOT /root/.claude)
# Container runs as 'node' user, not 'root'
```

**If session corrupted**:
```bash
# Delete session data and start fresh
rm -rf data/sessions/main/.claude/*
# Update sessions.json to remove session ID
```

### Session for wrong group

**Symptom**: Agent has wrong context in group chat

**Cause**: Session ID shared between groups

**Diagnosis**:
```bash
# Check sessions.json
cat data/sessions.json

# Each group should have unique session ID
```

**Solution**:
```bash
# Ensure per-group session directories
ls -la data/sessions/

# Should see:
# main/
# family-chat/
# dev-team/

# Each with own .claude/ directory
```

---

## Task Scheduler Issues

### Tasks not running

**Diagnosis**:
```bash
# Check if scheduler is running
grep "Scheduler loop started" logs/nanoclaw.log

# Check tasks in database
sqlite3 store/messages.db "SELECT id, prompt, next_run, status FROM scheduled_tasks;"

# Check task run logs
sqlite3 store/messages.db "SELECT * FROM task_run_logs ORDER BY run_at DESC LIMIT 10;"
```

**Common Issues**:

**Scheduler not started**:
```bash
# Check logs for startup
grep -i scheduler logs/nanoclaw.log

# Should see "Scheduler loop started"
# If not, check for earlier errors
```

**Task status is 'paused'**:
```sql
-- Resume task
UPDATE scheduled_tasks SET status='active' WHERE id='task-123';
```

**next_run is null**:
```sql
-- Check task
SELECT * FROM scheduled_tasks WHERE next_run IS NULL;

-- Invalid cron expression or past one-time task
```

**next_run is in future**:
```sql
-- Check if task is actually due
SELECT id, next_run, datetime('now') FROM scheduled_tasks;

-- Scheduler only runs tasks where next_run <= now
```

### Task runs but doesn't send message

**Diagnosis**:
```bash
# Check task run logs
sqlite3 store/messages.db \
  "SELECT task_id, status, result, error FROM task_run_logs WHERE task_id='task-123' ORDER BY run_at DESC LIMIT 1;"
```

**Possible Causes**:
1. Task succeeded but didn't call `send_message` tool
2. Task failed (check error field)
3. Message sent but WhatsApp failed (check logs)

**Solution**:
```bash
# Check task prompt includes sending message
sqlite3 store/messages.db "SELECT prompt FROM scheduled_tasks WHERE id='task-123';"

# Should mention "send message" or "reply" or similar
# Example: "Check status and send summary to group"
```

### Task runs too frequently

**Symptom**: Task executes multiple times per minute

**Cause**: Invalid interval or cron expression

**Diagnosis**:
```sql
SELECT id, schedule_type, schedule_value, next_run
FROM scheduled_tasks
WHERE id='task-123';
```

**Solution**:
```sql
-- Fix interval (must be in milliseconds)
UPDATE scheduled_tasks
SET schedule_value='3600000'  -- 1 hour
WHERE id='task-123' AND schedule_type='interval';

-- Fix cron expression
UPDATE scheduled_tasks
SET schedule_value='0 9 * * 1'  -- Every Monday 9am
WHERE id='task-123' AND schedule_type='cron';
```

---

## IPC Issues

### IPC files accumulating

**Symptom**: `data/ipc/{group}/tasks/` has many old files

**Diagnosis**:
```bash
# Check for stuck files
ls -lht data/ipc/main/tasks/

# Check IPC watcher is running
grep "IPC watcher started" logs/nanoclaw.log
```

**Solution**:
```bash
# Stop service
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# Clear stuck files
rm data/ipc/main/tasks/*.json
rm data/ipc/main/messages/*.json

# Restart service
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

### IPC errors directory filling up

**Location**: `data/ipc/errors/`

**Diagnosis**:
```bash
# List error files
ls -la data/ipc/errors/

# Read an error file
cat data/ipc/errors/main-schedule-1234567890.json
```

**Common Errors**:

**Invalid JSON**:
- Agent wrote malformed JSON to IPC file
- Check container logs for the timestamp

**Missing required fields**:
- IPC request missing parameters
- Check MCP tool call in container logs

**Authorization failed**:
- Non-main group trying to schedule for another group
- Check `sourceGroup` vs `targetGroup` in logs

**Solution**:
```bash
# Review and delete error files once resolved
rm data/ipc/errors/*

# Fix underlying issue (check container logs)
```

---

## Performance Issues

### High CPU usage

**Diagnosis**:
```bash
# Check process CPU
top -pid $(pgrep -f "node.*nanoclaw")

# Check for runaway containers
ps aux | grep container
```

**Common Causes**:
1. Polling interval too short
2. Too many groups registered
3. Container not terminating
4. Infinite loop in agent

**Solutions**:

**Increase polling intervals** (.env):
```bash
# Increase from 2s to 5s
# (Edit src/config.ts, rebuild)
POLL_INTERVAL=5000
```

**Kill stuck containers**:
```bash
# List running containers
container list

# Kill stuck container
container kill <container-id>
```

### High memory usage

**Diagnosis**:
```bash
# Check process memory
ps aux | grep node | grep nanoclaw

# Check container logs size
du -sh groups/*/logs/
```

**Solutions**:

**Clean old logs**:
```bash
# Delete logs older than 7 days
find groups/*/logs/ -name "*.log" -mtime +7 -delete
find logs/ -name "*.log" -mtime +7 -delete
```

**Reduce log verbosity**:
```bash
# In .env
LOG_LEVEL=info  # Instead of debug
```

**Limit container output**:
```bash
# In .env
CONTAINER_MAX_OUTPUT_SIZE=5242880  # 5MB instead of 10MB
```

### Slow message processing

**Diagnosis**:
```bash
# Time a message processing
# Send: "@Andy what's 2+2?"
# Check logs for duration
grep "Container completed" logs/nanoclaw.log | tail -1
```

**Solutions**:

**Use Codex runtime for simple queries**:
```bash
# In .env
AGENT_RUNTIME=codex

# Or hot-swap in Discord/WhatsApp
!runtime codex
```

**Reduce session context**:
```bash
# Use isolated context for tasks
schedule_task({
  context_mode: 'isolated'  // Faster, no history
});
```

**Optimize database**:
```bash
sqlite3 store/messages.db "VACUUM;"
sqlite3 store/messages.db "ANALYZE;"
```

---

## Debug Techniques

### Enable verbose logging

```bash
# In .env or environment
LOG_LEVEL=debug

# Restart service
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

**Debug output includes**:
- Full container input JSON
- All mount points
- Complete stdout/stderr
- IPC file operations
- Database queries

### Watch logs in real-time

```bash
# Host logs
tail -f logs/nanoclaw.log

# Container logs (most recent)
tail -f $(ls -t groups/main/logs/container-*.log | head -1)

# Multiple logs
tail -f logs/nanoclaw.log groups/main/logs/container-*.log
```

### Inspect database

```bash
# Interactive mode
sqlite3 store/messages.db

# Useful queries
.schema
SELECT * FROM chats;
SELECT * FROM messages ORDER BY timestamp DESC LIMIT 10;
SELECT * FROM scheduled_tasks;
SELECT * FROM task_run_logs ORDER BY run_at DESC LIMIT 10;

# Query settings
SELECT * FROM settings;
```

### Test container manually

```bash
# Create test input
cat > /tmp/test-input.json << EOF
{
  "prompt": "<messages><message sender=\"Test\">Hello</message></messages>",
  "groupFolder": "main",
  "chatJid": "test",
  "isMain": true
}
EOF

# Run container
cat /tmp/test-input.json | \
  container run -i --rm \
  -v $(pwd)/groups/main:/workspace/group \
  -v $(pwd)/data/sessions/main/.claude:/home/node/.claude \
  nanoclaw-agent:latest
```

### Trace message flow

```bash
# 1. Send message in WhatsApp
# "@Andy test message"

# 2. Watch message arrive
sqlite3 store/messages.db \
  "SELECT timestamp, sender_name, content FROM messages ORDER BY timestamp DESC LIMIT 1;"

# 3. Check router state
cat data/router_state.json | jq

# 4. Check container was spawned
ls -lt groups/main/logs/ | head -2

# 5. Check response sent
sqlite3 store/messages.db \
  "SELECT timestamp, sender_name, content FROM messages WHERE is_from_me=1 ORDER BY timestamp DESC LIMIT 1;"
```

### Monitor IPC

```bash
# Watch IPC directories
watch -n 1 'ls -lht data/ipc/main/tasks/ | head -5'

# Or use fswatch (install via brew)
fswatch -o data/ipc/main/ | xargs -n1 -I{} \
  echo "IPC activity detected: $(date)"
```

### Check container mounts

```bash
# View mounts in container log
grep "Container mount configuration" logs/nanoclaw.log -A 20
```

---

## Getting Help

If issues persist:

1. **Run /debug skill in Claude Code**
   ```bash
   claude
   # Then: /debug
   ```

2. **Collect diagnostic info**:
   ```bash
   # System info
   uname -a
   node --version
   container system status

   # Recent logs
   tail -100 logs/nanoclaw.log > debug.log
   tail -100 logs/nanoclaw.error.log >> debug.log

   # State files
   cat data/router_state.json >> debug.log
   cat data/sessions.json >> debug.log
   cat data/registered_groups.json >> debug.log

   # Database info
   sqlite3 store/messages.db ".schema" >> debug.log
   sqlite3 store/messages.db "SELECT COUNT(*) FROM messages;" >> debug.log
   sqlite3 store/messages.db "SELECT COUNT(*) FROM scheduled_tasks;" >> debug.log
   ```

3. **Create GitHub issue** with:
   - Error message
   - Relevant logs (sanitize sensitive data!)
   - Steps to reproduce
   - System info

---

## Appendix: Log Analysis

### Log Levels

- **ERROR**: Something failed, requires attention
- **WARN**: Something unexpected, may cause issues
- **INFO**: Normal operation events
- **DEBUG**: Detailed diagnostic information

### Common Log Messages

**"Container completed"** (INFO):
- Normal: Container finished successfully
- Check `duration` field for performance

**"Container exited with error"** (ERROR):
- Problem: Container failed
- Check `code` and `stderr` fields

**"Failed to parse container output"** (ERROR):
- Problem: Container stdout not in expected format
- Check container logs for malformed output

**"Unauthorized task attempt blocked"** (WARN):
- Normal: Security working correctly
- Non-main group tried privileged operation

**"IPC watcher started"** (INFO):
- Normal: IPC system running
- Should appear once on startup

**"Group metadata synced"** (INFO):
- Normal: WhatsApp groups refreshed
- Happens on startup and every 24 hours

### Log Location Summary

| Log Type | Location | Purpose |
|----------|----------|---------|
| Host stdout | `logs/nanoclaw.log` | Main application logs |
| Host stderr | `logs/nanoclaw.error.log` | Unhandled errors |
| Container | `groups/{folder}/logs/container-*.log` | Per-execution logs |
| System | Console.app or `log show` | macOS system logs |

---

## Quick Reference

```bash
# Start/stop service
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# Dev mode
npm run dev

# View logs
tail -f logs/nanoclaw.log

# Check database
sqlite3 store/messages.db "SELECT * FROM scheduled_tasks;"

# Rebuild container
./container/build.sh

# Check container system
container system status

# Clean up
rm -rf store/auth/           # Re-authenticate WhatsApp
rm data/sessions.json        # Reset sessions
rm data/ipc/*/tasks/*.json   # Clear IPC queue
```
