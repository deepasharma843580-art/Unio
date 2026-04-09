// routes/reset.js
// ─────────────────────────────────────────────────────────────────
//  Admin-only Transaction Reset — API + Transfer
//  - Kisi bhi pichli week ki transactions delete karo
//  - Weekly auto-reset dono types ke liye (har 7 din)
//  - Admin secret: 8435
// ─────────────────────────────────────────────────────────────────

const router      = require('express').Router();
const Transaction = require('../models/Transaction');
const axios       = require('axios');

const BOT_TOKEN    = process.env.BOT_TOKEN    || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG     = process.env.ADMIN_TG_ID  || '8509393869';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '8435';

// ── Telegram helper ───────────────────────────────────────────────────────────
async function sendTG(chat_id, text) {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id, text, parse_mode: 'Markdown' }, { timeout: 8000 });
  } catch(e) { console.error('TG error:', e.message); }
}

// ── Admin auth middleware ─────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || secret !== ADMIN_SECRET)
    return res.status(403).json({ status: 'error', message: 'Unauthorized' });
  next();
}

// ── IST timestamp ─────────────────────────────────────────────────────────────
function istNow() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

// ── Week range calculator ─────────────────────────────────────────────────────
// weekOffset: -1 = last week, -2 = week before, etc.
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

  const startUTC = new Date(weekStart.getTime() - 5.5 * 60 * 60 * 1000);
  const endUTC   = new Date(weekEnd.getTime()   - 5.5 * 60 * 60 * 1000);

  const fmt = d => d.toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric' });

  return { start: startUTC, end: endUTC, label: `${fmt(startUTC)} → ${fmt(endUTC)}`, weekOffset };
}

