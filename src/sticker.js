import path from 'path';
import fs from 'fs/promises';
import os from 'os';
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

/**
 * Checks if a WebP buffer is an animated sticker by scanning for the RIFF ANIM chunk header.
 */
export function isAnimatedWebp(buffer) {
  if (!buffer || buffer.length < 30) return false;
  return buffer.includes(Buffer.from('ANIM'));
}

/**
 * Converts a static or animated WebP sticker buffer into a PNG photo buffer.
 */
export async function stickerToPhoto(webpBuffer) {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `stk_in_${Date.now()}_${Math.random().toString(36).slice(2)}.webp`);
  const outputPath = path.join(tmpDir, `photo_out_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);

  try {
    await fs.writeFile(inputPath, webpBuffer);
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-vframes 1'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

/**
 * Converts an animated WebP sticker buffer into an MP4 video buffer.
 */
export async function stickerToVideo(webpBuffer) {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `stk_in_${Date.now()}_${Math.random().toString(36).slice(2)}.webp`);
  const outputPath = path.join(tmpDir, `video_out_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);

  try {
    await fs.writeFile(inputPath, webpBuffer);
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-movflags +faststart'
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
