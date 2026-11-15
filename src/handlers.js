import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import axios from 'axios';
import { config } from './config.js';
import { memory } from './memory.js';
import { askAI, summarizeChat, transcribeAudio } from './ai.js';
import { createSticker, stickerToPhoto, stickerToVideo, isAnimatedWebp } from './sticker.js';
import { textToVoiceNote } from './tts.js';
import { INSTAGRAM_REEL_REGEX, downloadAndSendInstagramMedia } from './reels.js';

/**
 * Normalizes user JIDs by removing multi-device session tags (e.g. 1234:0@s.whatsapp.net -> 1234@s.whatsapp.net).
 */
function normalizeJid(jid) {
  if (!jid) return '';
  if (jid.endsWith('@g.us')) return jid;
  const parts = jid.split('@');
  const user = parts[0].split(':')[0];
  const server = parts[1] || 's.whatsapp.net';
  return `${user}@${server}`;
}

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
 * Checks if user text expresses intent to fetch a profile picture.
 */
function isPfpIntent(text, firstWord) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  const word = (firstWord || '').toLowerCase();
  if (['pfp', 'dp', 'avatar', 'profilepic', 'profilephoto'].includes(word)) return true;
  if (word === 'profile' && /^(pic|picture|photo)/i.test(lower.slice(word.length).trim())) return true;
  if (/^(pfp|dp|avatar|profile\s*pic(ture)?|profile\s*photo)\b/i.test(lower)) return true;
  if (/^(get|show|send|fetch|give|grab)\s+(the\s+)?(pfp|dp|avatar|profile\s*pic(ture)?|profile\s*photo)\b/i.test(lower)) return true;
  if (/(pfp|dp|avatar|profile\s*pic(ture)?|profile\s*photo)$/i.test(lower)) return true;
  return false;
}

/**
 * Checks if user text expresses intent to convert sticker to photo or video.
 */
function isStickerToPhotoIntent(text, firstWord) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  const word = (firstWord || '').toLowerCase();
  if (['photo', 'image', 'toimg', 'tophoto', 'tovideo'].includes(word)) return true;
  if (/^(photo|image|toimg|tophoto|tovideo)\b/i.test(lower)) return true;
  if (/^(convert|turn|make|change|extract)(\s+(this|the|a))?\s+stickers?\s+(in)?to\s+(photo|image|pic|picture|video)/i.test(lower)) return true;
  if (/^stickers?\s+(in)?to\s+(photo|image|pic|picture|video)/i.test(lower)) return true;
  return false;
}

/**
 * Finds sticker media in:
 * 1. Quoted message (most common: replying to a sticker)
 * 2. Current message attachment
 * 3. Recent chat media history (if a sticker was recently sent)
 */
