/**
 * Logger structuré minimal (une ligne JSON par entrée), sans dépendance.
 *
 * Les champs `gameId`, `playerId`, `action` et `requestId` sont normalisés pour
 * pouvoir filtrer les logs d'une partie parmi des milliers d'autres.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  gameId?: string;
  playerId?: string;
  action?: string;
  requestId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Logger enfant qui ajoute ce contexte à chaque entrée (ex. { gameId }). */
  child(context: LogContext): Logger;
}

export type LogSink = (line: string, level: LogLevel) => void;

const defaultSink: LogSink = (line, level) => {
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
};

export function createLogger(base: LogContext = {}, sink: LogSink = defaultSink): Logger {
  const write = (level: LogLevel, message: string, context?: LogContext): void => {
    sink(
      JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...base, ...context }),
      level,
    );
  };
  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
    child: (context) => createLogger({ ...base, ...context }, sink),
  };
}

/** Logger qui n'écrit rien (tests). */
export const silentLogger: Logger = createLogger({}, () => undefined);
