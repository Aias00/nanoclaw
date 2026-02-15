import { spawn } from 'child_process';
import pino from 'pino';
import { CONTAINER_MAX_OUTPUT_SIZE, CONTAINER_TIMEOUT, OPENCODE_MODEL } from './config.js';
import type { RegisteredGroup } from './types.js';
import type { ContainerInput, ContainerOutput } from './container-runner.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

function buildOpenCodePrompt(prompt: string): string {
  // Keep instructions short; we rely on NanoClaw's IPC watcher.
  const ipcDir = process.env.NANOCLAW_IPC_DIR || '$NANOCLAW_IPC_DIR';

  const toolGuide = `

[NANOCLAW IPC TOOLS]
You can interact with NanoClaw by writing JSON files.
- Send a message:
  Write a new file to: ${ipcDir}/messages/
  JSON: {"type":"message","chatJid":"...","text":"..."}
- Schedule/pause/resume/cancel tasks:
  Write a new file to: ${ipcDir}/tasks/
  Examples:
  {"type":"schedule_task","prompt":"...","schedule_type":"cron|interval|once","schedule_value":"...","groupFolder":"main"}
  {"type":"pause_task","taskId":"..."}

Reply with plain text for the user.
`;

  return `${prompt}${toolGuide}`;
}

function extractOpenCodeResponse(rawStdout: string): string {
  const lines = rawStdout
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .map(l => l.trimEnd());

  // OpenCode outputs in JSON format when using --format json
  // Try to extract the last assistant message
  let result = '';

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const json = JSON.parse(line);

      // OpenCode outputs text chunks with type: "text"
      if (json.type === 'text') {
        if (json.text) {
          result += json.text;
        } else if (json.part && json.part.text) {
          result += json.part.text;
        }
      }

      // Also handle message format (for compatibility)
      if (json.type === 'message' && json.role === 'assistant') {
        if (json.content) {
          // Handle both string content and array content
          if (typeof json.content === 'string') {
            result = json.content;
          } else if (Array.isArray(json.content)) {
            // Extract text from content array
            const textParts = json.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text);
            if (textParts.length > 0) {
              result = textParts.join('\n');
            }
          }
        }
      }
    } catch {
      // Not JSON, might be plain text output
      continue;
    }
  }

  if (result) return result;

  // Fallback: try to extract from default format
  // OpenCode might output plain text in default format
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    // Skip common metadata lines
    if (l.includes('tokens used') || l.includes('session:') || l.startsWith('http://')) continue;
    return l;
  }

  return '';
}

export async function runOpenCodeAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  opts?: {
    timeoutMs?: number;
  }
): Promise<ContainerOutput> {
  const timeoutMs = opts?.timeoutMs ?? group.containerConfig?.timeout ?? CONTAINER_TIMEOUT;

  return new Promise((resolve) => {
    // Use --format json for easier parsing
    // Model can be configured via OPENCODE_MODEL environment variable
    const args = [
      'run',
      '--model', OPENCODE_MODEL,
      '--format', 'json',
      buildOpenCodePrompt(input.prompt)
    ];

    // If session ID is provided, continue that session
    if (input.sessionId) {
      args.unshift('--session', input.sessionId);
    }

    logger.info({
      group: group.name,
      cwd: process.env.NANOCLAW_GROUP_DIR || process.cwd(),
      sessionId: input.sessionId,
      args: args,
      prompt: input.prompt.slice(0, 100)
    }, 'Spawning OpenCode CLI');

    const proc = spawn('opencode', args, {
      cwd: process.env.NANOCLAW_GROUP_DIR || process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let capturedSessionId: string | undefined;

    proc.stdout.on('data', (data) => {
      if (stdoutTruncated) return;
      const chunk = data.toString();

      // Real-time parsing to detect completion
      try {
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);

            // Capture session ID
            if (json.type === 'session' && json.id) {
              capturedSessionId = json.id;
            }

            // Detect completion event
            // Only terminate if the reason is 'stop' (completed) or 'error'
            // Do NOT terminate on 'tool-calls' or other reasons, as it might be working
            if (json.type === 'step_finish' && (json.part?.reason === 'stop' || json.part?.reason === 'error')) {
              logger.info({ group: group.name, reason: json.part?.reason }, 'OpenCode finished, terminating process');
              // Give it a moment to flush any remaining output
              setTimeout(() => proc.kill('SIGTERM'), 100);
            }
          } catch {
            // Not JSON, continue
          }
        }
      } catch {
        // Ignore parsing errors
      }

      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
      } else {
        stdout += chunk;
      }
    });

    proc.stderr.on('data', (data) => {
      if (stderrTruncated) return;
      const chunk = data.toString();
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
      } else {
        stderr += chunk;
      }
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({
        status: 'error',
        result: null,
        error: `OpenCode timed out after ${timeoutMs}ms`
      });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);

      logger.info({
        group: group.name,
        exitCode: code,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        stdout: stdout.slice(0, 500),
        stderr: stderr.slice(0, 500)
      }, 'OpenCode process closed');

      // If code is null, it means we killed it (success). If code is 0, it exited normally (success).
      // Anything else is an error.
      if (code !== 0 && code !== null) {
        resolve({
          status: 'error',
          result: null,
          error: `OpenCode exited with code ${code}. Stdout: ${stdout.trim().slice(-500)}. Stderr: ${stderr.trim().slice(-500)}`
        });
        return;
      }

      const text = extractOpenCodeResponse(stdout);
      if (!text) {
        resolve({
          status: 'error',
          result: null,
          error: `OpenCode returned empty output. Stderr: ${stderr.trim().slice(-500)}`
        });
        return;
      }

      resolve({
        status: 'success',
        result: text,
        // Return session ID for continuation
        newSessionId: capturedSessionId
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        status: 'error',
        result: null,
        error: `Failed to spawn opencode: ${err.message}`
      });
    });
  });
}
