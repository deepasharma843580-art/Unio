// routes/ulite.js
// ─────────────────────────────────────────────────────────────────
//  UNIO Lite (ULite) — Separate mini-wallet inside main account
//  - Main wallet → ULite (add)
//  - ULite → any mobile number (transfer, auto name fetch)
//  - ULite → Main wallet (withdraw)
//  - Full transaction history
//  - Admin: delete weekly transactions + send JSON to admin TG
// ─────────────────────────────────────────────────────────────────

const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN    = process.env.BOT_TOKEN    || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG     = process.env.ADMIN_TG_ID  || '8509393869';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '8435';

// ── Helpers ───────────────────────────────────────────────────────────────────
async function sendTG(chat_id, text, opts = {}) {
  if (!chat_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id, text, parse_mode: 'Markdown', ...opts }, { timeout: 8000 });
  } catch(e) { console.error('TG error:', e.message); }
}

async function sendTGDocument(chat_id, filename, jsonData) {
  try {
    const FormData = require('form-data');
    const form     = new FormData();
    const buf      = Buffer.from(JSON.stringify(jsonData, null, 2), 'utf8');
    form.append('chat_id', chat_id.toString());
    form.append('document', buf, { filename, contentType: 'application/json' });
    form.append('caption', `📋 ULite Transactions Export\n📅 ${filename}`);
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form,
      { headers: form.getHeaders(), timeout: 30000 });
  } catch(e) { console.error('TG doc error:', e.message); }
}

function adminAuth(req, res, next) {
  const s = req.headers['x-admin-secret'] || req.query.secret;
  if (!s || s !== ADMIN_SECRET)
    return res.status(403).json({ status: 'error', message: 'Unauthorized' });
  next();
}

function istTime(d = new Date()) {
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
}

function genTxId(prefix = 'UL') {
  return prefix + Date.now() + Math.floor(Math.random() * 9999);
}

