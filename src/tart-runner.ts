/**
 * Tart Runner for NanoClaw
 * Provides VM-level isolation using Tart (macOS Virtualization.framework)
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { logger } from './logger.js';
import {
  executeSSH,
  waitForVMIP,
  waitForSSH,
  uploadViaSCP,
  type SSHConfig,
} from './tart-ssh-helper.js';
import type { RegisteredGroup } from './types.js';
import type { ContainerInput, ContainerOutput } from './container-runner.js';
import { GROUPS_DIR, DATA_DIR, type AgentRuntime } from './config.js';

// Tart configuration
const TART_BASE_IMAGE = process.env.TART_BASE_IMAGE || 'tart_nanoclaw_base';
const TART_USERNAME = process.env.TART_VM_USERNAME || 'admin';
const TART_PASSWORD = process.env.TART_VM_PASSWORD || 'admin';
const TART_SSH_TIMEOUT = parseInt(process.env.TART_SSH_TIMEOUT || '60000', 10);
const TART_PROJECT_MOUNT = '/Volumes/My Shared Files/project';

/**
 * Get the agent runtime from group configuration
 */
function getAgentRuntime(group: RegisteredGroup): AgentRuntime {
  const groupRuntime = group.containerConfig?.env?.AGENT_RUNTIME as AgentRuntime | undefined;
  if (groupRuntime) return groupRuntime;
  return (process.env.AGENT_RUNTIME as AgentRuntime) || 'claude';
}

/**
 * Upload configuration files to the VM
 */
async function uploadConfigs(
  ip: string,
  sshConfig: SSHConfig,
): Promise<void> {
  const homeDir = os.homedir();
  const configFiles = [
    path.join(homeDir, '.claude'),
    path.join(homeDir, '.claude.json'),
    path.join(homeDir, '.opencode'),
    path.join(homeDir, '.opencode.json'),
  ].filter(fs.existsSync);

  if (configFiles.length === 0) {
    logger.info('No configuration files found to upload');
    return;
  }

  // Create tar archive for batch upload
  const tarFile = `/tmp/nanoclaw-configs-${Date.now()}.tar.gz`;
  const relativeFiles = configFiles.map((f) => path.relative(homeDir, f));

  logger.info({ files: relativeFiles.length }, 'Creating config archive');
  execSync(`tar -czf ${tarFile} -C ${homeDir} ${relativeFiles.join(' ')}`);

  try {
    // Upload tar to VM
    await uploadViaSCP(ip, tarFile, '/tmp/configs.tar.gz', sshConfig);

    // Extract on VM
    await executeSSH(
      ip,
      `tar -xzf /tmp/configs.tar.gz -C /Users/${sshConfig.username} && rm -f /tmp/configs.tar.gz`,
      sshConfig,
      30000,
    );

    logger.info({ files: relativeFiles.length }, 'Configuration files uploaded');
  } finally {
    // Cleanup local tar file
    try {
      fs.unlinkSync(tarFile);
    } catch {}
  }
}

/**
 * Export environment variables to the VM
 */
async function exportEnvVars(
  ip: string,
  sshConfig: SSHConfig,
): Promise<void> {
  const envVars: string[] = [];

  // Export all *API_KEY* environment variables
  for (const key of Object.keys(process.env)) {
    if (key.includes('API_KEY')) {
      const value = process.env[key];
      if (value) {
        envVars.push(`export ${key}="${value}"`);
        logger.debug({ key }, 'Exporting environment variable');
      }
    }
  }

  if (envVars.length === 0) {
    logger.info('No API keys found to export');
    return;
  }

  const envScript = envVars.join('\n');
  await executeSSH(
    ip,
    `cat >> ~/.zshenv << 'ENVEOF'\n${envScript}\nENVEOF`,
    sshConfig,
    30000,
  );

  logger.info({ count: envVars.length }, 'Environment variables exported');
}

/**
 * Execute agent command in the VM
 */
async function executeAgentInVM(
  ip: string,
  sshConfig: SSHConfig,
  group: RegisteredGroup,
  input: ContainerInput,
  runtime: AgentRuntime,
): Promise<{ stdout: string; sessionId?: string }> {
  let command: string;

  // Build command based on runtime
  switch (runtime) {
    case 'claude':
      command = `cd ~/project && claude --dangerously-skip-permissions exec "${input.prompt.replace(/"/g, '\\"')}"`;
      if (input.sessionId) {
        command = `cd ~/project && claude --dangerously-skip-permissions --session ${input.sessionId} exec "${input.prompt.replace(/"/g, '\\"')}"`;
      }
      break;

    case 'codex':
      command = `cd ~/project && codex --yolo exec "${input.prompt.replace(/"/g, '\\"')}"`;
      break;

    case 'opencode':
      command = `cd ~/project && OPENCODE_YOLO=true opencode run "${input.prompt.replace(/"/g, '\\"')}"`;
      if (input.sessionId) {
        command = `cd ~/project && OPENCODE_YOLO=true opencode run --session ${input.sessionId} "${input.prompt.replace(/"/g, '\\"')}"`;
      }
      break;

    default:
      throw new Error(`Unknown runtime: ${runtime}`);
  }

  logger.info({ runtime, group: group.name }, 'Executing agent in VM');

  const timeout = group.containerConfig?.timeout || TART_SSH_TIMEOUT;
  const result = await executeSSH(ip, command, sshConfig, timeout);

  if (result.exitCode !== 0) {
    throw new Error(`Agent execution failed with exit code ${result.exitCode}: ${result.stderr.slice(-500)}`);
  }

  // Try to extract session ID from output (implementation depends on CLI format)
  const sessionId = extractSessionId(result.stdout, runtime);

  return {
    stdout: result.stdout,
    sessionId,
  };
}

