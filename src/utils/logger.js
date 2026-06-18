import pino from 'pino';
import config from '../../config/default.js';

const isDev = (process.env.NODE_ENV ?? 'development') === 'development';

const transport = isDev
  ? {
      target:  'pino-pretty',
      options: {
        colorize:        true,
        translateTime:   'SYS:HH:MM:ss.l',
        ignore:          'pid,hostname',
        messageFormat:   '[{module}] {msg}',
      },
    }
  : undefined;

const logger = pino(
  {
    level:     process.env.LOG_LEVEL ?? config.logging.level ?? 'info',
    base:      { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport ? pino.transport(transport) : undefined,
);

export default logger;
