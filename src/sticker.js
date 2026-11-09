import { Sticker, StickerTypes } from 'wa-sticker-formatter';

/**
 * Converts an image buffer to a valid 512x512 WebP WhatsApp sticker with metadata.
 */
export async function createSticker(imageBuffer, { pack = '@sam Pack', author = 'Sam' } = {}) {
  try {
    const sticker = new Sticker(imageBuffer, {
      pack: pack || '@sam Pack',
      author: author || 'Sam',
      type: StickerTypes.DEFAULT,
      quality: 80
    });
    return await sticker.toBuffer();
  } catch (err) {
    console.error('[Sticker Creation Error]:', err.message);
    throw err;
  }
}
