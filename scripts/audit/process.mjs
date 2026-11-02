import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const auditDirectory = resolve(root, '.data/audit');
export function dockerExecutable() {
  if (process.env.DOCKER_BIN) return process.env.DOCKER_BIN;
  if (process.platform !== 'win32') return 'docker';
  const choices = [join(process.env.LOCALAPPDATA ?? '', 'Programs/DockerDesktop/resources/bin/docker.exe'), 'C:/Program Files/Docker/Docker/resources/bin/docker.exe'];
  const executable = choices.find(existsSync);
  if (!executable) throw new Error('Docker CLI not found. Set DOCKER_BIN to its executable path.');
  return executable;
}
export const npmCommand = () => [process.execPath, process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
export const redact = (text) => text.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[database URL redacted]');

export async function run(executable, args, { env = process.env, log, allowFailure = false, input } = {}) {
  await mkdir(auditDirectory, { recursive: true });
  const file = log ? createWriteStream(resolve(auditDirectory, log), { mode: 0o600 }) : null;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; file?.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk; file?.write(chunk); });
    child.on('error', (error) => { file?.end(); reject(error); });
    child.on('close', (code) => {
      file?.end();
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code && !allowFailure) reject(new Error(`Command failed (${result.code}): ${redact(args.slice(0, 8).join(' '))}. ${log ? `See .data/audit/${log}` : redact(stderr.slice(-500))}`));
      else resolvePromise(result);
    });
    child.stdin.end(input);
  });
}
