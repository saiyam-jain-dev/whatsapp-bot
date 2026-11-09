import Groq, { toFile } from 'groq-sdk';
import { config } from './config.js';
import { memory } from './memory.js';

let groqClient = null;
if (config.groqApiKey) {
  groqClient = new Groq({ apiKey: config.groqApiKey });
}

function getSystemPrompt() {
  return `You are ${config.botName}, a witty, sharp, and helpful friend inside a WhatsApp chat.
Key guidelines:
1. Speak naturally like a real person texting friends on WhatsApp. Use concise, direct sentences.
2. Avoid formal corporate greetings, robotic pleasantries, and unnecessary fluff.
3. Keep most answers to 1-3 sentences unless the user explicitly asks for detailed explanations, code, or stories.
4. When context of prior messages is provided, use it to understand ongoing jokes, plans, or questions seamlessly.
5. You can understand Hinglish, slang, memes, and casual banter naturally.
6. Never use em dashes anywhere. Use standard hyphens, colons, or parentheses if needed.`;
}

export async function askAI({ chatId, senderName, prompt, isGroup = false }) {
  if (!config.groqApiKey && !config.geminiApiKey) {
    return `Hey ${senderName || 'there'}! Please add your GROQ_API_KEY (or GEMINI_API_KEY) in the .env file to enable AI answers. You can grab a free one at https://console.groq.com/keys`;
  }

  const contextText = isGroup ? memory.formatContextForPrompt(chatId) : '';

  let userContent = '';
  if (contextText) {
    userContent += `[Recent chat messages for background context]:\n${contextText}\n\n`;
  }
  userContent += `${senderName || 'Friend'}: ${prompt}`;

  if (config.groqApiKey) {
    if (!groqClient) {
      groqClient = new Groq({ apiKey: config.groqApiKey });
    }

    const candidateModels = [
      config.groqModel || 'openai/gpt-oss-120b',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b'
    ];

    const uniqueModels = [...new Set(candidateModels)];

    for (const model of uniqueModels) {
      try {
        const response = await groqClient.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: getSystemPrompt() },
            { role: 'user', content: userContent }
          ],
          temperature: 0.7,
          max_tokens: 800
        });

        const reply = response.choices[0]?.message?.content?.trim();
        if (reply) return reply;
      } catch (err) {
        console.warn(`[AI Groq Attempt with ${model} failed]:`, err.message);
        // Continue to fallback model
      }
    }

    if (!config.geminiApiKey) {
      return "Groq couldn't generate a response. Check model availability or try again.";
    }
  }

  if (config.geminiApiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`;
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: `${getSystemPrompt()}\n\n${userContent}` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      return reply || "Couldn't generate a response from Gemini.";
    } catch (err) {
      console.error('[AI Gemini Error]:', err.message);
      return `Gemini error: ${err.message}`;
    }
  }

  return 'No AI provider configured.';
}

export async function summarizeChat(chatId) {
  const context = memory.formatContextForPrompt(chatId, 25);
  if (!context || context.trim().length === 0) {
    return 'No recent messages recorded yet to summarize.';
  }

  const prompt = `Here is the transcript of recent messages from this WhatsApp group:\n\n${context}\n\n` +
    `Please provide a crisp, informal summary (3 to 5 quick bullet points) of what was discussed, any key decisions, or upcoming plans. Use friendly WhatsApp style. Zero em dashes.`;

  return askAI({
    chatId,
    senderName: 'Group Summary Request',
    prompt,
    isGroup: false
  });
}

export async function transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
  if (!config.groqApiKey) {
    return null;
  }

  try {
    if (!groqClient) {
      groqClient = new Groq({ apiKey: config.groqApiKey });
    }

    const file = await toFile(audioBuffer, 'audio.ogg', { type: mimeType });
    const transcription = await groqClient.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      response_format: 'text'
    });

    return typeof transcription === 'string' ? transcription.trim() : transcription.text?.trim();
  } catch (err) {
    console.error('[Whisper Error]:', err.message);
    return null;
  }
}
