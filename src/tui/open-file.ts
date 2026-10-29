import { spawn } from 'node:child_process';

/**
 * Abre un archivo con la aplicación predeterminada del sistema.
 * No bloquea la terminal: el proceso hijo queda desprendido.
 */
export function openFile(path: string): void {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', path], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return;
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [path], { detached: true, stdio: 'ignore' }).unref();
}
