// routes/deposit-gateway.js
// ─────────────────────────────────────────────────────────────────
//  UNIO Deposit Gateway — MongoDB backed (Vercel safe)
//  1. Merchant → invoice create (GET /create)
//  2. Customer → invoice info   (GET /invoice/:id)
//  3. Customer → pay            (POST /pay)  mobile + PIN
//  4. Merchant → status check   (GET /status/:id)
// ─────────────────────────────────────────────────────────────────

const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const Invoice     = require('../models/Invoice');
const axios       = require('axios');

// ── CORS — every route pe preflight allow karo ───────────────────────────────
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const BOT_TOKEN = process.env.BOT_TOKEN || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';

// ── Helpers ───────────────────────────────────────────────────────────────────
function genId() {
  return 'INV-' + Date.now().toString(36).toUpperCase() +
         Math.random().toString(36).substr(2, 5).toUpperCase();
}

function istTime() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
}

async function sendTG(tg_id, text) {
  if (!tg_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id: tg_id, text, parse_mode: 'Markdown' }, { timeout: 8000 });
  } catch(e) {}
}

async function sendWebhook(url, payload) {
  if (!url) return;
  try {
    await axios.post(url, payload, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'X-UNIO-Webhook': '1' }
    });
  } catch(e) { console.error('Webhook failed:', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CREATE INVOICE
// GET /deposit-gateway/create?key=API_KEY&amount=100&callback_url=https://...&order_id=ORDER123&note=...
// ─────────────────────────────────────────────────────────────────────────────
router.get('/create', async (req, res) => {
  try {
    const { key, amount, callback_url, order_id, note } = req.query;

    if (!key)    return res.json({ status: 'error', message: 'API key required' });
    if (!amount) return res.json({ status: 'error', message: 'Amount required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1)
      return res.json({ status: 'error', message: 'Invalid amount. Minimum ₹1' });

    const merchant = await User.findOne({ api_key: key });
    if (!merchant) return res.json({ status: 'error', message: 'Invalid API key' });

    // Duplicate order_id check
    if (order_id) {
      const exists = await Invoice.findOne({ order_id, merchant_id: merchant._id, status: 'pending' });
      if (exists) return res.json({ status: 'error', message: 'Order ID already exists with a pending invoice' });
    }

    const invoice_id = genId();
    const expires_at = new Date(Date.now() + 30 * 60 * 1000); // 30 min
    const host        = req.headers.host || 'unio-hazel.vercel.app';
    const proto       = host.includes('localhost') ? 'http' : 'https';
    const payment_url = `${proto}://${host}/pay/${invoice_id}`;

    await Invoice.create({
      invoice_id,
      merchant_id:     merchant._id,
      merchant_name:   merchant.name,
      merchant_mobile: merchant.mobile,
      amount:          amt,
      callback_url:    callback_url || null,
      order_id:        order_id     || null,
      note:            note         || '',
      status:          'pending',
      expires_at
    });

    res.json({
      status:      'success',
      invoice_id,
      payment_url,
      amount:      amt,
      merchant:    merchant.name,
      order_id:    order_id || null,
      expires_at:  expires_at.toISOString(),
      expires_in:  '30 minutes'
    });

  } catch(e) {
    console.error('Create error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET INVOICE INFO (payment page fetch karta hai)
// GET /deposit-gateway/invoice/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/invoice/:id', async (req, res) => {
  try {
    const inv = await Invoice.findOne({ invoice_id: req.params.id });
    if (!inv) return res.json({ status: 'error', message: 'Invoice not found' });

    if (inv.status === 'paid')
      return res.json({ status: 'error', message: 'Invoice already paid' });

    if (inv.status === 'expired' || inv.expires_at < new Date())
      return res.json({ status: 'error', message: 'Invoice expired' });

    res.json({
      status:        'success',
      invoice_id:    inv.invoice_id,
      merchant_name: inv.merchant_name,
      amount:        inv.amount,
      note:          inv.note,
      order_id:      inv.order_id,
      expires_at:    inv.expires_at.toISOString()
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. PAY INVOICE
// POST /deposit-gateway/pay
// Body: { invoice_id, mobile, pin }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/pay', async (req, res) => {
  try {
    const { invoice_id, mobile, pin, password } = req.body;

    if (!invoice_id || !mobile || !pin || !password)
      return res.status(400).json({ status: 'error', message: 'invoice_id, mobile, PIN aur password required hai' });

    // Fetch invoice
    const inv = await Invoice.findOne({ invoice_id });
    if (!inv)
      return res.json({ status: 'error', message: 'Invoice nahi mila' });
    if (inv.status === 'paid')
      return res.json({ status: 'error', message: 'Ye invoice pehle se pay ho chuka hai' });
    if (inv.status === 'expired' || inv.expires_at < new Date())
      return res.json({ status: 'error', message: 'Invoice expire ho gaya hai' });

    // Customer find — PIN select karo
    const customer = await User.findOne({ mobile: mobile.toString() }).select('+pin +pin_set +password +balance +tg_id +name');
    if (!customer)
      return res.json({ status: 'error', message: 'Ye mobile UNIO pe registered nahi hai' });

    // PIN verify — plain string compare (same as verify-pin route)
    if (!customer.pin_set)
      return res.json({ status: 'error', message: 'Customer ka PIN set nahi hai' });

    if (customer.pin !== pin.toString())
      return res.json({ status: 'error', message: 'Wrong PIN' });

    // Password verify
    const passMatch = await customer.matchPassword(password);
    if (!passMatch)
      return res.json({ status: 'error', message: 'Wrong password' });

    // Self payment block
    if (customer._id.toString() === inv.merchant_id.toString())
      return res.json({ status: 'error', message: 'Apne aap ko pay nahi kar sakte' });

    // Balance check
    if (customer.balance < inv.amount)
      return res.json({ status: 'error', message: `Insufficient balance. Available: ₹${customer.balance}` });

    // Merchant fetch
    const merchant = await User.findById(inv.merchant_id).select('+tg_id +balance +name +mobile');
    if (!merchant)
      return res.json({ status: 'error', message: 'Merchant account nahi mila' });

    // Execute transfer
    const txId = 'UW' + String(Math.floor(10000 + Math.random() * 90000));
    const now  = new Date();

    await User.findByIdAndUpdate(customer._id, { $inc: { balance: -inv.amount } });
    await User.findByIdAndUpdate(merchant._id, { $inc: { balance: +inv.amount } });

    await Transaction.create({
      tx_id:       txId,
      sender_id:   customer._id,
      receiver_id: merchant._id,
      amount:      inv.amount,
      type:        'gateway',
      status:      'success',
      remark:      `Gateway | ${inv.order_id || inv.invoice_id}`,
      tx_time:     now
    });

    // Mark invoice paid
    await Invoice.findOneAndUpdate({ invoice_id }, {
      status:      'paid',
      paid_at:     now,
      tx_id:       txId,
      payer_mobile: mobile.toString()
    });

    const dt = istTime();

    // Updated balances
    const cNew = await User.findById(customer._id).select('balance tg_id');
    const mNew = await User.findById(merchant._id).select('balance tg_id');

    // TG — Customer debit
    if (cNew?.tg_id) {
      sendTG(cNew.tg_id,
`⚡ *Payment Successful*

━━━━━━━━━━━━━━
⚡  UNIO WALLET ✅
━━━━━━━━━━━━━━

💰 Amount : ₹${inv.amount}
🏪 Merchant : ${merchant.name}
🆔 Txn ID : \`${txId}\`
📋 Invoice : \`${invoice_id}\`
📅 Date : ${dt}

━━━━━━━━━━━━━━
🪙 Balance : ₹${cNew.balance}
━━━━━━━━━━━━━━

⚡ UNIO Gateway Payment`);
    }

    // TG — Merchant credit
    if (mNew?.tg_id) {
      sendTG(mNew.tg_id,
`⚡ *Payment Received*

━━━━━━━━━━━━━━
⚡  UNIO WALLET ✅
━━━━━━━━━━━━━━

💰 Amount : ₹${inv.amount}
👤 From : \`${mobile}\`
🆔 Txn ID : \`${txId}\`
📋 Order : \`${inv.order_id || invoice_id}\`
📅 Date : ${dt}

━━━━━━━━━━━━━━
🪙 Balance : ₹${mNew.balance}
━━━━━━━━━━━━━━

⚡ UNIO Gateway`);
    }

    // Send response first
    res.json({
      status:     'success',
      message:    'Payment successful!',
      tx_id:      txId,
      amount:     inv.amount,
      invoice_id,
      order_id:   inv.order_id
    });

    // Webhook (after response)
    if (inv.callback_url) {
      sendWebhook(inv.callback_url, {
        event:        'invoice.paid',
        status:       'success',
        invoice_id,
        order_id:     inv.order_id || null,
        tx_id:        txId,
        amount:       inv.amount,
        payer_mobile: mobile.toString(),
        merchant:     merchant.name,
        paid_at:      now.toISOString()
      });
    }

  } catch(e) {
    console.error('Pay error:', e.message);
    if (!res.headersSent)
      res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. STATUS CHECK (merchant ke liye)
// GET /deposit-gateway/status/:id?key=API_KEY
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status/:id', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.json({ status: 'error', message: 'API key required' });

    const merchant = await User.findOne({ api_key: key });
    if (!merchant)  return res.json({ status: 'error', message: 'Invalid API key' });

    const inv = await Invoice.findOne({ invoice_id: req.params.id });
    if (!inv)       return res.json({ status: 'error', message: 'Invoice not found' });

    if (inv.merchant_id.toString() !== merchant._id.toString())
      return res.status(403).json({ status: 'error', message: 'Unauthorized' });

    res.json({
      status:       'success',
      invoice_id:   inv.invoice_id,
      order_id:     inv.order_id,
      amount:       inv.amount,
      inv_status:   inv.status,
      tx_id:        inv.tx_id,
      payer_mobile: inv.payer_mobile,
      paid_at:      inv.paid_at   ? inv.paid_at.toISOString()   : null,
      expires_at:   inv.expires_at ? inv.expires_at.toISOString() : null
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;


        
