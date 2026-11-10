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

  // If this message contains an image or video/GIF in a group, save to media history
  if (isGroup) {
    if (rootContent.imageMessage) {
      memory.saveLatestMedia(remoteJid, { media: rootContent.imageMessage, type: 'image' });
    } else if (rootContent.videoMessage) {
      memory.saveLatestMedia(remoteJid, { media: rootContent.videoMessage, type: 'video' });
    } else if (rootContent.documentMessage && (rootContent.documentMessage.mimetype?.startsWith('image/') || rootContent.documentMessage.mimetype?.startsWith('video/'))) {
      memory.saveLatestMedia(remoteJid, { media: rootContent.documentMessage, type: 'document' });
    }
  }

  // Check quoted context
  const contextInfo = getContextInfo(rootContent);
  const mentionedJids = contextInfo?.mentionedJid || [];
  const isMentioned = mentionedJids.includes(botJid) || (botJidRaw && mentionedJids.includes(botJidRaw));

  // Record group messages into memory silently for context tracking
  if (isGroup && trimmedText && !msg.key.fromMe) {
    memory.addMessage(remoteJid, {
      sender: senderName,
      senderJid,
      text: trimmedText,
      isBot: false
    });
  }

  // STRICT TRIGGER POLICY:
  // The bot MUST ONLY respond if an explicit command is invoked:
  // 1. Starts with @explaintts
  // 2. Starts with @sam (or @Sam)
  // 3. Starts with command prefix "!"
  // 4. In a group chat, if explicitly @mentioned via WhatsApp blue tag
  //
  // NORMAL DIRECT MESSAGES, BUSINESS TALK, INCOMING CLIENT INQUIRIES, OR REGULAR BANTER
  // WILL NEVER TRIGGER THE BOT UNDER ANY CIRCUMSTANCES.
  const defaultPrefix = config.prefix || '!';
  const samPrefixRegex = /^@sam[:\s]*/i;
  const explainTtsRegex = /^@explaintts[:\s]*/i;

  let isTriggered = false;
  let isExplainTts = false;
  let commandBody = '';

  if (explainTtsRegex.test(trimmedText)) {
    isTriggered = true;
    isExplainTts = true;
    commandBody = trimmedText.replace(explainTtsRegex, '').trim();
  } else if (samPrefixRegex.test(trimmedText)) {
    isTriggered = true;
    commandBody = trimmedText.replace(samPrefixRegex, '').trim();
  } else if (trimmedText.startsWith(defaultPrefix)) {
    isTriggered = true;
    commandBody = trimmedText.slice(defaultPrefix.length).trim();
  } else if (isGroup && isMentioned) {
    isTriggered = true;
    commandBody = trimmedText.replace(new RegExp(`@${botJid.split('@')[0]}`, 'g'), '').trim();
  }

  // If not explicitly commanded, SILENTLY EXIT immediately
  if (!isTriggered) return;

  // Log only commanded executions
  console.log(`[Command Invoked] From: ${senderName} (${remoteJid}) | Trigger: "${commandBody}"`);

  const firstWord = commandBody.split(/\s+/)[0]?.toLowerCase();
  const commandArgs = commandBody.slice(firstWord.length).trim();

  if (firstWord === 'explaintts') {
    isExplainTts = true;
    commandBody = commandArgs;
  }

  // 1. Explain in Voice Note (@explaintts <prompt> or @sam explaintts <prompt>)
  if (isExplainTts) {
    console.log(`[ExplainTTS] Triggered by ${senderName} (${remoteJid}) with prompt: "${commandBody}"`);

    // Resolve prompt from input or quoted message
    let prompt = commandBody;
    const quoted = contextInfo?.quotedMessage;
    if (quoted) {
      const unwrappedQuoted = unwrapMessage(quoted);
      const qText =
        unwrappedQuoted?.conversation ||
        unwrappedQuoted?.extendedTextMessage?.text ||
        unwrappedQuoted?.imageMessage?.caption ||
        '';
      if (qText) {
        prompt = prompt
          ? `Regarding this message "${qText}": ${prompt}`
          : `Explain this message clearly in simple terms: "${qText}"`;
      }
    }

    if (!prompt) {
      prompt = 'Explain something interesting in 2 to 3 sentences.';
    }

    try {
      await sock.sendPresenceUpdate('recording', remoteJid);

      // Generate conversational explanation meant to be spoken aloud
      const spokenPrompt = `${prompt} (Answer concisely in 2 to 4 direct, conversational sentences meant to be spoken aloud. Do not use markdown asterisks, bullet points, or lists).`;
      const aiAnswer = await askAI({
        chatId: remoteJid,
        senderName,
        prompt: spokenPrompt,
        isGroup
      });

      // Transcode AI explanation to WhatsApp Opus OGG voice note
      const cleanTextForSpeech = aiAnswer.replace(/[*_~`#]/g, '').trim();
      const voiceBuffer = await textToVoiceNote(cleanTextForSpeech);

      await sock.sendPresenceUpdate('paused', remoteJid);

      // Send the audio voice note
      try {
        await sock.sendMessage(
          remoteJid,
          { audio: voiceBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true },
          { quoted: msg }
        );
      } catch (voiceErr) {
        console.warn('[ExplainTTS] Quoted voice send failed, falling back to direct send:', voiceErr.message);
        await sock.sendMessage(
          remoteJid,
          { audio: voiceBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }
        );
      }

      // Also deliver text version with SamAi header
      memory.addMessage(remoteJid, {
        sender: config.botName,
        senderJid: botJid,
        text: aiAnswer,
        isBot: true
      });

      await replyWithTyping(sock, remoteJid, `🎙️ *Voice Explanation:*\n\n${aiAnswer}`, msg);
      console.log('[ExplainTTS] Successfully sent audio voice note and text explanation!');
      return;
    } catch (err) {
      console.error('[ExplainTTS Error]:', err.message);
      return replyWithTyping(sock, remoteJid, `Could not generate voice explanation: ${err.message}`, msg);
    }
  }

  // 2. Help command (@sam help, @sam menu, !help, !menu)
  if (firstWord === 'help' || firstWord === 'menu') {
    const helpText =
      `*Commands (works with @sam or !):*\n` +
      `• *@sam <prompt>* or *!ai <prompt>* - Ask a question or chat\n` +
      `• *@explaintts <prompt>* - Ask any question and get an audio voice note answer\n` +
      `• *@sam tts <text>* or *!tts* - Convert text to voice note\n` +
      `• *@sam s* or *!s* - Turn photo, GIF, or video into sticker\n` +
      `• *@sam summary* or *!summary* - Summarize recent group chat\n` +
      `• *@sam ping* or *!ping* - Check bot connection and latency\n` +
      `• *@sam clear* or *!clear* - Clear recent chat context\n` +
      `• *@sam help* or *!help* - Show this menu\n\n` +
      `*Strict Command Policy:*\n` +
      `SamAi strictly stays silent and never replies to messages unless explicitly called with *@sam*, *@explaintts*, or *!*.`;
    return replyWithTyping(sock, remoteJid, helpText, msg);
  }

  // 3. Ping command (@sam ping, !ping)
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

  // 4. TTS / Text to Audio Command (@sam tts, @sam voice, @sam say, @sam convert to audio)
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

  // 5. Sticker command (@sam s, @sam sticker, !s, or natural language "create sticker", "make sticker")
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

  // 6. Summary / TLDR command (@sam summary, @sam tldr, !summary, !tldr)
  if (firstWord === 'summary' || firstWord === 'tldr') {
    await replyWithTyping(sock, remoteJid, 'Reading recent messages and preparing summary...', msg);
    const summary = await summarizeChat(remoteJid);
    return replyWithTyping(sock, remoteJid, `*📝 Chat Summary:*\n\n${summary}`, msg);
  }

  // 7. Clear command (@sam clear, !clear)
  if (firstWord === 'clear') {
    memory.clear(remoteJid);
    return replyWithTyping(sock, remoteJid, 'Cleared recent chat history memory for this chat.', msg);
  }

  // 8. Conversational AI Prompt
  let promptText = '';
  if (firstWord === 'ai' || firstWord === 'ask') {
    promptText = commandArgs;
  } else {
    promptText = commandBody;
  }

  if (!promptText && isMentioned) {
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
