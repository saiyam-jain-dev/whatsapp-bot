import path from 'path';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// Configure static FFmpeg binary path for Windows/Linux/macOS
if (ffmpegInstaller?.path) {
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  process.env.FFMPEG_PATH = ffmpegInstaller.path;

  const ffmpegDir = path.dirname(ffmpegInstaller.path);
  if (!process.env.PATH?.includes(ffmpegDir)) {
    process.env.PATH = `${ffmpegDir};${process.env.PATH || ''}`;
  }
}

/**
 * Converts an image, animated GIF, or short video buffer to a valid 512x512 WebP WhatsApp sticker.
 */
export async function createSticker(mediaBuffer, { pack = '@sam Pack', author = 'Sam' } = {}) {
  try {
    const sticker = new Sticker(mediaBuffer, {
      pack: pack || '@sam Pack',
      author: author || 'Sam',
      type: StickerTypes.DEFAULT,
      quality: 60 // Optimal quality to ensure animated stickers remain under the WhatsApp 1MB ceiling
    });

    return await sticker.toBuffer();
  } catch (err) {
    console.error('[Sticker Creation Error]:', err.message);
    throw err;
  }
}
