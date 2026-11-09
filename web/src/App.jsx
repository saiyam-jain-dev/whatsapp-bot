import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  MessageSquare,
  QrCode,
  Sparkles,
  Terminal,
  Activity,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  Users,
  Bot,
  Zap,
  Trash2
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('connection');
  const [status, setStatus] = useState({
    status: 'disconnected',
    qr: null,
    user: null,
    uptimeSeconds: 0
  });
  const [config, setConfig] = useState({
    botName: 'Buddy',
    prefix: '!',
    contextLimit: 15,
    hasGroqKey: false,
    hasGeminiKey: false
  });
  const [memoryChats, setMemoryChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [playgroundInput, setPlaygroundInput] = useState('');
  const [playgroundMessages, setPlaygroundMessages] = useState([
    { role: 'bot', text: 'Hey there! Type a message below to test how I answer before using me in WhatsApp.' }
  ]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Poll status and memory every 3 seconds
  useEffect(() => {
    fetchStatus();
    fetchConfig();
    fetchMemory();

    const interval = setInterval(() => {
      fetchStatus();
      fetchMemory();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setLastUpdated(new Date());
      }
    } catch {
      // API not up yet
    }
  }

  async function fetchConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch {
      // ignore
    }
  }

  async function fetchMemory() {
    try {
      const res = await fetch('/api/memory');
      if (res.ok) {
        const data = await res.json();
        setMemoryChats(data.chats || []);
        if (data.chats?.length > 0 && !selectedChat) {
          setSelectedChat(data.chats[0]);
        }
      }
    } catch {
      // ignore
    }
  }

  async function handlePlaygroundSubmit(e) {
    e.preventDefault();
    if (!playgroundInput.trim() || isAiLoading) return;

    const userText = playgroundInput.trim();
    setPlaygroundMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setPlaygroundInput('');
    setIsAiLoading(true);

    try {
      const res = await fetch('/api/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userText })
      });
      const data = await res.json();
      if (data.reply) {
        setPlaygroundMessages((prev) => [...prev, { role: 'bot', text: data.reply }]);
      } else {
        setPlaygroundMessages((prev) => [
          ...prev,
          { role: 'bot', text: data.error || 'No reply received. Verify your API key in .env' }
        ]);
      }
    } catch (err) {
      setPlaygroundMessages((prev) => [
        ...prev,
        { role: 'bot', text: 'Error connecting to API server: ' + err.message }
      ]);
    } finally {
      setIsAiLoading(false);
    }
  }

  const formatUptime = (seconds) => {
    if (!seconds) return '0s';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navbar */}
      <header
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              backgroundColor: 'var(--accent-green)',
              color: '#fff',
              padding: '8px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Bot size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '18px', fontWeight: '700' }}>{config.botName}</h1>
              <span
                style={{
                  fontSize: '11px',
                  backgroundColor: 'var(--bg-card)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)'
                }}
              >
                Prefix: {config.prefix}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Personal WhatsApp Assistant (Groq Llama 3.3 70B & Baileys)
            </p>
          </div>
        </div>

        {/* Status pill & stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'var(--bg-card)',
              padding: '6px 14px',
              borderRadius: '20px',
              border: '1px solid var(--border-color)',
              fontSize: '13px'
            }}
          >
            {status.status === 'connected' && (
              <>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--accent-green)'
                  }}
                />
                <span style={{ color: 'var(--accent-green)', fontWeight: '600' }}>Connected</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  ({status.user?.name || status.user?.id?.split(':')[0] || 'Active'})
                </span>
              </>
            )}
            {status.status === 'qr_ready' && (
              <>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: '#eab308'
                  }}
                />
                <span style={{ color: '#eab308', fontWeight: '600' }}>QR Code Ready</span>
              </>
            )}
            {status.status === 'disconnected' && (
              <>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--danger)'
                  }}
                />
                <span style={{ color: 'var(--danger)', fontWeight: '600' }}>Offline / Connecting</span>
              </>
            )}
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Uptime: <strong style={{ color: 'var(--text-main)' }}>{formatUptime(status.uptimeSeconds)}</strong>
          </div>
        </div>
      </header>

      {/* Main Tab Bar */}
      <nav
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          padding: '0 24px',
          display: 'flex',
          gap: '8px'
        }}
      >
        {[
          { id: 'connection', label: 'Device Pairing', icon: QrCode },
          { id: 'memory', label: 'Group Context', icon: Users, badge: memoryChats.length },
          { id: 'playground', label: 'AI Playground', icon: Sparkles },
          { id: 'commands', label: 'Command Reference', icon: Terminal }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 16px',
                backgroundColor: 'transparent',
                color: isActive ? 'var(--accent-green)' : 'var(--text-muted)',
                borderBottom: isActive ? '2px solid var(--accent-green)' : '2px solid transparent',
                fontWeight: isActive ? '600' : '400',
                fontSize: '14px'
              }}
            >
              <Icon size={16} />
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span
                  style={{
                    fontSize: '11px',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    backgroundColor: isActive ? 'var(--accent-green)' : 'var(--border-color)',
                    color: isActive ? '#fff' : 'var(--text-muted)'
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Main View Area */}
      <main style={{ flex: 1, padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        {/* TAB 1: Device Pairing */}
        {activeTab === 'connection' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
            {/* QR Card */}
            <div
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '24px',
                textAlign: 'center'
              }}
            >
              <h2 style={{ fontSize: '18px', marginBottom: '8px' }}>Scan QR Code to Link</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
                Open WhatsApp on your phone and link this device
              </p>

              {status.status === 'qr_ready' && status.qr ? (
                <div
                  style={{
                    display: 'inline-block',
                    padding: '16px',
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                    marginBottom: '20px'
                  }}
                >
                  <QRCodeSVG value={status.qr} size={240} level="M" />
                </div>
              ) : status.status === 'connected' ? (
                <div
                  style={{
                    padding: '36px 16px',
                    backgroundColor: 'rgba(0, 168, 132, 0.1)',
                    borderRadius: '12px',
                    border: '1px solid var(--accent-green)',
                    marginBottom: '20px'
                  }}
                >
                  <CheckCircle2 size={56} color="var(--accent-green)" style={{ margin: '0 auto 12px' }} />
                  <h3 style={{ color: 'var(--accent-green)', fontSize: '18px' }}>Linked & Active!</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
                    Connected as {status.user?.name || status.user?.id || 'Primary Device'}
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    padding: '36px 16px',
                    backgroundColor: 'var(--bg-card)',
                    borderRadius: '12px',
                    marginBottom: '20px'
                  }}
                >
                  <RefreshCw size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px', animation: 'spin 2s linear infinite' }} />
                  <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                    Waiting for WhatsApp socket or QR update...
                  </p>
                </div>
              )}

              <div
                style={{
                  textAlign: 'left',
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: '8px',
                  padding: '16px',
                  fontSize: '13px',
                  lineHeight: '1.8'
                }}
              >
                <div style={{ fontWeight: '600', marginBottom: '6px', color: 'var(--text-main)' }}>
                  How to link:
                </div>
                <div>1. Open <strong>WhatsApp</strong> on your mobile phone</div>
                <div>2. Tap <strong>Settings</strong> or <strong>Three Dots</strong> &gt; <strong>Linked Devices</strong></div>
                <div>3. Tap <strong>Link a Device</strong> and point camera at the QR code above</div>
                <div>4. Session saves to <code>auth_session/</code> so you only scan once!</div>
              </div>
            </div>

            {/* Status & Config Card */}
            <div
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}
            >
              <h2 style={{ fontSize: '18px' }}>Bot System Status</h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ backgroundColor: 'var(--bg-card)', padding: '14px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Status</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', textTransform: 'capitalize', marginTop: '4px' }}>
                    {status.status}
                  </div>
                </div>

                <div style={{ backgroundColor: 'var(--bg-card)', padding: '14px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>AI Provider</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--accent-green)', marginTop: '4px' }}>
                    {config.hasGroqKey ? 'Groq (Llama 3.3)' : config.hasGeminiKey ? 'Gemini 1.5' : 'Missing API Key'}
                  </div>
                </div>

                <div style={{ backgroundColor: 'var(--bg-card)', padding: '14px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Memory Limit</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '4px' }}>
                    {config.contextLimit} msgs / chat
                  </div>
                </div>

                <div style={{ backgroundColor: 'var(--bg-card)', padding: '14px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Active Chats</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '4px' }}>
                    {memoryChats.length} recorded
                  </div>
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: '8px',
                  padding: '16px',
                  fontSize: '13px',
                  borderLeft: '4px solid var(--accent-green)'
                }}
              >
                <div style={{ fontWeight: '600', color: 'var(--text-main)', marginBottom: '4px' }}>
                  Anti-Ban Heuristic Safety
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  Human typing simulation is enabled (1.0 to 2.5 second randomized typing delay). Group silent listening prevents unsolicited spam.
                </div>
              </div>

              <button
                onClick={() => {
                  fetchStatus();
                  fetchMemory();
                }}
                style={{
                  marginTop: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-color)',
                  padding: '12px',
                  borderRadius: '8px',
                  fontSize: '14px'
                }}
              >
                <RefreshCw size={16} />
                Refresh State
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: Group Context & Memory */}
        {activeTab === 'memory' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '300px 1fr',
              gap: '20px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              minHeight: '520px',
              overflow: 'hidden'
            }}
          >
            {/* Chat List Sidebar */}
            <div style={{ borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', fontWeight: '600' }}>
                Recorded Conversations ({memoryChats.length})
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {memoryChats.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                    No messages recorded yet. Start chatting in your WhatsApp groups or DMs!
                  </div>
                ) : (
                  memoryChats.map((chat) => (
                    <div
                      key={chat.jid}
                      onClick={() => setSelectedChat(chat)}
                      style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid var(--border-color)',
                        cursor: 'pointer',
                        backgroundColor: selectedChat?.jid === chat.jid ? 'var(--bg-card)' : 'transparent',
                        transition: 'background-color 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: '600', fontSize: '14px' }}>
                          {chat.isGroup ? '👥 Group Chat' : '👤 Direct Message'}
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {chat.messageCount} msgs
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-muted)',
                          marginTop: '4px',
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {chat.lastMessage ? `${chat.lastMessage.sender}: ${chat.lastMessage.text}` : chat.jid}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Conversation Window */}
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {selectedChat ? (
                <>
                  <div
                    style={{
                      padding: '16px',
                      borderBottom: '1px solid var(--border-color)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: '600' }}>{selectedChat.jid}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Sliding window history ({selectedChat.messages?.length || 0} messages)
                      </div>
                    </div>
                  </div>

                  <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedChat.messages?.map((msg, i) => (
                      <div
                        key={i}
                        style={{
                          alignSelf: msg.isBot ? 'flex-end' : 'flex-start',
                          maxWidth: '75%',
                          backgroundColor: msg.isBot ? 'var(--accent-green)' : 'var(--bg-card)',
                          color: msg.isBot ? '#ffffff' : 'var(--text-main)',
                          padding: '10px 14px',
                          borderRadius: '10px',
                          fontSize: '13px'
                        }}
                      >
                        <div style={{ fontSize: '11px', opacity: 0.8, marginBottom: '2px', fontWeight: '600' }}>
                          {msg.sender}
                        </div>
                        <div>{msg.text}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Select a chat on the left to inspect its rolling context
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: AI Playground */}
        {activeTab === 'playground' && (
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              minHeight: '520px',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: '600' }}>AI Assistant Playground</h2>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Test {config.botName}'s answers, tone, and humor using your configured LLM
                </p>
              </div>
              <button
                onClick={() => setPlaygroundMessages([])}
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px'
                }}
              >
                <Trash2 size={14} /> Clear
              </button>
            </div>

            {/* Chat message stream */}
            <div
              style={{
                flex: 1,
                padding: '20px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxHeight: '420px'
              }}
            >
              {playgroundMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '80%',
                    backgroundColor: msg.role === 'user' ? 'var(--accent-green)' : 'var(--bg-card)',
                    color: msg.role === 'user' ? '#ffffff' : 'var(--text-main)',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    fontSize: '14px',
                    lineHeight: '1.5'
                  }}
                >
                  <div style={{ fontSize: '11px', opacity: 0.8, marginBottom: '4px', fontWeight: '600' }}>
                    {msg.role === 'user' ? 'You' : config.botName}
                  </div>
                  <div>{msg.text}</div>
                </div>
              ))}
              {isAiLoading && (
                <div
                  style={{
                    alignSelf: 'flex-start',
                    backgroundColor: 'var(--bg-card)',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    fontSize: '13px',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Sparkles size={16} color="var(--accent-green)" />
                  {config.botName} is typing...
                </div>
              )}
            </div>

            {/* Chat Input */}
            <form
              onSubmit={handlePlaygroundSubmit}
              style={{
                padding: '16px 20px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                gap: '12px'
              }}
            >
              <input
                type="text"
                placeholder={`Ask ${config.botName} something (e.g. "plan a Goa trip with friends")...`}
                value={playgroundInput}
                onChange={(e) => setPlaygroundInput(e.target.value)}
                style={{
                  flex: 1,
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  fontSize: '14px'
                }}
              />
              <button
                type="submit"
                disabled={isAiLoading || !playgroundInput.trim()}
                style={{
                  backgroundColor: 'var(--accent-green)',
                  color: '#ffffff',
                  padding: '12px 20px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: '600',
                  opacity: isAiLoading || !playgroundInput.trim() ? 0.5 : 1
                }}
              >
                <Send size={16} /> Send
              </button>
            </form>
          </div>
        )}

        {/* TAB 4: Command Reference */}
        {activeTab === 'commands' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {[
              {
                cmd: `${config.prefix}ai <prompt>`,
                title: 'Direct AI Prompt',
                desc: 'Ask the bot a question directly or prompt it for information, recipes, code, or ideas.'
              },
              {
                cmd: `${config.prefix}s or ${config.prefix}sticker`,
                title: 'Sticker Generator',
                desc: 'Send an image with this caption, or reply to any photo with !s to instantly turn it into a 512x512 WhatsApp sticker.'
              },
              {
                cmd: `${config.prefix}summary or ${config.prefix}tldr`,
                title: 'Group Chat Catch-Up',
                desc: 'Reads the rolling memory of recent group messages and produces a crisp 3 to 5 bullet summary.'
              },
              {
                cmd: `${config.prefix}ping`,
                title: 'Health Check',
                desc: 'Returns online status, WebSocket round-trip latency, and current context message count.'
              },
              {
                cmd: `${config.prefix}clear`,
                title: 'Reset Memory',
                desc: 'Clears the recorded conversation history for the current group or direct chat.'
              },
              {
                cmd: `${config.prefix}help`,
                title: 'Menu / Help',
                desc: 'Prints the formatted command menu and tips for friend group chats.'
              }
            ].map((card, i) => (
              <div
                key={i}
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '20px'
                }}
              >
                <code
                  style={{
                    backgroundColor: 'rgba(0, 168, 132, 0.15)',
                    color: 'var(--accent-green)',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '600'
                  }}
                >
                  {card.cmd}
                </code>
                <h3 style={{ fontSize: '16px', margin: '12px 0 6px', fontWeight: '600' }}>{card.title}</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>{card.desc}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