function findStickerMedia(msg, remoteJid) {
  const root = unwrapMessage(msg.message);
  const contextInfo = getContextInfo(root);
  const quoted = contextInfo?.quotedMessage;

  // 1. Quoted message
  if (quoted) {
    const unwrappedQuoted = unwrapMessage(quoted);
    if (unwrappedQuoted?.stickerMessage) {
      return {
        media: unwrappedQuoted.stickerMessage,
        type: 'sticker',
        isAnimated: Boolean(unwrappedQuoted.stickerMessage.isAnimated),
        source: 'quoted'
      };
    }
  }

  // 2. Direct message
  if (root?.stickerMessage) {
    return {
      media: root.stickerMessage,
      type: 'sticker',
      isAnimated: Boolean(root.stickerMessage.isAnimated),
      source: 'direct'
    };
  }

  // 3. Fallback: Recent chat media if it was a sticker
  if (remoteJid) {
    const recentMedia = memory.getLatestMedia(remoteJid);
    if (recentMedia && recentMedia.type === 'sticker') {
      return {
        media: recentMedia.media,
        type: 'sticker',
        isAnimated: Boolean(recentMedia.media?.isAnimated),
        source: 'chat_history'
      };
    }
  }

  return null;
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
async function replyWithTyping(sock, jid, text, quotedMsg, options = {}) {
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

    return await sock.sendMessage(jid, { text: formattedText, ...options }, { quoted: quotedMsg });
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
  const senderJidRaw = isGroup ? (msg.key.participant || msg.participant || '') : remoteJid;
  const senderJid = normalizeJid(senderJidRaw);
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

  // If this message contains an image, video/GIF, or sticker in a group, save to media history
  if (isGroup) {
    if (rootContent.imageMessage) {
      memory.saveLatestMedia(remoteJid, { media: rootContent.imageMessage, type: 'image' });
    } else if (rootContent.videoMessage) {
      memory.saveLatestMedia(remoteJid, { media: rootContent.videoMessage, type: 'video' });
    } else if (rootContent.documentMessage && (rootContent.documentMessage.mimetype?.startsWith('image/') || rootContent.documentMessage.mimetype?.startsWith('video/'))) {
      memory.saveLatestMedia(remoteJid, { media: rootContent.documentMessage, type: 'document' });
    } else if (rootContent.stickerMessage) {
      memory.saveLatestMedia(remoteJid, { media: rootContent.stickerMessage, type: 'sticker' });
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

  // AUTO-DOWNLOAD INSTAGRAM REEL LINKS:
  // If any message contains an Instagram Reel URL, automatically download and deliver the video
  // without requiring any syntax, command prefix, or mention.
  const igMatch = trimmedText.match(INSTAGRAM_REEL_REGEX);
  if (igMatch) {
    const reelUrl = igMatch[0].startsWith('http') ? igMatch[0] : `https://${igMatch[0]}`;
    await downloadAndSendInstagramMedia(sock, msg, remoteJid, reelUrl);
    return;
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

  // 2. Help command (!help, @sam help, !menu, @sam menu)
  if (firstWord === 'help' || firstWord === 'menu') {
    const helpText =
      `*Commands (works with ! or @sam):*\n\n` +
      `• *!ai <prompt>* or *@sam <prompt>* - Ask any question or chat with AI\n` +
      `• *@explaintts <prompt>* - Ask a question and get a spoken audio voice note answer\n` +
      `• *!tts <text>* or *@sam tts <text>* - Convert text or quoted message to voice note\n` +
      `• *!s* or *@sam s* - Reply to any photo, GIF, or video to create a sticker\n` +
      `• *!photo* or *@sam photo* - Reply to any sticker to convert it to a photo or video\n` +
      `• *!pfp* or *@sam pfp* - Get profile picture of yourself, tagged member, or replied user\n` +
      `• *Instagram Reels* - Send any Instagram Reel link directly and it auto-downloads (no command needed!)\n` +
      `• *!summary* or *@sam summary* - Summarize recent group chat messages\n` +
      `• *!ping* or *@sam ping* - Check bot connection status and latency\n` +
      `• *!clear* or *@sam clear* - Clear rolling chat context memory\n` +
      `• *!help* or *@sam help* - Show this command list\n\n` +
      `*Trigger Policy:*\n` +
      `SamAi stays silent and never replies to normal group banter unless an Instagram Reel link is shared, or explicitly invoked with *!* or *@sam*.`;
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

  // 5. Convert Sticker to Photo/Video command (!photo, @sam photo, !image, !toimg, !tovideo)
  if (isStickerToPhotoIntent(commandBody, firstWord)) {
    console.log(`[Sticker to Photo/Video] Triggered by ${senderName} (${remoteJid}) with input: "${commandBody}"`);
    const target = findStickerMedia(msg, remoteJid);

    if (!target) {
      return replyWithTyping(
        sock,
        remoteJid,
        `No sticker found to convert! You can:\n1. Reply to any sticker with *!photo* (or *@sam photo*)\n2. Send a sticker directly with caption *!photo*\n3. Type *!photo* right after a sticker was shared in this chat.`,
        msg
      );
    }

    try {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const stream = await downloadContentFromMessage(target.media, 'sticker');
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const stickerBuffer = Buffer.concat(chunks);
      const isAnimated = target.isAnimated || isAnimatedWebp(stickerBuffer);
      const heading = '*SamAi- bot by sammy*';
      const divider = '────────────────────';

      if (isAnimated) {
        console.log('[Sticker to Media] Converting animated sticker to MP4 video with FFmpeg...');
        const videoBuffer = await stickerToVideo(stickerBuffer);
        const caption = `${heading}\n${divider}\n🎥 *Converted Sticker to Video*`;
        try {
          await sock.sendMessage(
            remoteJid,
            { video: videoBuffer, mimetype: 'video/mp4', caption },
            { quoted: msg }
          );
        } catch {
          await sock.sendMessage(
            remoteJid,
            { video: videoBuffer, mimetype: 'video/mp4', caption }
          );
        }
      } else {
        console.log('[Sticker to Media] Converting static sticker to PNG photo with FFmpeg...');
        const photoBuffer = await stickerToPhoto(stickerBuffer);
        const caption = `${heading}\n${divider}\n🖼️ *Converted Sticker to Photo*`;
        try {
          await sock.sendMessage(
            remoteJid,
            { image: photoBuffer, caption },
            { quoted: msg }
          );
        } catch {
          await sock.sendMessage(
            remoteJid,
            { image: photoBuffer, caption }
          );
        }
      }
      return;
    } catch (err) {
      console.error('[Sticker to Media Error]:', err.message);
      return replyWithTyping(sock, remoteJid, `Could not convert sticker: ${err.message}`, msg);
    }
  }

  // 6. Sticker command (@sam s, @sam sticker, !s, or natural language "create sticker", "make sticker")
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

  // 7. Profile Picture (PFP / DP / Avatar) command
  if (isPfpIntent(commandBody, firstWord)) {
    console.log(`[PFP Command] Triggered by ${senderName} (${remoteJid}) with input: "${commandBody}"`);

    const lowerArgs = commandArgs.toLowerCase().trim();
    if (lowerArgs === 'help') {
      const pfpHelpText =
        `*Profile Picture (PFP) Commands:*\n` +
        `• Reply to any group member's message with *@sam pfp* (or *!pfp*)\n` +
        `• *@sam pfp @user* - Fetch profile picture of tagged member\n` +
        `• *@sam pfp <phone-number>* - Fetch profile picture by phone number\n` +
        `• *@sam pfp group* - Fetch group profile picture\n` +
        `• *@sam pfp* - Fetch your own profile picture\n\n` +
        `Aliases: *pfp*, *dp*, *avatar*, *profilepic*`;
      return replyWithTyping(sock, remoteJid, pfpHelpText, msg);
    }

    // Determine target JID
    let targetJid = null;
    let targetName = null;

    // A. Check if another user was @mentioned (excluding the bot itself)
    const otherMentions = mentionedJids.filter(jid => {
      const normalized = jid.split('@')[0];
      return jid !== botJid && jid !== botJidRaw && normalized !== botJid.split('@')[0];
    });

    if (otherMentions.length > 0) {
      targetJid = otherMentions[0];
    }

    // B. Check if quoting a message
    if (!targetJid) {
      const quoted = contextInfo?.quotedMessage;
      if (quoted) {
        targetJid = contextInfo?.participant || (isGroup ? null : remoteJid);
      }
    }

    // C. Check if targeting the group icon
    if (!targetJid && /\b(group|this group|group icon|group pfp|group dp)\b/i.test(commandBody)) {
      if (isGroup) {
        targetJid = remoteJid;
      }
    }

    // D. Check if phone number was passed as argument (e.g. !pfp 919876543210)
    if (!targetJid) {
      const digitsOnly = commandArgs.replace(/\D/g, '');
      if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
        targetJid = `${digitsOnly}@s.whatsapp.net`;
      }
    }

    // E. Fallback: target sender themselves
    if (!targetJid) {
      targetJid = senderJid;
    }

    // If target is an LID, try to map to phone JID if available
    if (targetJid && targetJid.endsWith('@lid') && sock.signalRepository?.lidMapping?.getPNForLID) {
      try {
        const pn = await sock.signalRepository.lidMapping.getPNForLID(targetJid);
        if (pn) {
          targetJid = pn;
        }
      } catch {
        // Keep LID if resolving fails
      }
    }

    targetJid = normalizeJid(targetJid);

    // Resolve target display name
    if (targetJid === remoteJid) {
      targetName = 'Group';
    } else if (targetJid === senderJid) {
      targetName = senderName;
    } else {
      const recent = memory.getRecentMessages(remoteJid);
      const match = recent.slice().reverse().find(m => m.senderJid === targetJid);
      if (match?.sender) {
        targetName = match.sender;
      }
    }

    try {
      await sock.sendPresenceUpdate('composing', remoteJid);

      // Attempt to retrieve profile picture URL (high-res image first, preview fallback)
      let pfpUrl = null;
      try {
        pfpUrl = await sock.profilePictureUrl(targetJid, 'image');
      } catch {
        try {
          pfpUrl = await sock.profilePictureUrl(targetJid, 'preview');
        } catch {
          pfpUrl = null;
        }
      }

      if (!pfpUrl) {
        const isSelf = targetJid === senderJid;
        const isGroupTarget = targetJid === remoteJid;
        const targetDisplay = isGroupTarget
          ? 'this group'
          : isSelf
            ? 'your account'
            : targetName
              ? `${targetName} (@${targetJid.split('@')[0]})`
              : `@${targetJid.split('@')[0]}`;

        const notFoundMsg =
          `Could not retrieve profile picture for ${targetDisplay}.\n\n` +
          `Possible reasons:\n` +
          `• No profile picture is set\n` +
          `• WhatsApp privacy settings hide the photo\n` +
          `• Account is not accessible`;

        return replyWithTyping(sock, remoteJid, notFoundMsg, msg, { mentions: [targetJid] });
      }

      console.log(`[PFP] Fetching profile picture image from URL for ${targetJid}...`);
      let imageBuffer = null;
      try {
        const res = await axios.get(pfpUrl, {
          responseType: 'arraybuffer',
          timeout: 10000,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/*,*/*'
          }
        });
        imageBuffer = Buffer.from(res.data);
      } catch (axErr) {
        console.warn('[PFP] Axios image fetch failed, trying fetch fallback:', axErr.message);
        const response = await fetch(pfpUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        if (!response.ok) {
          throw new Error(`Failed to download image (HTTP ${response.status})`);
        }
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      }

      const heading = '*SamAi- bot by sammy*';
      const divider = '────────────────────';
      const isSelf = targetJid === senderJid;
      const isGroupTarget = targetJid === remoteJid;

      let captionTitle = '';
      if (isGroupTarget) {
        captionTitle = 'Group Profile Picture';
      } else if (isSelf) {
        captionTitle = `Profile Picture of @${targetJid.split('@')[0]} (You)`;
      } else if (targetName && targetName !== targetJid.split('@')[0]) {
        captionTitle = `Profile Picture of ${targetName} (@${targetJid.split('@')[0]})`;
      } else {
        captionTitle = `Profile Picture of @${targetJid.split('@')[0]}`;
      }

      let tipNote = '';
      if (isSelf && isGroup) {
        tipNote = `\n\n💡 _Tip: Tag a member (@sam pfp @user) or reply to their message with @sam pfp to fetch their photo._`;
      }

      const caption = `${heading}\n${divider}\n👤 *${captionTitle}*${tipNote}`;

      try {
        await sock.sendMessage(
          remoteJid,
          {
            image: imageBuffer,
            caption,
            mentions: [targetJid]
          },
          { quoted: msg }
        );
      } catch (sendErr) {
        console.warn('[PFP] Quoted image send failed, falling back to direct send:', sendErr.message);
        await sock.sendMessage(
          remoteJid,
          {
            image: imageBuffer,
            caption,
            mentions: [targetJid]
          }
        );
      }

      console.log(`[PFP] Successfully sent profile picture for ${targetJid}`);
      return;
    } catch (err) {
      console.error('[PFP Error]:', err.message);
      return replyWithTyping(sock, remoteJid, `Could not retrieve profile picture: ${err.message}`, msg);
    }
  }

  // 8. Instagram Reel Command (@sam reel, !reel, @sam ig, !ig, @sam download)
  if (['reel', 'reels', 'ig', 'igdl', 'download'].includes(firstWord)) {
    let targetUrl = commandArgs;
    if (!targetUrl) {
      const quoted = contextInfo?.quotedMessage;
      if (quoted) {
        const unwrappedQuoted = unwrapMessage(quoted);
        const qText =
          unwrappedQuoted?.conversation ||
          unwrappedQuoted?.extendedTextMessage?.text ||
          unwrappedQuoted?.imageMessage?.caption ||
          unwrappedQuoted?.videoMessage?.caption ||
          '';
        const qMatch = qText.match(INSTAGRAM_REEL_REGEX);
        if (qMatch) {
          targetUrl = qMatch[0];
        }
      }
    }
    const match = targetUrl?.match(INSTAGRAM_REEL_REGEX);
    if (match) {
      const reelUrl = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
      await downloadAndSendInstagramMedia(sock, msg, remoteJid, reelUrl);
      return;
    }
    return replyWithTyping(
      sock,
      remoteJid,
      `No Instagram Reel link found! You can:\n1. Send any Instagram Reel link directly in chat (no command needed!)\n2. Reply to a message with *@sam reel*\n3. Type *@sam reel <link>*`,
      msg
    );
  }

  // 9. Summary / TLDR command (@sam summary, @sam tldr, !summary, !tldr)
  if (firstWord === 'summary' || firstWord === 'tldr') {
    await replyWithTyping(sock, remoteJid, 'Reading recent messages and preparing summary...', msg);
    const summary = await summarizeChat(remoteJid);
    return replyWithTyping(sock, remoteJid, `*📝 Chat Summary:*\n\n${summary}`, msg);
  }

  // 10. Clear command (@sam clear, !clear)
  if (firstWord === 'clear') {
    memory.clear(remoteJid);
    return replyWithTyping(sock, remoteJid, 'Cleared recent chat history memory for this chat.', msg);
  }

  // 11. Conversational AI Prompt
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
