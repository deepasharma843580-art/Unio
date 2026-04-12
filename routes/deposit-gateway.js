// routes/deposit-gateway.js
// ─────────────────────────────────────────────────────────────────
//  UNIO Deposit Gateway
//  1. Merchant → invoice create karo
//  2. Customer → payment page pe mobile + PIN se pay karo
//  3. UNIO → customer se merchant ko transfer + webhook
// ─────────────────────────────────────────────────────────────────

const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const axios       = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';

// ── Invoice store (in-memory) ─────────────────────────────────────────────────
// Production mein Invoice mongoose model bana sakte ho
const invoices = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────
function genId() {
  return 'INV-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2,4).toUpperCase();
}

function istTime() {
  return new Date().toLocaleString('en-IN', {
    timeZone:'Asia/Kolkata', day:'2-digit', month:'short',
    year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true
  });
}

async function sendTG(tg_id, text) {
  if (!tg_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id: tg_id, text, parse_mode: 'Markdown' }, { timeout: 8000 });
  } catch(e) {}
}

// ── Webhook sender ────────────────────────────────────────────────────────────
async function sendWebhook(callbackUrl, payload) {
  if (!callbackUrl) return;
  try {
    await axios.post(callbackUrl, payload, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'X-UNIO-Webhook': '1' }
    });
    console.log(`✅ Webhook sent to ${callbackUrl}`);
  } catch(e) {
    console.error(`❌ Webhook failed: ${callbackUrl} — ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. CREATE INVOICE ─────────────────────────────────────────────────────────
// GET /deposit-gateway/create?key=API_KEY&amount=100&callback_url=https://...&order_id=ORDER123
// Returns: { status, invoice_id, payment_url, amount, expires_at }
router.get('/create', async (req, res) => {
  try {
    const { key, amount, callback_url, order_id, note } = req.query;

    if (!key)    return res.json({ status:'error', message:'API key required' });
    if (!amount) return res.json({ status:'error', message:'Amount required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1)
      return res.json({ status:'error', message:'Invalid amount. Minimum ₹1' });

    // Merchant verify
    const merchant = await User.findOne({ api_key: key });
    if (!merchant) return res.json({ status:'error', message:'Invalid API key' });

    // Duplicate order check
    if (order_id) {
      for (const [, inv] of invoices) {
        if (inv.order_id === order_id && inv.merchant_id.toString() === merchant._id.toString()) {
          return res.json({ status:'error', message:'Order ID already exists' });
        }
      }
    }

    const invoice_id  = genId();
    const expires_at  = Date.now() + 30 * 60 * 1000; // 30 min expiry
    const payment_url = `${req.protocol}://${req.get('host')}/pay/${invoice_id}`;

    invoices.set(invoice_id, {
      invoice_id,
      merchant_id:   merchant._id,
      merchant_name: merchant.name,
      merchant_mobile: merchant.mobile,
      amount:        amt,
      callback_url:  callback_url || null,
      order_id:      order_id || null,
      note:          note || '',
      status:        'pending',  // pending | paid | expired
      created_at:    Date.now(),
      expires_at,
      paid_at:       null,
      tx_id:         null,
      payer_mobile:  null
    });

    // Auto-expire after 30 min
    setTimeout(() => {
      const inv = invoices.get(invoice_id);
      if (inv && inv.status === 'pending') {
        inv.status = 'expired';
        invoices.set(invoice_id, inv);
        // Webhook for expiry
        if (inv.callback_url) {
          sendWebhook(inv.callback_url, {
            event:      'invoice.expired',
            status:     'expired',
            invoice_id,
            order_id:   inv.order_id,
            amount:     inv.amount
          });
        }
      }
    }, 30 * 60 * 1000);

    res.json({
      status:      'success',
      invoice_id,
      payment_url,
      amount:      amt,
      merchant:    merchant.name,
      order_id:    order_id || null,
      expires_at:  new Date(expires_at).toISOString(),
      expires_in:  '30 minutes'
    });

  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── 2. GET INVOICE INFO (for payment page) ────────────────────────────────────
// GET /deposit-gateway/invoice/:id
router.get('/invoice/:id', async (req, res) => {
  try {
    const inv = invoices.get(req.params.id);
    if (!inv) return res.json({ status:'error', message:'Invoice not found' });

    if (inv.status === 'expired' || Date.now() > inv.expires_at)
      return res.json({ status:'error', message:'Invoice expired' });

    if (inv.status === 'paid')
      return res.json({ status:'error', message:'Invoice already paid' });

    res.json({
      status:        'success',
      invoice_id:    inv.invoice_id,
      merchant_name: inv.merchant_name,
      amount:        inv.amount,
      note:          inv.note,
      order_id:      inv.order_id,
      expires_at:    inv.expires_at
    });
  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── 3. PAY INVOICE (mobile + PIN) ─────────────────────────────────────────────
// POST /deposit-gateway/pay
// Body: { invoice_id, mobile, pin }
router.post('/pay', async (req, res) => {
  try {
    const { invoice_id, mobile, pin } = req.body;

    if (!invoice_id || !mobile || !pin)
      return res.status(400).json({ status:'error', message:'invoice_id, mobile aur PIN required' });

    const inv = invoices.get(invoice_id);
    if (!inv)                              return res.json({ status:'error', message:'Invoice nahi mila' });
    if (inv.status === 'paid')             return res.json({ status:'error', message:'Ye invoice pehle se pay ho chuka hai' });
    if (inv.status === 'expired' || Date.now() > inv.expires_at)
                                           return res.json({ status:'error', message:'Invoice expire ho gaya' });

    // Customer find + PIN verify
    const customer = await User.findOne({ mobile }).select('+pin');
    if (!customer) return res.json({ status:'error', message:'Mobile number registered nahi hai UNIO pe' });

    if (!customer.pin_set || customer.pin !== pin.toString())
      return res.json({ status:'error', message:'Wrong PIN' });

    // Self payment check
    if (customer._id.toString() === inv.merchant_id.toString())
      return res.json({ status:'error', message:'Apne aap ko pay nahi kar sakte' });

    // Balance check
    if (customer.balance < inv.amount)
      return res.json({ status:'error', message:`Insufficient balance. Available: ₹${customer.balance}` });

    // Merchant fetch
    const merchant = await User.findById(inv.merchant_id);
    if (!merchant) return res.json({ status:'error', message:'Merchant account nahi mila' });

    // Execute transfer
    const txId = 'UW' + String(Math.floor(10000 + Math.random() * 90000));
    const now  = new Date();

    await User.findByIdAndUpdate(customer._id,  { $inc: { balance: -inv.amount } });
    await User.findByIdAndUpdate(merchant._id,  { $inc: { balance: +inv.amount } });

    await Transaction.create({
      tx_id:       txId,
      sender_id:   customer._id,
      receiver_id: merchant._id,
      amount:      inv.amount,
      type:        'gateway',
      status:      'success',
      remark:      `Gateway Payment — ${inv.order_id || inv.invoice_id}`,
      tx_time:     now
    });

    // Mark invoice paid
    inv.status       = 'paid';
    inv.paid_at      = Date.now();
    inv.tx_id        = txId;
    inv.payer_mobile = mobile;
    invoices.set(invoice_id, inv);

    const dt = istTime();

    // TG — Customer debit
    const cUpdated = await User.findById(customer._id).select('tg_id balance');
    if (cUpdated?.tg_id) {
      sendTG(cUpdated.tg_id,
`⚡ *Payment Successful*

━━━━━━━━━━━━━
⚡ UNIO WALLET ✅
━━━━━━━━━━━━━

💰 Amount : ₹${inv.amount}
🏪 Merchant : ${merchant.name}
🆔 Txn ID : \`${txId}\`
📋 Invoice : \`${invoice_id}\`
📅 Date : ${dt}

━━━━━━━━━━━━━
🪙 Balance : ₹${cUpdated.balance}
━━━━━━━━━━━━━`);
    }

    // TG — Merchant credit
    const mUpdated = await User.findById(merchant._id).select('tg_id balance');
    if (mUpdated?.tg_id) {
      sendTG(mUpdated.tg_id,
`⚡ *Payment Received — Gateway*

━━━━━━━━━━━━━
⚡ UNIO WALLET ✅
━━━━━━━━━━━━━

💰 Amount : ₹${inv.amount}
👤 From : \`${mobile}\`
🆔 Txn ID : \`${txId}\`
📋 Order : \`${inv.order_id || invoice_id}\`
📅 Date : ${dt}

━━━━━━━━━━━━━
🪙 Balance : ₹${mUpdated.balance}
━━━━━━━━━━━━━`);
    }

    // Response to frontend
    res.json({
      status:     'success',
      message:    'Payment successful!',
      tx_id:      txId,
      amount:     inv.amount,
      invoice_id,
      order_id:   inv.order_id
    });

    // Webhook to merchant (async — response pehle ja chuka)
    if (inv.callback_url) {
      sendWebhook(inv.callback_url, {
        event:        'invoice.paid',
        status:       'success',
        invoice_id,
        order_id:     inv.order_id || null,
        tx_id:        txId,
        amount:       inv.amount,
        payer_mobile: mobile,
        merchant:     merchant.name,
        paid_at:      new Date(inv.paid_at).toISOString()
      });
    }

  } catch(e) {
    console.error('Pay error:', e.message);
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── 4. CHECK INVOICE STATUS ───────────────────────────────────────────────────
// GET /deposit-gateway/status/:id?key=API_KEY
router.get('/status/:id', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.json({ status:'error', message:'API key required' });

    const merchant = await User.findOne({ api_key: key });
    if (!merchant) return res.json({ status:'error', message:'Invalid API key' });

    const inv = invoices.get(req.params.id);
    if (!inv) return res.json({ status:'error', message:'Invoice not found' });

    if (inv.merchant_id.toString() !== merchant._id.toString())
      return res.status(403).json({ status:'error', message:'Unauthorized' });

    res.json({
      status:       'success',
      invoice_id:   inv.invoice_id,
      order_id:     inv.order_id,
      amount:       inv.amount,
      inv_status:   inv.status,
      tx_id:        inv.tx_id,
      payer_mobile: inv.payer_mobile,
      paid_at:      inv.paid_at ? new Date(inv.paid_at).toISOString() : null,
      expires_at:   new Date(inv.expires_at).toISOString()
    });
  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

module.exports = router;