// ── Core delete function ──────────────────────────────────────────────────────
// txType: 'api' | 'transfer' | 'both'
async function deleteTxns({ txType = 'api', start, end, triggeredBy = 'manual', label = '' }) {
  let typeQuery;
  if      (txType === 'api')      typeQuery = { type: 'api' };
  else if (txType === 'transfer') typeQuery = { type: 'transfer' };
  else                            typeQuery = { type: { $in: ['api', 'transfer'] } };

  let query = { ...typeQuery };
  if (start && end) query.tx_time = { $gte: start, $lte: end };

  const result = await Transaction.deleteMany(query);
  const count  = result.deletedCount;

  const typeLabel = txType === 'both' ? 'API + Transfer' : txType.toUpperCase();

  await sendTG(ADMIN_TG,
    `🗑️ *${typeLabel} Transactions Reset*\n\n` +
    `📊 Deleted: *${count}* transactions\n` +
    `📅 Range: ${label || 'All'}\n` +
    `⚙️ Trigger: *${triggeredBy}*\n` +
    `🕐 Time: ${istNow()}\n\n` +
    `_UNIO Wallet Reset System_`
  );

  console.log(`✅ [RESET:${typeLabel}] ${count} deleted | ${label} | By: ${triggeredBy}`);
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /reset/weeks?type=api|transfer|both
// Returns all available weeks with counts for given type
router.get('/weeks', adminAuth, async (req, res) => {
  try {
    const txType = req.query.type || 'api'; // 'api', 'transfer', 'both'

    let typeQuery;
    if      (txType === 'api')      typeQuery = { type: 'api' };
    else if (txType === 'transfer') typeQuery = { type: 'transfer' };
    else                            typeQuery = { type: { $in: ['api', 'transfer'] } };

    const oldest = await Transaction.findOne(typeQuery).sort({ tx_time: 1 }).select('tx_time');
    if (!oldest) return res.json({ status: 'success', weeks: [] });

    const weeks = [];
    let offset  = -1;

    while (true) {
      const range = getWeekRange(offset);
      if (range.end < oldest.tx_time) break;

      const count = await Transaction.countDocuments({
        ...typeQuery,
        tx_time: { $gte: range.start, $lte: range.end }
      });

      weeks.push({ weekOffset: offset, label: range.label, count });
      offset--;
      if (offset < -104) break;
    }

    res.json({ status: 'success', weeks });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// DELETE /reset/week
// Body: { weekOffset: -1, txType: 'api'|'transfer'|'both' }
router.delete('/week', adminAuth, async (req, res) => {
  try {
    const weekOffset = parseInt(req.body.weekOffset ?? req.query.weekOffset ?? -1);
    const txType     = req.body.txType || req.query.txType || 'api';

    if (weekOffset >= 0)
      return res.status(400).json({ status: 'error', message: 'weekOffset must be negative' });

    if (!['api','transfer','both'].includes(txType))
      return res.status(400).json({ status: 'error', message: 'txType must be api, transfer, or both' });

    const range = getWeekRange(weekOffset);
    const count = await deleteTxns({
      txType,
      start:       range.start,
      end:         range.end,
      triggeredBy: 'manual-admin',
      label:       range.label
    });

    res.json({
      status:  'success',
      message: `${count} transactions deleted`,
      deleted: count,
      week:    range.label,
      type:    txType
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// GET /reset/count?type=api|transfer|both
router.get('/count', adminAuth, async (req, res) => {
  try {
    const txType = req.query.type || 'api';
    let typeQuery;
    if      (txType === 'api')      typeQuery = { type: 'api' };
    else if (txType === 'transfer') typeQuery = { type: 'transfer' };
    else                            typeQuery = { type: { $in: ['api', 'transfer'] } };

    const [apiCount, transferCount] = await Promise.all([
      Transaction.countDocuments({ type: 'api' }),
      Transaction.countDocuments({ type: 'transfer' })
    ]);

    res.json({ status: 'success', api: apiCount, transfer: transferCount, total: apiCount + transferCount });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Weekly Auto Reset ─────────────────────────────────────────────────────────
// Har 7 din — pichli week ki dono (api + transfer) transactions auto-delete
const WEEK = 7 * 24 * 3600 * 1000;
let nextAPIResetTime      = Date.now() + WEEK;
let nextTransferResetTime = Date.now() + WEEK;

// GET /reset/next-reset
router.get('/next-reset', adminAuth, async (req, res) => {
  const apiRem = nextAPIResetTime - Date.now();
  const trfRem = nextTransferResetTime - Date.now();
  const fmt = ms => {
    const d = Math.floor(ms/86400000), h = Math.floor((ms%86400000)/3600000), m = Math.floor((ms%3600000)/60000);
    return `${d}d ${h}h ${m}m`;
  };
  res.json({
    status: 'success',
    api:      { next_reset: new Date(nextAPIResetTime).toISOString(),      remaining: fmt(Math.max(0,apiRem)),      remaining_ms: Math.max(0,apiRem) },
    transfer: { next_reset: new Date(nextTransferResetTime).toISOString(), remaining: fmt(Math.max(0,trfRem)), remaining_ms: Math.max(0,trfRem) }
  });
});

function scheduleAutoReset(txType) {
  const nextTime = txType === 'api' ? nextAPIResetTime : nextTransferResetTime;
  const delay    = Math.max(0, nextTime - Date.now());

  setTimeout(async () => {
    try {
      const range = getWeekRange(-1);
      await deleteTxns({ txType, start: range.start, end: range.end, triggeredBy: 'weekly-auto', label: range.label });
    } catch(e) { console.error(`Auto-reset [${txType}] error:`, e.message); }

    if (txType === 'api') nextAPIResetTime      = Date.now() + WEEK;
    else                  nextTransferResetTime  = Date.now() + WEEK;
    scheduleAutoReset(txType);
  }, delay);

  console.log(`⏰ [SCHEDULER:${txType}] Next auto-reset in ${Math.round(delay/3600000)}h`);
}

scheduleAutoReset('api');
scheduleAutoReset('transfer');

module.exports = router;
