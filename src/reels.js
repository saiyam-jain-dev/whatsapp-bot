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

function withTimeout(promise, ms, desc = 'Operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${desc} timed out after ${ms}ms`)), ms)
    )
  ]);
}

function detectMediaType(url, itemType) {
  if (itemType === 'video') return 'video';
  if (itemType === 'image' || itemType === 'photo') return 'image';
  if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) return 'video';
  if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)) return 'image';
  return 'video';
}

function getCdnHeaders(url) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"'
  };

  if (url.includes('snapcdn.app') || url.includes('indown.net')) {
    headers['Referer'] = 'https://indown.net/';
  } else if (url.includes('rapidcdn.app') || url.includes('snapsave.app')) {
    headers['Referer'] = 'https://snapsave.app/';
  } else if (url.includes('cdninstagram.com') || url.includes('fbcdn.net') || url.includes('instagram.com')) {
    headers['Referer'] = 'https://www.instagram.com/';
  } else {
    headers['Referer'] = 'https://www.instagram.com/';
  }

  return headers;
}

/**
 * Extracts downloadable video/image candidates from an Instagram Reel or post with multi-tier fallback.
 */
export async function extractInstagramMedia(reelUrl) {
  const match = reelUrl.match(INSTAGRAM_REEL_REGEX);
  const targetUrl = match?.[1]
    ? `https://www.instagram.com/reel/${match[1]}/`
    : reelUrl.replace(/[)\].,;!]+$/, '').split('?')[0];

  const candidates = [];
  let mediaTitle = '';

  // Tier 1: snapsave-media-downloader (fastest, 8s timeout)
  try {
    const res = await withTimeout(snapsave(targetUrl), 8000, 'snapsave-pkg');
    if (res.success && res.data?.media?.length) {
      if (res.data.description) mediaTitle = res.data.description.slice(0, 100);
      for (const item of res.data.media) {
        if (item?.url) {
          candidates.push({
            url: item.url,
            mediaType: detectMediaType(item.url, item.type),
            mediaTitle: mediaTitle || 'Instagram Reel'
          });
        }
      }
    }
  } catch (err) {
    console.warn('[IG Reel] snapsave-pkg attempt failed:', err.message);
  }

  // Tier 2: scrapr indown scraper (ultra reliable, 8s timeout)
  if (candidates.length === 0) {
    try {
      const res = await withTimeout(scrapr.instagram.indown(targetUrl), 8000, 'indown');
      if (res.status && res.result?.downloads?.length) {
        if (res.result.title) mediaTitle = res.result.title.slice(0, 100);
        for (const item of res.result.downloads) {
          if (item?.url) {
            candidates.push({
              url: item.url,
              mediaType: detectMediaType(item.url, item.type),
              mediaTitle: mediaTitle || 'Instagram Reel'
            });
          }
        }
      }
    } catch (err) {
      console.warn('[IG Reel] indown attempt failed:', err.message);
    }
  }

  // Tier 3: scrapr snapsave scraper (8s timeout)
  if (candidates.length === 0) {
    try {
      const res = await withTimeout(scrapr.instagram.snapsave(targetUrl), 8000, 'scrapr snapsave');
      if (res.status && res.result?.downloads?.length) {
        if (res.result.title) mediaTitle = res.result.title.slice(0, 100);
        for (const item of res.result.downloads) {
          if (item?.url) {
            candidates.push({
              url: item.url,
              mediaType: detectMediaType(item.url, item.type),
              mediaTitle: mediaTitle || 'Instagram Reel'
            });
          }
        }
      }
    } catch (err) {
      console.warn('[IG Reel] scrapr snapsave attempt failed:', err.message);
    }
  }

  // Tier 4: scrapr snapinsta scraper (8s timeout)
  if (candidates.length === 0) {
    try {
      const res = await withTimeout(scrapr.instagram.snapinsta(targetUrl), 8000, 'snapinsta');
      if (res.status && res.result?.downloads?.length) {
        if (res.result.title) mediaTitle = res.result.title.slice(0, 100);
        for (const item of res.result.downloads) {
          if (item?.url) {
            candidates.push({
              url: item.url,
              mediaType: detectMediaType(item.url, item.type),
              mediaTitle: mediaTitle || 'Instagram Reel'
            });
          }
        }
      }
    } catch (err) {
      console.warn('[IG Reel] snapinsta attempt failed:', err.message);
    }
  }

  // Tier 5: scrapr direct embed scraper (6s timeout)
  if (candidates.length === 0) {
    try {
      const res = await withTimeout(scrapr.instagram.direct(targetUrl), 6000, 'direct');
      if (res.status && res.result?.downloads?.length) {
        if (res.result.title) mediaTitle = res.result.title.slice(0, 100);
        for (const item of res.result.downloads) {
          if (item?.url) {
            candidates.push({
              url: item.url,
              mediaType: detectMediaType(item.url, item.type),
              mediaTitle: mediaTitle || 'Instagram Reel'
            });
          }
        }
      }
    } catch (err) {
      console.warn('[IG Reel] direct embed attempt failed:', err.message);
    }
  }

  if (candidates.length === 0) return null;

  // Prioritize video candidates before images
  const videos = candidates.filter(c => c.mediaType === 'video');
  const images = candidates.filter(c => c.mediaType === 'image');
  const orderedCandidates = [...videos, ...images];

  return {
    candidates: orderedCandidates,
    videoUrl: orderedCandidates[0]?.url,
    mediaType: orderedCandidates[0]?.mediaType,
    mediaTitle: mediaTitle && mediaTitle !== 'Instagram Media' ? mediaTitle : 'Instagram Reel'
  };
}

