import { createElement } from 'react';
import { render } from 'ink';
import { logger } from '../logger.js';
import { EvaService } from '../services/eva-service.js';
import { App } from './App.js';

/**
 * Arranca la interfaz interactiva (TUI) para navegar EVA desde la terminal.
 */
export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'La TUI necesita una terminal interactiva (TTY). Ejecutá "npm run tui" desde una terminal, sin pipes.'
    );
  }

  // Los logs a stderr arruinan el dibujado de la TUI.
  logger.setLevel('silent');

  const service = await new EvaService().init();
  const status = await service.status(true);
  if (status.auth === 'none') {
    throw new Error('No hay una sesión válida de EVA. Ejecutá "npm run login" y volvé a intentar.');
  }

  const user = status.user?.fullname ?? status.user?.username ?? 'invitado';
  const mode = status.auth === 'webservice' ? 'Web Services' : 'sesión web';
  const instance = render(createElement(App, { service, userLabel: `${user} · ${mode}` }));
  await instance.waitUntilExit();
}
