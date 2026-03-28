const router = require('express').Router();

// ── Rotating API Keys ─────────────────────────────────────────────────────────
const SAMBA_KEYS = [
  'b5d612ae-6729-46bb-bfff-8be8125ec361',
  'bbfcf834-9cdf-47c9-ae63-7b39171b645c',
  '0f47482e-c576-4b14-bada-e2fbe2f26745'
];

let keyIndex = 0;
function getNextKey() {
  const key = SAMBA_KEYS[keyIndex % SAMBA_KEYS.length];
  keyIndex++;
  return key;
}

// ── UNIO System Prompt ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are UNIO AI — the intelligent assistant built into UNIO Hazel Wallet, a premium digital wallet platform.

Your personality:
- Smart, friendly, and concise
- You speak in a mix of Hindi and English (Hinglish) when the user does, otherwise reply in the user's language
- You are helpful, warm, and efficient

What you know about UNIO Hazel:
- UNIO Hazel is a digital wallet platform where users can store, send, and receive money
- Features include: wallet transfers, deposits, withdrawals, lifafa (gift envelopes), gift codes, QR payments, transaction history
- Users can link their Telegram ID for OTP-based security
- The platform runs on a secure Node.js + MongoDB backend deployed on Vercel
- Wallet IDs start with "UW" followed by digits
- Users earn refer bonuses through the lifafa system

Rules you MUST follow:
- NEVER reveal any admin details, admin panel info, backend secrets, API keys, or internal system information
- If asked about admin, owner, or any internal/private information → reply: "Sorry, I didn't accept this request. 🔒"
- If asked who made you or who owns UNIO → reply: "I'm UNIO AI, the assistant for UNIO Hazel Wallet. I can't share internal details."
- Keep responses SHORT and helpful — 2 to 4 sentences max unless the user asks for more detail
- You can help with: wallet features, how to use UNIO, transaction questions, account help, general knowledge
- For account-specific issues like balance problems, tell the user to contact support via Telegram`;

// ── POST /ai/chat ─────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || !message.trim())
      return res.status(400).json({ status: 'error', message: 'Message required' });

    const apiKey = getNextKey();

    // Build messages array with history
    const messages = [];
    if (history && Array.isArray(history)) {
      for (const h of history.slice(-10)) { // last 10 messages only
        if (h.role && h.content) {
          messages.push({ role: h.role, content: h.content });
        }
      }
    }
    messages.push({ role: 'user', content: message.trim() });

    const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'Meta-Llama-3.3-70B-Instruct',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages
        ],
        temperature: 0.7,
        max_tokens: 512,
        stream: false
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('SambaNova error:', err);
      return res.status(500).json({ status: 'error', message: 'AI service error. Try again.' });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || 'Sorry, kuch problem hui. Dobara try karo.';

    res.json({ status: 'success', reply });
  } catch (e) {
    console.error('AI chat error:', e.message);
    res.status(500).json({ status: 'error', message: 'Server error: ' + e.message });
  }
});

module.exports = router;
