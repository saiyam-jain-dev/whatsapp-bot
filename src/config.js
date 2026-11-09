import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

export const config = {
  botName: process.env.BOT_NAME || 'Buddy',
  prefix: process.env.COMMAND_PREFIX || '!',
  groqApiKey: process.env.GROQ_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  contextLimit: parseInt(process.env.CONTEXT_LIMIT || '15', 10),
  typingDelayMin: parseInt(process.env.TYPING_DELAY_MIN || '1000', 10),
  typingDelayMax: parseInt(process.env.TYPING_DELAY_MAX || '2500', 10),
  authDir: path.join(rootDir, 'auth_session'),
  rootDir
};
