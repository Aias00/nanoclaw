/**
 * Tart SSH Helper Utilities
 * Provides SSH connection and command execution for Tart VMs
 */
import { spawn, execSync } from 'child_process';
import { logger } from './logger.js';

export interface SSHResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SSHConfig {
  username: string;
  password: string;
  strictHostKeyChecking?: boolean;
}

/**
 * Execute a command via SSH on the Tart VM
 */
export async function executeSSH(
  ip: string,
  command: string,
  config: SSHConfig,
  timeout = 300000, // 5 minutes default
): Promise<SSHResult> {
  return new Promise((resolve, reject) => {
    const sshArgs = [
      '-p', config.password,
      'ssh',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'PreferredAuthentications=password',
      '-o', `ConnectTimeout=10`,
      '-t',
      `${config.username}@${ip}`,
      `source ~/.zshenv 2>/dev/null; ${command}`,
    ];

    logger.debug({ ip, command: command.substring(0, 100) }, 'Executing SSH command');

    const proc = spawn('sshpass', sshArgs);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`SSH command timed out after ${timeout}ms`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Wait for Tart VM to obtain an IP address
 */
export async function waitForVMIP(
  vmName: string,
  maxAttempts = 30,
  intervalMs = 2000,
): Promise<string> {
  logger.info({ vmName, maxAttempts }, 'Waiting for VM IP address');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const ip = execSync(`tart ip ${vmName}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (ip && ip.length > 0) {
        logger.info({ vmName, ip, attempt: i + 1 }, 'VM IP address obtained');
        return ip;
      }
    } catch (err) {
      // VM not ready yet, continue waiting
    }

    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`Failed to get IP address for VM ${vmName} after ${maxAttempts} attempts`);
}

/**
 * Wait for SSH connection to become available
 */
export async function waitForSSH(
  ip: string,
  config: SSHConfig,
  maxAttempts = 30,
  intervalMs = 2000,
): Promise<void> {
  logger.info({ ip, maxAttempts }, 'Waiting for SSH connectivity');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await executeSSH(ip, 'echo hello', config, 5000);
      if (result.exitCode === 0) {
        logger.info({ ip, attempt: i + 1 }, 'SSH connectivity established');
        return;
      }
    } catch (err) {
      // SSH not ready yet, continue waiting
    }

    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`Failed to establish SSH connectivity to ${ip} after ${maxAttempts} attempts`);
}

/**
 * Upload a file via SCP to the Tart VM
 */
export async function uploadViaSCP(
  ip: string,
  localPath: string,
  remotePath: string,
  config: SSHConfig,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const scpArgs = [
      '-p', config.password,
      'scp',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'PreferredAuthentications=password',
      '-r',
      localPath,
      `${config.username}@${ip}:${remotePath}`,
    ];

    logger.debug({ ip, localPath, remotePath }, 'Uploading via SCP');

    const proc = spawn('sshpass', scpArgs);

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`SCP failed with exit code ${code}: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Check if required dependencies are installed
 */
export function checkTartDependencies(): { tart: boolean; sshpass: boolean } {
  let tart = false;
  let sshpass = false;

  try {
    execSync('tart --version', { stdio: 'ignore' });
    tart = true;
  } catch {}

  try {
    execSync('sshpass -V', { stdio: 'ignore' });
    sshpass = true;
  } catch {}

  return { tart, sshpass };
}
