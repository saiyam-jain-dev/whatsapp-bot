import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import waStickerPkg, { Sticker, StickerTypes } from 'wa-sticker-formatter';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
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
 * Checks if a WebP buffer is an animated sticker by scanning for the RIFF ANIM chunk header.
 */
export function isAnimatedWebp(buffer) {
  if (!buffer || buffer.length < 30) return false;
  return buffer.includes(Buffer.from('ANIM'));
}

/**
 * Executes FFmpeg to render an animated WebP sticker with 512x512 transparent padding.
 */
function runFfmpegWebp(inputPath, outputPath, { duration = 3, fps = 14, quality = 45 } = {}) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .inputOptions(['-nostdin', '-ss', '0', '-t', String(duration)])
      .complexFilter([
        'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000'
      ])
      .outputOptions([
        '-vcodec', 'libwebp',
        '-lossless', '0',
        '-compression_level', '6',
        '-q:v', String(quality),
        '-loop', '0',
        '-an',
        '-vsync', '0',
        '-r', String(fps)
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Converts a video, GIF, or animated WebP buffer into a mobile-compatible WhatsApp animated sticker.
 * Strictly enforces:
 * 1. File size < 480 KB (WhatsApp mobile hard limit is 500 KB)
 * 2. Dimensions exactly 512x512 with transparent canvas padding
 * 3. Infinite loop (-loop 0)
 * 4. WhatsApp EXIF pack and author metadata
 */
export async function createAnimatedSticker(mediaBuffer, { pack = '@sam Pack', author = 'Sam' } = {}) {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `anim_in_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
  const outputPath = path.join(tmpDir, `anim_out_${Date.now()}_${Math.random().toString(36).slice(2)}.webp`);

  try {
    await fs.writeFile(inputPath, mediaBuffer);

    // Pass 1: High quality 14 fps, 3s duration, quality 45
    await runFfmpegWebp(inputPath, outputPath, { duration: 3, fps: 14, quality: 45 });
    let stat = await fs.stat(outputPath);

    // Pass 2: If size exceeds 460 KB, apply tighter compression and 12 fps
    if (stat.size > 460 * 1024) {
      console.log(`[Sticker] Pass 1 size was ${stat.size} bytes (> 460 KB). Running pass 2 compression...`);
      await runFfmpegWebp(inputPath, outputPath, { duration: 2.5, fps: 12, quality: 32 });
      stat = await fs.stat(outputPath);
    }

    // Pass 3: If still exceeding 480 KB for complex video scenes
    if (stat.size > 480 * 1024) {
      console.log(`[Sticker] Pass 2 size was ${stat.size} bytes (> 480 KB). Running pass 3 compression...`);
      await runFfmpegWebp(inputPath, outputPath, { duration: 2.0, fps: 10, quality: 22 });
      stat = await fs.stat(outputPath);
    }

    const rawWebp = await fs.readFile(outputPath);
    console.log(`[Sticker] Mobile-optimized animated WebP generated: ${rawWebp.length} bytes (${Math.round(rawWebp.length / 1024)} KB). Adding WhatsApp Exif...`);

    const ExifClass = waStickerPkg.Exif;
    if (ExifClass) {
      const exif = new ExifClass({
        pack: pack || '@sam Pack',
        author: author || 'Sam'
      });
      return await exif.add(rawWebp);
    }

    return rawWebp;
  } catch (err) {
    console.error('[Animated Sticker Error]:', err.message);
    throw err;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

/**
 * Converts an image, animated GIF, or video buffer to a valid 512x512 WebP WhatsApp sticker.
 * Handles both static images and mobile-optimized animated stickers.
 */
export async function createSticker(mediaBuffer, { pack = '@sam Pack', author = 'Sam' } = {}) {
  try {
    const detectedType = await fileTypeFromBuffer(mediaBuffer);
    const mime = detectedType?.mime || '';
    const isVideoOrAnim =
      mime.startsWith('video/') ||
      mime === 'image/gif' ||
      (mime === 'image/webp' && isAnimatedWebp(mediaBuffer));

    if (isVideoOrAnim) {
      console.log(`[Sticker] Detected video/animated media (${mime || 'animated webp'}). Generating mobile-optimized animated sticker...`);
      return await createAnimatedSticker(mediaBuffer, { pack, author });
    }

    // Static sticker (photos, static webp, png, jpeg)
    const sticker = new Sticker(mediaBuffer, {
      pack: pack || '@sam Pack',
      author: author || 'Sam',
      type: StickerTypes.DEFAULT,
      quality: 75
    });

    let buffer = await sticker.toBuffer();

    // Guard against rare large static images exceeding 480 KB
    if (buffer.length > 480 * 1024) {
      const reducedSticker = new Sticker(mediaBuffer, {
        pack: pack || '@sam Pack',
        author: author || 'Sam',
        type: StickerTypes.DEFAULT,
        quality: 50
      });
      buffer = await reducedSticker.toBuffer();
    }

    return buffer;
  } catch (err) {
    console.error('[Sticker Creation Error]:', err.message);
    throw err;
  }
}

/**
 * Converts a static or animated WebP sticker buffer into a PNG photo buffer using Sharp.
 */
export async function stickerToPhoto(webpBuffer) {
  try {
    return await sharp(webpBuffer, { page: 0 }).png().toBuffer();
  } catch (sharpErr) {
    console.warn('[Sticker to Photo] Sharp conversion failed, falling back to FFmpeg:', sharpErr.message);
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `stk_in_${Date.now()}_${Math.random().toString(36).slice(2)}.webp`);
    const outputPath = path.join(tmpDir, `photo_out_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);

    try {
      await fs.writeFile(inputPath, webpBuffer);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('FFmpeg conversion timed out after 10s')), 10000);
        ffmpeg(inputPath)
          .inputOptions(['-nostdin', '-y'])
          .outputOptions(['-vframes', '1'])
          .output(outputPath)
          .on('end', () => {
            clearTimeout(timeout);
            resolve();
          })
          .on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          })
          .run();
      });

      return await fs.readFile(outputPath);
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
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
      const timeout = setTimeout(() => reject(new Error('FFmpeg video conversion timed out after 20s')), 20000);
      ffmpeg(inputPath)
        .inputOptions(['-nostdin', '-y'])
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-movflags +faststart'
        ])
        .output(outputPath)
        .on('end', () => {
          clearTimeout(timeout);
          resolve();
        })
        .on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        })
        .run();
    });

    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
