import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);

// Disposable remote host: only OpenSSH, a POSIX shell and tmux. No Jelly, Node or Python.
export async function sshFixture(parent: string) {
  const directory = await mkdtemp(join(parent, 'ssh-'));
  const container = `jelly-ssh-test-${randomBytes(6).toString('hex')}`;
  const image = 'jelly-ssh-test:local';
  const docker = (...args: string[]) => exec('docker', args, { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  try { await docker('image', 'inspect', image); }
  catch { await docker('build', '-t', image, 'test/ssh-container'); }
  try {
    await exec('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(directory, 'client')]);
    await docker('run', '--rm', '-d', '--name', container, '-p', '127.0.0.1::22', image);
    const { stdout: portOutput } = await docker('port', container, '22/tcp');
    const port = Number(portOutput.trim().split(':').at(-1));
    if (!Number.isInteger(port)) throw new Error('Invalid SSH fixture port');
    await docker('cp', join(directory, 'client.pub'), `${container}:/root/.ssh/authorized_keys`);
    await docker('exec', container, 'chown', 'root:root', '/root/.ssh/authorized_keys');
    await docker('exec', container, 'chmod', '600', '/root/.ssh/authorized_keys');
    let publicKey = '';
    for (let i = 0; i < 50; i++) {
      try { publicKey = (await docker('exec', container, 'cat', '/etc/ssh/ssh_host_ed25519_key.pub')).stdout.trim().split(' ').slice(0, 2).join(' '); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (!publicKey) throw new Error('Test SSH host key unavailable');
    await writeFile(join(directory, 'known_hosts'), `[127.0.0.1]:${port} ${publicKey}\n`, { mode: 0o600 });
    const config = join(directory, 'config');
    await writeFile(config, `Include ${directory}/included.conf\nHost *\n  User root\n  IdentityFile ${directory}/client\n  UserKnownHostsFile ${directory}/known_hosts\n  IdentitiesOnly yes\nHost jelly-remote\n  HostName 127.0.0.1\n  Port ${port}\nHost jelly-offline\n  HostName 127.0.0.1\n  Port 1\n`, { mode: 0o600 });
    await writeFile(join(directory, 'included.conf'), `Host "included-alias" extra-alias\n  HostName 127.0.0.1\n  Port ${port}\nHost pattern-* !excluded\n  ConnectTimeout 1\n`, { mode: 0o600 });
    return { config, directory, port,
      command: async (...args: string[]) => (await docker('exec', container, ...args)).stdout,
      start: async () => { await docker('unpause', container); },
      stop: async () => { await docker('pause', container); },
      async close() {
        if (!container.startsWith('jelly-ssh-test-') || !resolve(directory).startsWith(resolve(parent) + '/ssh-')) throw new Error('Invalid SSH fixture cleanup target');
        await docker('rm', '-f', container);
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await docker('rm', '-f', container).catch(() => {});
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
