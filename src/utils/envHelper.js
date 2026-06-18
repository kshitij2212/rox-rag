import fs from 'fs';
import path from 'path';
import logger from './logger.js';

const log = logger.child({ module: 'EnvHelper' });

export function updateEnvValue(key, value) {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
      log.warn({ envPath }, '.env file not found, skipping update');
      return;
    }
    
    let content = fs.readFileSync(envPath, 'utf8');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content = content.trim() + `\n${key}=${value}\n`;
    }
    
    fs.writeFileSync(envPath, content, 'utf8');
    log.info({ key, value }, 'Updated env variable in .env file');
  } catch (err) {
    log.error({ err, key, value }, 'Failed to update env variable in .env file');
  }
}
