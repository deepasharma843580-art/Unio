const router = require('express').Router();

// ── Rotating API Keys ─────────────────────────────────────────────────────────
const SAMBA_KEYS = [
  '5f222533-ea2b-449c-aa2f-304ca5f289c0',
  '9bd02fdf-5ca7-4462-80a8-4808346a1fa1',
  '28659b10-27e7-4bd2-9b78-45e70f06575a'
];

let keyIndex = 0;
function getNextKey() {
  const key = SAMBA_KEYS[keyIndex % SAMBA_KEYS.length];
  keyIndex++;
  return key;
}

// ── Models to try (in order) ──────────────────────────────────────────────────
const MODELS = [
  'Meta-Llama-3.3-70B-Instruct',
  'Meta-Llama-3.1-8B-Instruct',
  'Qwen2.5-72B-Instruct',
  'Qwen2.5-Coder-32B-Instruct',
  'DeepSeek-R1-Distill-Llama-70B',
  'DeepSeek-V3-0324'
];

// ── UNIO System Prompt ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are UNIO AI — the intelligent assistant built into UNIO Hazel Wallet, a premium digital wallet platform.

Your personality:
- Smart, friendly, and concise
- You speak in a mix of Hindi and English (Hinglish) when the user does, otherwise reply in the user's language
- You are helpful, warm, and efficient

What you know about UNIO Hazel:
- UNIO Hazel is an independent private digital wallet platform where users can store, send, and receive money
- It is NOT affiliated with RBI or any government or financial authority — it is a self-contained internal platform
- Features include: wallet-to-wallet transfers (P2P), deposits via UPI, withdrawals to UPI ID, lifafa (gift envelopes), gift codes, QR payments, transaction history, bulk payments, payment gateway (collect payments via API)
- Users can link their Telegram ID for OTP-based login security and real-time transaction alerts
- The platform runs on a secure Node.js + MongoDB backend deployed on Vercel
- Wallet IDs start with "UW" followed by digits
- Users earn lots bonuses through the lifafa system
- Minimum withdrawal amount is ₹10
- Withdrawals are processed manually by admin within 48 hours
- Forgot password works via Telegram OTP verification

WITHDRAWAL & PAYMENT FEE POLICY (very important — answer accurately):
- There is ZERO fee, ZERO tax, and ZERO service charge on all withdrawals — you receive the full requested amount
- Wallet-to-wallet transfers (P2P) via UNIO are also completely free
- Payments collected via UNIO Payment Gateway are also zero fee
- UNIO Wallet does NOT deduct anything from withdrawals or wallet payments
- If anyone claims there is a fee, that information is outdated — current policy is Zero Fee

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

// ── Helper: call SambaNova with a specific model & key ────────────────────────
async function callSambaNova(messages, model, apiKey) {
  const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 512,
      stream: false
    })
  });

  return response;
}

// ── GET /ai?quest= ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const message = req.query.quest;
    if (!message || !message.trim())
      return res.status(400).json({ status: 'error', message: 'Query param "quest" is required. Usage: /ai?quest=your question' });

    const messages = [{ role: 'user', content: message.trim() }];

    let lastError = '';
    for (const model of MODELS) {
      const apiKey = getNextKey();
      try {
        console.log(`[GET] Trying model: ${model}`);
        const response = await callSambaNova(messages, model, apiKey);

        if (response.ok) {
          const data = await response.json();
          const reply = data?.choices?.[0]?.message?.content || 'Sorry, kuch problem hui. Dobara try karo.';
          console.log(`[GET] Success with model: ${model}`);
          return res.json({ status: 'success', reply, model });
        } else {
          const errText = await response.text();
          lastError = `${model} → HTTP ${response.status}: ${errText}`;
          console.error(`[GET] Failed model ${model}:`, lastError);
          continue;
        }
      } catch (fetchErr) {
        lastError = `${model} → ${fetchErr.message}`;
        console.error(`[GET] Fetch error for model ${model}:`, fetchErr.message);
        continue;
      }
    }

    return res.status(500).json({
      status: 'error',
      message: 'AI service temporarily unavailable. Thodi der baad try karo. 🙏'
    });

  } catch (e) {
    console.error('[GET] AI chat error:', e.message);
    res.status(500).json({ status: 'error', message: 'Server error: ' + e.message });
  }
});

// ── POST /ai/chat ─────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || !message.trim())
      return res.status(400).json({ status: 'error', message: 'Message required' });

    const messages = [];
    if (history && Array.isArray(history)) {
      for (const h of history.slice(-10)) {
        if (h.role && h.content) {
          messages.push({ role: h.role, content: h.content });
        }
      }
    }
    messages.push({ role: 'user', content: message.trim() });

    let lastError = '';
    for (const model of MODELS) {
      const apiKey = getNextKey();
      try {
        console.log(`Trying model: ${model}`);
        const response = await callSambaNova(messages, model, apiKey);

        if (response.ok) {
          const data = await response.json();
          const reply = data?.choices?.[0]?.message?.content || 'Sorry, kuch problem hui. Dobara try karo.';
          console.log(`Success with model: ${model}`);
          return res.json({ status: 'success', reply, model });
        } else {
          const errText = await response.text();
          lastError = `${model} → HTTP ${response.status}: ${errText}`;
          console.error(`Failed model ${model}:`, lastError);
          continue;
        }
      } catch (fetchErr) {
        lastError = `${model} → ${fetchErr.message}`;
        console.error(`Fetch error for model ${model}:`, fetchErr.message);
        continue;
      }
    }

    console.error('All models failed. Last error:', lastError);
    return res.status(500).json({
      status: 'error',
      message: 'AI service temporarily unavailable. Thodi der baad try karo. 🙏'
    });

  } catch (e) {
    console.error('AI chat error:', e.message);
    res.status(500).json({ status: 'error', message: 'Server error: ' + e.message });
  }
});

module.exports = router;
