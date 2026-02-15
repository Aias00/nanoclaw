/**
 * Vibe Runner for NanoClaw
 * Provides persistent Linux VM isolation using Vibe
 */
import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';
import {
  executeVibe,
  createAgentScript,
  extractVibeOutput,
  extractSessionIdFromVibeOutput,
  cleanupTempScripts,
  type VibeOptions,
} from './vibe-helper.js';
import type { RegisteredGroup } from './types.js';
import type { ContainerInput, ContainerOutput } from './container-runner.js';
import { GROUPS_DIR, DATA_DIR, type AgentRuntime } from './config.js';

// Vibe configuration
const VIBE_BASE_IMAGE = process.env.VIBE_BASE_IMAGE || 'base.raw';
const VIBE_IMAGES_DIR = process.env.VIBE_IMAGES_DIR || path.join(DATA_DIR, 'vibe-images');
const VIBE_CPUS = parseInt(process.env.VIBE_CPUS || '2', 10);
const VIBE_RAM = parseInt(process.env.VIBE_RAM || '2048', 10);
const VIBE_TIMEOUT = parseInt(process.env.VIBE_TIMEOUT || '300000', 10);

/**
 * Get the agent runtime from group configuration
 */
function getAgentRuntime(group: RegisteredGroup): AgentRuntime {
  const groupRuntime = group.containerConfig?.env?.AGENT_RUNTIME as AgentRuntime | undefined;
  if (groupRuntime) return groupRuntime;
  return (process.env.AGENT_RUNTIME as AgentRuntime) || 'claude';
}

/**
 * Get or create Vibe image for a group
 */
function getVibeImagePath(group: RegisteredGroup): string {
  // Ensure vibe images directory exists
  fs.mkdirSync(VIBE_IMAGES_DIR, { recursive: true });

  // Check for custom image path in group config
  const customImage = group.containerConfig?.vibeImage;
  if (customImage) {
    const customPath = path.join(VIBE_IMAGES_DIR, customImage);
    if (fs.existsSync(customPath)) {
      return customPath;
    }
  }

  // Default: one image per group
  const imagePath = path.join(VIBE_IMAGES_DIR, `${group.folder}.raw`);

  // If image doesn't exist, clone from base
  if (!fs.existsSync(imagePath)) {
    const baseImagePath = path.isAbsolute(VIBE_BASE_IMAGE)
      ? VIBE_BASE_IMAGE
      : path.join(VIBE_IMAGES_DIR, VIBE_BASE_IMAGE);

    if (!fs.existsSync(baseImagePath)) {
      throw new Error(
        `Vibe base image not found: ${baseImagePath}. Run scripts/prepare-vibe-base.sh first.`,
      );
    }

    logger.info({ group: group.name, baseImage: baseImagePath }, 'Creating Vibe image from base');

    // Copy base image (use CoW if on APFS)
    try {
      // Try APFS CoW copy first
      fs.copyFileSync(baseImagePath, imagePath, fs.constants.COPYFILE_FICLONE);
      logger.info('Used CoW copy for Vibe image');
    } catch {
      // Fallback to regular copy
      fs.copyFileSync(baseImagePath, imagePath);
      logger.info('Used regular copy for Vibe image');
    }
  }

  return imagePath;
}

/**
 * Get Vibe configuration from group settings
 */
function getVibeConfig(group: RegisteredGroup): {
  cpus: number;
  ram: number;
  timeout: number;
} {
  const config = group.containerConfig || {};

  return {
    cpus: (config.cpus as number) || VIBE_CPUS,
    ram: (config.ram as number) || VIBE_RAM,
    timeout: config.timeout || VIBE_TIMEOUT,
  };
}

/**
 * Main Vibe agent runner
 */
