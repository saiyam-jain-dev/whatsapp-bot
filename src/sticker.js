import sharp from 'sharp';

/**
 * Encodes WhatsApp sticker EXIF metadata into a WebP buffer.
 */
function addExifMetadata(webpBuffer, pack = 'Sayam Bot Stickers', author = 'Sayam') {
  const json = {
    'sticker-pack-id': 'com.sayam.whatsappbot',
    'sticker-pack-name': pack,
    'sticker-pack-publisher': author,
    'emojis': ['✨']
  };

  const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8');
  const exifHeader = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00
  ]);
  const lengthBuff = Buffer.alloc(4);
  lengthBuff.writeUInt32LE(jsonBuff.length, 0);

  const payload = Buffer.concat([exifHeader, lengthBuff, Buffer.from([0x00, 0x00, 0x00, 0x00]), jsonBuff]);

  const exifChunkHeader = Buffer.from('EXIF');
  const exifChunkSize = Buffer.alloc(4);
  exifChunkSize.writeUInt32LE(payload.length, 0);

  // WebP files have RIFF header (4 bytes), fileSize (4 bytes), WEBP (4 bytes)
  if (webpBuffer.length < 12) return webpBuffer;

  const riff = webpBuffer.subarray(0, 12);
  const remaining = webpBuffer.subarray(12);

  const exifChunk = Buffer.concat([exifChunkHeader, exifChunkSize, payload]);
  const newLength = webpBuffer.length - 8 + exifChunk.length;
  riff.writeUInt32LE(newLength, 4);

  return Buffer.concat([riff, exifChunk, remaining]);
}

/**
 * Converts an image buffer to a 512x512 WebP sticker.
 */
export async function createSticker(imageBuffer, { pack = 'Sayam Bot', author = 'Buddy' } = {}) {
  try {
    const webpBuffer = await sharp(imageBuffer)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality: 80 })
      .toBuffer();

    try {
      return addExifMetadata(webpBuffer, pack, author);
    } catch {
      return webpBuffer;
    }
  } catch (err) {
    console.error('[Sticker Conversion Error]:', err.message);
    throw err;
  }
}
