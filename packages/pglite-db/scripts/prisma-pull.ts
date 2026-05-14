import { spawn } from 'node:child_process';
import net from 'node:net';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const server = spawn(npm, ['run', 'pglite:server'], { stdio: 'inherit' });

await new Promise<void>((resolve) => {
  const retry = () =>
    net
      .connect(5432, '127.0.0.1')
      .on('connect', function (this: net.Socket) {
        this.destroy();
        resolve();
      })
      .on('error', () => setTimeout(retry, 200));
  retry();
});

const pull = spawn(npm, ['run', 'prisma:pull:bare'], { stdio: 'inherit' });
const code = await new Promise<number>((resolve) =>
  pull.on('close', (code) => resolve(code ?? 1)),
);

server.kill();
await new Promise<void>((resolve) => server.on('close', resolve));
process.exit(code);
