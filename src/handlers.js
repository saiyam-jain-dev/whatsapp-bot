import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { memory } from './memory.js';
import { askAI, summarizeChat, transcribeAudio } from './ai.js';
import { createSticker } from './sticker.js';

/**
 * Downloads image buffer from either the current message or a quoted message.
 */
async function getImageBuffer(msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const imageMsg = msg.message?.imageMessage || quoted?.imageMessage;
  if (!imageMsg) return null;

  try {
    const stream = await downloadContentFromMessage(imageMsg, 'image');
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    console.error('[Image Download Error]:', err.message);
    return null;
  }
}

/**
 * Downloads audio buffer from either the current message or a quoted message.
 */
async function getAudioBuffer(msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const audioMsg = msg.message?.audioMessage || quoted?.audioMessage;
  if (!audioMsg) return null;

  try {
    const stream = await downloadContentFromMessage(audioMsg, 'audio');
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return {
      buffer: Buffer.concat(chunks),
      mimetype: audioMsg.mimetype || 'audio/ogg'
    };
  } catch (err) {
    console.error('[Audio Download Error]:', err.message);
    return null;
  }
}

/**
 * Simulates human typing before delivering text message.
 */
async function replyWithTyping(sock, jid, text, quotedMsg) {
  try {
    await sock.sendPresenceUpdate('composing', jid);

    const minDelay = config.typingDelayMin || 1000;
    const maxDelay = config.typingDelayMax || 2500;
    const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    await new Promise(resolve => setTimeout(resolve, delay));

    await sock.sendPresenceUpdate('paused', jid);
    return await sock.sendMessage(jid, { text }, { quoted: quotedMsg });
  } catch (err) {
    console.error('[Send Message Error]:', err.message);
  }
}

/**
 * Main dispatcher for incoming WhatsApp messages.
 */
