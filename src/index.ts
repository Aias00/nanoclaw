import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  DISCORD_MAIN_CHANNEL_ID,
  DISCORD_TOKEN,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  REQUIRE_TRIGGER,
  TRIGGER_PATTERN,
} from './config.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { startDiscord, sendDiscordMessage, setDiscordTyping, DiscordIncomingMessage } from './discord.js';
import {
  ContainerOutput,
  runAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeDiscordMessage,
  storeMessage,
  getSetting,
  setSetting,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { startIpcWatcher } from './ipc.js';
import { escapeXml, formatMessages, formatOutbound } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

let whatsapp: WhatsAppChannel;
const queue = new GroupQueue();

// Hardcoded group for Discord interactions (for now)
const DISCORD_GROUP: RegisteredGroup = {
  name: 'Discord',
  folder: 'discord',
  trigger: '.*',
  added_at: new Date().toISOString(),
  requiresTrigger: false,
};

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();

  // Ensure Discord group is registered
  if (!registeredGroups['discord']) {
    registerGroup('discord', DISCORD_GROUP);
  }

  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState(
    'last_agent_timestamp',
    JSON.stringify(lastAgentTimestamp),
  );
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.jid.endsWith('@g.us'))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  // REQUIRE_TRIGGER config controls whether we enforce @Name mentions
  if (!isMainGroup && REQUIRE_TRIGGER && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ group: group.name }, 'Idle timeout, closing container stdin');
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await whatsapp.setTyping(chatJid, true);
  let hadError = false;

  // Update session tracking
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMainGroup,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMainGroup,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  try {
    const output = await runAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain: isMainGroup,
      },
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
      async (result) => {
        // Streaming output callback — called for each agent result
        if (result.newSessionId) {
          sessions[group.folder] = result.newSessionId;
          setSession(group.folder, result.newSessionId);
        }

        if (result.result) {
          const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
          // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
          const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
          logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
          if (text) {
            // Send raw text without "AssistantName:" prefix
            await whatsapp.sendMessage(chatJid, text);
            // Save state immediately after sending to prevent re-sending on crash
            saveState();
          }
          // Only reset idle timer on actual results, not session-update markers (result: null)
          resetIdleTimer();
        }

        if (result.status === 'error') {
          hadError = true;
        }
      }
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      hadError = true;
    }
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent execution error');
    hadError = true;
  }

  await whatsapp.setTyping(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (hadError) {
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn({ group: group.name }, 'Agent error, rolled back message cursor for retry');
    return false;
  }

  return true;
}

// Discord message handler
async function processDiscordIncoming(msg: DiscordIncomingMessage): Promise<void> {
  // Handle admin commands (hot-swappable settings)
  const commandMatch = msg.content.match(/^!runtime\s+(claude|codex|opencode|status)$/i);
  if (commandMatch) {
    const cmd = commandMatch[1].toLowerCase();
    if (cmd === 'status') {
      const current = getSetting('agent_runtime') || 'claude (default)';
      await sendDiscordMessage(msg.scopeId, `🔧 Current runtime: **${current}**`);
    } else {
      setSetting('agent_runtime', cmd);
      logger.info({ runtime: cmd, user: msg.authorName }, 'Runtime switched via command');
      await sendDiscordMessage(msg.scopeId, `✅ Runtime switched to **${cmd}**. Next message will use it.`);
    }
    return; // Don't process as normal message
  }

  // Persist chat + message
  storeChatMetadata(msg.scopeId, msg.timestamp, msg.channelName ? `discord:${msg.channelName}` : msg.scopeId);
  storeDiscordMessage({
    id: msg.id,
    chatJid: msg.scopeId,
    senderId: msg.authorId,
    senderName: msg.authorName,
    content: msg.content,
    timestamp: msg.timestamp,
    isFromMe: false
  });

  // Respond to all messages in allowed channels (no @mention required)
  // The isAllowed check in discord.ts already filters to main channel + allowlisted channels
  const shouldRespond = true;
  if (!shouldRespond) return;

  const sinceTimestamp = lastAgentTimestamp[msg.scopeId] || '';
  const prompt = buildPromptFromMessages(msg.scopeId, sinceTimestamp);
  if (!prompt) return;

  const isMain = msg.isMainChannel;

  logger.info({ scopeId: msg.scopeId, isMain, isDM: msg.isDM }, 'Processing Discord message');

  await setDiscordTyping(msg.scopeId, true);

  // Ensure Discord group is registered
  if (!registeredGroups['discord']) {
    registerGroup('discord', DISCORD_GROUP);
  }

  const group = registeredGroups['discord'];
  const sessionId = sessions[group.folder];

  // Update snapshots
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    false, // Discord group is not "main" in terms of whatsapp management
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  try {
    const output = await runAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid: msg.scopeId,
        isMain: false,
      },
      (proc, containerName) => {
        // No queue management for Discord yet
      }
    );

    await setDiscordTyping(msg.scopeId, false);

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.result) {
      lastAgentTimestamp[msg.scopeId] = msg.timestamp;
      saveState(); // Save state immediately
      // Send raw response without prefix
      await sendDiscordMessage(msg.scopeId, output.result);
    }
  } catch (err) {
    logger.error({ err }, 'Error processing Discord message');
    await setDiscordTyping(msg.scopeId, false);
  }
}

