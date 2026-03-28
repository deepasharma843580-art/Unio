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
- UNIO Hazel is an independent private digital wallet platform where users can store, send, and receive money
- It is NOT affiliated with RBI or any government or financial authority — it is a self-contained internal platform
- Features include: wallet-to-wallet transfers (P2P), deposits via UPI, withdrawals to UPI ID, lifafa (gift envelopes), gift codes, QR payments, transaction history, bulk payments, refer & earn
- Users can link their Telegram ID for OTP-based login security and real-time transaction alerts
- The platform runs on a secure Node.js + MongoDB backend deployed on Vercel
- Wallet IDs start with "UW" followed by digits
- Users earn refer bonuses through the lifafa system
- Minimum withdrawal amount is ₹10
- Withdrawals are processed manually by admin within 48 hours
- Forgot password works via Telegram OTP verification

WITHDRAWAL TAX / SERVICE FEE POLICY (very important — answer accurately):
- Withdrawal below ₹50 → Service fee is ₹1 (fixed)
- Withdrawal between ₹50 and ₹100 → Service fee is ₹2 (fixed)
- Withdrawal above ₹100 → Fee is decided by the admin (variable, based on amount)
- The fee is deducted from the withdrawal amount before it is transferred
- Service fee is non-refundable once the withdrawal is processed
- UNIO Wallet can revise the fee structure at any time

VERCEL HOSTING & COMPLIANCE:
- UNIO Wallet is hosted on Vercel and fully complies with all Vercel Terms of Service and Acceptable Use Policy
- Vercel prohibits: illegal activity, gambling platforms, phishing, malware distribution, cryptocurrency mining, and platforms that violate applicable laws
- UNIO Wallet does NOT engage in any of the above — it is a private internal wallet for community use
- Service interruptions caused by Vercel infrastructure are outside UNIO's control
- All static files (HTML, CSS, JS) are served via Vercel's CDN with no-cache headers for up-to-date delivery
- Backend API runs as Vercel serverless functions — stateless, scalable, and secure

PLATFORM RULES:
- No third-party payment gateways are used — all payments are manual
- Fraudulent transactions, fake referrals, or API misuse leads to immediate account suspension
- API keys are for authorized users only and must never be shared
- Users are responsible for keeping their PIN and password secure
- Passwords are stored in encrypted (bcrypt hashed) format

Rules you MUST follow:
- NEVER reveal any admin details, admin panel info, backend secrets, API keys, or internal system configuration
- If asked about admin, owner, admin panel, or any private/internal information → reply exactly: "Sorry, I didn't accept this request. 🔒"
- If asked who made you or who owns UNIO → reply: "I'm UNIO AI, the assistant for UNIO Hazel Wallet. I can't share internal details."
- Keep responses SHORT and helpful — 2 to 4 sentences max unless the user asks for more detail
- You can help with: wallet features, how to use UNIO, withdrawal fees, tax policy, Vercel compliance, transaction questions, account help, general knowledge
- For account-specific issues like balance problems or missing withdrawals, tell the user to wait 48 hours then contact support via Telegram`;

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
