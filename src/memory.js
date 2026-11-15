import { config } from './config.js';

class MemoryManager {
  constructor() {
    this.chats = new Map();
    this.chatMedia = new Map(); // chatId -> latest media item
    this.chatMediaList = new Map(); // chatId -> Array of recent media items
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

  saveLatestMedia(chatId, mediaObj) {
    if (!chatId || !mediaObj) return;

    const now = Date.now();
    const item = {
      ...mediaObj,
      timestamp: mediaObj.timestamp || now,
      messageTimestamp: mediaObj.messageTimestamp || now
    };

    // Save as latest single media
    this.chatMedia.set(chatId, item);

    // Save into rolling chat media list
    if (!this.chatMediaList.has(chatId)) {
      this.chatMediaList.set(chatId, []);
    }
    const list = this.chatMediaList.get(chatId);

    // Avoid duplicate message IDs if already recorded
    if (item.msgId) {
      const idx = list.findIndex(m => m.msgId === item.msgId);
      if (idx >= 0) {
        list[idx] = item;
        return;
      }
    }

    list.push(item);

    // Retain up to 30 recent media items per chat
    while (list.length > 30) {
      list.shift();
    }
  }

  getLatestMedia(chatId) {
    if (!chatId || !this.chatMedia.has(chatId)) return null;
    const item = this.chatMedia.get(chatId);
    // Keep media valid for 30 minutes
    if (Date.now() - item.timestamp > 30 * 60 * 1000) {
      this.chatMedia.delete(chatId);
      return null;
    }
    return item;
  }

  getLatestMediaOfType(chatId, type) {
    if (!chatId) return null;
    const list = this.chatMediaList.get(chatId) || [];
    const now = Date.now();
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if ((now - item.timestamp) <= 30 * 60 * 1000) {
        if (!type || item.type === type) return item;
      }
    }
    const single = this.getLatestMedia(chatId);
    if (single && (!type || single.type === type)) return single;
    return null;
  }

  /**
   * Retrieves an album or batch of media items belonging to one message or sent together.
   * If albumId is present, matches all items in the album.
   * Otherwise, matches items from the same sender within a 5-second window.
   */
  getMediaBatch(chatId, refItem = null) {
    if (!chatId) return [];

    const list = this.chatMediaList.get(chatId) || [];
    const now = Date.now();
    // Filter items older than 30 minutes
    const valid = list.filter(m => (now - m.timestamp) <= 30 * 60 * 1000);
    if (!valid.length) {
      const single = this.getLatestMedia(chatId);
      return single ? [single] : [];
    }

    const ref = refItem || valid[valid.length - 1];
    if (!ref) return [];

    // 1. If albumId exists, match all items with the same albumId
    if (ref.albumId) {
      const albumMatches = valid.filter(m => m.albumId === ref.albumId);
      if (albumMatches.length > 0) return albumMatches;
    }

    // 2. Match by sender and close timestamps (within 5 seconds of each other)
    const refTime = ref.messageTimestamp || ref.timestamp;
    const refSender = ref.senderJid;

    const cluster = valid.filter(m => {
      const mTime = m.messageTimestamp || m.timestamp;
      const isSameSender = !refSender || !m.senderJid || m.senderJid === refSender;
      const isCloseInTime = Math.abs(mTime - refTime) <= 5000;
      return isSameSender && isCloseInTime;
    });

    if (cluster.length > 0) {
      return cluster;
    }

    return [ref];
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
    }
    if (this.chatMedia.has(chatId)) {
      this.chatMedia.delete(chatId);
    }
    if (this.chatMediaList.has(chatId)) {
      this.chatMediaList.delete(chatId);
    }
    return true;
  }
}

export const memory = new MemoryManager();
