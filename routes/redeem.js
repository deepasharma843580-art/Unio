// routes/redeem.js
// ─────────────────────────────────────────────────────────────────
//  Redeem Code System
//
//  USER (API):
//    GET /redeem?key=API_KEY&type=google_play_10
//    → balance se price kata, code milta hai, DB se auto delete
//
//  ADMIN:
//    POST /redeem/admin/add          → codes add karo
//    GET  /redeem/admin/stock        → stock dekho
//    DELETE /redeem/admin/code/:id   → ek code delete karo
//    DELETE /redeem/admin/product    → ek product ke sare unsold codes delete
//
//  GIFTCODE ADMIN (weekly):
//    GET  /redeem/admin/giftcode/weeks       → weeks list with counts
//    DELETE /redeem/admin/giftcode/week      → week delete + refund
// ─────────────────────────────────────────────────────────────────

const router     = require('express').Router();
const User       = require('../models/User');
const Transaction= require('../models/Transaction');
const RedeemCode = require('../models/RedeemCode');
const GiftCode   = require('../models/GiftCode');
const axios      = require('axios');

const BOT_TOKEN    = process.env.BOT_TOKEN    || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG     = process.env.ADMIN_TG_ID  || '8509393869';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '8435';

// ── Helpers ───────────────────────────────────────────────────────────────────
async function sendTG(chat_id, text) {
  if (!chat_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id, text, parse_mode: 'Markdown' }, { timeout: 8000 });
  } catch(e) {}
}

function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || secret !== ADMIN_SECRET)
    return res.status(403).json({ status: 'error', message: 'Unauthorized' });
  next();
}

function istTime() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
  });
}

