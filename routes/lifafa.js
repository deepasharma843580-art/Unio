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
// Helper: Lifafa finish — bacha hua fund creator ko refund, phir delete
// ─────────────────────────────────────────────────────────────────────────────
async function finishLifafa(lifafa, finalClaimedFund, finalClaimedUsers) {
  const dt = istTime();

  const perAmt    = lifafa.per_user_amount > 0 ? lifafa.per_user_amount : lifafa.max_range;
  const totalFund = parseFloat((perAmt * lifafa.max_users).toFixed(2));
  const remaining = parseFloat((totalFund - finalClaimedFund).toFixed(2));

  // ── Refund karo agar kuch bacha ──
  if (remaining > 0.00) {
    const creator = await User.findByIdAndUpdate(
      lifafa.creator_id,
      { $inc: { balance: remaining } },
      { new: true }
    );
    await Transaction.create({
      receiver_id: lifafa.creator_id,
      amount:      remaining,
      remark:      `Lifafa Refund: ${lifafa.code} (unused ₹${remaining})`,
      type:        'transfer',
      status:      'success',
      tx_time:     new Date()
    });
    if (creator?.tg_id) {
      sendTG(creator.tg_id,
`♻️ *Lifafa Fund Refund!*

━━━━━━━━━━━━━━
🎁   UNIO LIFAFA ✅
━━━━━━━━━━━━━━

🔑 Code     : \`${lifafa.code}\`
💰 Total Fund : ₹${totalFund}
💸 Fund Used  : ₹${finalClaimedFund}
♻️ *Refund    : ₹${remaining}*
📅 Time       : ${dt}

✅ Bacha hua fund aapke wallet mein wapas aa gaya!`
      );
    }
  }

  // ── Delete lifafa ──
  await Lifafa.findByIdAndDelete(lifafa._id);

  const creator = await User.findById(lifafa.creator_id).select('tg_id name');

  sendTG(ADMIN_TG_ID,
`🔴 *Lifafa Complete & Deleted*

🔑 Code    : \`${lifafa.code}\`
👤 Creator : ${creator?.name || '—'}
👥 Claimed : ${finalClaimedUsers}/${lifafa.max_users}
💸 Used    : ₹${finalClaimedFund} / ₹${totalFund}
♻️ Refund  : ₹${remaining}
📅 Time    : ${dt}`
  );

  if (creator?.tg_id) {
    sendTG(creator.tg_id,
`🎊 *Lifafa Complete Ho Gaya!*

🔑 Code    : \`${lifafa.code}\`
👥 Claimed : ${finalClaimedUsers}/${lifafa.max_users}
💸 Used    : ₹${finalClaimedFund} / ₹${totalFund}
${remaining > 0 ? `♻️ Refund  : ₹${remaining} wallet mein wapas` : '✅ Pura fund use hua!'}
📅 Time    : ${dt}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /lifafa/referrer-by-mobile/:mobile
// ─────────────────────────────────────────────────────────────────────────────
router.get('/referrer-by-mobile/:mobile', async (req, res) => {
  try {
    const referrer = await User.findOne({ mobile: req.params.mobile }).select('name mobile');
    if (!referrer) return res.status(404).json({ status: 'error', message: 'User not found' });
    res.json({ status: 'success', name: referrer.name, mobile: referrer.mobile });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /lifafa/referrer/:walletId
// ─────────────────────────────────────────────────────────────────────────────
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
// Creator se sirf base fund deduct hoga (amt × users)
// Refer bonus usi fund mein se aayega — 1 paisa extra nahi
// ─────────────────────────────────────────────────────────────────────────────
router.post('/create', auth, async (req, res) => {
  try {
    const { code, type, amt, min_range, max_range, toss_answer, users, channels, refer_bonus } = req.body;

    const usersInt  = parseInt(users);
    const perAmt    = type === 'scratch' ? parseFloat(max_range) : parseFloat(amt);
    const rb        = parseFloat(refer_bonus) || 0;

    // ✅ Sirf base fund — refer bonus fund mein se hi niklegaa
    const total = parseFloat((perAmt * usersInt).toFixed(2));

    // ── Validation: refer_bonus per_user_amount se kam hona chahiye ──
    if (rb > 0 && rb >= perAmt) {
      return res.status(400).json({
        status:  'error',
        message: `Refer bonus (₹${rb}) per user amount (₹${perAmt}) se kam hona chahiye!`
      });
    }

    const sender = await User.findById(req.user._id);
    if (!sender) return res.status(404).json({ status: 'error', message: 'User not found' });

    if (sender.balance < total)
      return res.status(400).json({ status: 'error', message: `Insufficient balance. Need ₹${total}` });

    if (await Lifafa.findOne({ code: code.toUpperCase() }))
      return res.status(400).json({ status: 'error', message: 'Code already exists' });

    await User.findByIdAndUpdate(sender._id, { $inc: { balance: -total } });
    await Transaction.create({
      sender_id: sender._id,
      amount:    total,
      type:      'transfer',
      status:    'success',
      remark:    `Created ${type} Lifafa: ${code}`,
      tx_time:   new Date()
    });

    const lifafa = await Lifafa.create({
      creator_id:      sender._id,
      creator_mobile:  sender.mobile,
      code:            code.toUpperCase(),
      type,
      per_user_amount: parseFloat(amt)       || 0,
      min_range:       parseFloat(min_range) || 0,
      max_range:       parseFloat(max_range) || 0,
      toss_answer:     toss_answer           || '',
      max_users:       usersInt,
      channels:        channels              || [],
      refer_bonus:     rb,
      claimed_fund:    0,
      claimed_users:   0
    });

    const dt = istTime();

    if (sender.tg_id) {
      sendTG(sender.tg_id,
`🎁 *Lifafa Created!*

━━━━━━━━━━━━━━
🎁   UNIO LIFAFA ✅
━━━━━━━━━━━━━━

🔑 Code        : \`${lifafa.code}\`
📋 Type        : ${type.toUpperCase()}
👥 Users       : ${usersInt}
💰 Per User    : ₹${perAmt}
💸 Total Fund  : ₹${total}
🎯 Refer Bonus : ${rb > 0 ? '₹' + rb + ' per refer (fund mein se)' : 'Off'}
📅 Date        : ${dt}

━━━━━━━━━━━━━━
Claim Link: ${process.env.APP_URL || ''}/claim.html?code=${lifafa.code}
Share karo! 🚀`
      );
    }

    sendTG(ADMIN_TG_ID,
`🎁 *New Lifafa Created*

👤 By         : ${sender.name} (${sender.mobile})
🔑 Code       : \`${lifafa.code}\`
📋 Type       : ${type} | 👥 ${usersInt} users
💸 Total Fund : ₹${total}
🎯 Refer      : ${rb > 0 ? '₹' + rb + ' per refer (fund mein se)' : 'Off'}`
    );

    res.json({
      status:         'success',
      code:           lifafa.code,
      claim_url:      `/claim.html?code=${lifafa.code}`,
      total_deducted: total,
      refer_bonus:    lifafa.refer_bonus
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /lifafa/:code
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:code', async (req, res) => {
  try {
    const l = await Lifafa.findOne({ code: req.params.code.toUpperCase(), status: 'active' })
      .populate('creator_id', 'name');
    if (!l) return res.status(404).json({ status: 'error', message: 'Invalid or expired code' });
    res.json({ status: 'success', lifafa: l });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /lifafa/claim
//
// FUND LOGIC:
//   totalFund  = per_user_amount × max_users  (fixed, creator ne itna hi diya)
//   Claim amt  → fund mein se
//   Refer bonus → fund mein se (atomic check: claimed_fund + amt + rb <= totalFund)
//   Agar fund mein jagah nahi → refer nahi milega, 0 paisa extra nahi jaayega
//   Lifafa complete → bacha hua fund creator ko refund
// ─────────────────────────────────────────────────────────────────────────────
router.post('/claim', async (req, res) => {
  try {
    const { code, mobile, guess, ref_code } = req.body;

    const user = await User.findOne({ mobile });
    if (!user) return res.status(404).json({ status: 'error', message: 'Mobile not found' });

    const lifafa = await Lifafa.findOne({ code: code.toUpperCase(), status: 'active' });
    if (!lifafa) return res.status(404).json({ status: 'error', message: 'Invalid or expired code' });

    // Already claimed check
    const rem = `Loot_${code}_${mobile}`;
    if (await Transaction.findOne({ remark: rem }))
      return res.status(400).json({ status: 'error', message: 'Already claimed!' });

    if (lifafa.claimed_users >= lifafa.max_users)
      return res.status(400).json({ status: 'error', message: 'Lifafa is full!' });

    // ── Total fund (creator ne itna hi diya, 1 paisa zyada nahi) ──
    const perAmt    = lifafa.per_user_amount > 0 ? lifafa.per_user_amount : lifafa.max_range;
    const totalFund = parseFloat((perAmt * lifafa.max_users).toFixed(2));

    // ── Claim amount decide ──
    let amt = lifafa.per_user_amount;
    if (lifafa.type === 'scratch') {
      amt = Math.floor(
        Math.random() * (lifafa.max_range * 100 - lifafa.min_range * 100 + 1)
        + lifafa.min_range * 100
      ) / 100;
    }
    amt = parseFloat(amt.toFixed(2));

    // ── Toss check ──
    if (lifafa.type === 'toss' && (!guess || guess.toUpperCase() !== lifafa.toss_answer.toUpperCase())) {
      await Transaction.create({
        receiver_id: user._id, amount: 0, remark: rem,
        type: 'transfer', status: 'failed', tx_time: new Date()
      });
      return res.status(400).json({ status: 'error', message: 'Wrong guess! Locked.' });
    }

    // ── Referrer check (pehle karo taaki rb pata ho) ──
    const rb          = parseFloat((lifafa.refer_bonus || 0).toFixed(2));
    let   referrer    = null;
    let   referBonus  = 0;

    if (ref_code && rb > 0) {
      const candidate = await User.findOne({ mobile: ref_code.toString() });
      if (candidate && candidate.mobile !== mobile) {
        referrer = candidate;
      }
    }

    // ── ATOMIC CLAIM: claim + refer ek saath ──
    // Agar referrer hai → ek hi atomic update mein amt + rb dono check karo
    // Agar nahi         → sirf amt check
    const totalDeduct = referrer ? parseFloat((amt + rb).toFixed(2)) : amt;

    let claimDoc = null;
    for (let i = 0; i < 5; i++) {
      claimDoc = await Lifafa.findOneAndUpdate(
        {
          _id:           lifafa._id,
          status:        'active',
          claimed_users: { $lt: lifafa.max_users },
          // ✅ claimed_fund + (amt + rb) <= totalFund — fund se bahar nahi jaayega
          $expr: { $lte: [{ $add: ['$claimed_fund', totalDeduct] }, totalFund] }
        },
        { $inc: { claimed_users: 1, claimed_fund: totalDeduct } },
        { new: true }
      );
      if (claimDoc) break;
      await new Promise(r => setTimeout(r, 60));
    }

    // ── Agar refer ke saath fund nahi tha → refer ke bina try karo ──
    if (!claimDoc && referrer) {
      for (let i = 0; i < 5; i++) {
        claimDoc = await Lifafa.findOneAndUpdate(
          {
            _id:           lifafa._id,
            status:        'active',
            claimed_users: { $lt: lifafa.max_users },
            $expr: { $lte: [{ $add: ['$claimed_fund', amt] }, totalFund] }
          },
          { $inc: { claimed_users: 1, claimed_fund: amt } },
          { new: true }
        );
        if (claimDoc) { referrer = null; break; } // refer nahi milega
        await new Promise(r => setTimeout(r, 60));
      }
    }

    if (!claimDoc) {
      return res.status(400).json({ status: 'error', message: 'Lifafa fund khatam ho gaya!' });
    }

    const now         = new Date();
    const dt          = istTime();
    const newClaimed  = claimDoc.claimed_users;
    const usedSoFar   = parseFloat(claimDoc.claimed_fund.toFixed(2));

    // ── Credit claimer ──
    await User.findByIdAndUpdate(user._id, { $inc: { balance: amt } });
    await Transaction.create({
      receiver_id: user._id,
      amount:      amt,
      remark:      rem,
      type:        'transfer',
      status:      'success',
      tx_time:     now
    });

    // ── Credit referrer (already atomically deducted from fund above) ──
    if (referrer) {
      referBonus = rb;
      await User.findByIdAndUpdate(referrer._id, { $inc: { balance: referBonus } });
      await Transaction.create({
        receiver_id: referrer._id,
        amount:      referBonus,
        remark:      `Refer Bonus: ${mobile} ne ${code} claim kiya`,
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

👤 ${user.name} (${mobile}) ne aapke refer link se claim kiya!
🔑 Lifafa : \`${code}\`
💰 Bonus  : ₹${referBonus}
📅 Time   : ${dt}

✅ Balance mein add ho gaya!`
        );
      }
    }

    // ── TG to claimer ──
    if (user.tg_id) {
      sendTG(user.tg_id,
`🎉 *Lifafa Claimed!*

━━━━━━━━━━━━━━
🎁   UNIO LIFAFA ✅
━━━━━━━━━━━━━━

🔑 Code   : \`${code}\`
💰 Amount : ₹${amt}
👥 ${newClaimed}/${lifafa.max_users} Claimed
📅 Time   : ${dt}

✅ Balance mein add ho gaya!`
      );
    }

    // ── Auto-finish check: max_users poore ya fund khatam ──
    const shouldFinish = newClaimed >= lifafa.max_users || usedSoFar >= totalFund;
    if (shouldFinish) {
      // finishLifafa background mein chalao — response wait na kare
      finishLifafa(lifafa, usedSoFar, newClaimed).catch(() => {});
    } else {
      const creator = await User.findById(lifafa.creator_id).select('tg_id name');
      if (creator?.tg_id) {
        sendTG(creator.tg_id,
`👋 *Someone Claimed Your Lifafa!*

🔑 Code    : \`${code}\`
👤 By      : ${user.name} (${mobile})
💰 Amount  : ₹${amt}
💸 Fund    : ₹${usedSoFar} / ₹${totalFund} used
📅 Time    : ${dt}

⏳ ${lifafa.max_users - newClaimed} slots bache hain`
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
        
