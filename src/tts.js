import * as googleTTS from 'google-tts-api';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { Readable, PassThrough } from 'stream';

if (ffmpegInstaller?.path) {
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
}

/**
 * Converts text into a WhatsApp-compatible Opus OGG voice note (PTT).
 */
export async function textToVoiceNote(text, { lang = 'en', slow = false } = {}) {
  if (!text || !text.trim()) {
    throw new Error('No text provided for TTS conversion');
  }

  // Detect language: use Hindi if Devanagari characters are present, else English
  const isHindi = /[\u0900-\u097F]/.test(text);
  const targetLang = isHindi ? 'hi' : (lang || 'en');

  // Fetch audio chunks (supports both short phrases and long paragraphs)
  const results = await googleTTS.getAllAudioBase64(text.slice(0, 1000), {
    lang: targetLang,
    slow: Boolean(slow),
    host: 'https://translate.google.com',
    timeout: 15000
  });

  const mp3Buffers = results.map(r => Buffer.from(r.base64, 'base64'));
  const combinedMp3 = Buffer.concat(mp3Buffers);

  // Transcode MP3 to WhatsApp native Opus OGG with PTT single-channel 48kHz
  return new Promise((resolve, reject) => {
    const inputStream = new Readable();
    inputStream.push(combinedMp3);
    inputStream.push(null);

    const chunks = [];
    const outputStream = new PassThrough();

    outputStream.on('data', chunk => chunks.push(chunk));
    outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    outputStream.on('error', reject);

    ffmpeg(inputStream)
      .toFormat('ogg')
      .audioCodec('libopus')
      .audioChannels(1)
      .audioFrequency(48000)
      .audioBitrate('48k')
      .on('error', err => reject(err))
      .pipe(outputStream);
  });
}
