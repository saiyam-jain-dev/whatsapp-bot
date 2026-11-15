import dns from 'node:dns';
import { Agent, setGlobalDispatcher } from 'undici';

dns.setDefaultResultOrder('ipv4first');

// Setup DNS resolver with public fallbacks (8.8.8.8, 1.1.1.1) to avoid local ISP timeouts on mmg.whatsapp.net
const dnsResolver = new dns.promises.Resolver();
dnsResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

const undiciAgent = new Agent({
  connect: {
    lookup: (hostname, options, callback) => {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      if (/^[a-z]\.whatsapp\.net$/i.test(hostname)) {
        hostname = 'mmg.whatsapp.net';
      }
      if (hostname === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
        return dns.lookup(hostname, options, callback);
      }
      dnsResolver.resolve4(hostname).then(addresses => {
        if (!addresses || addresses.length === 0) throw new Error('No IPv4');
        if (options && options.all) {
          callback(null, addresses.map(a => ({ address: a, family: 4 })));
        } else {
          callback(null, addresses[0], 4);
        }
      }).catch(() => {
        dnsResolver.resolve6(hostname).then(addresses => {
          if (!addresses || addresses.length === 0) throw new Error('No IPv6');
          if (options && options.all) {
            callback(null, addresses.map(a => ({ address: a, family: 6 })));
          } else {
            callback(null, addresses[0], 6);
          }
        }).catch(() => {
          dns.lookup(hostname, options, callback);
        });
      });
    }
  }
});
setGlobalDispatcher(undiciAgent);

import fs from 'node:fs';
import path from 'path';

const botLogStream = fs.createWriteStream(path.resolve('bot.log'), { flags: 'a' });
const _log = console.log;
const _err = console.error;
const _warn = console.warn;
console.log = (...args) => {
  try { botLogStream.write(`[${new Date().toISOString()}] [LOG] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') + '\n'); } catch {}
  _log(...args);
};
console.error = (...args) => {
  try { botLogStream.write(`[${new Date().toISOString()}] [ERR] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') + '\n'); } catch {}
  _err(...args);
};
console.warn = (...args) => {
  try { botLogStream.write(`[${new Date().toISOString()}] [WARN] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') + '\n'); } catch {}
  _warn(...args);
};

process.on('uncaughtException', (err) => {
  console.error('[Process Uncaught Exception]:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process Unhandled Rejection]:', reason?.message || reason);
});

import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import { config } from './config.js';
import { handleMessage, preRecordMedia } from './handlers.js';
import { botState, startApiServer } from './server.js';
import { warmUpAI } from './ai.js';

const logger = pino({ level: 'silent' });
let apiServerStarted = false;
let reconnectTimeout = null;
let isStarting = false;

async function startBot() {
  if (isStarting) return;
  isStarting = true;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Clean up any existing socket before creating a new one
  if (botState.sock) {
    try {
      botState.sock.ev?.removeAllListeners();
      botState.sock.end?.();
    } catch {}
    botState.sock = null;
  }

  if (!apiServerStarted) {
    startApiServer(3001);
    apiServerStarted = true;
  }

  console.log('====================================================');
  console.log(`🤖 Starting ${config.botName} WhatsApp Bot`);
  console.log(`📂 Auth session directory: ${config.authDir}`);
  console.log('====================================================\n');

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({
    version: [2, 3000, 1015901307],
    isLatest: false
  }));

  console.log(`Using Baileys version: ${version.join('.')}${isLatest ? ' (latest)' : ''}`);

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.windows('Desktop'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: true
  });

  botState.sock = sock;

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      botState.status = 'qr_ready';
      botState.qr = qr;
      console.log('\n[!] SCAN QR CODE TO LINK WHATSAPP:');
      qrcode.generate(qr, { small: true });
      console.log('\nInstructions:');
      console.log('1. Open WhatsApp on your phone.');
      console.log('2. Go to Settings / Menu > Linked Devices.');
      console.log('3. Tap "Link a Device" and scan the QR code above.');
      console.log('Or view live in the Web Dashboard: http://localhost:3001\n');
    }

    if (connection === 'close') {
      botState.status = 'disconnected';
      const statusCode = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : null;

      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isReplaced = statusCode === DisconnectReason.connectionReplaced;
      const shouldReconnect = !isLoggedOut && !isReplaced;

      console.log(`[!] Connection closed. Reason code: ${statusCode} (${isReplaced ? 'connectionReplaced' : 'normal'}). Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        if (!reconnectTimeout) {
          console.log('[*] Scheduling reconnect in 3 seconds...\n');
          reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;
            isStarting = false;
            startBot();
          }, 3000);
        }
      } else if (isReplaced) {
        console.warn('[!] Session was opened on another client or device. Pausing bot to prevent session collision.');
      } else {
        console.log('[X] Device was logged out. To pair again, delete the auth_session directory and restart.');
      }
    } else if (connection === 'open') {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      isStarting = false;
      botState.status = 'connected';
      botState.qr = null;
      botState.user = sock.user;

      console.log('\n====================================================');
      console.log(`✅ ${config.botName} is ONLINE and connected to WhatsApp!`);
      console.log(`📱 User JID: ${sock.user?.id || 'Connected'}`);
      console.log(`🏷️  Bot Name: ${config.botName}`);
      console.log(`⚡ Command Prefix: ${config.prefix}`);
      console.log('💬 Ready to receive direct messages and group commands.');
      console.log('🌐 Web Dashboard: http://localhost:3001');
      console.log('====================================================\n');

      // Pre-warm Groq API connection in background to eliminate first-message latency
      warmUpAI().catch(() => {});
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    // Pre-record incoming media in batch so albums arriving together are immediately linked in memory
    for (const msg of m.messages) {
      try {
        preRecordMedia(msg, sock);
      } catch {}
    }

    for (const msg of m.messages) {
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        console.error('[Handler Error]:', err.message);
      }
    }
  });

  return sock;
}

startBot().catch((err) => {
  console.error('[Fatal Start Error]:', err);
});