export async function runVibeAgent(
  group: RegisteredGroup,
  input: ContainerInput,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  try {
    // 1. Get or create Vibe image
    const imagePath = getVibeImagePath(group);
    logger.info({ group: group.name, imagePath }, 'Using Vibe image');

    // 2. Prepare directories
    const groupDir = path.join(GROUPS_DIR, group.folder);
    fs.mkdirSync(groupDir, { recursive: true });

    const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
    fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
    fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });

    const groupSessionsDir = path.join(DATA_DIR, 'sessions', group.folder, '.claude');
    fs.mkdirSync(groupSessionsDir, { recursive: true });

    // 3. Get agent runtime and create script
    const runtime = getAgentRuntime(group);
    const scriptPath = createAgentScript(input.prompt, runtime, input.sessionId);

    logger.info({ group: group.name, runtime, script: scriptPath }, 'Created agent script');

    // 4. Configure mounts
    const mounts = [
      {
        hostPath: groupDir,
        guestPath: '/workspace',
        readonly: false,
      },
      {
        hostPath: groupIpcDir,
        guestPath: '/ipc',
        readonly: false,
      },
    ];

    // Add session directory mount if exists
    if (fs.existsSync(groupSessionsDir)) {
      mounts.push({
        hostPath: groupSessionsDir,
        guestPath: '/home/user/.claude',
        readonly: false,
      });
    }

    // Add additional mounts from group config
    if (group.containerConfig?.additionalMounts) {
      for (const mount of group.containerConfig.additionalMounts) {
        mounts.push({
          hostPath: mount.hostPath,
          guestPath: mount.containerPath,
          readonly: mount.readonly || false,
        });
      }
    }

    // 5. Get Vibe configuration
    const vibeConfig = getVibeConfig(group);

    // 6. Execute Vibe
    const vibeOptions: VibeOptions = {
      cpus: vibeConfig.cpus,
      ram: vibeConfig.ram,
      mounts,
      script: scriptPath,
      timeout: vibeConfig.timeout,
    };

    logger.info(
      {
        group: group.name,
        cpus: vibeOptions.cpus,
        ram: vibeOptions.ram,
        mountCount: mounts.length,
      },
      'Executing Vibe VM',
    );

    const result = await executeVibe(imagePath, vibeOptions);

    // 7. Cleanup script
    try {
      fs.unlinkSync(scriptPath);
    } catch {}

    // Periodic cleanup of old scripts
    if (Math.random() < 0.1) {
      // 10% chance
      cleanupTempScripts();
    }

    const duration = Date.now() - startTime;

    // 8. Check exit code
    if (result.exitCode !== 0) {
      logger.error(
        {
          group: group.name,
          exitCode: result.exitCode,
          stderr: result.stderr.slice(-500),
          duration,
        },
        'Vibe execution failed',
      );

      return {
        status: 'error',
        result: null,
        error: `Vibe exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`,
      };
    }

    // 9. Extract output
    const output = extractVibeOutput(result.stdout);
    const sessionId = extractSessionIdFromVibeOutput(output, runtime);

    logger.info(
      {
        group: group.name,
        runtime,
        duration,
        hasOutput: output.length > 0,
        hasSessionId: !!sessionId,
      },
      'Vibe execution completed',
    );

    return {
      status: 'success',
      result: output,
      newSessionId: sessionId,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      {
        group: group.name,
        error,
        duration,
      },
      'Vibe agent execution failed',
    );

    return {
      status: 'error',
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Reset a group's Vibe image to base state
 * Useful for clearing accumulated state
 */
export async function resetVibeImage(groupFolder: string): Promise<void> {
  const imagePath = path.join(VIBE_IMAGES_DIR, `${groupFolder}.raw`);

  if (!fs.existsSync(imagePath)) {
    logger.info({ groupFolder }, 'Vibe image does not exist, nothing to reset');
    return;
  }

  const baseImagePath = path.isAbsolute(VIBE_BASE_IMAGE)
    ? VIBE_BASE_IMAGE
    : path.join(VIBE_IMAGES_DIR, VIBE_BASE_IMAGE);

  if (!fs.existsSync(baseImagePath)) {
    throw new Error(`Vibe base image not found: ${baseImagePath}`);
  }

  logger.info({ groupFolder, imagePath }, 'Resetting Vibe image to base state');

  // Delete old image
  fs.unlinkSync(imagePath);

  // Copy base image
  try {
    fs.copyFileSync(baseImagePath, imagePath, fs.constants.COPYFILE_FICLONE);
  } catch {
    fs.copyFileSync(baseImagePath, imagePath);
  }

  logger.info({ groupFolder }, 'Vibe image reset completed');
}

/**
 * Get disk usage statistics for Vibe images
 */
export function getVibeImageStats(): Array<{
  group: string;
  path: string;
  sizeMB: number;
  modified: Date;
}> {
  if (!fs.existsSync(VIBE_IMAGES_DIR)) {
    return [];
  }

  const stats: Array<{ group: string; path: string; sizeMB: number; modified: Date }> = [];
  const files = fs.readdirSync(VIBE_IMAGES_DIR);

  for (const file of files) {
    if (file.endsWith('.raw')) {
      const filePath = path.join(VIBE_IMAGES_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        stats.push({
          group: file.replace('.raw', ''),
          path: filePath,
          sizeMB: Math.round(stat.size / 1024 / 1024),
          modified: stat.mtime,
        });
      } catch {}
    }
  }

  return stats;
}
