const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const tg          = require('../helpers/telegram');

const ADMIN_KEY = process.env.ADMIN_KEY || '8435';

function adminCheck(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.admin_key;
  if(key === ADMIN_KEY) return next();
  return res.status(403).json({ status:'error', message:'Admin access required' });
}

router.use(adminCheck);

router.get('/stats', async (req, res) => {
  try {
    const [users, txns, bal] = await Promise.all([
      User.countDocuments(),
      Transaction.countDocuments({ status:'success' }),
      User.aggregate([{ $group:{ _id:null, total:{ $sum:'$balance' } } }])
    ]);
    const api_vol = await Transaction.aggregate([
      { $match:{ type:'api', status:'success' } },
      { $group:{ _id:null, total:{ $sum:'$amount' } } }
    ]);
    res.json({ status:'success', users, transactions:txns,
      total_balance: bal[0]?.total||0, api_volume: api_vol[0]?.total||0 });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

router.get('/users', async (req, res) => {
  const users = await User.find().select('-password -login_pin').sort({ created_at:-1 });
  res.json({ status:'success', users });
});

router.post('/add-balance', async (req, res) => {
  const { mobile, amount } = req.body;
  const amt  = parseFloat(amount);
  const user = await User.findOneAndUpdate({ mobile }, { $inc:{ balance: amt } }, { new:true });
  if(!user) return res.status(404).json({ status:'error', message:'User not found' });
  await Transaction.create({ receiver_id:user._id, amount:amt, type:'admin_add', status:'success', remark:'Admin credit' });
  res.json({ status:'success', new_balance: user.balance });
});

router.post('/deduct-balance', async (req, res) => {
  const { mobile, amount } = req.body;
  const amt  = parseFloat(amount);
  const user = await User.findOne({ mobile });
  if(!user) return res.status(404).json({ status:'error', message:'User not found' });
  if(user.balance < amt) return res.status(400).json({ status:'error', message:'Insufficient balance' });
  await User.findByIdAndUpdate(user._id, { $inc:{ balance:-amt } });
  await Transaction.create({ sender_id:user._id, amount:amt, type:'admin_deduct', status:'success', remark:'Admin debit' });
  res.json({ status:'success' });
});

router.post('/ban/:id', async (req, res) => {
  const { type, until } = req.body;
  await User.findByIdAndUpdate(req.params.id, { is_banned: parseInt(type)||0, ban_until: until||null });
  res.json({ status:'success' });
});

router.get('/transactions', async (req, res) => {
  const txns = await Transaction.find().sort({ tx_time:-1 }).limit(200)
    .populate('sender_id','name mobile').populate('receiver_id','name mobile');
  res.json({ status:'success', transactions:txns });
});

router.get('/withdrawals', async (req, res) => {
  const list = await Transaction.find({ type:'withdraw', status:'pending' }).sort({ tx_time:-1 })
    .populate('sender_id','name mobile');
  res.json({ status:'success', withdrawals:list });
});

const BOT_TOKEN = process.env.BOT_TOKEN || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG  = process.env.ADMIN_TG_ID || '8509393869';

async function sendTG(chat_id, text) {
  if (!chat_id) return;
  try {
    const axios = require('axios');
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id, text, parse_mode: 'Markdown' }, { timeout: 8000 });
  } catch(e) {}
}

function istTime() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
}

