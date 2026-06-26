import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load package-level env first (API_PORT etc.)
config({ path: resolve(__dirname, '../../.env') });

// Then load root env (DATABASE_URL, REDIS_URL etc.)
config({ path: resolve(__dirname, '../../../.env') });