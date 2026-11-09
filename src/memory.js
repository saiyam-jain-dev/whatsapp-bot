import { config } from './config.js';

class MemoryManager {
  constructor() {
    this.chats = new Map();
  }

  addMessage(chatId, { sender, senderJid, text, isBot = false }) {
    if (!chatId || !text || !text.trim()) return;

    if (!this.chats.has(chatId)) {
      this.chats.set(chatId, []);
    }

    const messages = this.chats.get(chatId);
    messages.push({
      sender: sender || 'User',
      senderJid: senderJid || '',
      text: text.trim(),
      isBot: Boolean(isBot),
      timestamp: Date.now()
    });

    const maxLimit = Math.max(5, config.contextLimit || 15);
    while (messages.length > maxLimit) {
      messages.shift();
    }
  }

  getRecentMessages(chatId, limit) {
    const messages = this.chats.get(chatId) || [];
    const count = limit || config.contextLimit || 15;
    return messages.slice(-count);
  }

  formatContextForPrompt(chatId, limit) {
    const recent = this.getRecentMessages(chatId, limit);
    if (!recent.length) return '';

    return recent
      .map(m => `${m.sender}${m.isBot ? ' (' + config.botName + ')' : ''}: ${m.text}`)
      .join('\n');
  }

  clear(chatId) {
    if (this.chats.has(chatId)) {
      this.chats.delete(chatId);
      return true;
    }
    return false;
  }
}

export const memory = new MemoryManager();