export async function handleMessage(sock, msg) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid || remoteJid === 'status@broadcast') return;

  const isGroup = remoteJid.endsWith('@g.us');
  const botJidRaw = sock.user?.id || '';
  const botJid = botJidRaw.split(':')[0] + '@s.whatsapp.net';
  const senderJid = isGroup ? (msg.key.participant || msg.participant || '') : remoteJid;
  const senderName = msg.pushName || 'Friend';

  const messageContent = msg.message;
  if (!messageContent) return;

  // Extract text body
  const rawText =
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    messageContent.imageMessage?.caption ||
    messageContent.videoMessage?.caption ||
    messageContent.documentMessage?.caption ||
    '';

  const trimmedText = rawText.trim();
  const lowerText = trimmedText.toLowerCase();

  // Check quoted context
  const contextInfo = messageContent.extendedTextMessage?.contextInfo;
  const mentionedJids = contextInfo?.mentionedJid || [];
  const isMentioned = mentionedJids.includes(botJid) || (botJidRaw && mentionedJids.includes(botJidRaw));
  const isReplyToBot = contextInfo?.participant?.includes(botJid.split('@')[0]) || false;

  // Always record user messages into memory for context tracking
  if (trimmedText && !msg.key.fromMe) {
    memory.addMessage(remoteJid, {
      sender: senderName,
      senderJid,
      text: trimmedText,
      isBot: false
    });
  }

  // Handle command prefix
  const prefix = config.prefix || '!';
  const isCommand = trimmedText.startsWith(prefix);
  const commandBody = isCommand ? trimmedText.slice(prefix.length).trim() : '';
  const commandName = commandBody.split(/\s+/)[0]?.toLowerCase();
  const commandArgs = commandBody.slice(commandName.length).trim();

  // 1. Help command
  if (isCommand && (commandName === 'help' || commandName === 'menu')) {
    const helpText =
      `*🤖 ${config.botName} - WhatsApp AI Assistant*\n\n` +
      `*Commands:*\n` +
      `• *${prefix}ai <prompt>* - Ask a question directly\n` +
      `• *${prefix}s* or *${prefix}sticker* - Convert image to sticker\n` +
      `• *${prefix}summary* or *${prefix}tldr* - Summarize recent group chat\n` +
      `• *${prefix}ping* - Check bot connection and latency\n` +
      `• *${prefix}clear* - Clear recent chat context\n\n` +
      `*Group Chat Tips:*\n` +
      `In groups, I only respond when you @mention me, reply to my message, or use a *${prefix}* command. Otherwise I keep quiet and remember the context so you can ask me questions anytime.`;
    return replyWithTyping(sock, remoteJid, helpText, msg);
  }

  // 2. Ping command
  if (isCommand && commandName === 'ping') {
    const startTime = (msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now());
    const latency = Math.max(5, Date.now() - startTime);
    const storedCount = memory.getRecentMessages(remoteJid).length;
    const pingText =
      `*Pong!* 🏓\n` +
      `• Status: Online\n` +
      `• Latency: ~${latency}ms\n` +
      `• Context memory: ${storedCount} messages stored for this chat.`;
    return replyWithTyping(sock, remoteJid, pingText, msg);
  }

  // 3. Sticker command
  if (isCommand && (commandName === 's' || commandName === 'sticker')) {
    const imgBuffer = await getImageBuffer(msg);
    if (!imgBuffer) {
      return replyWithTyping(
        sock,
        remoteJid,
        `Send an image with *${prefix}s* as the caption, or reply to an image with *${prefix}s* to make a sticker!`,
        msg
      );
    }

    try {
      const stickerBuffer = await createSticker(imgBuffer, {
        pack: `${config.botName} Pack`,
        author: senderName
      });
      return await sock.sendMessage(remoteJid, { sticker: stickerBuffer }, { quoted: msg });
    } catch (err) {
      return replyWithTyping(sock, remoteJid, `Could not generate sticker: ${err.message}`, msg);
    }
  }

  // 4. Summary / TLDR command
  if (isCommand && (commandName === 'summary' || commandName === 'tldr')) {
    await replyWithTyping(sock, remoteJid, 'Reading recent messages and preparing summary...', msg);
    const summary = await summarizeChat(remoteJid);
    return replyWithTyping(sock, remoteJid, `*📝 Chat Summary:*\n\n${summary}`, msg);
  }

  // 5. Clear command
  if (isCommand && commandName === 'clear') {
    memory.clear(remoteJid);
    return replyWithTyping(sock, remoteJid, 'Cleared recent chat history memory for this chat.', msg);
  }

  // 6. Voice note handling
  const isAudioMsg = Boolean(messageContent.audioMessage);
  if (isAudioMsg && (!isGroup || isMentioned || isReplyToBot)) {
    const audioData = await getAudioBuffer(msg);
    if (audioData) {
      const transcription = await transcribeAudio(audioData.buffer, audioData.mimetype);
      if (transcription) {
        const aiAnswer = await askAI({
          chatId: remoteJid,
          senderName,
          prompt: `[Friend sent a voice message that said: "${transcription}"]. Please respond to it.`,
          isGroup
        });

        const replyText = `🎙️ *Transcribed:* "${transcription}"\n\n${aiAnswer}`;
        memory.addMessage(remoteJid, {
          sender: config.botName,
          senderJid: botJid,
          text: aiAnswer,
          isBot: true
        });
        return replyWithTyping(sock, remoteJid, replyText, msg);
      }
    }
  }

  // 7. Decide whether to trigger AI response
  let promptText = '';
  let shouldReply = false;

  if (isCommand && (commandName === 'ai' || commandName === 'ask')) {
    shouldReply = true;
    promptText = commandArgs;
  } else if (!isGroup) {
    // In direct 1-on-1 private chat, reply to all text messages
    shouldReply = true;
    promptText = trimmedText;
  } else if (isMentioned || isReplyToBot) {
    // In groups, trigger when bot is tagged or replied to
    shouldReply = true;
    // Strip the bot mention string if present
    promptText = trimmedText.replace(new RegExp(`@${botJid.split('@')[0]}`, 'g'), '').trim();
    if (!promptText) {
      promptText = 'Hey! What can I help you with?';
    }
  }

  if (shouldReply && promptText) {
    const aiAnswer = await askAI({
      chatId: remoteJid,
      senderName,
      prompt: promptText,
      isGroup
    });

    memory.addMessage(remoteJid, {
      sender: config.botName,
      senderJid: botJid,
      text: aiAnswer,
      isBot: true
    });

    return replyWithTyping(sock, remoteJid, aiAnswer, msg);
  }
}
