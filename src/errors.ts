export type EvaErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'TOKEN_INVALID'
  | 'SESSION_EXPIRED'
  | 'NOT_FOUND'
  | 'UPSTREAM_ERROR'
  | 'INVALID_INPUT'
  | 'NOT_ALLOWED'
  | 'DOWNLOAD_TOO_LARGE'
  | 'NETWORK_ERROR';

export class EvaError extends Error {
  readonly code: EvaErrorCode;
  readonly status?: number;
  readonly details?: unknown;

  constructor(code: EvaErrorCode, message: string, options: { status?: number; details?: unknown; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'EvaError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.status ? { status: this.status } : {}),
        ...(this.details ? { details: this.details } : {})
      }
    };
  }
}

export class AuthRequiredError extends EvaError {
  constructor(message = 'No hay una sesión válida de EVA. Ejecutá "npm run login" para iniciar sesión.') {
    super('AUTH_REQUIRED', message);
  }
}

export class NotFoundError extends EvaError {
  constructor(message: string, details?: unknown) {
    super('NOT_FOUND', message, { status: 404, details });
  }
}

export function toEvaError(error: unknown): EvaError {
  if (error instanceof EvaError) return error;
  if (error instanceof Error) {
    return new EvaError('UPSTREAM_ERROR', error.message, { cause: error });
  }
  return new EvaError('UPSTREAM_ERROR', String(error));
}
