const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const axios       = require('axios');

// Environment Variables or Defaults
const BOT_TOKEN   = process.env.BOT_TOKEN   || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '8509393869';

/**
 * Helper to send Telegram Messages
 */
async function sendTG(tg_id, text) {
  if (!tg_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id:    tg_id,
      text:       text,
      parse_mode: 'Markdown'
    }, { timeout: 8000 });
  } catch (e) {
    console.error('TG Error:', e.message);
  }
}

/**
 * Main Payment Processor
 */
async function processPayment(req, res, query) {
  try {
    const key     = query.key;
    const to      = query.to || query.paytm;
    const amount  = query.amount || query.amt;
    const comment = query.comment || '';
    const txn     = query.txn || '';

    // 1. Validation
    if (!key)    return res.json({ status: 'error', message: 'API key required' });
    if (!to)     return res.json({ status: 'error', message: 'Receiver number required (to or paytm)' });
    if (!amount) return res.json({ status: 'error', message: 'Amount required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1)
      return res.json({ status: 'error', message: 'Invalid amount. Minimum Rs.1' });

    // 2. Fetch Users
    const sender = await User.findOne({ api_key: key });
    if (!sender) return res.json({ status: 'error', message: 'Invalid API key' });

    const receiver = await User.findOne({ mobile: to });
    if (!receiver) return res.json({ status: 'error', message: 'Receiver ' + to + ' not found' });

    // 3. Duplicate Transaction Check
    if (txn) {
      const exists = await Transaction.findOne({ tx_id: txn });
      if (exists) return res.json({ status: 'error', message: 'Already Claimed! This Transaction ID is used.' });
    }

    // 4. Balance Check
    if (sender.balance < amt)
      return res.json({ status: 'error', message: 'Insufficient Balance' });

    // 5. Setup Transaction Data
    const txId = txn || ('UW' + Math.random().toString(36).substr(2, 4).toUpperCase());
    const now  = new Date();

    // Format IST Date for display
    const pad = n => String(n).padStart(2, '0');
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const timestamp = `${pad(ist.getDate())}-${pad(ist.getMonth() + 1)}-${ist.getFullYear()} ${pad(ist.getHours())}:${pad(ist.getMinutes())}:${pad(ist.getSeconds())}`;

    const dt = now.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
      year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });

    // 6. Execute Database Updates
    await User.findByIdAndUpdate(sender._id,   { $inc: { balance: -amt } });
    await User.findByIdAndUpdate(receiver._id, { $inc: { balance: +amt } });

    await Transaction.create({
      tx_id:       txId,
      sender_id:   sender._id,
      receiver_id: receiver._id,
      amount:      amt,
      type:        'api',
      status:      'success',
      remark:      comment || 'API Transfer',
      tx_time:     now
    });

    // 7. Send API Response
    res.json({
      status:  'success',
      message: 'Payment successful',
      data: {
        transaction_id: txId,
        amount:         amt,
        receiver: {
          name:   receiver.name,
          number: receiver.mobile
        },
        comment:   comment || '',
        timestamp: timestamp
      },
      note: '❤️ Thank you for using UNIO Hazel Wallet Gateway'
    });

    // 8. Fetch updated balances for notifications
    const sUpdated = await User.findById(sender._id).select('balance tg_id mobile name');
    const rUpdated = await User.findById(receiver._id).select('balance tg_id mobile name');

    // --- INSTANT NOTIFICATIONS ---

    // DEBIT ALERT (to Sender)
    if (sUpdated && sUpdated.tg_id) {
      sendTG(sUpdated.tg_id, 
`⚡ *DEBIT ALERT*

━━━━━━━━━━━━━━
⚡   UNIO WALLET ✅ ⚡
━━━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 Sent To : \`${to}\`
👤 Name : ${rUpdated.name || 'User'}
🆔 Txn ID : \`${txId}\`
📋 Type : API TRANSFER
💬 Comment : ${comment || '—'}
📅 Date : ${dt}

━━━━━━━━━━━━━━
🪙 Balance : ₹${sUpdated.balance}
━━━━━━━━━━━━━━

⚡ Amount Debited through UNIO Wallet`);
    }

    // CREDIT ALERT (to Receiver)
    if (rUpdated && rUpdated.tg_id) {
      sendTG(rUpdated.tg_id, 
`⚡ *CREDIT ALERT*

━━━━━━━━━━━━━━
⚡   UNIO WALLET ✅ ⚡
━━━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 From : \`${sUpdated.mobile}\`
👤 Name : ${sUpdated.name || 'User'}
🆔 Txn ID : \`${txId}\`
📋 Type : API TRANSFER
💬 Comment : ${comment || '—'}
📅 Date : ${dt}

━━━━━━━━━━━━━━
🪙 Balance : ₹${rUpdated.balance}
━━━━━━━━━━━━━━

⚡ Amount Credited through UNIO Wallet`);
    }

    // ADMIN ALERT
    if (ADMIN_TG_ID) {
      sendTG(ADMIN_TG_ID, 
`⚡ *API TRANSACTION*

💰 Amount : ₹${amt}
👤 From : ${sUpdated.name} (${sUpdated.mobile})
👤 To : ${rUpdated.name} (${to})
💬 Comment : ${comment || '—'}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}`);
    }

  } catch (e) {
    console.error('Payment error:', e.message);
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', message: e.message });
    }
  }
}

// Routes
router.get('/', (req, res) => processPayment(req, res, req.query));
router.get('/api-pay', (req, res) => processPayment(req, res, req.query));

// Balance Check
router.get('/balance', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.json({ status: 'error', message: 'key required' });
    const user = await User.findOne({ api_key: key });
    if (!user) return res.json({ status: 'error', message: 'Invalid API key' });
    res.json({ status: 'success', balance: user.balance, name: user.name });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// Verify Number
router.get('/verify', async (req, res) => {
  try {
    const { key, number, mobile } = req.query;
    if (!key) return res.json({ status: 'error', message: 'key required' });
    const sender = await User.findOne({ api_key: key });
    if (!sender) return res.json({ status: 'error', message: 'Invalid API key' });
    const mob = number || mobile;
    if (!mob) return res.json({ status: 'error', message: 'number required' });
    const user = await User.findOne({ mobile: mob });
    if (!user) return res.json({ status: 'error', message: 'User not found' });
    res.json({ status: 'success', name: user.name, number: user.mobile });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;

