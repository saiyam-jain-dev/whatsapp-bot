import { snapsave } from 'snapsave-media-downloader';
import scrapr from '@coflyn/scrapr';

/**
 * Regular expression matching any Instagram Reel, Video, or Post URL.
 */
export const INSTAGRAM_REEL_REGEX = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:[A-Za-z0-9_.]+\/)?(?:reel|reels|p|tv|share\/reel)\/([A-Za-z0-9_-]+)[^\s]*/i;

// Cache of recently processed clean URLs (cleanUrl -> timestamp) to prevent duplicate downloads
const recentDownloads = new Map();

/**
 * Clears cached download entries older than 5 minutes.
 */
function cleanCache() {
  const now = Date.now();
  for (const [url, time] of recentDownloads.entries()) {
    if (now - time > 5 * 60 * 1000) {
      recentDownloads.delete(url);
    }
  }
}

/**
 * Extracts downloadable video/image URL from an Instagram Reel or post with multi-tier fallback.
 */
export async function extractInstagramMedia(reelUrl) {
  let videoUrl = null;
  let mediaTitle = '';
  let mediaType = 'video';

  // Tier 1: snapsave-media-downloader
  try {
    const res = await snapsave(reelUrl);
    if (res.success && res.data?.media?.length) {
      const item = res.data.media.find(m => m.type === 'video') || res.data.media[0];
      if (item?.url) {
        videoUrl = item.url;
        mediaType = item.type || 'video';
        if (res.data.description) mediaTitle = res.data.description.slice(0, 100);
      }
    }
  } catch (err) {
    console.warn('[IG Reel] snapsave attempt failed:', err.message);
  }

  // Tier 2: scrapr indown scraper
  if (!videoUrl) {
    try {
      const res = await scrapr.instagram.indown(reelUrl);
      if (res.status && res.result?.downloads?.length) {
        const item = res.result.downloads.find(d => d.type === 'video') || res.result.downloads[0];
        if (item?.url) {
          videoUrl = item.url;
          mediaType = item.type || 'video';
          if (res.result.title) mediaTitle = res.result.title.slice(0, 100);
        }
      }
    } catch (err) {
      console.warn('[IG Reel] indown attempt failed:', err.message);
    }
  }

  // Tier 3: scrapr direct embed scraper
  if (!videoUrl) {
    try {
      const res = await scrapr.instagram.direct(reelUrl);
      if (res.status && res.result?.downloads?.length) {
        const item = res.result.downloads.find(d => d.type === 'video') || res.result.downloads[0];
        if (item?.url) {
          videoUrl = item.url;
          mediaType = item.type || 'video';
          if (res.result.title) mediaTitle = res.result.title.slice(0, 100);
        }
      }
    } catch (err) {
      console.warn('[IG Reel] direct embed attempt failed:', err.message);
    }
  }

  // Tier 4: scrapr snapsave scraper
  if (!videoUrl) {
    try {
      const res = await scrapr.instagram.snapsave(reelUrl);
      if (res.status && res.result?.downloads?.length) {
        const item = res.result.downloads.find(d => d.type === 'video') || res.result.downloads[0];
        if (item?.url) {
          videoUrl = item.url;
          mediaType = item.type || 'video';
          if (res.result.title) mediaTitle = res.result.title.slice(0, 100);
        }
      }
    } catch (err) {
      console.warn('[IG Reel] snapsave scraper attempt failed:', err.message);
    }
  }

  if (!videoUrl) return null;

  return {
    videoUrl,
    mediaType,
    mediaTitle: mediaTitle && mediaTitle !== 'Instagram Media' ? mediaTitle : 'Instagram Reel'
  };
}

/**
 * Automatically downloads and delivers an Instagram Reel video or photo directly to the chat.
 */
export async function downloadAndSendInstagramMedia(sock, msg, remoteJid, reelUrl) {
  // Sanitize trailing punctuation from URL
  const sanitizedUrl = reelUrl.replace(/[)\].,;!]+$/, '');
  const cleanUrl = sanitizedUrl.split('?')[0];

  cleanCache();

  // Deduplication check: ignore if processed within last 60 seconds
  if (recentDownloads.has(cleanUrl) && Date.now() - recentDownloads.get(cleanUrl) < 60000) {
    console.log(`[IG Reel] Skipping duplicate reel URL request for: ${cleanUrl}`);
    return;
  }
  recentDownloads.set(cleanUrl, Date.now());

  console.log(`[IG Reel] Auto-detected Reel URL from ${remoteJid}: ${sanitizedUrl}`);

  // Send reaction ⏳ to provide immediate feedback that reel is being downloaded
  try {
    await sock.sendMessage(remoteJid, { react: { text: '⏳', key: msg.key } });
  } catch {}

  try {
    const extracted = await extractInstagramMedia(sanitizedUrl);
    if (!extracted?.videoUrl) {
      console.warn(`[IG Reel] Could not extract media for: ${sanitizedUrl}`);
      try {
        await sock.sendMessage(remoteJid, { react: { text: '❌', key: msg.key } });
      } catch {}
      return;
    }

    console.log(`[IG Reel] Downloading media buffer from CDN...`);
    const response = await fetch(extracted.videoUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download media buffer (HTTP ${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const mediaBuffer = Buffer.from(arrayBuffer);
    console.log(`[IG Reel] Media download complete (${mediaBuffer.length} bytes). Sending to ${remoteJid}...`);

    const heading = '*SamAi- bot by sammy*';
    const divider = '────────────────────';
    const titleText =
      extracted.mediaTitle && extracted.mediaTitle !== 'Instagram Reel'
        ? `\n\n_${extracted.mediaTitle}_`
        : '';
    const caption = `${heading}\n${divider}\n🎬 *Instagram Reel*${titleText}`;

    if (extracted.mediaType === 'image') {
      try {
        await sock.sendMessage(
          remoteJid,
          { image: mediaBuffer, caption },
          { quoted: msg }
        );
      } catch {
        await sock.sendMessage(remoteJid, { image: mediaBuffer, caption });
      }
    } else {
      try {
        await sock.sendMessage(
          remoteJid,
          { video: mediaBuffer, mimetype: 'video/mp4', caption },
          { quoted: msg }
        );
      } catch {
        await sock.sendMessage(
          remoteJid,
          { video: mediaBuffer, mimetype: 'video/mp4', caption }
        );
      }
    }

    // Reaction ✅ to indicate successful delivery
    try {
      await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });
    } catch {}

    console.log(`[IG Reel] Successfully delivered Instagram Reel to ${remoteJid}!`);
  } catch (err) {
    console.error('[IG Reel Download Error]:', err.message);
    try {
      await sock.sendMessage(remoteJid, { react: { text: '❌', key: msg.key } });
    } catch {}
  }
}