function getWeekRange(offset = -1) {
  const now = new Date(), ist = new Date(now.getTime() + 5.5*60*60*1000);
  const day = ist.getUTCDay(), diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(ist); mon.setUTCDate(ist.getUTCDate() + diff); mon.setUTCHours(0,0,0,0);
  const ws  = new Date(mon.getTime() + offset*7*24*3600*1000);
  const we  = new Date(ws.getTime() + 7*24*3600*1000 - 1);
  const su  = new Date(ws.getTime() - 5.5*60*60*1000);
  const eu  = new Date(we.getTime() - 5.5*60*60*1000);
  const fmt = d => d.toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric' });
  return { start: su, end: eu, label: `${fmt(su)} → ${fmt(eu)}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /ulite/balance — ULite balance + main wallet
// ─────────────────────────────────────────────────────────────────────────────
router.get('/balance', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('name mobile balance ulite_balance');
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
    res.json({
      status:          'success',
      name:            user.name,
      mobile:          user.mobile,
      wallet_balance:  user.balance        || 0,
      ulite_balance:   user.ulite_balance  || 0
    });
  } catch(e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /ulite/lookup/:mobile — auto name fetch
// ─────────────────────────────────────────────────────────────────────────────
router.get('/lookup/:mobile', auth, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.params.mobile }).select('name mobile');
    if (!user) return res.json({ status: 'error', message: 'User not found' });
    res.json({ status: 'success', name: user.name, mobile: user.mobile });
  } catch(e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /ulite/add — Main wallet → ULite
// Body: { amount, pin }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/add', auth, async (req, res) => {
  try {
    const { amount, pin } = req.body;
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1) return res.status(400).json({ status: 'error', message: 'Minimum ₹1' });

    const user = await User.findById(req.user._id).select('+pin name mobile balance ulite_balance tg_id');
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    if (user.pin !== String(pin)) return res.json({ status: 'error', message: 'Wrong PIN' });
    if (user.balance < amt) return res.json({ status: 'error', message: `Insufficient wallet balance. Available: ₹${user.balance}` });

    const now  = new Date();
    const txId = genTxId('ULA');

    await User.findByIdAndUpdate(req.user._id, {
      $inc: { balance: -amt, ulite_balance: amt }
    });

    await Transaction.create({
      tx_id:     txId,
      sender_id: req.user._id,
      amount:    amt,
      type:      'ulite_add',
      status:    'success',
      remark:    '💙 Added to ULite',
      tx_time:   now
    });

    const updUser = await User.findById(req.user._id).select('balance ulite_balance tg_id');

    if (updUser?.tg_id) {
      sendTG(updUser.tg_id,
`💙 *ULite — Fund Added*

━━━━━━━━━━━━
💙 UNIO LITE ✅
━━━━━━━━━━━━

💰 Added : ₹${amt}
🆔 Txn ID : \`${txId}\`
📅 Date : ${istTime(now)}

━━━━━━━━━━━━
💙 ULite Balance : ₹${updUser.ulite_balance}
🏦 Wallet : ₹${updUser.balance}
━━━━━━━━━━━━`);
    }

    res.json({
      status:         'success',
      message:        `₹${amt} ULite mein add ho gaya!`,
      tx_id:          txId,
      ulite_balance:  updUser.ulite_balance,
      wallet_balance: updUser.balance
    });
  } catch(e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /ulite/transfer — ULite → any mobile
// Body: { to_mobile, amount, pin, remark? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/transfer', auth, async (req, res) => {
  try {
    const { to_mobile, amount, pin, remark } = req.body;
    if (!to_mobile || !amount || !pin)
      return res.status(400).json({ status: 'error', message: 'to_mobile, amount, pin required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1) return res.status(400).json({ status: 'error', message: 'Minimum ₹1' });

    const sender = await User.findById(req.user._id).select('+pin name mobile balance ulite_balance tg_id');
    if (!sender) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (sender.pin !== String(pin)) return res.json({ status: 'error', message: 'Wrong PIN' });

    const uliteBal = sender.ulite_balance || 0;
    if (uliteBal < amt) return res.json({ status: 'error', message: `ULite mein sirf ₹${uliteBal} hai` });

    const receiver = await User.findOne({ mobile: to_mobile.toString() }).select('name mobile balance tg_id');
    if (!receiver) return res.json({ status: 'error', message: `${to_mobile} UNIO pe registered nahi` });
    if (sender._id.toString() === receiver._id.toString())
      return res.json({ status: 'error', message: 'Apne aap ko transfer nahi kar sakte' });

    const now    = new Date();
    const txId   = genTxId('ULT');
    const note   = remark || 'ULite Transfer';

    // Deduct from sender ULite, add to receiver main wallet
    await User.findByIdAndUpdate(sender._id,   { $inc: { ulite_balance: -amt } });
    await User.findByIdAndUpdate(receiver._id, { $inc: { balance: amt } });

    await Transaction.create({
      tx_id:       txId,
      sender_id:   sender._id,
      receiver_id: receiver._id,
      amount:      amt,
      type:        'ulite_transfer',
      status:      'success',
      remark:      `💙 ${note}`,
      tx_time:     now
    });

    const sUpd = await User.findById(sender._id).select('ulite_balance balance tg_id');
    const rUpd = await User.findById(receiver._id).select('balance tg_id');
    const dt   = istTime(now);

    // TG — sender
    if (sUpd?.tg_id) {
      sendTG(sUpd.tg_id,
`💙 *ULite Transfer Sent*

━━━━━━━━━━━━
💙 UNIO LITE ✅
━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 To : ${receiver.name} (\`${to_mobile}\`)
💬 Remark : ${note}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}

━━━━━━━━━━━━
💙 ULite : ₹${sUpd.ulite_balance}
━━━━━━━━━━━━`);
    }

    // TG — receiver
    if (rUpd?.tg_id) {
      sendTG(rUpd.tg_id,
`💙 *ULite — Payment Received*

━━━━━━━━━━━━
💙 UNIO LITE ✅
━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 From : ${sender.name} (\`${sender.mobile}\`)
💬 Remark : ${note}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}

━━━━━━━━━━━━
🏦 Wallet : ₹${rUpd.balance}
━━━━━━━━━━━━`);
    }

    res.json({
      status:         'success',
      message:        `₹${amt} ${receiver.name} ko bhej diya!`,
      tx_id:          txId,
      receiver_name:  receiver.name,
      ulite_balance:  sUpd.ulite_balance,
      timestamp:      dt
    });
  } catch(e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /ulite/withdraw — ULite → Main wallet
// Body: { amount, pin }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { amount, pin } = req.body;
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1) return res.status(400).json({ status: 'error', message: 'Minimum ₹1' });

    const user = await User.findById(req.user._id).select('+pin name mobile balance ulite_balance tg_id');
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (user.pin !== String(pin)) return res.json({ status: 'error', message: 'Wrong PIN' });

    const uliteBal = user.ulite_balance || 0;
    if (uliteBal < amt) return res.json({ status: 'error', message: `ULite mein sirf ₹${uliteBal} hai` });

    const now  = new Date();
    const txId = genTxId('ULW');

    await User.findByIdAndUpdate(req.user._id, {
      $inc: { ulite_balance: -amt, balance: amt }
    });

    await Transaction.create({
      tx_id:       txId,
      receiver_id: req.user._id,
      amount:      amt,
      type:        'ulite_withdraw',
      status:      'success',
      remark:      '💙 ULite → Wallet',
      tx_time:     now
    });

    const upd = await User.findById(req.user._id).select('balance ulite_balance tg_id');

    if (upd?.tg_id) {
      sendTG(upd.tg_id,
`💙 *ULite Withdrawal*

━━━━━━━━━━━━
💙 UNIO LITE ✅
━━━━━━━━━━━━

💰 Withdrawn : ₹${amt}
🆔 Txn ID : \`${txId}\`
📅 Date : ${istTime(now)}

━━━━━━━━━━━━
💙 ULite : ₹${upd.ulite_balance}
🏦 Wallet : ₹${upd.balance}
━━━━━━━━━━━━`);
    }

    res.json({
      status:         'success',
      message:        `₹${amt} main wallet mein aa gaya!`,
      tx_id:          txId,
      ulite_balance:  upd.ulite_balance,
      wallet_balance: upd.balance
    });
  } catch(e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /ulite/transactions — history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/transactions', auth, async (req, res) => {
  try {
    const txns = await Transaction.find({
      $or: [{ sender_id: req.user._id }, { receiver_id: req.user._id }],
      type: { $in: ['ulite_add', 'ulite_transfer', 'ulite_withdraw'] }
    })
    .populate('sender_id',   'name mobile')
    .populate('receiver_id', 'name mobile')
    .sort({ tx_time: -1 })
    .limit(50);

    res.json({ status: 'success', data: txns });
  } catch(e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — GET /ulite/admin/weeks
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/weeks', adminAuth, async (req, res) => {
  try {
    const oldest = await Transaction.findOne({ type:{ $in:['ulite_add','ulite_transfer','ulite_withdraw'] } })
      .sort({ tx_time: 1 }).select('tx_time');
    if (!oldest) return res.json({ status: 'success', weeks: [] });

    const weeks = []; let off = -1;
    while (true) {
      const r     = getWeekRange(off);
      if (r.end < oldest.tx_time) break;
      const count = await Transaction.countDocuments({
        type:    { $in: ['ulite_add','ulite_transfer','ulite_withdraw'] },
        tx_time: { $gte: r.start, $lte: r.end }
      });
      weeks.push({ weekOffset: off, label: r.label, count });
      off--; if (off < -104) break;
    }
    res.json({ status: 'success', weeks });
  } catch(e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — DELETE /ulite/admin/week
// Deletes transactions + sends JSON file to admin TG
// Body: { weekOffset: -1 }
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/admin/week', adminAuth, async (req, res) => {
  try {
    const off = parseInt(req.body.weekOffset ?? req.query.weekOffset ?? -1);
    if (off >= 0) return res.status(400).json({ status: 'error', message: 'weekOffset must be negative' });

    const range = getWeekRange(off);

    // Fetch all before delete
    const txns = await Transaction.find({
      type:    { $in: ['ulite_add','ulite_transfer','ulite_withdraw'] },
      tx_time: { $gte: range.start, $lte: range.end }
    })
    .populate('sender_id',   'name mobile')
    .populate('receiver_id', 'name mobile')
    .lean();

    // Format for JSON export
    const exportData = {
      exported_at: istTime(),
      week:        range.label,
      total:       txns.length,
      transactions: txns.map(t => ({
        tx_id:         t.tx_id,
        type:          t.type,
        amount:        t.amount,
        remark:        t.remark,
        status:        t.status,
        sender:        t.sender_id   ? `${t.sender_id.name} (${t.sender_id.mobile})`   : null,
        receiver:      t.receiver_id ? `${t.receiver_id.name} (${t.receiver_id.mobile})` : null,
        date:          istTime(new Date(t.tx_time))
      }))
    };

    // Delete
    const result = await Transaction.deleteMany({
      type:    { $in: ['ulite_add','ulite_transfer','ulite_withdraw'] },
      tx_time: { $gte: range.start, $lte: range.end }
    });

    // Send JSON file to admin TG
    const filename = `ulite_txns_${range.label.replace(/ → /g,'_to_').replace(/ /g,'')}.json`;
    sendTGDocument(ADMIN_TG, filename, exportData).catch(() => {});

    // Also send summary text
    sendTG(ADMIN_TG,
`🗑️ *ULite Transactions Deleted*

📅 Week : ${range.label}
📊 Deleted : ${result.deletedCount} transactions
📎 JSON file bheja gaya admin ko
📅 Time : ${istTime()}`);

    res.json({
      status:  'success',
      deleted: result.deletedCount,
      week:    range.label,
      note:    'JSON file admin TG pe bhej di'
    });
  } catch(e) { res.status(500).json({ status: 'error', message: e.message }); }
});

module.exports = router;
                       