/**
 * Extract session ID from agent output
 */
function extractSessionId(output: string, runtime: AgentRuntime): string | undefined {
  // This is a placeholder - actual implementation depends on CLI output format
  // For Claude Code, session ID might be in a specific format
  // For OpenCode, it's in JSON output

  if (runtime === 'opencode') {
    try {
      const lines = output.split('\n');
      for (const line of lines) {
        const json = JSON.parse(line);
        if (json.type === 'session' && json.id) {
          return json.id;
        }
      }
    } catch {}
  }

  return undefined;
}

/**
 * Main Tart agent runner
 */
export async function runTartAgent(
  group: RegisteredGroup,
  input: ContainerInput,
): Promise<ContainerOutput> {
  const vmName = `nanoclaw-${group.folder}-${Date.now()}`;
  const sshConfig: SSHConfig = {
    username: TART_USERNAME,
    password: TART_PASSWORD,
  };

  let vmIP: string | null = null;

  try {
    // 1. Check base image exists
    const images = execSync('tart list', { encoding: 'utf8' });
    if (!images.includes(TART_BASE_IMAGE)) {
      throw new Error(
        `Tart base image '${TART_BASE_IMAGE}' not found. Run scripts/prepare-tart-base.sh first.`,
      );
    }

    // 2. Clone base image
    logger.info({ group: group.name, vmName, baseImage: TART_BASE_IMAGE }, 'Cloning Tart VM');
    execSync(`tart clone ${TART_BASE_IMAGE} ${vmName}`, { stdio: 'inherit' });

    // 3. Start VM with project directory mounted
    const groupDir = path.join(GROUPS_DIR, group.folder);
    fs.mkdirSync(groupDir, { recursive: true });

    logger.info({ group: group.name, groupDir }, 'Starting Tart VM');
    execSync(
      `tart run ${vmName} --dir=project:"${groupDir}" --no-audio --no-clipboard &`,
      { stdio: 'inherit' },
    );

    // 4. Wait for VM to boot and get IP
    vmIP = await waitForVMIP(vmName);
    logger.info({ group: group.name, vmIP }, 'VM IP obtained');

    // 5. Wait for SSH connectivity
    await waitForSSH(vmIP, sshConfig);
    logger.info({ group: group.name, vmIP }, 'SSH connectivity established');

    // 6. Create ~/project symlink to mounted directory
    await executeSSH(
      vmIP,
      `ln -sfn "${TART_PROJECT_MOUNT}" ~/project`,
      sshConfig,
      10000,
    );

    // 7. Upload configuration files
    await uploadConfigs(vmIP, sshConfig);

    // 8. Export environment variables
    await exportEnvVars(vmIP, sshConfig);

    // 9. Set up IPC and session directories (similar to container-runner)
    const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
    const groupSessionsDir = path.join(DATA_DIR, 'sessions', group.folder, '.claude');
    fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
    fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
    fs.mkdirSync(groupSessionsDir, { recursive: true });

    // Note: For Tart, IPC and sessions are handled on host filesystem
    // The VM sees the mounted ~/project directory
    process.env.NANOCLAW_GROUP_DIR = groupDir;
    process.env.NANOCLAW_IPC_DIR = groupIpcDir;

    // 10. Execute agent
    const runtime = getAgentRuntime(group);
    const result = await executeAgentInVM(vmIP, sshConfig, group, input, runtime);

    logger.info({ group: group.name, runtime }, 'Agent execution completed');

    return {
      status: 'success',
      result: result.stdout,
      newSessionId: result.sessionId,
    };
  } catch (error) {
    logger.error({ group: group.name, error, vmIP }, 'Tart agent execution failed');

    return {
      status: 'error',
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Cleanup: stop and delete VM
    logger.info({ group: group.name, vmName }, 'Cleaning up Tart VM');

    try {
      execSync(`tart stop ${vmName}`, { stdio: 'ignore' });
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for graceful shutdown
      execSync(`tart delete ${vmName}`, { stdio: 'ignore' });
      logger.info({ group: group.name, vmName }, 'VM cleanup completed');
    } catch (cleanupError) {
      logger.error({ group: group.name, cleanupError }, 'Failed to cleanup Tart VM');
    }
  }
}