function buildPromptFromMessages(chatJid: string, sinceTimestamp: string): string {
  const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

  const lines = missedMessages.map(m => {
    const escapeXml = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    return `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`;
  });

  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

          // Check REQUIRE_TRIGGER for non-main groups
          const needsTrigger = !isMainGroup && REQUIRE_TRIGGER && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const hasTrigger = groupMessages.some((m) =>
              TRIGGER_PATTERN.test(m.content.trim()),
            );
            if (!hasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  // Only check Apple Container if we are using it
  // Docker, Tart, and Vibe don't use 'container' command
  // But we still need to check if 'container' command exists first to avoid error
  const containerRuntime = process.env.CONTAINER_RUNTIME;
  if (containerRuntime === 'docker' || containerRuntime === 'tart' || containerRuntime === 'vibe') {
    logger.info({ runtime: containerRuntime }, 'Using alternative runtime, skipping Apple Container check');
    return;
  }

  // Auto-detection logic: if 'container' command exists, use it.
  try {
    execSync('which container', { stdio: 'ignore' });
  } catch {
    // container command not found, probably using Docker as fallback
    logger.info('Apple Container (container) not found, assuming Docker usage');
    return;
  }

  try {
    execSync('container system status', { stdio: 'pipe' });
    logger.debug('Apple Container system already running');
  } catch {
    logger.info('Starting Apple Container system...');
    try {
      execSync('container system start', { stdio: 'pipe', timeout: 30000 });
      logger.info('Apple Container system started');
    } catch (err) {
      logger.warn({ err }, 'Failed to start Apple Container system (may fallback to Docker)');
    }
  }
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    if (whatsapp) await whatsapp.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Create WhatsApp channel
  whatsapp = new WhatsAppChannel({
    onMessage: (chatJid, msg) => storeMessage(msg),
    onChatMetadata: (chatJid, timestamp) => storeChatMetadata(chatJid, timestamp),
    registeredGroups: () => registeredGroups,
  });

  // Connect WhatsApp — resolves when first connected
  // Note: We don't block on this anymore to allow Discord-only operation
  whatsapp.connect().catch(err => {
    logger.warn({ err }, 'WhatsApp connection failed (continuing with other channels)');
  });

  // Connect Discord
  if (DISCORD_TOKEN) {
    try {
      await startDiscord({
        onIncomingMessage: processDiscordIncoming,
        logger
      });
    } catch (err) {
      logger.error({ err }, 'Discord connection failed (continuing with other channels)');
    }
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) => queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const text = formatOutbound(whatsapp, rawText);
      if (text) await whatsapp.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => whatsapp.sendMessage(jid, text),
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: (force) => whatsapp.syncGroupMetadata(force),
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) => writeGroupsSnapshot(gf, im, ag, rj),
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop();
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
