import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { memory } from './memory.js';
import { askAI, summarizeChat, transcribeAudio } from './ai.js';
import { createSticker } from './sticker.js';

/**
 * Unwraps nested WhatsApp message wrappers (ephemeral, viewOnce, documentWithCaption, edited).
 */
function unwrapMessage(content) {
  if (!content) return null;
  let unwrapped = content;
  for (let i = 0; i < 5; i++) {
    if (unwrapped.ephemeralMessage?.message) {
      unwrapped = unwrapped.ephemeralMessage.message;
    } else if (unwrapped.viewOnceMessage?.message) {
      unwrapped = unwrapped.viewOnceMessage.message;
    } else if (unwrapped.viewOnceMessageV2?.message) {
      unwrapped = unwrapped.viewOnceMessageV2.message;
    } else if (unwrapped.viewOnceMessageV2Extension?.message) {
      unwrapped = unwrapped.viewOnceMessageV2Extension.message;
    } else if (unwrapped.documentWithCaptionMessage?.message) {
      unwrapped = unwrapped.documentWithCaptionMessage.message;
    } else if (unwrapped.editedMessage?.message) {
      unwrapped = unwrapped.editedMessage.message;
    } else {
      break;
    }
  }
  return unwrapped;
}

/**
 * Finds image media in either current message or quoted message.
 */
function findImageInMessage(msg) {
  const root = unwrapMessage(msg.message);

  // 1. Direct message attachment
  if (root?.imageMessage) {
    return { media: root.imageMessage, type: 'image' };
  }
  if (root?.documentMessage && root.documentMessage.mimetype?.startsWith('image/')) {
    return { media: root.documentMessage, type: 'document' };
  }
  if (root?.stickerMessage) {
    return { media: root.stickerMessage, type: 'sticker' };
  }

  // 2. Quoted message attachment
  const quoted = root?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quoted) {
    const unwrappedQuoted = unwrapMessage(quoted);
    if (unwrappedQuoted?.imageMessage) {
      return { media: unwrappedQuoted.imageMessage, type: 'image' };
    }
    if (unwrappedQuoted?.documentMessage && unwrappedQuoted.documentMessage.mimetype?.startsWith('image/')) {
      return { media: unwrappedQuoted.documentMessage, type: 'document' };
    }
    if (unwrappedQuoted?.stickerMessage) {
      return { media: unwrappedQuoted.stickerMessage, type: 'sticker' };
    }
  }

  return null;
}

/**
 * Downloads image buffer from either the current message or a quoted message.
 */
async function getImageBuffer(msg) {
  const target = findImageInMessage(msg);
  if (!target) {
    console.log('[Sticker] No image found in current or quoted message');
    return null;
  }

  try {
    console.log(`[Sticker] Found media type: ${target.type}. Starting download...`);
    const stream = await downloadContentFromMessage(target.media, target.type);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    console.log(`[Sticker] Download completed. Buffer size: ${buffer.length} bytes`);
    return buffer;
  } catch (err) {
    console.error('[Sticker Download Error]:', err.message);
    return null;
  }
}

/**
 * Downloads audio buffer from either the current message or a quoted message.
 */
