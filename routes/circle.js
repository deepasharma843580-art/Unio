// routes/circle.js
// ─────────────────────────────────────────────────────────────────
//  UNIO Circle — UPI-style trusted payer network
//  Owner invites members → members pay from their wallet TO owner
//  Pay tab: select payer by mobile (auto name fetch) + amount + remark
//  TG instant alerts on every event
// ─────────────────────────────────────────────────────────────────

const router      = require('express').Router();
const User        = require('../models/User');
const Circle      = require('../models/Circle');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';

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
// GET /circle/lookup/:mobile — auto name fetch
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

// ─────────────────────────────────────────────────────────────────
// POST /circle/invite
// Body: { mobile, payment_mode: 'approve'|'auto' }
// ─────────────────────────────────────────────────────────────────
router.post('/invite', auth, async (req, res) => {
  try {
    const { mobile, payment_mode } = req.body;
    if (!mobile) return res.status(400).json({ status: 'error', message: 'Mobile required' });

    const owner  = await User.findById(req.user._id).select('name mobile tg_id');
    const member = await User.findOne({ mobile: mobile.toString() }).select('name mobile tg_id');

    if (!member)
      return res.json({ status: 'error', message: `${mobile} UNIO pe registered nahi hai` });
    if (member._id.toString() === owner._id.toString())
      return res.json({ status: 'error', message: 'Apne aap ko add nahi kar sakte' });

    const existing = await Circle.findOne({ owner_id: owner._id, member_id: member._id });
    if (existing) {
      if (existing.status === 'active')  return res.json({ status: 'error', message: 'Ye user already aapke circle mein hai' });
      if (existing.status === 'pending') return res.json({ status: 'error', message: 'Invite already pending hai' });
      // Re-invite if rejected
      existing.status       = 'pending';
      existing.payment_mode = payment_mode || 'approve';
      await existing.save();
    } else {
      await Circle.create({
        owner_id:      owner._id,
        member_id:     member._id,
        member_mobile: mobile,
        payment_mode:  payment_mode || 'approve',
        status:        'pending'
      });
    }

    // TG to member
    if (member.tg_id) {
      sendTG(member.tg_id,
`🔵 *UNIO Circle Invite*

━━━━━━━━━━━━
*${owner.name}* (\`${owner.mobile}\`) ne tumhe apne UNIO Circle mein add kiya hai.

💳 Mode: *${payment_mode === 'auto' ? '⚡ Auto Deduct' : '✅ Approve Each Time'}*

👉 UNIO app mein *"My Invites"* mein Accept ya Reject karo.
━━━━━━━━━━━━`);
    }

    res.json({ status: 'success', message: `Invite bheja ${member.name} ko!`, member_name: member.name });
  } catch(e) {
    if (e.code === 11000) return res.json({ status: 'error', message: 'Already circle mein hai' });
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /circle/my-circle — owner ka circle (members list)
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
// GET /circle/my-invites — member ko mila hua invite
// ─────────────────────────────────────────────────────────────────
router.get('/my-invites', auth, async (req, res) => {
  try {
    const invites = await Circle.find({ member_id: req.user._id })
      .populate('owner_id', 'name mobile')
      .sort({ created_at: -1 });
    res.json({ status: 'success', data: invites });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /circle/respond — member accepts/rejects invite
// Body: { circle_id, action: 'accept'|'reject' }
// ─────────────────────────────────────────────────────────────────
router.post('/respond', auth, async (req, res) => {
  try {
    const { circle_id, action } = req.body;
    if (!circle_id || !action)
      return res.status(400).json({ status: 'error', message: 'circle_id and action required' });

    const circle = await Circle.findById(circle_id)
      .populate('owner_id',  'name mobile tg_id')
      .populate('member_id', 'name mobile');

    if (!circle) return res.json({ status: 'error', message: 'Invite nahi mila' });
    if (circle.member_id._id.toString() !== req.user._id.toString())
      return res.status(403).json({ status: 'error', message: 'Ye invite tumhara nahi' });
    if (circle.status !== 'pending')
      return res.json({ status: 'error', message: 'Invite already processed hai' });

    circle.status = action === 'accept' ? 'active' : 'rejected';
    if (action === 'accept') circle.accepted_at = new Date();
    await circle.save();

    // TG to owner
    if (circle.owner_id.tg_id) {
      sendTG(circle.owner_id.tg_id,
        action === 'accept'
          ? `✅ *Circle Accepted!*\n\n*${circle.member_id.name}* (\`${circle.member_id.mobile}\`) ne circle invite accept kiya!\n💳 Mode: *${circle.payment_mode === 'auto' ? '⚡ Auto' : '✅ Approve'}*`
          : `❌ *Circle Rejected*\n\n*${circle.member_id.name}* (\`${circle.member_id.mobile}\`) ne invite reject kar diya.`
      );
    }

    res.json({ status: 'success', message: action === 'accept' ? 'Accept kar liya! ✅' : 'Reject kar diya.' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /circle/remove/:circle_id — owner removes member
// ─────────────────────────────────────────────────────────────────
router.delete('/remove/:circle_id', auth, async (req, res) => {
  try {
    const circle = await Circle.findById(req.params.circle_id);
    if (!circle) return res.json({ status: 'error', message: 'Entry nahi mili' });
    if (circle.owner_id.toString() !== req.user._id.toString())
      return res.status(403).json({ status: 'error', message: 'Ye aapka circle nahi' });
    await circle.deleteOne();
    res.json({ status: 'success', message: 'Member remove kar diya' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /circle/pay
// Owner selects payer by mobile number (auto name fetch on frontend)
// Body: { mobile, amount, remark? }
// Finds active circle where that mobile is member & current user is owner
// ─────────────────────────────────────────────────────────────────
router.post('/pay', auth, async (req, res) => {
  try {
    const { mobile, amount, remark } = req.body;
    if (!mobile || !amount)
      return res.status(400).json({ status: 'error', message: 'mobile aur amount required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1)
      return res.status(400).json({ status: 'error', message: 'Minimum ₹1' });

    // Find member user
    const memberUser = await User.findOne({ mobile: mobile.toString() })
      .select('name mobile balance tg_id');
    if (!memberUser)
      return res.json({ status: 'error', message: `${mobile} UNIO pe registered nahi` });

    // Find active circle where current user is owner and memberUser is member
    const circle = await Circle.findOne({
      owner_id:  req.user._id,
      member_id: memberUser._id,
      status:    'active'
    }).populate('owner_id', 'name mobile tg_id');

    if (!circle)
      return res.json({ status: 'error', message: `${memberUser.name} aapke active circle mein nahi hai` });

    const owner = circle.owner_id;
    const note  = remark || 'UNIO Circle Payment';
    const txId  = 'CC' + Date.now() + Math.floor(Math.random() * 999);
    const now   = new Date();
    const dt    = istTime();

    // ── AUTO mode ──────────────────────────────────────────────────
    if (circle.payment_mode === 'auto') {
      if (memberUser.balance < amt)
        return res.json({ status: 'error', message: `${memberUser.name} ke wallet mein sirf ₹${memberUser.balance} hai` });

      await User.findByIdAndUpdate(memberUser._id, { $inc: { balance: -amt } });
      await User.findByIdAndUpdate(req.user._id,   { $inc: { balance:  amt } });

      await Transaction.create({
        tx_id:       txId,
        sender_id:   memberUser._id,
        receiver_id: req.user._id,
        amount:      amt,
        type:        'circle_pay',
        status:      'success',
        remark:      `🔵 ${note}`,
        tx_time:     now
      });

      // TG — member (payer)
      const mUpd = await User.findById(memberUser._id).select('balance tg_id');
      if (mUpd?.tg_id) {
        sendTG(mUpd.tg_id,
`🔵 *Circle — Auto Deduct*

━━━━━━━━━━━━
⚡  UNIO CIRCLE ✅
━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 To : ${owner.name} (\`${owner.mobile}\`)
💬 Remark : ${note}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}

━━━━━━━━━━━━
🪙 Balance : ₹${mUpd.balance}
━━━━━━━━━━━━`);
      }

      // TG — owner (receiver)
      const oUpd = await User.findById(req.user._id).select('balance tg_id');
      if (oUpd?.tg_id) {
        sendTG(oUpd.tg_id,
`🔵 *Circle — Payment Received*

━━━━━━━━━━━━
⚡  UNIO CIRCLE ✅
━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 From : ${memberUser.name} (\`${mobile}\`)
💬 Remark : ${note}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}

━━━━━━━━━━━━
🪙 Balance : ₹${oUpd.balance}
━━━━━━━━━━━━`);
      }

      return res.json({
        status:  'success',
        message: `₹${amt} ${memberUser.name} ke wallet se aaya!`,
        receipt: {
          tx_id:        txId, amount: amt,
          from_name:    memberUser.name,
          from_mobile:  mobile,
          to_name:      owner.name,
          remark:       note,
          timestamp:    dt,
          mode:         'auto',
          status:       'success'
        }
      });

    // ── APPROVE mode ───────────────────────────────────────────────
    } else {
      await Transaction.create({
        tx_id:       txId,
        sender_id:   memberUser._id,
        receiver_id: req.user._id,
        amount:      amt,
        type:        'circle_pay',
        status:      'pending',
        remark:      `🔵 ${note}`,
        tx_time:     now
      });

      // TG — member (approval request)
      if (memberUser.tg_id) {
        sendTG(memberUser.tg_id,
`🔵 *Circle — Approval Required*

━━━━━━━━━━━━
*${owner.name}* (\`${owner.mobile}\`) ne payment maanga hai.

💰 Amount : ₹${amt}
💬 Remark : ${note}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}

👉 UNIO app mein *"My Invites"* mein Approve ya Reject karo.
━━━━━━━━━━━━`);
      }

      return res.json({
        status:  'success',
        message: `${memberUser.name} ko approval request bhej di!`,
        receipt: {
          tx_id:        txId, amount: amt,
          from_name:    memberUser.name,
          from_mobile:  mobile,
          to_name:      owner.name,
          remark:       note,
          timestamp:    dt,
          mode:         'approve',
          status:       'pending'
        }
      });
    }
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /circle/pending-approvals — member ki pending payments
// ─────────────────────────────────────────────────────────────────
router.get('/pending-approvals', auth, async (req, res) => {
  try {
    const txns = await Transaction.find({
      sender_id: req.user._id,
      type:      'circle_pay',
      status:    'pending'
    }).populate('receiver_id', 'name mobile').sort({ tx_time: -1 });
    res.json({ status: 'success', data: txns });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /circle/approve-pay — member approves/rejects pending pay
// Body: { tx_id, action: 'approve'|'reject' }
// ─────────────────────────────────────────────────────────────────
router.post('/approve-pay', auth, async (req, res) => {
  try {
    const { tx_id, action } = req.body;
    if (!tx_id || !action)
      return res.status(400).json({ status: 'error', message: 'tx_id and action required' });

    const txn = await Transaction.findOne({ tx_id, status: 'pending', type: 'circle_pay' })
      .populate('sender_id',   'name mobile balance tg_id')
      .populate('receiver_id', 'name mobile tg_id');

    if (!txn) return res.json({ status: 'error', message: 'Pending transaction nahi mili' });
    if (txn.sender_id._id.toString() !== req.user._id.toString())
      return res.status(403).json({ status: 'error', message: 'Ye transaction aapka nahi' });

    const member = txn.sender_id;
    const owner  = txn.receiver_id;
    const amt    = txn.amount;
    const dt     = istTime();

    if (action === 'approve') {
      if (member.balance < amt) {
        txn.status = 'failed';
        await txn.save();
        return res.json({ status: 'error', message: `Insufficient balance. ₹${member.balance} hai` });
      }

      await User.findByIdAndUpdate(member._id, { $inc: { balance: -amt } });
      await User.findByIdAndUpdate(owner._id,  { $inc: { balance:  amt } });
      txn.status = 'success';
      await txn.save();

      const mUpd = await User.findById(member._id).select('balance tg_id');
      if (mUpd?.tg_id) {
        sendTG(mUpd.tg_id,
`✅ *Circle Payment Approved*

━━━━━━━━━━━━
💰 Amount : ₹${amt}
👤 To : ${owner.name}
🆔 Txn ID : \`${txn.tx_id}\`
📅 Date : ${dt}
━━━━━━━━━━━━
🪙 Balance : ₹${mUpd.balance}
━━━━━━━━━━━━`);
      }

      if (owner.tg_id) {
        sendTG(owner.tg_id,
`✅ *Circle Payment Received!*

━━━━━━━━━━━━
💰 Amount : ₹${amt}
👤 From : ${member.name} (\`${member.mobile}\`)
🆔 Txn ID : \`${txn.tx_id}\`
📅 Date : ${dt}
━━━━━━━━━━━━`);
      }

      res.json({ status: 'success', message: `₹${amt} approve! ✅` });
    } else {
      txn.status = 'rejected';
      await txn.save();
      if (owner.tg_id) {
        sendTG(owner.tg_id,
`❌ *Circle Payment Rejected*\n\n💰 ₹${amt} by ${member.name}\n🆔 \`${txn.tx_id}\``);
      }
      res.json({ status: 'success', message: 'Payment reject kar di.' });
    }
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
