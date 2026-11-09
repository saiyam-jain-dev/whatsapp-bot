# Personal WhatsApp AI Bot & Vite Control Dashboard

A fast, lightweight personal WhatsApp AI assistant with an interactive Vite web dashboard. Powered by [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) and [Groq](https://console.groq.com) (Llama 3.3 70B & Whisper).

Built for chatting with friends, managing rolling group conversation memory, making stickers, and generating instant chat summaries without spamming.

---

## Key Features

- **Pure WebSocket Protocol**: Runs via Baileys multi-device protocol (~60 MB RAM). No heavy headless Chrome or Puppeteer.
- **Interactive Vite Dashboard**: Modern React + Vite control center at `http://localhost:3001` with live QR code pairing, active chat memory viewer, and an AI playground.
- **Group Intelligence**: Stays quiet during regular group banter. Only responds when @mentioned, replied to, or triggered by a command (`!ai`, `!s`, `!summary`).
- **Rolling Context Memory**: Maintains an in-memory buffer of the last 15 group messages so the AI understands ongoing topics, banter, and plans.
- **Sub-Second AI Inference**: Uses Groq Llama 3.3 70B (250+ tokens/sec) for instant responses.
- **Image to Sticker**: Turn any picture into a 512x512 WhatsApp sticker with `!s` or `!sticker`.
- **Catch-Up Summaries**: Run `!summary` or `!tldr` to get a quick bulleted breakdown of recent group messages.
- **Voice Note Transcription**: Automatically transcribes voice notes via Groq Whisper and answers them.
- **Anti-Ban Simulation**: Simulates human typing latency (`sendPresenceUpdate('composing')` with randomized 1.0 to 2.5s delay).
- **Persistent Multi-Device Auth**: Scans QR code once into `auth_session/`. Remains connected across restarts without re-scanning.

---

## Quick Start

### 1. Configure Environment
Edit `.env` (or copy from `.env.example`):
```env
# Free API key from https://console.groq.com/keys
GROQ_API_KEY=your_groq_api_key_here

# Bot configuration
BOT_NAME=Buddy
COMMAND_PREFIX=!
CONTEXT_LIMIT=15
```

### 2. Run the Bot & Web Dashboard
```bash
npm start
```
The console will display the terminal QR code, and start the Vite web dashboard on **http://localhost:3001**.

### 3. Link Your WhatsApp
1. Open **http://localhost:3001** in your browser (or look at the terminal).
2. Open WhatsApp on your phone.
3. Tap **Settings** (or 3 dots on Android) > **Linked Devices** > **Link a Device**.
4. Scan the QR code displayed on the screen.
5. Credentials save automatically to `./auth_session`.

---

## Commands & Usage

All commands can be invoked using either `@sam` or the traditional `!` prefix:

| Command | Usage Example | Description |
|---|---|---|
| `@sam <prompt>` or `!ai <prompt>` | `@sam what movie should we watch tonight?` | Ask @sam anything directly (also answers when replied to) |
| `@explaintts <prompt>` | `@explaintts why is the sky blue?` | Asks the AI and replies with an authentic audio voice note explanation |
| `@sam tts <text>` or `!tts` | `@sam tts Hello friends!` or reply to any message with `@sam tts` | Converts text or a quoted message into a real WhatsApp audio voice note |
| `@sam s` or `!s` | Send photo/GIF with caption `@sam s`, or reply to one with `@sam s` | Converts the photo or GIF into an animated/static WhatsApp sticker |
| `@sam summary` or `!summary` | `@sam summary` or `@sam tldr` | Generates a 3-5 bullet point summary of recent group chat |
| `@sam ping` or `!ping` | `@sam ping` | Checks bot status, connection latency, and stored memory count |
| `@sam clear` or `!clear` | `@sam clear` | Clears recent conversation memory for the current chat |
| `@sam help` or `!help` | `@sam help` | Displays the command menu |

---

## Development

- Start backend with auto-reload:
  ```bash
  npm run dev
  ```
- Start Vite frontend dev server with HMR:
  ```bash
  npm run dev:web
  ```
- Build Vite frontend for production:
  ```bash
  npm run build:web
  ```

---

## License

MIT
