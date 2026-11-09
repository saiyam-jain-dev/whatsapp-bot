import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { memory } from './memory.js';
import { askAI, summarizeChat, transcribeAudio } from './ai.js';
import { createSticker } from './sticker.js';
import { textToVoiceNote } from './tts.js';

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
 * Extracts contextInfo from various WhatsApp message wrappers.
 */
function getContextInfo(root) {
  if (!root) return null;
  return root.extendedTextMessage?.contextInfo ||
         root.imageMessage?.contextInfo ||
         root.videoMessage?.contextInfo ||
         root.documentMessage?.contextInfo ||
         root.stickerMessage?.contextInfo ||
         root.contextInfo ||
         null;
}

/**
 * Checks if user text expresses intent to create a sticker.
 */
function isStickerIntent(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  if (lower === 's' || lower === 'sticker' || lower === 'stickers') return true;
  if (/^(create|make|convert|generate|turn into)(\s+(a|an|this|into))?\s+stickers?/i.test(lower)) return true;
  if (/stickers?(\s+(this|please|plz|now))?$/i.test(lower)) return true;
  return false;
}

/**
 * Checks if user text expresses intent to convert text to speech (TTS) audio.
 */
function isTtsIntent(text, firstWord) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  const word = (firstWord || '').toLowerCase();
  if (['tts', 'say', 'voice', 'speak', 'audio'].includes(word)) return true;
  if (/^(convert|turn)(\s+(this|the|a|into|to|message))+(\s+(into|to))?\s+(audio|voice|voice\s*note|speech)/i.test(lower)) return true;
  if (/^(read|speak|say)\s+(this|it|out|message)/i.test(lower)) return true;
  return false;
}

/**
 * Finds image or GIF/video media in:
 * 1. Current message attachment
 * 2. Quoted message attachment
 * 3. Recent chat media history
 */
function findMediaForSticker(msg, remoteJid) {
  const root = unwrapMessage(msg.message);

  // 1. Direct message attachment
  if (root?.imageMessage) {
    return { media: root.imageMessage, type: 'image', source: 'direct' };
  }
  if (root?.videoMessage) {
    return { media: root.videoMessage, type: 'video', source: 'direct' };
  }
  if (root?.documentMessage && (root.documentMessage.mimetype?.startsWith('image/') || root.documentMessage.mimetype?.startsWith('video/'))) {
    return { media: root.documentMessage, type: 'document', source: 'direct' };
  }
  if (root?.stickerMessage) {
    return { media: root.stickerMessage, type: 'sticker', source: 'direct' };
  }

  // 2. Quoted message attachment
  const contextInfo = getContextInfo(root);
  const quoted = contextInfo?.quotedMessage;
  if (quoted) {
    const unwrappedQuoted = unwrapMessage(quoted);
    if (unwrappedQuoted?.imageMessage) {
      return { media: unwrappedQuoted.imageMessage, type: 'image', source: 'quoted' };
    }
    if (unwrappedQuoted?.videoMessage) {
      return { media: unwrappedQuoted.videoMessage, type: 'video', source: 'quoted' };
    }
    if (unwrappedQuoted?.documentMessage && (unwrappedQuoted.documentMessage.mimetype?.startsWith('image/') || unwrappedQuoted.documentMessage.mimetype?.startsWith('video/'))) {
      return { media: unwrappedQuoted.documentMessage, type: 'document', source: 'quoted' };
    }
    if (unwrappedQuoted?.stickerMessage) {
      return { media: unwrappedQuoted.stickerMessage, type: 'sticker', source: 'quoted' };
    }
  }

  // 3. Fallback: Check recent media saved from chat history
  if (remoteJid) {
    const recentMedia = memory.getLatestMedia(remoteJid);
    if (recentMedia) {
      return { ...recentMedia, source: 'chat_history' };
    }
  }

  return null;
}

/**
 * Downloads media buffer from direct message, quoted message, or chat history.
 */