/**
 * Automatically downloads and delivers an Instagram Reel video or photo directly to the chat.
 */
export async function downloadAndSendInstagramMedia(sock, msg, remoteJid, reelUrl) {
  const match = reelUrl.match(INSTAGRAM_REEL_REGEX);
  const cleanUrl = match?.[1]
    ? `https://www.instagram.com/reel/${match[1]}/`
    : reelUrl.replace(/[)\].,;!]+$/, '').split('?')[0];

  cleanCache();

  // Deduplication check: ignore if processed within last 60 seconds
  if (recentDownloads.has(cleanUrl) && Date.now() - recentDownloads.get(cleanUrl) < 60000) {
    console.log(`[IG Reel] Skipping duplicate reel URL request for: ${cleanUrl}`);
    return;
  }
  recentDownloads.set(cleanUrl, Date.now());

  console.log(`[IG Reel] Processing Reel URL from ${remoteJid}: ${cleanUrl}`);

  // Send reaction ⏳ to provide immediate feedback that reel is being downloaded
  try {
    await sock.sendMessage(remoteJid, { react: { text: '⏳', key: msg.key } });
  } catch {}

  try {
    const extracted = await extractInstagramMedia(cleanUrl);
    if (!extracted?.candidates?.length) {
      console.warn(`[IG Reel] Could not extract media for: ${cleanUrl}`);
      try {
        await sock.sendMessage(remoteJid, { react: { text: '❌', key: msg.key } });
      } catch {}
      return;
    }

    console.log(`[IG Reel] Found ${extracted.candidates.length} download candidate(s). Downloading media buffer from CDN...`);

    let mediaBuffer = null;
    let chosenCandidate = null;

    for (let i = 0; i < extracted.candidates.length; i++) {
      const candidate = extracted.candidates[i];
      try {
        console.log(`[IG Reel] Candidate ${i + 1}/${extracted.candidates.length}: ${candidate.url.slice(0, 60)}...`);
        const headers = getCdnHeaders(candidate.url);
        const response = await fetch(candidate.url, {
          signal: AbortSignal.timeout(25000),
          headers
        });

        if (!response.ok) {
          console.warn(`[IG Reel] Candidate ${i + 1} returned HTTP ${response.status}, trying next...`);
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        if (buf && buf.length > 500) {
          mediaBuffer = buf;
          chosenCandidate = candidate;
          break;
        }
      } catch (candErr) {
        console.warn(`[IG Reel] Candidate ${i + 1} failed: ${candErr.message}, trying next...`);
      }
    }

    if (!mediaBuffer || !chosenCandidate) {
      throw new Error('All candidate download streams failed or were forbidden');
    }

    console.log(`[IG Reel] Media download complete (${mediaBuffer.length} bytes, type: ${chosenCandidate.mediaType}). Sending to ${remoteJid}...`);

    const heading = '*SamAi- bot by sammy*';
    const divider = '────────────────────';
    const titleText =
      extracted.mediaTitle && extracted.mediaTitle !== 'Instagram Reel'
        ? `\n\n_${extracted.mediaTitle}_`
        : '';
    const caption = `${heading}\n${divider}\n🎬 *Instagram Reel*${titleText}`;

    if (chosenCandidate.mediaType === 'image') {
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
