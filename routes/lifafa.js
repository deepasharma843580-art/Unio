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

// GET /lifafa/referrer-by-mobile/:mobile
router.get('/referrer-by-mobile/:mobile', async (req, res) => {
  try {
    const referrer = await User.findOne({ mobile: req.params.mobile }).select('name mobile');
    if (!referrer) return res.status(404).json({ status: 'error', message: 'User not found' });
    res.json({ status: 'success', name: referrer.name, mobile: referrer.mobile });
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
// ─────────────────────────────────────────────────────────────────────────────
router.post('/create', auth, async (req, res) => {
  try {
    const { code, type, amt, min_range, max_range, toss_answer, users, channels, refer_bonus } = req.body;

    // total_fund = perAmt × users (creator yahi pay karta hai)
    const perAmt     = type === 'scratch' ? parseFloat(max_range) : parseFloat(amt);
    const totalFund  = parseFloat((perAmt * parseInt(users)).toFixed(2));

    if (!totalFund || totalFund <= 0)
      return res.status(400).json({ status: 'error', message: 'Invalid amount/users' });

    const sender = await User.findById(req.user._id);
    if (!sender) return res.status(404).json({ status: 'error', message: 'User not found' });

    if (sender.balance < totalFund)
      return res.status(400).json({ status: 'error', message: `Insufficient balance. Need ₹${totalFund}` });

    if (await Lifafa.findOne({ code: code.toUpperCase() }))
      return res.status(400).json({ status: 'error', message: 'Code already exists' });

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

    const lifafa = await Lifafa.create({
      creator_id:      sender._id,
      creator_mobile:  sender.mobile,
      code:            code.toUpperCase(),
      type,
      per_user_amount: parseFloat(amt)       || 0,
      min_range:       parseFloat(min_range) || 0,
      max_range:       parseFloat(max_range) || 0,
      toss_answer:     toss_answer           || '',
      max_users:       parseInt(users),           // kept for display reference only
      channels:        channels              || [],
      refer_bonus:     parseFloat(refer_bonus) || 0,
      refer_fund_used: 0,
      // claimed_fund tracked via claimed_users * per_user_amount approx,
      // but we store total_fund in a virtual — use max_users×perAmt as totalFund
    });

    const dt = istTime();

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
📅 Date : ${dt}

━━━━━━━━━━━━━━
Claim Link: ${process.env.APP_URL || ''}/claim.html?code=${lifafa.code}
Share karo! 🚀`
      );
    }

    sendTG(ADMIN_TG_ID,
`🎁 *New Lifafa Created*

👤 By : ${sender.name} (${sender.mobile})
🔑 Code : \`${lifafa.code}\`
📋 Type : ${type} | 💸 Fund : ₹${totalFund}
🎯 Refer : ${parseFloat(refer_bonus) > 0 ? '₹' + refer_bonus : 'Off'}`
    );

    res.json({
      status:         'success',
      code:           lifafa.code,
      claim_url:      `/claim.html?code=${lifafa.code}`,
      total_deducted: totalFund,
      refer_bonus:    lifafa.refer_bonus
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

    const perAmt        = l.per_user_amount > 0 ? l.per_user_amount : l.max_range;
    const totalFund     = parseFloat((perAmt * l.max_users).toFixed(2));
    // claimed_fund = users ne kya liya (claimed_users × perAmt approx nahi — we track in DB)
    // Schema mein claimed_fund nahi hai, toh hum claimed_users se estimate karte hain
    // BUT scratch mein random amount hai — toh accurate track ke liye
    // claimed_fund field add karo schema mein, ya refer_fund_used se kaam chalao
    // Abhi: claimed_fund = totalFund - remaining
    // remaining = totalFund - refer_fund_used - (claimed_users × perAmt for standard/toss)
    // For scratch: claimed_fund ko alag track karna padega — isliye schema mein add karo
    // SIMPLE: total_used = refer_fund_used + (claimed_users * perAmt) [standard/toss ke liye exact]
    const claimUsed     = parseFloat((l.claimed_users * perAmt).toFixed(2));
    const referUsed     = parseFloat((l.refer_fund_used || 0).toFixed(2));
    const totalUsed     = parseFloat((claimUsed + referUsed).toFixed(2));
    const remaining     = parseFloat(Math.max(0, totalFund - totalUsed).toFixed(2));

    const obj = l.toObject ? l.toObject() : l;
    res.json({
      status: 'success',
      lifafa: { ...obj, total_fund: totalFund, total_used: totalUsed, remaining }
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /lifafa/claim
// Fund-based: sirf fund check, max_users secondary guard hai
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

    // Total fund
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
    // Fund check: (claimed_users × perAmt) + refer_fund_used + amt <= totalFund
    // refer_fund_used schema mein already hai ✅
    // ─────────────────────────────────────────────────────────────────────────
    let claimDoc = null;
    for (let i = 0; i < 5; i++) {
      claimDoc = await Lifafa.findOneAndUpdate(
        {
          _id:    lifafa._id,
          status: 'active',
          // Fund check: current claim_fund_used + refer_fund_used + naya amt <= totalFund
          $expr: {
            $lte: [
              { $add: [
                { $multiply: ['$claimed_users', perAmt] },  // already claimed amount
                { $ifNull: ['$refer_fund_used', 0] },       // refer bonuses diye gaye
                amt                                          // naya claim
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

    // Credit claimer
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
    // Fund check: (claimed_users × perAmt) + refer_fund_used + rb <= totalFund
    // claimDoc mein claimed_users already +1 ho chuka hai (naya claim include)
    // ─────────────────────────────────────────────────────────────────────────
    let referBonus = 0;
    if (ref_code && lifafa.refer_bonus > 0) {
      const referrer = await User.findOne({ mobile: ref_code.toString() });

      if (referrer && referrer.mobile !== mobile) {
        const rb = parseFloat(lifafa.refer_bonus.toFixed(2));

        let referDoc = null;
        for (let i = 0; i < 5; i++) {
          referDoc = await Lifafa.findOneAndUpdate(
            {
              _id: lifafa._id,
              // Fund check after claim: (new claimed_users × perAmt) + refer_fund_used + rb <= totalFund
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
            { $inc: { refer_fund_used: rb } },  // ← schema ka field ✅
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

👤 ${user.name} (${mobile}) ne aapke refer link se claim kiya!
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

    // TG to claimer
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

    // Final used = (new claimed_users × perAmt) + (refer_fund_used + referBonus)
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
👤 By : ${user.name} (${mobile})
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
                                                                                
