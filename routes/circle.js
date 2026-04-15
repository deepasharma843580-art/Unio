// routes/circle.js
// ─────────────────────────────────────────────────────────────────
//  UNIO Circle System
//  - Add member by mobile (invite sent)
//  - Member accepts/rejects via "My Payers" section
//  - Pay from circle member's wallet (approve / auto mode)
//  - TG alerts on all events
// ─────────────────────────────────────────────────────────────────

const router      = require('express').Router();
const User        = require('../models/User');
const Circle      = require('../models/Circle');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';

// ── Helpers ───────────────────────────────────────────────────────
async function sendTG(chat_id, text) {
  if (!chat_id) return;
  try {
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

// ─────────────────────────────────────────────────────────────────
// POST /circle/invite
// Body: { mobile, payment_mode: 'approve'|'auto' }
// Owner invites a user to their circle
// ─────────────────────────────────────────────────────────────────
router.post('/invite', auth, async (req, res) => {
  try {
    const { mobile, payment_mode } = req.body;
    if (!mobile) return res.status(400).json({ status: 'error', message: 'Mobile number required' });

    const owner  = await User.findById(req.user._id).select('name mobile tg_id');
    const member = await User.findOne({ mobile: mobile.toString() }).select('name mobile tg_id');

    if (!member) return res.json({ status: 'error', message: `${mobile} UNIO pe registered nahi hai` });
    if (member._id.toString() === owner._id.toString())
      return res.json({ status: 'error', message: 'Apne aap ko add nahi kar sakte' });

    // Check if already in circle
    const existing = await Circle.findOne({ owner_id: owner._id, member_id: member._id });
    if (existing) {
      if (existing.status === 'active')   return res.json({ status: 'error', message: 'Ye user already aapke circle mein hai' });
      if (existing.status === 'pending')  return res.json({ status: 'error', message: 'Invite already bheja ja chuka hai, accept hone ka wait karo' });
      if (existing.status === 'rejected') {
        // Re-invite
        existing.status = 'pending';
        existing.payment_mode = payment_mode || 'approve';
        await existing.save();
        // TG to member
        if (member.tg_id) {
          sendTG(member.tg_id,
`🔵 *UNIO Circle Invite*

━━━━━━━━━━━━
*${owner.name}* (\`${owner.mobile}\`) ne tumhe apne UNIO Circle mein add karna chahta hai.

💳 Payment Mode: *${payment_mode === 'auto' ? '⚡ Auto Deduct' : '✅ Approve Each Time'}*

UNIO app mein "My Payers" mein jaake *Accept* ya *Reject* karo.
━━━━━━━━━━━━`);
        }
        return res.json({ status: 'success', message: `Re-invite bheja ${member.name} ko!` });
      }
    }

    await Circle.create({
      owner_id:     owner._id,
      member_id:    member._id,
      member_mobile: mobile,
      payment_mode: payment_mode || 'approve',
      status:       'pending'
    });

    // TG to member
    if (member.tg_id) {
      sendTG(member.tg_id,
`🔵 *UNIO Circle Invite*

━━━━━━━━━━━━
*${owner.name}* (\`${owner.mobile}\`) ne tumhe apne UNIO Circle mein add karna chahta hai.

💳 Payment Mode: *${payment_mode === 'auto' ? '⚡ Auto Deduct' : '✅ Approve Each Time'}*

UNIO app mein "My Payers" section mein jaake *Accept* ya *Reject* karo.
━━━━━━━━━━━━`);
    }

    res.json({ status: 'success', message: `Invite bheja gaya ${member.name} ko!`, member_name: member.name });
  } catch(e) {
    if (e.code === 11000) return res.json({ status: 'error', message: 'Ye user already circle mein hai' });
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /circle/my-circle
// Returns all members owner has added (with status)
// ─────────────────────────────────────────────────────────────────
router.get('/my-circle', auth, async (req, res) => {
  try {
    const circles = await Circle.find({ owner_id: req.user._id })
      .populate('member_id', 'name mobile')
      .sort({ created_at: -1 });

    res.json({ status: 'success', data: circles });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /circle/my-payers
// Returns all circle invites where current user is the MEMBER
// ─────────────────────────────────────────────────────────────────
router.get('/my-payers', auth, async (req, res) => {
  try {
    const payers = await Circle.find({ member_id: req.user._id })
      .populate('owner_id', 'name mobile')
      .sort({ created_at: -1 });

    res.json({ status: 'success', data: payers });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /circle/respond
// Body: { circle_id, action: 'accept'|'reject' }
// Member accepts or rejects an invite
// ─────────────────────────────────────────────────────────────────
router.post('/respond', auth, async (req, res) => {
  try {
    const { circle_id, action } = req.body;
    if (!circle_id || !action) return res.status(400).json({ status: 'error', message: 'circle_id and action required' });

    const circle = await Circle.findById(circle_id)
      .populate('owner_id', 'name mobile tg_id')
      .populate('member_id', 'name mobile');

    if (!circle) return res.json({ status: 'error', message: 'Invite nahi mila' });
    if (circle.member_id._id.toString() !== req.user._id.toString())
      return res.status(403).json({ status: 'error', message: 'Ye invite tumhara nahi hai' });
    if (circle.status !== 'pending')
      return res.json({ status: 'error', message: 'Invite already processed ho chuka hai' });

    if (action === 'accept') {
      circle.status = 'active';
      circle.accepted_at = new Date();
      await circle.save();

      if (circle.owner_id.tg_id) {
        sendTG(circle.owner_id.tg_id,
`✅ *Circle Request Accepted!*

━━━━━━━━━━━━
*${circle.member_id.name}* (\`${circle.member_id.mobile}\`) ne aapka UNIO Circle invite accept kar liya!

💳 Mode: *${circle.payment_mode === 'auto' ? '⚡ Auto Deduct' : '✅ Approve Each Time'}*
━━━━━━━━━━━━`);
      }
      res.json({ status: 'success', message: 'Circle invite accept kar liya!' });

    } else if (action === 'reject') {
      circle.status = 'rejected';
      await circle.save();

      if (circle.owner_id.tg_id) {
        sendTG(circle.owner_id.tg_id,
`❌ *Circle Request Rejected*

━━━━━━━━━━━━
*${circle.member_id.name}* (\`${circle.member_id.mobile}\`) ne aapka UNIO Circle invite reject kar diya.
━━━━━━━━━━━━`);
      }
      res.json({ status: 'success', message: 'Invite reject kar diya.' });

    } else {
      res.status(400).json({ status: 'error', message: 'Invalid action' });
    }
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /circle/remove/:circle_id
// Owner removes a member from circle
// ─────────────────────────────────────────────────────────────────
router.delete('/remove/:circle_id', auth, async (req, res) => {
  try {
    const circle = await Circle.findById(req.params.circle_id);
    if (!circle) return res.json({ status: 'error', message: 'Circle entry nahi mili' });
    if (circle.owner_id.toString() !== req.user._id.toString())
      return res.status(403).json({ status: 'error', message: 'Ye aapka circle nahi hai' });

    await circle.deleteOne();
    res.json({ status: 'success', message: 'Member remove kar diya circle se' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /circle/pay
// Owner pays from a circle member's wallet
// Body: { circle_id, amount, remark? }
// If mode=auto: instant deduct
// If mode=approve: creates pending txn, member must approve
// ─────────────────────────────────────────────────────────────────
router.post('/pay', auth, async (req, res) => {
  try {
    const { circle_id, amount, remark } = req.body;
    if (!circle_id || !amount) return res.status(400).json({ status: 'error', message: 'circle_id and amount required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1) return res.status(400).json({ status: 'error', message: 'Minimum ₹1' });

    const circle = await Circle.findById(circle_id)
      .populate('member_id', 'name mobile balance tg_id')
      .populate('owner_id', 'name mobile tg_id');

    if (!circle) return res.json({ status: 'error', message: 'Circle entry nahi mili' });
    if (circle.owner_id._id.toString() !== req.user._id.toString())
      return res.status(403).json({ status: 'error', message: 'Ye aapka circle nahi hai' });
    if (circle.status !== 'active')
      return res.json({ status: 'error', message: 'Member ne abhi accept nahi kiya hai' });

    const member = circle.member_id;
    const note   = remark || 'UNIO Circle Payment';
    const txId   = 'CC' + Date.now() + Math.floor(Math.random() * 999);
    const now    = new Date();

    // ── AUTO MODE: instant deduct ──
    if (circle.payment_mode === 'auto') {
      if (member.balance < amt)
        return res.json({ status: 'error', message: `${member.name} ke wallet mein sirf ₹${member.balance} hai` });

      await User.findByIdAndUpdate(member._id, { $inc: { balance: -amt } });
      await User.findByIdAndUpdate(req.user._id, { $inc: { balance: amt } });

      await Transaction.create({
        tx_id:       txId,
        sender_id:   member._id,
        receiver_id: req.user._id,
        amount:      amt,
        type:        'circle_pay',
        status:      'success',
        remark:      `🔵 ${note}`,
        tx_time:     now
      });

      const dt = istTime();

      // TG to member (payer)
      if (member.tg_id) {
        sendTG(member.tg_id,
`🔵 *UNIO Circle — Auto Deduct*

━━━━━━━━━━━━
💰 Amount : ₹${amt}
👤 To : ${circle.owner_id.name} (\`${circle.owner_id.mobile}\`)
💬 Remark : ${note}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}
━━━━━━━━━━━━
🏦 Balance : ₹${(member.balance - amt).toFixed(2)}
━━━━━━━━━━━━`);
      }

      // TG to owner (receiver)
      if (circle.owner_id.tg_id) {
        sendTG(circle.owner_id.tg_id,
`🔵 *UNIO Circle — Payment Received*

━━━━━━━━━━━━
💰 Amount : ₹${amt}
👤 From : ${member.name} (\`${member.mobile}\`)
💬 Remark : ${note}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}
━━━━━━━━━━━━`);
      }

      return res.json({
        status: 'success',
        message: `₹${amt} ${member.name} ke wallet se deduct ho gaya!`,
        receipt: {
          tx_id: txId, amount: amt,
          from_name: member.name, from_mobile: member.mobile,
          to_name: circle.owner_id.name,
          remark: note, timestamp: dt, mode: 'auto'
        }
      });

    // ── APPROVE MODE: create pending txn ──
    } else {
      // Create a pending transaction
      await Transaction.create({
        tx_id:       txId,
        sender_id:   member._id,
        receiver_id: req.user._id,
        amount:      amt,
        type:        'circle_pay',
        status:      'pending',
        remark:      `🔵 ${note}`,
        tx_time:     now
      });

      const dt = istTime();

      // TG to member asking to approve
      if (member.tg_id) {
        sendTG(member.tg_id,
`🔵 *UNIO Circle — Approval Required*

━━━━━━━━━━━━
*${circle.owner_id.name}* (\`${circle.owner_id.mobile}\`) ne aapke wallet se payment maanga hai.

💰 Amount : ₹${amt}
💬 Remark : ${note}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}

UNIO app mein "My Payers" mein jaake *Approve* ya *Reject* karo.
━━━━━━━━━━━━`);
      }

      return res.json({
        status: 'success',
        message: `${member.name} ko approval request bhej di! (Txn: ${txId})`,
        receipt: {
          tx_id: txId, amount: amt,
          from_name: member.name, from_mobile: member.mobile,
          to_name: circle.owner_id.name,
          remark: note, timestamp: dt, mode: 'approve', status: 'pending'
        }
      });
    }
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /circle/approve-pay
// Body: { tx_id, action: 'approve'|'reject' }
// Member approves or rejects a pending circle payment
// ─────────────────────────────────────────────────────────────────
router.post('/approve-pay', auth, async (req, res) => {
  try {
    const { tx_id, action } = req.body;
    if (!tx_id || !action) return res.status(400).json({ status: 'error', message: 'tx_id and action required' });

    const txn = await Transaction.findOne({ tx_id, status: 'pending', type: 'circle_pay' })
      .populate('sender_id',   'name mobile balance tg_id')
      .populate('receiver_id', 'name mobile tg_id');

    if (!txn) return res.json({ status: 'error', message: 'Pending transaction nahi mili' });
    if (txn.sender_id._id.toString() !== req.user._id.toString())
      return res.status(403).json({ status: 'error', message: 'Ye transaction aapka nahi hai' });

    const member = txn.sender_id;
    const owner  = txn.receiver_id;
    const amt    = txn.amount;
    const dt     = istTime();

    if (action === 'approve') {
      if (member.balance < amt) {
        txn.status = 'failed';
        await txn.save();
        return res.json({ status: 'error', message: `Insufficient balance. Aapke wallet mein ₹${member.balance} hai` });
      }

      await User.findByIdAndUpdate(member._id, { $inc: { balance: -amt } });
      await User.findByIdAndUpdate(owner._id,  { $inc: { balance:  amt } });
      txn.status = 'success';
      await txn.save();

      if (owner.tg_id) {
        sendTG(owner.tg_id,
`✅ *Circle Payment Approved!*

━━━━━━━━━━━━
💰 Amount : ₹${amt}
👤 From : ${member.name} (\`${member.mobile}\`)
🆔 Txn ID : \`${txn.tx_id}\`
📅 Date : ${dt}
━━━━━━━━━━━━`);
      }

      res.json({ status: 'success', message: `₹${amt} approve ho gaya!` });

    } else {
      txn.status = 'rejected';
      await txn.save();

      if (owner.tg_id) {
        sendTG(owner.tg_id,
`❌ *Circle Payment Rejected*

━━━━━━━━━━━━
💰 Amount : ₹${amt}
👤 By : ${member.name} (\`${member.mobile}\`)
🆔 Txn ID : \`${txn.tx_id}\`
━━━━━━━━━━━━`);
      }

      res.json({ status: 'success', message: 'Payment reject kar di.' });
    }
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /circle/pending-approvals
// Returns pending circle_pay txns where current user is sender
// ─────────────────────────────────────────────────────────────────
router.get('/pending-approvals', auth, async (req, res) => {
  try {
    const txns = await Transaction.find({
      sender_id: req.user._id,
      type: 'circle_pay',
      status: 'pending'
    }).populate('receiver_id', 'name mobile').sort({ tx_time: -1 });

    res.json({ status: 'success', data: txns });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /circle/lookup/:mobile — name fetch
// ─────────────────────────────────────────────────────────────────
router.get('/lookup/:mobile', auth, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.params.mobile }).select('name mobile');
    if (!user) return res.json({ status: 'error', message: 'User not found' });
    res.json({ status: 'success', name: user.name, mobile: user.mobile });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
                     
