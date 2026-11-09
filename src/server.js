import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { memory } from './memory.js';
import { askAI } from './ai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistPath = path.resolve(__dirname, '../web/dist');

export const botState = {
  status: 'disconnected', // 'qr_ready' | 'connected' | 'disconnected'
  qr: null,
  user: null,
  startTime: Date.now(),
  sock: null
};

export function startApiServer(port = 3001) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Status endpoint
  app.get('/api/status', (req, res) => {
    res.json({
      status: botState.status,
      qr: botState.qr,
      user: botState.user,
      startTime: botState.startTime,
      uptimeSeconds: Math.floor((Date.now() - botState.startTime) / 1000)
    });
  });

  // Bot configuration info
  app.get('/api/config', (req, res) => {
    res.json({
      botName: config.botName,
      prefix: config.prefix,
      contextLimit: config.contextLimit,
      hasGroqKey: Boolean(config.groqApiKey),
      hasGeminiKey: Boolean(config.geminiApiKey)
    });
  });

  // Group memory and chat context
  app.get('/api/memory', (req, res) => {
    const chats = [];
    for (const [jid, messages] of memory.chats.entries()) {
      const isGroup = jid.endsWith('@g.us');
      chats.push({
        jid,
        isGroup,
        messageCount: messages.length,
        lastMessage: messages[messages.length - 1] || null,
        messages: messages.slice(-15)
      });
    }
    res.json({ chats });
  });

  // Playground endpoint to test bot AI responses from web UI
  app.post('/api/playground', async (req, res) => {
    try {
      const { prompt, senderName = 'Dashboard User' } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      const reply = await askAI({
        chatId: 'web-dashboard-test',
        senderName,
        prompt,
        isGroup: false
      });

      res.json({ reply });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve Vite production build if present
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  const server = app.listen(port, () => {
    console.log(`🌐 Web Dashboard API running on: http://localhost:${port}`);
  });

  return server;
}
