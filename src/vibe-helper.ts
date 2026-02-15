/**
 * Vibe Helper Utilities
 * Provides utilities for working with Vibe Linux VMs
 */
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

export interface VibeOptions {
  cpus?: number;
  ram?: number; // in MB
  mounts?: Array<{
    hostPath: string;
    guestPath: string;
    readonly?: boolean;
  }>;
  script?: string;
  timeout?: number;
}

export interface VibeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute vibe command with given options
 */
export async function executeVibe(
  imagePath: string,
  options: VibeOptions = {},
): Promise<VibeResult> {
  const args: string[] = [];

  // Add CPU configuration
  if (options.cpus) {
    args.push('--cpus', String(options.cpus));
  }

  // Add RAM configuration
  if (options.ram) {
    args.push('--ram', String(options.ram));
  }

  // Add mounts
  if (options.mounts) {
    for (const mount of options.mounts) {
      const mode = mount.readonly ? ':read-only' : ':read-write';
      args.push('--mount', `${mount.hostPath}:${mount.guestPath}${mode}`);
    }
  }

  // Add script if provided
  if (options.script) {
    args.push('--script', options.script);
  }

  // Add image path
  args.push(imagePath);

  logger.debug({ args: args.join(' ') }, 'Executing vibe command');

  return new Promise((resolve, reject) => {
    const proc = spawn('vibe', args);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = options.timeout
      ? setTimeout(() => {
          proc.kill('SIGKILL');
          reject(new Error(`Vibe execution timed out after ${options.timeout}ms`));
        }, options.timeout)
      : null;

    proc.on('close', (code) => {
      if (timeout) clearTimeout(timeout);

      resolve({
        exitCode: code || 0,
        stdout,
        stderr,
      });
    });

    proc.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Create agent execution script for Vibe
 */
export function createAgentScript(
  prompt: string,
  runtime: 'claude' | 'codex' | 'opencode',
  sessionId?: string,
): string {
  const scriptPath = `/tmp/nanoclaw-vibe-agent-${Date.now()}.sh`;

  let command: string;

  switch (runtime) {
    case 'claude':
      if (sessionId) {
        command = `claude --dangerously-skip-permissions --session ${sessionId} exec "${prompt.replace(/"/g, '\\"')}"`;
      } else {
        command = `claude --dangerously-skip-permissions exec "${prompt.replace(/"/g, '\\"')}"`;
      }
      break;

    case 'codex':
      command = `codex --yolo exec "${prompt.replace(/"/g, '\\"')}"`;
      break;

    case 'opencode':
      if (sessionId) {
        command = `OPENCODE_YOLO=true opencode run --session ${sessionId} "${prompt.replace(/"/g, '\\"')}"`;
      } else {
        command = `OPENCODE_YOLO=true opencode run "${prompt.replace(/"/g, '\\"')}"`;
      }
      break;

    default:
      throw new Error(`Unknown runtime: ${runtime}`);
  }

  const script = `#!/bin/bash
set -e

# Output markers for parsing
echo "NANOCLAW_OUTPUT_START"

# Source environment
source ~/.bashrc 2>/dev/null || true
source ~/.profile 2>/dev/null || true

# Change to workspace
cd /workspace || exit 1

# Execute agent
${command}

# End marker
echo "NANOCLAW_OUTPUT_END"
`;

  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  return scriptPath;
}

/**
 * Extract agent output from vibe stdout
 */
export function extractVibeOutput(stdout: string): string {
  const startMarker = 'NANOCLAW_OUTPUT_START';
  const endMarker = 'NANOCLAW_OUTPUT_END';

  const startIdx = stdout.indexOf(startMarker);
  const endIdx = stdout.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const output = stdout
      .slice(startIdx + startMarker.length, endIdx)
      .trim();
    return output;
  }

  // Fallback: return last non-empty lines
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Remove common vibe output lines
  const filteredLines = lines.filter(
    (l) =>
      !l.startsWith('[vibe]') &&
      !l.includes('Virtualization.framework') &&
      l !== startMarker &&
      l !== endMarker,
  );

  return filteredLines.slice(-10).join('\n');
}

/**
 * Extract session ID from agent output (if available)
 */
export function extractSessionIdFromVibeOutput(
  output: string,
  runtime: 'claude' | 'codex' | 'opencode',
): string | undefined {
  if (runtime === 'opencode') {
    // OpenCode outputs JSON with session info
    try {
      const lines = output.split('\n');
      for (const line of lines) {
        const json = JSON.parse(line);
        if (json.type === 'session' && json.id) {
          return json.id;
        }
      }
    } catch {
      // Not JSON, ignore
    }
  }

  // For Claude and Codex, session ID extraction may vary
  // This is a placeholder for future implementation

  return undefined;
}

/**
 * Check if vibe command is available
 */
export function checkVibeDependency(): boolean {
  try {
    execSync('vibe --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get vibe version information
 */
export function getVibeVersion(): string | null {
  try {
    const output = execSync('vibe --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const match = output.match(/Git SHA: ([a-f0-9]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Cleanup temporary script files
 */
export function cleanupTempScripts(): void {
  try {
    const tmpDir = '/tmp';
    const files = fs.readdirSync(tmpDir);

    for (const file of files) {
      if (file.startsWith('nanoclaw-vibe-agent-')) {
        const filePath = path.join(tmpDir, file);
        try {
          fs.unlinkSync(filePath);
          logger.debug({ file: filePath }, 'Cleaned up temp script');
        } catch (err) {
          logger.debug({ file: filePath, err }, 'Failed to cleanup temp script');
        }
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Failed to cleanup temp scripts directory');
  }
}