router.post('/approve-withdraw/:txn_id', async (req, res) => {
  try {
    const txn = await Transaction.findOne({ tx_id: req.params.txn_id, type: 'withdraw' })
      .populate('sender_id', 'name mobile tg_id');

    if (!txn) return res.status(404).json({ status: 'error', message: 'Transaction not found' });
    if (txn.status !== 'pending') return res.json({ status: 'error', message: 'Already processed' });

    await Transaction.findOneAndUpdate({ tx_id: req.params.txn_id }, { status: 'success' });

    const dt   = istTime();
    const user = txn.sender_id;
    const amt  = txn.amount;

    // TG to user
    if (user?.tg_id) {
      sendTG(user.tg_id,
`✅ *Your Withdraw is Paid Successfully!* 🎉

━━━━━━━━━━━━━━━━━
💰 Amount : ₹${amt}
📅 Time : ${dt}
━━━━━━━━━━━━━━━━━

Check your UPI app or bank statement ✅

🔐 Secured by UNIO System`);
    }

    // TG to admin
    sendTG(ADMIN_TG,
`✅ *Withdraw Approved*

👤 User : ${user?.name || 'Unknown'} (${user?.mobile || '—'})
💰 Amount : ₹${amt}
🆔 Txn ID : \`${txn.tx_id}\`
📅 Time : ${dt}`);

    res.json({ status: 'success', message: 'Withdraw approved, user notified' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

router.post('/reject-withdraw/:txn_id', async (req, res) => {
  const txn = await Transaction.findOne({ tx_id: req.params.txn_id, type:'withdraw', status:'pending' });
  if(!txn) return res.status(404).json({ status:'error', message:'Not found' });
  await User.findByIdAndUpdate(txn.sender_id, { $inc:{ balance: txn.amount } });
  await Transaction.findByIdAndUpdate(txn._id, { status:'rejected' });
  res.json({ status:'success' });
});

router.post('/approve-deposit/:id', async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id)
      .populate('receiver_id', 'name mobile balance');
    if(!txn) return res.status(404).json({ status:'error', message:'Not found' });
    if(txn.status !== 'pending')
      return res.json({ status:'error', message:'Already processed' });
    await User.findByIdAndUpdate(txn.receiver_id._id, { $inc:{ balance: txn.amount } });
    await Transaction.findByIdAndUpdate(req.params.id, { status:'success' });
    res.json({ status:'success', message:'Deposit approved' });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

router.post('/reject-deposit/:id', async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id);
    if(!txn) return res.status(404).json({ status:'error', message:'Not found' });
    if(txn.status !== 'pending')
      return res.json({ status:'error', message:'Already processed' });
    await Transaction.findByIdAndUpdate(req.params.id, { status:'rejected' });
    res.json({ status:'success', message:'Deposit rejected' });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

router.get('/api-transactions', async (req, res) => {
  const txns = await Transaction.find({ type:'api' }).sort({ tx_time:-1 }).limit(200)
    .populate('sender_id','name mobile tg_id balance')
    .populate('receiver_id','name mobile tg_id balance');
  res.json({ status:'success', transactions:txns });
});

router.post('/notify-txn/:id', async (req, res) => {
  const txn = await Transaction.findById(req.params.id)
    .populate('sender_id','name mobile tg_id balance')
    .populate('receiver_id','name mobile tg_id balance');
  if(!txn) return res.status(404).json({ status:'error', message:'Not found' });
  const dt    = tg.fmtDate(txn.tx_time);
  const label = tg.txnLabel(txn._id, txn.amount);
  const sD    = txn.sender_id   ? `${txn.sender_id.name}\nNumber: ${txn.sender_id.mobile}`   : 'Unknown';
  const rD    = txn.receiver_id ? `${txn.receiver_id.name}\nNumber: ${txn.receiver_id.mobile}` : 'Unknown';
  if(txn.sender_id?.tg_id)   tg.sendAlert(txn.sender_id.tg_id,   tg.debitMsg(txn.amount, rD, label, dt, txn.sender_id.balance));
  if(txn.receiver_id?.tg_id) tg.sendAlert(txn.receiver_id.tg_id, tg.creditMsg(txn.amount, sD, label, dt, txn.receiver_id.balance));
  if(process.env.ADMIN_TG_ID) tg.sendAlert(process.env.ADMIN_TG_ID, tg.adminApiMsg(txn.amount, sD, rD, label, dt));
  res.json({ status:'success' });
});

// ── Reset Password ────────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { mobile, new_password } = req.body;
    if(!mobile || !new_password)
      return res.status(400).json({ status:'error', message:'Mobile and new_password required' });
    const user = await User.findOne({ mobile });
    if(!user) return res.status(404).json({ status:'error', message:'User not found' });
    user.password = new_password; // pre('save') hash kar dega
    await user.save();
    res.json({ status:'success', message:'Password reset successfully' });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

module.exports = router;

