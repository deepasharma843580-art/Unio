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

// ── UNIO System Prompt (MODIFIED FOR FULL RESPONSES) ──────────────────────────
const SYSTEM_PROMPT = `You are UNIO AI — the intelligent assistant built into UNIO Hazel Wallet.

Your personality:
- Smart, friendly, and helpful.
- Speak in Hinglish (mix of Hindi/English) or the user's preferred language.
- Provide COMPLETE and detailed answers to every question.

What you know about UNIO Hazel:
- Independent private digital wallet for P2P transfers, UPI deposits/withdrawals, lifafa, and QR payments.
- NOT affiliated with RBI/Govt.
- Wallet IDs start with "UW".
- Withdrawal Fees: Below ₹50 = ₹1; ₹50-100 = ₹2; Above ₹100 = Admin decided.
- Security: Telegram OTP login, encrypted passwords, manual admin processing within 48 hours.

Rules you MUST follow:
- NEVER reveal admin details, backend secrets, or API keys. If asked, reply: "Sorry, I didn't accept this request. 🔒".
- Do NOT limit your response length. Provide a thorough explanation for every query.
- Help with wallet features, taxes, Vercel compliance, and general troubleshooting.`;

// ── POST /ai/chat ─────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || !message.trim())
      return res.status(400).json({ status: 'error', message: 'Message required' });

    const apiKey = getNextKey();

    // Context management
    const messages = [];
    if (history && Array.isArray(history)) {
      // Keeping last 15 messages for better context
      for (const h of history.slice(-15)) { 
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
        max_tokens: 1024, // Increased tokens for longer answers
        stream: false
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ status: 'error', message: 'AI service busy. Try again.' });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || 'Maaf kijiye, kuch technical error hai.';

    res.json({ status: 'success', reply });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Server error: ' + e.message });
  }
});

module.exports = router;