// Week range calculator (IST)
function getWeekRange(weekOffset = -1) {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay();
  const diffToMon = (day === 0) ? -6 : 1 - day;
  const monday = new Date(ist);
  monday.setUTCDate(ist.getUTCDate() + diffToMon);
  monday.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(monday.getTime() + weekOffset * 7 * 24 * 3600 * 1000);
  const weekEnd   = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000 - 1);
  const startUTC  = new Date(weekStart.getTime() - 5.5 * 60 * 60 * 1000);
  const endUTC    = new Date(weekEnd.getTime()   - 5.5 * 60 * 60 * 1000);
  const fmt = d => d.toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric' });
  return { start: startUTC, end: endUTC, label: `${fmt(startUTC)} → ${fmt(endUTC)}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — STOCK LIST (user side ke liye — count only, codes nahi)
// GET /redeem/stock
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stock', async (req, res) => {
  try {
    const stock = await RedeemCode.aggregate([
      { $match: { sold: false } },
      { $group: { _id: { product: '$product', label: '$label', price: '$price' }, count: { $sum: 1 } } },
      { $sort: { '_id.price': 1 } }
    ]);

    res.json({
      status: 'success',
      stock: stock.map(s => ({
        product: s._id.product,
        label:   s._id.label,
        price:   s._id.price,
        count:   s.count
      }))
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// USER — BUY CODE VIA API
// GET /redeem/buy?key=API_KEY&type=google_play_10
// ─────────────────────────────────────────────────────────────────────────────
router.get('/buy', async (req, res) => {
  try {
    const { key, type } = req.query;
    if (!key)  return res.json({ status: 'error', message: 'API key required' });
    if (!type) return res.json({ status: 'error', message: 'type required (e.g. google_play_10)' });

    // Verify user
    const user = await User.findOne({ api_key: key });
    if (!user) return res.json({ status: 'error', message: 'Invalid API key' });

    // Find one unsold code of this type
    const codeDoc = await RedeemCode.findOne({ product: type, sold: false });
    if (!codeDoc)
      return res.json({ status: 'error', message: `No codes available for: ${type}` });

    // Balance check
    if (user.balance < codeDoc.price)
      return res.json({ status: 'error', message: `Insufficient balance. Need ₹${codeDoc.price}, Available: ₹${user.balance}` });

    const txId        = 'RC' + Date.now() + Math.floor(Math.random() * 999);
    const now         = new Date();
    const deliveredCode  = codeDoc.code;
    const deliveredLabel = codeDoc.label;
    const deliveredPrice = codeDoc.price;

    // Deduct balance
    await User.findByIdAndUpdate(user._id, { $inc: { balance: -deliveredPrice } });

    // Transaction record
    await Transaction.create({
      tx_id:     txId,
      sender_id: user._id,
      amount:    deliveredPrice,
      type:      'redeem',
      status:    'success',
      remark:    `🎁 ${deliveredLabel} | Code: ${deliveredCode}`,
      tx_time:   now
    });

    // DELETE from DB (auto delete)
    await RedeemCode.findByIdAndDelete(codeDoc._id);

    const updatedUser = await User.findById(user._id).select('balance tg_id');

    // TG to user
    if (updatedUser?.tg_id) {
      sendTG(updatedUser.tg_id,
`🎁 *Redeem Code Purchased!*

━━━━━━━━━━━━
⚡  UNIO WALLET ✅
━━━━━━━━━━━━

🏷️ Product : ${codeDoc.label}
💰 Price : ₹${codeDoc.price}
🔑 Code : \`${deliveredCode}\`
🆔 Txn ID : \`${txId}\`
📅 Date : ${istTime()}

━━━━━━━━━━━━
🪙 Balance : ₹${updatedUser.balance}
━━━━━━━━━━━━`);
    }

    // TG to admin
    sendTG(ADMIN_TG,
`🛒 *Code Sold*

🏷️ Product : ${codeDoc.label}
👤 Buyer : ${user.name} (${user.mobile})
💰 Price : ₹${codeDoc.price}
📅 Date : ${istTime()}`);

    // Return code in response
    const pad = n => String(n).padStart(2, '0');
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const timestamp = `${pad(ist.getDate())}-${pad(ist.getMonth()+1)}-${ist.getFullYear()} ${pad(ist.getHours())}:${pad(ist.getMinutes())}:${pad(ist.getSeconds())}`;

    res.json({
      status:  'success',
      message: 'Code delivered successfully',
      data: {
        product:   deliveredLabel,
        price:     deliveredPrice,
        code:      deliveredCode,
        tx_id:     txId,
        balance:   updatedUser?.balance ?? null,
        timestamp: timestamp
      },
      note: '❤️ Thank you for using UNIO Hazel Wallet Gateway'
    });

  } catch(e) {
    console.error('Redeem buy error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — ADD CODES
// POST /redeem/admin/add
// Header: x-admin-secret: 8435
// Body: { product, label, price, codes: ['CODE1','CODE2'] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/add', adminAuth, async (req, res) => {
  try {
    const { product, label, price, codes } = req.body;
    if (!product || !label || !price || !codes || !codes.length)
      return res.status(400).json({ status: 'error', message: 'product, label, price, codes[] required' });

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 1)
      return res.status(400).json({ status: 'error', message: 'Valid price required' });

    const docs = codes
      .map(c => c.toString().trim())
      .filter(c => c.length > 0)
      .map(c => ({ product, label, price: priceNum, code: c, sold: false }));

    if (!docs.length)
      return res.status(400).json({ status: 'error', message: 'No valid codes found' });

    const inserted = await RedeemCode.insertMany(docs);

    sendTG(ADMIN_TG,
`➕ *Codes Added*

🏷️ Product : ${label}
💰 Price : ₹${priceNum}
📦 Count : ${inserted.length} codes
📅 Date : ${istTime()}`);

    res.json({ status: 'success', added: inserted.length, product, label, price: priceNum });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — STOCK
// GET /redeem/admin/stock
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/stock', adminAuth, async (req, res) => {
  try {
    const stock = await RedeemCode.aggregate([
      { $match: { sold: false } },
      { $group: { _id: { product: '$product', label: '$label', price: '$price' }, count: { $sum: 1 } } },
      { $sort: { '_id.product': 1 } }
    ]);

    const result = stock.map(s => ({
      product: s._id.product,
      label:   s._id.label,
      price:   s._id.price,
      count:   s.count
    }));

    res.json({ status: 'success', stock: result, total: result.reduce((a, s) => a + s.count, 0) });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — DELETE ONE CODE
// DELETE /redeem/admin/code/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/admin/code/:id', adminAuth, async (req, res) => {
  try {
    const doc = await RedeemCode.findByIdAndDelete(req.params.id);
    if (!doc) return res.json({ status: 'error', message: 'Code not found' });
    res.json({ status: 'success', message: 'Code deleted', product: doc.label });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — DELETE ALL UNSOLD OF A PRODUCT
// DELETE /redeem/admin/product?product=google_play_10
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/admin/product', adminAuth, async (req, res) => {
  try {
    const { product } = req.query;
    if (!product) return res.status(400).json({ status: 'error', message: 'product required' });
    const result = await RedeemCode.deleteMany({ product, sold: false });
    res.json({ status: 'success', deleted: result.deletedCount, product });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — GIFTCODE WEEKLY VIEW
// GET /redeem/admin/giftcode/weeks
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/giftcode/weeks', adminAuth, async (req, res) => {
  try {
    const oldest = await GiftCode.findOne().sort({ created_at: 1 }).select('created_at');
    if (!oldest) return res.json({ status: 'success', weeks: [] });

    const weeks = [];
    let offset  = -1;

    while (true) {
      const range = getWeekRange(offset);
      if (range.end < oldest.created_at) break;

      const codes = await GiftCode.find({
        created_at: { $gte: range.start, $lte: range.end }
      }).select('code total_users per_user_amount total_amount claimed_by active creator_name');

      // Total remaining fund = unclaimed slots * per_user_amount
      let totalRefund = 0;
      codes.forEach(g => {
        const unclaimed = g.total_users - g.claimed_by.length;
        if (unclaimed > 0) totalRefund += unclaimed * g.per_user_amount;
      });

      weeks.push({
        weekOffset: offset,
        label:      range.label,
        count:      codes.length,
        totalRefund: Math.round(totalRefund * 100) / 100
      });

      offset--;
      if (offset < -104) break;
    }

    res.json({ status: 'success', weeks });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — GIFTCODE WEEKLY DELETE + REFUND
// DELETE /redeem/admin/giftcode/week
// Body: { weekOffset: -1 }
// Unclaimed slots ka fund creator ko refund hoga
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/admin/giftcode/week', adminAuth, async (req, res) => {
  try {
    const weekOffset = parseInt(req.body.weekOffset ?? req.query.weekOffset ?? -1);
    if (weekOffset >= 0)
      return res.status(400).json({ status: 'error', message: 'weekOffset must be negative' });

    const range = getWeekRange(weekOffset);

    // Fetch all gift codes of this week
    const codes = await GiftCode.find({
      created_at: { $gte: range.start, $lte: range.end }
    });

    let totalDeleted = 0;
    let totalRefunded = 0;
    const refundLog = [];

    for (const gift of codes) {
      const unclaimed = gift.total_users - gift.claimed_by.length;

      if (unclaimed > 0 && gift.active) {
        const refundAmt = Math.round(unclaimed * gift.per_user_amount * 100) / 100;

        // Refund to creator
        await User.findByIdAndUpdate(gift.creator_id, { $inc: { balance: refundAmt } });

        // Refund transaction record
        const txId = 'GCR' + Date.now() + Math.floor(Math.random() * 999);
        await Transaction.create({
          tx_id:       txId,
          receiver_id: gift.creator_id,
          amount:      refundAmt,
          type:        'transfer',
          status:      'success',
          remark:      `Gift Code Refund: ${gift.code} (${unclaimed} unclaimed slots)`,
          tx_time:     new Date()
        });

        // TG notify creator
        const creator = await User.findById(gift.creator_id).select('tg_id balance');
        if (creator?.tg_id) {
          sendTG(creator.tg_id,
`💸 *Gift Code Refund*

━━━━━━━━━━━━
⚡  UNIO WALLET ✅
━━━━━━━━━━━━

🔑 Code : \`${gift.code}\`
👥 Unclaimed Slots : ${unclaimed}/${gift.total_users}
💰 Refund : ₹${refundAmt}
📅 Date : ${istTime()}

━━━━━━━━━━━━
🪙 Balance : ₹${(creator.balance || 0) + refundAmt}
━━━━━━━━━━━━`);
        }

        totalRefunded += refundAmt;
        refundLog.push({ code: gift.code, creator: gift.creator_name, refund: refundAmt });
      }

      totalDeleted++;
    }

    // Delete all gift codes of this week
    await GiftCode.deleteMany({ created_at: { $gte: range.start, $lte: range.end } });

    // Delete all related transactions (create + claim + refund) for these codes
    // Remark mein code name hota hai — sab match karke delete karo
    const codeNames = codes.map(g => g.code);
    let txDeleted = 0;
    if (codeNames.length > 0) {
      const txResult = await Transaction.deleteMany({
        remark: { $in: codeNames.map(c => new RegExp(c)) }
      });
      txDeleted = txResult.deletedCount;
    }

    // Admin TG
    sendTG(ADMIN_TG,
`🗑️ *Gift Codes Deleted*

📅 Week : ${range.label}
🗑️ Codes Deleted : ${totalDeleted}
📋 Transactions Deleted : ${txDeleted}
💸 Total Refunded : ₹${totalRefunded.toFixed(2)}
📅 Time : ${istTime()}`);

    res.json({
      status:              'success',
      deleted:             totalDeleted,
      transactions_deleted: txDeleted,
      total_refunded:      totalRefunded,
      week:                range.label,
      refund_log:          refundLog
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
  