async function getAudioBuffer(msg) {
  const root = unwrapMessage(msg.message);
  const quoted = root?.extendedTextMessage?.contextInfo?.quotedMessage;
  const unwrappedQuoted = unwrapMessage(quoted);

  const audioMsg = root?.audioMessage || unwrappedQuoted?.audioMessage;
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

  const rootContent = unwrapMessage(msg.message);
  if (!rootContent) return;

  // Extract text body
  const rawText =
    rootContent.conversation ||
    rootContent.extendedTextMessage?.text ||
    rootContent.imageMessage?.caption ||
    rootContent.videoMessage?.caption ||
    rootContent.documentMessage?.caption ||
    '';

  const trimmedText = rawText.trim();

  // Check quoted context
  const contextInfo = rootContent.extendedTextMessage?.contextInfo;
  const mentionedJids = contextInfo?.mentionedJid || [];
  const isMentioned = mentionedJids.includes(botJid) || (botJidRaw && mentionedJids.includes(botJidRaw));
  const isReplyToBot = contextInfo?.participant?.includes(botJid.split('@')[0]) || false;

  // Debug logging
  if (trimmedText || rootContent.imageMessage) {
    console.log(`[Msg] From: ${senderName} (${remoteJid}) | Text: "${trimmedText}" | Image: ${Boolean(rootContent.imageMessage)} | fromMe: ${msg.key.fromMe}`);
  }

  // Record user messages into memory for context tracking
  if (trimmedText && !msg.key.fromMe) {
    memory.addMessage(remoteJid, {
      sender: senderName,
      senderJid,
      text: trimmedText,
      isBot: false
    });
  }

  // Voice note handling
  const isAudioMsg = Boolean(rootContent.audioMessage);
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

  // Determine trigger:
  // 1. Starts with @sam (e.g. "@sam", "@sam:", "@Sam")
  // 2. Starts with "!" (e.g. "!ai", "!s", "!summary", "!ping")
  // 3. Bot is natively @mentioned or replied to in a group
  // 4. In direct 1-on-1 private chat (unless fromMe without a trigger command)
  const defaultPrefix = config.prefix || '!';
  const samPrefixRegex = /^@sam[:\s]*/i;

  let isTriggered = false;
  let commandBody = '';

  if (samPrefixRegex.test(trimmedText)) {
    isTriggered = true;
    commandBody = trimmedText.replace(samPrefixRegex, '').trim();
  } else if (trimmedText.startsWith(defaultPrefix)) {
    isTriggered = true;
    commandBody = trimmedText.slice(defaultPrefix.length).trim();
  } else if (isMentioned || isReplyToBot) {
    isTriggered = true;
    // Strip native mention if present
    commandBody = trimmedText.replace(new RegExp(`@${botJid.split('@')[0]}`, 'g'), '').trim();
  } else if (!isGroup && !msg.key.fromMe) {
    // Direct message from someone else
    isTriggered = true;
    commandBody = trimmedText;
  }

  if (!isTriggered) return;

  const firstWord = commandBody.split(/\s+/)[0]?.toLowerCase();
  const commandArgs = commandBody.slice(firstWord.length).trim();

  // 1. Help command (@sam help, @sam menu, !help, !menu)
  if (firstWord === 'help' || firstWord === 'menu') {
    const helpText =
      `*🤖 ${config.botName} - WhatsApp AI Assistant*\n\n` +
      `*Commands (works with @sam or !):*\n` +
      `• *@sam <prompt>* or *!ai <prompt>* - Ask a question or chat\n` +
      `• *@sam s* or *!s* - Turn photo into a sticker (as caption or reply)\n` +
      `• *@sam summary* or *!summary* - Summarize recent group chat\n` +
      `• *@sam ping* or *!ping* - Check bot connection and latency\n` +
      `• *@sam clear* or *!clear* - Clear recent chat context\n` +
      `• *@sam help* or *!help* - Show this menu\n\n` +
      `*Group Chat Behavior:*\n` +
      `In groups, I only respond when you type *@sam*, use a *!* command, or reply directly to me. Otherwise I stay quiet and keep track of chat context!`;
    return replyWithTyping(sock, remoteJid, helpText, msg);
  }

  // 2. Ping command (@sam ping, !ping)
  if (firstWord === 'ping') {
    const startTime = (msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now());
    const latency = Math.max(5, Date.now() - startTime);
    const storedCount = memory.getRecentMessages(remoteJid).length;
    const pingText =
      `*Pong!* 🏓\n` +
      `• Bot: ${config.botName}\n` +
      `• Status: Online\n` +
      `• Latency: ~${latency}ms\n` +
      `• Context memory: ${storedCount} messages stored for this chat.`;
    return replyWithTyping(sock, remoteJid, pingText, msg);
  }

  // 3. Sticker command (@sam s, @sam sticker, !s, !sticker)
  if (firstWord === 's' || firstWord === 'sticker') {
    console.log(`[Sticker Command] Triggered by ${senderName} (${remoteJid})`);
    const imgBuffer = await getImageBuffer(msg);
    if (!imgBuffer) {
      return replyWithTyping(
        sock,
        remoteJid,
        `Send an image with *@sam s* or *!s* as the caption, or reply to any photo with *@sam s* to make a sticker!`,
        msg
      );
    }

    try {
      console.log(`[Sticker] Converting image (${imgBuffer.length} bytes) to WebP sticker...`);
      const stickerBuffer = await createSticker(imgBuffer, {
        pack: `${config.botName} Pack`,
        author: senderName
      });
      console.log(`[Sticker] Sticker created (${stickerBuffer.length} bytes). Sending to ${remoteJid}...`);
      await sock.sendMessage(remoteJid, { sticker: stickerBuffer }, { quoted: msg });
      console.log(`[Sticker] Successfully sent sticker!`);
      return;
    } catch (err) {
      console.error('[Sticker Processing Error]:', err.message);
      return replyWithTyping(sock, remoteJid, `Could not generate sticker: ${err.message}`, msg);
    }
  }

  // 4. Summary / TLDR command (@sam summary, @sam tldr, !summary, !tldr)
  if (firstWord === 'summary' || firstWord === 'tldr') {
    await replyWithTyping(sock, remoteJid, 'Reading recent messages and preparing summary...', msg);
    const summary = await summarizeChat(remoteJid);
    return replyWithTyping(sock, remoteJid, `*📝 Chat Summary:*\n\n${summary}`, msg);
  }

  // 5. Clear command (@sam clear, !clear)
  if (firstWord === 'clear') {
    memory.clear(remoteJid);
    return replyWithTyping(sock, remoteJid, 'Cleared recent chat history memory for this chat.', msg);
  }

  // 6. Conversational AI Prompt
  let promptText = '';
  if (firstWord === 'ai' || firstWord === 'ask') {
    promptText = commandArgs;
  } else {
    promptText = commandBody;
  }

  if (!promptText && (isMentioned || isReplyToBot)) {
    promptText = 'Hey! What can I help you with?';
  }

  if (promptText) {
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
