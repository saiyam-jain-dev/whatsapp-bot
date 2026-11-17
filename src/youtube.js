import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import youtubedl from 'youtube-dl-exec';
import scrapr from '@coflyn/scrapr';

/**
 * Regular expression matching YouTube watch, shorts, live, and youtu.be links.
 */
export const YOUTUBE_REGEX = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})[^\s]*/i;

export const MAX_YOUTUBE_DURATION_SECONDS = 1800; // 30 minutes
export const MAX_YOUTUBE_DURATION_MINUTES = Math.round(MAX_YOUTUBE_DURATION_SECONDS / 60);

/**
 * Downloads a YouTube video or short with multi-tier fallback (yt-dlp first, then web scraper).
 */
export async function downloadYouTubeVideo(videoUrl) {
  const tmpDir = os.tmpdir();
  const outPath = path.join(tmpDir, `yt_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);

  let title = 'YouTube Video';
  let duration = 0;

  // Tier 1: youtubedl (yt-dlp)
  try {
    console.log(`[YouTube] Attempting download via yt-dlp for: ${videoUrl}`);

    // Quick metadata probe
    try {
      const meta = await youtubedl(videoUrl, {
        dumpSingleJson: true,
        noWarnings: true,
        preferFreeFormats: true
      });
      if (meta?.title) title = meta.title;
      if (meta?.duration) duration = meta.duration;

      if (duration > MAX_YOUTUBE_DURATION_SECONDS) {
        throw new Error(`Video duration (${Math.round(duration / 60)} mins) exceeds the ${MAX_YOUTUBE_DURATION_MINUTES}-minute limit for WhatsApp.`);
      }
    } catch (metaErr) {
      if (metaErr.message?.includes('exceeds the') && metaErr.message?.includes('limit for WhatsApp')) {
        throw metaErr;
      }
      console.warn('[YouTube] Metadata pre-fetch warning:', metaErr.message);
    }

    await youtubedl(videoUrl, {
      output: outPath,
      format: 'best[filesize<=60M]/bestvideo[filesize<=50M][height<=720]+bestaudio/best[height<=720]/best[height<=480]/best[height<=360]/best',
      maxFilesize: '85M',
      noWarnings: true
    });

    const buffer = await fs.readFile(outPath);
    console.log(`[YouTube] Download completed via yt-dlp (${buffer.length} bytes).`);
    return { buffer, title, duration };
  } catch (err) {
    if (err.message?.includes('exceeds the') && err.message?.includes('limit for WhatsApp')) {
      throw err;
    }
    console.warn('[YouTube] Tier 1 yt-dlp failed, attempting Tier 2 scraper:', err.message);
  } finally {
    await fs.unlink(outPath).catch(() => {});
  }

  // Tier 2: @coflyn/scrapr ytmp3 / ytmp3gg
  try {
    console.log(`[YouTube] Attempting download via scrapr ytmp3gg for: ${videoUrl}`);
    const res = await scrapr.youtube.ytmp3gg(videoUrl, { format: 'mp4' });
    if (res?.status && res?.result?.downloads?.length) {
      const vid = res.result.downloads.find(d => d.type === 'video') || res.result.downloads[0];
      if (vid?.url) {
        if (res.result.title) title = res.result.title;
        console.log(`[YouTube] Fetching video stream from resolved URL: ${vid.url}`);
        const streamRes = await axios.get(vid.url, {
          responseType: 'arraybuffer',
          timeout: 45000,
          maxContentLength: 85 * 1024 * 1024,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        const buffer = Buffer.from(streamRes.data);
        console.log(`[YouTube] Download completed via scrapr (${buffer.length} bytes).`);
        return { buffer, title, duration };
      }
    }
  } catch (err2) {
    console.warn('[YouTube] Tier 2 scrapr failed:', err2.message);
  }

  throw new Error('Could not download YouTube video. The video may be private, age-restricted, or too large.');
}

/**
 * Downloads and sends YouTube video or Short to WhatsApp chat.
 */
export async function downloadAndSendYouTubeMedia(sock, msg, remoteJid, ytUrl) {
  const heading = '*SamAi- bot by sammy*';
  const divider = '────────────────────';

  try {
    console.log(`[YouTube] Starting download workflow for URL: ${ytUrl}`);
    await sock.sendPresenceUpdate('recording', remoteJid);

    const { buffer, title, duration } = await downloadYouTubeVideo(ytUrl);

    let durationText = '';
    if (duration > 0) {
      const mins = Math.floor(duration / 60);
      const secs = duration % 60;
      durationText = ` (${mins > 0 ? `${mins}m ` : ''}${secs}s)`;
    }

    const caption = `${heading}\n${divider}\n🎥 *${title}*${durationText}\n🔗 ${ytUrl}`;

    console.log(`[YouTube] Sending video (${buffer.length} bytes) to ${remoteJid}...`);
    const isLarge = buffer.length > 64 * 1024 * 1024;
    const sanitizedTitle = (title || 'video').replace(/[^\w\s.-]/gi, '').trim() || 'video';

    if (isLarge) {
      console.log(`[YouTube] File size (${(buffer.length / 1024 / 1024).toFixed(1)}MB) exceeds 64MB direct video limit, sending as video document...`);
      try {
        await sock.sendMessage(
          remoteJid,
          {
            document: buffer,
            mimetype: 'video/mp4',
            fileName: `${sanitizedTitle}.mp4`,
            caption
          },
          { quoted: msg }
        );
      } catch (docErr) {
        console.warn('[YouTube] Quoted document send failed, sending unquoted:', docErr.message);
        await sock.sendMessage(
          remoteJid,
          {
            document: buffer,
            mimetype: 'video/mp4',
            fileName: `${sanitizedTitle}.mp4`,
            caption
          }
        );
      }
    } else {
      try {
        await sock.sendMessage(
          remoteJid,
          {
            video: buffer,
            mimetype: 'video/mp4',
            caption
          },
          { quoted: msg }
        );
      } catch (sendErr) {
        console.warn('[YouTube] Quoted video send failed, falling back to direct send:', sendErr.message);
        await sock.sendMessage(
          remoteJid,
          {
            video: buffer,
            mimetype: 'video/mp4',
            caption
          }
        );
      }
    }

    console.log(`[YouTube] Video successfully delivered to ${remoteJid}!`);
  } catch (err) {
    console.error('[YouTube Download Error]:', err.message);
    const errorMsg =
      `${heading}\n${divider}\n` +
      `⚠️ *Could not download YouTube video*\n\n` +
      `*Error:* ${err.message}\n` +
      `_Tip: Ensure the video is public and under ${MAX_YOUTUBE_DURATION_MINUTES} minutes._`;

    try {
      await sock.sendMessage(remoteJid, { text: errorMsg }, { quoted: msg });
    } catch {
      await sock.sendMessage(remoteJid, { text: errorMsg });
    }
  }
}
