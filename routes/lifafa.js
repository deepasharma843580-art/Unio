const router      = require('express').Router();
const mongoose    = require('mongoose');
const User        = require('../models/User');
const Lifafa      = require('../models/Lifafa');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');

// ── CREATE ──
router.post('/create', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      code, type, amt, min_range, max_range,
      toss_answer, users, channels,
      refer_enabled, refer_amt
    } = req.body;

    const total = (type === 'scratch')
      ? (parseFloat(max_range) * parseInt(users))
      : (parseFloat(amt) * parseInt(users));

    const sender = await User.findById(req.user._id);
    if(sender.balance < total)
      return res.status(400).json({ status:'error', message:`Insufficient balance. Need ₹${total}` });
    if(await Lifafa.findOne({ code: code.toUpperCase() }))
      return res.status(400).json({ status:'error', message:'Code already exists' });

    await User.findByIdAndUpdate(sender._id, { $inc:{ balance:-total } }, { session });
    await Transaction.create([{
      sender_id:sender._id, amount:total, type:'transfer',
      status:'success', remark:`Created ${type} Lifafa: ${code}`
    }], { session });

    const lifafa = await Lifafa.create([{
      creator_id:      sender._id,
      creator_mobile:  sender.mobile,
      code:            code.toUpperCase(),
      type,
      per_user_amount: parseFloat(amt)||0,
      min_range:       parseFloat(min_range)||0,
      max_range:       parseFloat(max_range)||0,
      toss_answer:     toss_answer||'',
      max_users:       parseInt(users),
      channels:        channels||[],
      refer_enabled:   refer_enabled === true,
      refer_amt:       refer_enabled ? (parseFloat(refer_amt)||0) : 0
    }], { session });

    await session.commitTransaction();
    res.json({
      status:'success',
      code:lifafa[0].code,
      claim_url:`/claim/${lifafa[0].code}`,
      total_deducted:total
    });
  } catch(e) {
    await session.abortTransaction();
    res.status(500).json({ status:'error', message:e.message });
  } finally { session.endSession(); }
});

// ── GET LIFAFA INFO ──
router.get('/:code', async (req, res) => {
  const l = await Lifafa.findOne({
    code:req.params.code.toUpperCase(), status:'active'
  }).populate('creator_id','name');
  if(!l) return res.status(404).json({ status:'error', message:'Invalid or expired code' });
  res.json({
    status:'success',
    lifafa:{
      _id:           l._id,
      code:          l.code,
      type:          l.type,
      max_users:     l.max_users,
      claimed_users: l.claimed_users,
      channels:      l.channels,
      status:        l.status,
      refer_enabled: l.refer_enabled,
      refer_amt:     l.refer_amt
    }
  });
});

// ── CLAIM ──
router.post('/claim', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { code, mobile, guess, referred_by } = req.body;

    const user = await User.findOne({ mobile });
    if(!user) return res.status(404).json({ status:'error', message:'Mobile not found' });

    const lifafa = await Lifafa.findOne({ code:code.toUpperCase(), status:'active' });
    if(!lifafa) return res.status(404).json({ status:'error', message:'Invalid or expired code' });

    const rem = `Loot_${code}_${mobile}`;
    if(await Transaction.findOne({ remark:rem }))
      return res.status(400).json({ status:'error', message:'Already claimed!' });
    if(lifafa.claimed_users >= lifafa.max_users)
      return res.status(400).json({ status:'error', message:'Lifafa is full!' });

    let amt = lifafa.per_user_amount;
    if(lifafa.type === 'scratch')
      amt = Math.floor(Math.random()*(lifafa.max_range*100 - lifafa.min_range*100+1)+lifafa.min_range*100)/100;
    if(lifafa.type === 'toss' && (!guess || guess.toUpperCase() !== lifafa.toss_answer.toUpperCase())) {
      await Transaction.create([{ receiver_id:user._id, amount:0, remark:rem, type:'transfer', status:'failed' }], { session });
      await session.commitTransaction();
      return res.status(400).json({ status:'error', message:'Wrong guess! Locked.' });
    }

    await User.findByIdAndUpdate(user._id, { $inc:{ balance:+amt } }, { session });
    await Lifafa.findByIdAndUpdate(lifafa._id, { $inc:{ claimed_users:1 } }, { session });
    await Transaction.create([{
      receiver_id:user._id, amount:amt,
      remark:rem, type:'transfer', status:'success'
    }], { session });

    // ── Refer Bonus ──
    let referBonus = 0;
    if(lifafa.refer_enabled && lifafa.refer_amt > 0 && referred_by && referred_by !== mobile) {
      // referred_by is 5-digit ref_code — find matching user
      let referrer = await User.findOne({ mobile: referred_by });
      if(!referrer) referrer = await User.findOne({ ref_code: referred_by });
      if(referrer && referrer.mobile !== mobile) {
        referBonus = lifafa.refer_amt;
        await User.findByIdAndUpdate(referrer._id, { $inc:{ balance:+referBonus } }, { session });
        await Transaction.create([{
          receiver_id: referrer._id,
          amount:      referBonus,
          remark:      `ReferBonus_${code}_${mobile}`,
          type:        'transfer',
          status:      'success'
        }], { session });
      }
    }

    await session.commitTransaction();
    res.json({
      status:'success',
      amount:amt,
      message:`₹${amt} added to wallet!`,
      refer_bonus_given: referBonus > 0,
      refer_bonus_amt:   referBonus
    });
  } catch(e) {
    await session.abortTransaction();
    res.status(500).json({ status:'error', message:e.message });
  } finally { session.endSession(); }
});

module.exports = router;
                       