async function getMediaBuffer(msg, remoteJid) {
  const target = findMediaForSticker(msg, remoteJid);
  if (!target) {
    console.log('[Sticker] No image, GIF, or video found in direct message, quoted message, or chat history.');
    return null;
  }

  try {
    console.log(`[Sticker] Downloading media (source: ${target.source}, type: ${target.type})...`);
    const stream = await downloadContentFromMessage(target.media, target.type);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    console.log(`[Sticker] Media download completed successfully. Size: ${buffer.length} bytes.`);
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
  const contextInfo = getContextInfo(root);
  const quoted = contextInfo?.quotedMessage;
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
 * Formats every outgoing text response with the custom brand heading:
 * *SamAi- bot by sammy*
 */
async function replyWithTyping(sock, jid, text, quotedMsg) {
  try {
    await sock.sendPresenceUpdate('composing', jid);

    const minDelay = config.typingDelayMin || 1000;
    const maxDelay = config.typingDelayMax || 2500;
    const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    await new Promise(resolve => setTimeout(resolve, delay));

    await sock.sendPresenceUpdate('paused', jid);

    const heading = '*SamAi- bot by sammy*';
    const divider = '────────────────────';
    let formattedText = text ? text.trim() : '';

    if (!formattedText.startsWith(heading)) {
      formattedText = `${heading}\n${divider}\n${formattedText}`;
    }

    return await sock.sendMessage(jid, { text: formattedText }, { quoted: quotedMsg });
  } catch (err) {
    console.error('[Send Message Error]:', err.message);
  }
}

/**
 * Extracts target text for TTS conversion from command args, quoted message, or chat history.
 */
function extractTextForTts(msg, commandArgs, remoteJid) {
  // If user passed explicit text after command (e.g. "@sam tts hello world")
  // Strip out command prefix if needed
  let cleanedArgs = (commandArgs || '').replace(/^(into|to)?\s*(audio|voice\s*note|voice|speech)[:\s]*/i, '').trim();
  if (cleanedArgs.length > 0) {
    return cleanedArgs;
  }

  // Check quoted message
  const root = unwrapMessage(msg.message);
  const contextInfo = getContextInfo(root);
  const quoted = contextInfo?.quotedMessage;
  if (quoted) {
    const unwrappedQuoted = unwrapMessage(quoted);
    const qText =
      unwrappedQuoted?.conversation ||
      unwrappedQuoted?.extendedTextMessage?.text ||
      unwrappedQuoted?.imageMessage?.caption ||
      unwrappedQuoted?.videoMessage?.caption ||
      '';
    if (qText.trim()) return qText.trim();
  }

  // Fallback to recent message in chat history
  if (remoteJid) {
    const recent = memory.getRecentMessages(remoteJid);
    const lastMsg = recent.filter(m => !m.isBot && m.text).pop();
    if (lastMsg?.text) {
      return lastMsg.text;
    }
  }

  return null;
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

  // If this message contains an image or video/GIF, save it to chat media memory
  if (rootContent.imageMessage) {
    memory.saveLatestMedia(remoteJid, { media: rootContent.imageMessage, type: 'image' });
  } else if (rootContent.videoMessage) {
    memory.saveLatestMedia(remoteJid, { media: rootContent.videoMessage, type: 'video' });
  } else if (rootContent.documentMessage && (rootContent.documentMessage.mimetype?.startsWith('image/') || rootContent.documentMessage.mimetype?.startsWith('video/'))) {
    memory.saveLatestMedia(remoteJid, { media: rootContent.documentMessage, type: 'document' });
  }

  // Check quoted context
  const contextInfo = getContextInfo(rootContent);
  const mentionedJids = contextInfo?.mentionedJid || [];
  const isMentioned = mentionedJids.includes(botJid) || (botJidRaw && mentionedJids.includes(botJidRaw));
  const isReplyToBot = contextInfo?.participant?.includes(botJid.split('@')[0]) || false;

  // Debug logging
  if (trimmedText || rootContent.imageMessage || rootContent.videoMessage) {
    console.log(`[Msg] From: ${senderName} (${remoteJid}) | Text: "${trimmedText}" | Image: ${Boolean(rootContent.imageMessage)} | Video/GIF: ${Boolean(rootContent.videoMessage)} | fromMe: ${msg.key.fromMe}`);
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

  // Voice note transcription handling (speech to text)
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
  // 2. Starts with "!" (e.g. "!ai", "!s", "!tts", "!ping")
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
      `*Commands (works with @sam or !):*\n` +
      `• *@sam <prompt>* or *!ai <prompt>* - Ask a question or chat\n` +
      `• *@sam tts <text>* or *!tts* - Convert text to voice note\n` +
      `• *@sam s* or *!s* - Turn photo, GIF, or video into sticker\n` +
      `• *@sam summary* or *!summary* - Summarize recent group chat\n` +
      `• *@sam ping* or *!ping* - Check bot connection and latency\n` +
      `• *@sam clear* or *!clear* - Clear recent chat context\n` +
      `• *@sam help* or *!help* - Show this menu\n\n` +
      `*Tips:*\n` +
      `Reply to any message with *@sam tts* for voice, or reply to any photo/GIF with *@sam s* for stickers!`;
    return replyWithTyping(sock, remoteJid, helpText, msg);
  }

  // 2. Ping command (@sam ping, !ping)
  if (firstWord === 'ping') {
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

  // 3. TTS / Text to Audio Command (@sam tts, @sam voice, @sam say, @sam convert to audio)
  if (isTtsIntent(commandBody, firstWord)) {
    console.log(`[TTS Command] Triggered by ${senderName} (${remoteJid}) with input: "${commandBody}"`);
    const targetText = extractTextForTts(msg, commandArgs, remoteJid);

    if (!targetText) {
      return replyWithTyping(
        sock,
        remoteJid,
        `No text found to convert to voice! You can:\n1. Reply to any text message with *@sam tts* (or *@sam convert to audio*)\n2. Type *@sam tts <your message here>*\n3. Type *@sam tts* right after a message was sent in this chat.`,
        msg
      );
    }

    try {
      console.log(`[TTS] Synthesizing speech for: "${targetText.slice(0, 60)}..."`);
      await sock.sendPresenceUpdate('recording', remoteJid);
      const voiceBuffer = await textToVoiceNote(targetText);
      console.log(`[TTS] Voice note generated (${voiceBuffer.length} bytes). Sending PTT audio to ${remoteJid}...`);

      await sock.sendPresenceUpdate('paused', remoteJid);
      try {
        await sock.sendMessage(
          remoteJid,
          { audio: voiceBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true },
          { quoted: msg }
        );
      } catch (sendErr) {
        console.warn('[TTS] Quoted voice send failed, falling back to direct send:', sendErr.message);
        await sock.sendMessage(
          remoteJid,
          { audio: voiceBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }
        );
      }

      console.log('[TTS] Successfully delivered voice note!');
      return;
    } catch (err) {
      console.error('[TTS Generation Error]:', err.message);
      return replyWithTyping(sock, remoteJid, `Could not generate voice note: ${err.message}`, msg);
    }
  }

  // 4. Sticker command (@sam s, @sam sticker, !s, or natural language "create sticker", "make sticker")
  if (isStickerIntent(commandBody) || isStickerIntent(firstWord)) {
    console.log(`[Sticker Command] Triggered by ${senderName} (${remoteJid}) with input: "${commandBody}"`);
    const mediaBuffer = await getMediaBuffer(msg, remoteJid);
    if (!mediaBuffer) {
      return replyWithTyping(
        sock,
        remoteJid,
        `No photo or GIF found to convert! You can:\n1. Reply to any photo or GIF with *@sam s* (or *@sam create sticker*)\n2. Send a photo or GIF with caption *@sam s*\n3. Type *@sam s* right after a photo or GIF was shared in this chat.`,
        msg
      );
    }

    try {
      console.log(`[Sticker] Formatting media (${mediaBuffer.length} bytes) to WebP sticker...`);
      const stickerBuffer = await createSticker(mediaBuffer, {
        pack: `${config.botName} Pack`,
        author: senderName
      });
      console.log(`[Sticker] Sticker generated (${stickerBuffer.length} bytes). Sending to ${remoteJid}...`);

      try {
        await sock.sendMessage(remoteJid, { sticker: stickerBuffer }, { quoted: msg });
      } catch (sendErr) {
        console.warn('[Sticker] Quoted send failed, falling back to direct send:', sendErr.message);
        await sock.sendMessage(remoteJid, { sticker: stickerBuffer });
      }

      console.log(`[Sticker] Sticker successfully delivered!`);
      return;
    } catch (err) {
      console.error('[Sticker Processing Error]:', err.message);
      return replyWithTyping(sock, remoteJid, `Could not generate sticker: ${err.message}`, msg);
    }
  }

  // 5. Summary / TLDR command (@sam summary, @sam tldr, !summary, !tldr)
  if (firstWord === 'summary' || firstWord === 'tldr') {
    await replyWithTyping(sock, remoteJid, 'Reading recent messages and preparing summary...', msg);
    const summary = await summarizeChat(remoteJid);
    return replyWithTyping(sock, remoteJid, `*📝 Chat Summary:*\n\n${summary}`, msg);
  }

  // 6. Clear command (@sam clear, !clear)
  if (firstWord === 'clear') {
    memory.clear(remoteJid);
    return replyWithTyping(sock, remoteJid, 'Cleared recent chat history memory for this chat.', msg);
  }

  // 7. Conversational AI Prompt
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
