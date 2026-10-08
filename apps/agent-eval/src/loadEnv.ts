import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(directory, '../../apps/server/.env') });
dotenv.config({ path: path.resolve(directory, '../../.env') });
dotenv.config({ path: path.resolve(directory, '../.env') });
