import path from 'path';
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
import { handleMessage } from './handlers.js';
import { botState, startApiServer } from './server.js';

const logger = pino({ level: 'silent' });
let apiServerStarted = false;

async function startBot() {
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

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[!] Connection closed. Reason code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        console.log('[*] Reconnecting in 3 seconds...\n');
        setTimeout(() => {
          startBot();
        }, 3000);
      } else {
        console.log('[X] Device was logged out. To pair again, delete the auth_session directory and restart.');
      }
    } else if (connection === 'open') {
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
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

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
