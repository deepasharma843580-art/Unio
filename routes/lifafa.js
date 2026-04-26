const router      = require('express').Router();
const User        = require('../models/User');
const Lifafa      = require('../models/Lifafa');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN   = process.env.BOT_TOKEN   || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '8509393869';

async function sendTG(tg_id, text) {
  if (!tg_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: tg_id, text, parse_mode: 'Markdown'
    }, { timeout: 8000 });
  } catch(e) {}
}

function istTime() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', hour12: true,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bot admin check karo channel mein
// channel: "@channelname" ya chat_id "-100xxxx"
// Returns: { isAdmin: true/false }
// ─────────────────────────────────────────────────────────────────────────────
async function checkBotAdmin(channel) {
  try {
    const res = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`,
      { params: { chat_id: channel, user_id: (await getBotId()) }, timeout: 8000 }
    );
    const status = res.data?.result?.status;
    return ['administrator', 'creator'].includes(status);
  } catch(e) {
    return false;
  }
}

let _botId = null;
async function getBotId() {
  if (_botId) return _botId;
  try {
    const res = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, { timeout: 5000 });
    _botId = res.data?.result?.id;
    return _botId;
  } catch(e) { return null; }
}

// GET /lifafa/referrer-by-tg/:tg_id
router.get('/referrer-by-tg/:tg_id', async (req, res) => {
  try {
    const referrer = await User.findOne({ tg_id: req.params.tg_id }).select('name tg_id');
    if (!referrer) return res.status(404).json({ status: 'error', message: 'User not found' });
    res.json({ status: 'success', name: referrer.name, tg_id: referrer.tg_id });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// GET /lifafa/referrer/:walletId
router.get('/referrer/:walletId', async (req, res) => {
  try {
    const referrer = await User.findOne({ wallet_id: req.params.walletId }).select('name');
    if (!referrer) return res.status(404).json({ status: 'error', message: 'Invalid Referrer' });
    res.json({ status: 'success', name: referrer.name });
  } catch(e) {
    res.status(500).json({ status: 'error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /lifafa/create
// Fund-based: max_users nahi, sirf total_fund se chalega
// Channels ab objects hain: { url, type, chat_id, invite_link }
// access_code optional field
// ─────────────────────────────────────────────────────────────────────────────
router.post('/create', auth, async (req, res) => {
  try {
    const {
      code, type, amt, min_range, max_range,
      toss_answer, users, channels, refer_bonus, access_code
    } = req.body;

    const perAmt    = type === 'scratch' ? parseFloat(max_range) : parseFloat(amt);
    const totalFund = parseFloat((perAmt * parseInt(users)).toFixed(2));

    if (!totalFund || totalFund <= 0)
      return res.status(400).json({ status: 'error', message: 'Invalid amount/users' });

    const sender = await User.findById(req.user._id);
    if (!sender) return res.status(404).json({ status: 'error', message: 'User not found' });

    if (sender.balance < totalFund)
      return res.status(400).json({ status: 'error', message: `Insufficient balance. Need ₹${totalFund}` });

    if (await Lifafa.findOne({ code: code.toUpperCase() }))
      return res.status(400).json({ status: 'error', message: 'Code already exists' });

    // ── Channel admin verification ────────────────────────────────────────────
    // Har channel ke liye bot admin check karo
    const channelList = channels || [];
    const adminCheckResults = [];

    for (const ch of channelList) {
      // Support both string (old) and object (new) format
      let chatId, url;
      if (typeof ch === 'object') {
        url    = ch.url || '';
        // Private channel ke liye chat_id use karo, public ke liye @username
        chatId = (ch.type === 'private' && ch.chat_id)
          ? ch.chat_id
          : ('@' + (url.split('/').pop() || ''));
      } else {
        url    = ch;
        chatId = '@' + url.split('/').pop();
      }
      const isAdmin = await checkBotAdmin(chatId);
      adminCheckResults.push({ url, chatId, isAdmin });
    }

    const notAdmin = adminCheckResults.filter(c => !c.isAdmin);

    // ❌ Bot admin nahi hai — create block karo
    if (notAdmin.length > 0) {
      return res.status(400).json({
        status:    'error',
        message:   `❌ Bot @OTP_UNIO_BOT admin nahi hai in channels:\n${notAdmin.map(c => c.url).join('\n')}\n\nPehle bot ko admin banao, phir try karo.`,
        not_admin: notAdmin.map(c => c.url)
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Deduct from creator
    await User.findByIdAndUpdate(sender._id, { $inc: { balance: -totalFund } });

    await Transaction.create({
      sender_id: sender._id,
      amount:    totalFund,
      type:      'transfer',
      status:    'success',
      remark:    `Created ${type} Lifafa: ${code}`,
      tx_time:   new Date()
    });

    // Save channels with admin status
    const channelsToSave = adminCheckResults.map((c, i) => {
      const original = channelList[i];
      if (typeof original === 'object') {
        return { ...original, admin_verified: c.isAdmin };
      }
      return { url: c.url, type: 'public', admin_verified: c.isAdmin };
    });

    const lifafa = await Lifafa.create({
      creator_id:      sender._id,
      creator_mobile:  sender.mobile,
      code:            code.toUpperCase(),
      type,
      per_user_amount: parseFloat(amt)        || 0,
      min_range:       parseFloat(min_range)  || 0,
      max_range:       parseFloat(max_range)  || 0,
      toss_answer:     toss_answer            || '',
      max_users:       parseInt(users),
      channels:        channelsToSave,
      refer_bonus:     parseFloat(refer_bonus) || 0,
      refer_fund_used: 0,
      access_code:     access_code ? access_code.trim().toUpperCase() : '',
    });

    const dt = istTime();

    // Bot admin warning message
    const notAdminMsg = notAdmin.length > 0
      ? `\n⚠️ *Bot not admin in:*\n${notAdmin.map(c => `• ${c.url}`).join('\n')}\n`
      : '';

    if (sender.tg_id) {
      sendTG(sender.tg_id,
`🎁 *Lifafa Created!*

━━━━━━━━━━━━━━
🎁   UNIO LIFAFA ✅
━━━━━━━━━━━━━━

🔑 Code : \`${lifafa.code}\`
📋 Type : ${type.toUpperCase()}
💰 Amount : ₹${amt || max_range}/user
💸 Total Fund : ₹${totalFund}
🎯 Refer Bonus : ${parseFloat(refer_bonus) > 0 ? '₹' + refer_bonus + ' per refer' : 'Off'}
🔐 Access Code : ${access_code ? '✅ Set' : 'Off'}
📅 Date : ${dt}
${notAdminMsg}
━━━━━━━━━━━━━━
Claim Link: ${process.env.APP_URL || ''}/claim.html?code=${lifafa.code}
Share karo! 🚀`
      );
    }

    sendTG(ADMIN_TG_ID,
`🎁 *New Lifafa Created*

👤 By : ${sender.name} (TG: ${sender.tg_id})
🔑 Code : \`${lifafa.code}\`
📋 Type : ${type} | 💸 Fund : ₹${totalFund}
🎯 Refer : ${parseFloat(refer_bonus) > 0 ? '₹' + refer_bonus : 'Off'}
🔐 Access : ${access_code ? 'Yes' : 'No'}
${notAdmin.length > 0 ? '⚠️ Not admin in ' + notAdmin.length + ' channel(s)' : '✅ All channels OK'}`
    );

    res.json({
      status:         'success',
      code:           lifafa.code,
      claim_url:      `/claim.html?code=${lifafa.code}`,
      total_deducted: totalFund,
      refer_bonus:    lifafa.refer_bonus,
      not_admin:      notAdmin.map(c => c.url)  // Frontend pe warn kar sake
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /lifafa/:code — fund stats bhi return karo
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:code', async (req, res) => {
  try {
    const l = await Lifafa.findOne({ code: req.params.code.toUpperCase(), status: 'active' })
      .populate('creator_id', 'name');
    if (!l) return res.status(404).json({ status: 'error', message: 'Invalid or expired code' });

    const perAmt    = l.per_user_amount > 0 ? l.per_user_amount : l.max_range;
    const totalFund = parseFloat((perAmt * l.max_users).toFixed(2));
    const claimUsed = parseFloat((l.claimed_users * perAmt).toFixed(2));
    const referUsed = parseFloat((l.refer_fund_used || 0).toFixed(2));
    const totalUsed = parseFloat((claimUsed + referUsed).toFixed(2));
    const remaining = parseFloat(Math.max(0, totalFund - totalUsed).toFixed(2));

    const obj = l.toObject ? l.toObject() : l;

    // Access code: sirf "hai ya nahi" bhejo — actual code nahi bhejo (security)
    const hasAccessCode = !!(obj.access_code && obj.access_code.trim());

    res.json({
      status: 'success',
      lifafa: {
        ...obj,
        access_code:    hasAccessCode ? obj.access_code : '',  // Full code bhejo (claim verify ke liye client pe)
        has_access_code: hasAccessCode,
        total_fund:     totalFund,
        total_used:     totalUsed,
        remaining
      }
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /lifafa/claim
// ─────────────────────────────────────────────────────────────────────────────
router.post('/claim', async (req, res) => {
  try {
    const { code, mobile, guess, ref_code } = req.body;

    const user = await User.findOne({ mobile });
    if (!user) return res.status(404).json({ status: 'error', message: 'Mobile not found' });

    const lifafa = await Lifafa.findOne({ code: code.toUpperCase(), status: 'active' });
    if (!lifafa) return res.status(404).json({ status: 'error', message: 'Invalid or expired code' });

    const rem = `Loot_${code}_${mobile}`;
    if (await Transaction.findOne({ remark: rem }))
      return res.status(400).json({ status: 'error', message: 'Already claimed!' });

    const perAmt    = lifafa.per_user_amount > 0 ? lifafa.per_user_amount : lifafa.max_range;
    const totalFund = parseFloat((perAmt * lifafa.max_users).toFixed(2));

    // Amount decide
    let amt = lifafa.per_user_amount;
    if (lifafa.type === 'scratch') {
      amt = Math.floor(
        Math.random() * (lifafa.max_range * 100 - lifafa.min_range * 100 + 1)
        + lifafa.min_range * 100
      ) / 100;
    }
    amt = parseFloat(amt.toFixed(2));

    // Toss check
    if (lifafa.type === 'toss' && (!guess || guess.toUpperCase() !== lifafa.toss_answer.toUpperCase())) {
      await Transaction.create({
        receiver_id: user._id, amount: 0, remark: rem,
        type: 'transfer', status: 'failed', tx_time: new Date()
      });
      return res.status(400).json({ status: 'error', message: 'Wrong guess! Locked.' });
    }

    // ── ATOMIC CLAIM ──────────────────────────────────────────────────────────
    let claimDoc = null;
    for (let i = 0; i < 5; i++) {
      claimDoc = await Lifafa.findOneAndUpdate(
        {
          _id:    lifafa._id,
          status: 'active',
          $expr: {
            $lte: [
              { $add: [
                { $multiply: ['$claimed_users', perAmt] },
                { $ifNull: ['$refer_fund_used', 0] },
                amt
              ]},
              totalFund
            ]
          }
        },
        { $inc: { claimed_users: 1 } },
        { new: true }
      );
      if (claimDoc) break;
      await new Promise(r => setTimeout(r, 60));
    }

    if (!claimDoc) {
      return res.status(400).json({ status: 'error', message: 'Lifafa fund khatam ho gaya!' });
    }

    const now        = new Date();
    const dt         = istTime();
    const newClaimed = claimDoc.claimed_users;

    await User.findByIdAndUpdate(user._id, { $inc: { balance: +amt } });
    await Transaction.create({
      receiver_id: user._id,
      amount:      amt,
      remark:      rem,
      type:        'transfer',
      status:      'success',
      tx_time:     now
    });

    // ── REFER BONUS ───────────────────────────────────────────────────────────
    let referBonus = 0;
    if (ref_code && lifafa.refer_bonus > 0) {
      const referrer = await User.findOne({ tg_id: ref_code.toString() });
      if (referrer && referrer.tg_id !== user.tg_id) {
        const rb = parseFloat(lifafa.refer_bonus.toFixed(2));
        let referDoc = null;
        for (let i = 0; i < 5; i++) {
          referDoc = await Lifafa.findOneAndUpdate(
            {
              _id: lifafa._id,
              $expr: {
                $lte: [
                  { $add: [
                    { $multiply: ['$claimed_users', perAmt] },
                    { $ifNull: ['$refer_fund_used', 0] },
                    rb
                  ]},
                  totalFund
                ]
              }
            },
            { $inc: { refer_fund_used: rb } },
            { new: true }
          );
          if (referDoc) break;
          await new Promise(r => setTimeout(r, 60));
        }
        if (referDoc) {
          referBonus = rb;
          await User.findByIdAndUpdate(referrer._id, { $inc: { balance: referBonus } });
          await Transaction.create({
            receiver_id: referrer._id,
            amount:      referBonus,
            remark:      `Refer Bonus: ${user.tg_id} ne ${code} claim kiya`,
            type:        'transfer',
            status:      'success',
            tx_time:     now
          });
          if (referrer.tg_id) {
            sendTG(referrer.tg_id,
`💰 *Refer Bonus Mila!*

━━━━━━━━━━━━━━
🎁   UNIO REFER BONUS ✅
━━━━━━━━━━━━━━

👤 ${user.name} (TG: ${user.tg_id}) ne aapke refer link se claim kiya!
🔑 Lifafa : \`${code}\`
💰 Bonus : ₹${referBonus}
📅 Time : ${dt}

✅ Balance mein add ho gaya!`
            );
          }
        } else {
          if (referrer.tg_id) {
            sendTG(referrer.tg_id,
`⚠️ *Refer Bonus Nahi Mila!*

━━━━━━━━━━━━━━
🎁   UNIO REFER ALERT ❌
━━━━━━━━━━━━━━

👤 ${user.name} (TG: ${user.tg_id}) ne aapke refer link se claim kiya!
🔑 Lifafa : \`${code}\`
❌ Refer Bonus : ₹${rb} — nahi mila
💸 Wajah : Lifafa ka fund khatam ho gaya tha
📅 Time : ${dt}

Agali baar pehle claim karo! 🙏`
            );
          }
        }
      }
    }

    if (user.tg_id) {
      sendTG(user.tg_id,
`🎉 *Lifafa Claimed!*

━━━━━━━━━━━━━━
🎁   UNIO LIFAFA ✅
━━━━━━━━━━━━━━

🔑 Code : \`${code}\`
💰 Amount : ₹${amt}
📅 Time : ${dt}

✅ Balance mein add ho gaya!`
      );
    }

    const creator = await User.findById(lifafa.creator_id).select('tg_id name');
    const finalClaimUsed = parseFloat((newClaimed * perAmt).toFixed(2));
    const finalReferUsed = parseFloat(((claimDoc.refer_fund_used || 0) + referBonus).toFixed(2));
    const finalUsed      = parseFloat((finalClaimUsed + finalReferUsed).toFixed(2));
    const shouldDelete   = finalUsed >= totalFund;

    if (shouldDelete) {
      await Lifafa.findByIdAndDelete(lifafa._id);
      sendTG(ADMIN_TG_ID,
`🔴 *Lifafa Complete & Deleted!*

🔑 Code : \`${code}\`
👤 Creator : ${creator?.name || '—'}
👥 Total Claimed : ${newClaimed}
💸 Fund Used : ₹${finalUsed} / ₹${totalFund}
📅 Time : ${dt}

🗑️ Auto delete ho gaya!`
      );
      if (creator?.tg_id) {
        sendTG(creator.tg_id,
`🎊 *Lifafa Complete Ho Gaya!*

🔑 Code : \`${code}\`
👥 Claimed : ${newClaimed} users
💸 Fund : ₹${finalUsed} / ₹${totalFund} used
📅 Time : ${dt}

✅ Lifafa successfully completed!`
        );
      }
    } else {
      const remaining = parseFloat((totalFund - finalUsed).toFixed(2));
      if (creator?.tg_id) {
        sendTG(creator.tg_id,
`👋 *Someone Claimed Your Lifafa!*

🔑 Code : \`${code}\`
👤 By : ${user.name} (TG: ${user.tg_id})
💰 Amount : ₹${amt}
💸 Fund Remaining : ₹${remaining} / ₹${totalFund}
📅 Time : ${dt}`
        );
      }
    }

    res.json({
      status:      'success',
      amount:      amt,
      refer_bonus: referBonus,
      wallet_id:   user.wallet_id,
      message:     `₹${amt} added to wallet!`
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;

      
