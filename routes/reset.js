// routes/reset.js
// ─────────────────────────────────────────────────────────────────
//  Admin-only API Transaction Reset
//  - Kisi bhi pichli week ki transactions delete karo
//  - Weekly auto-reset (har 7 din)
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

// ── IST timestamp helper ──────────────────────────────────────────────────────
function istNow() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

// ── Get week boundaries (IST) ─────────────────────────────────────────────────
// weekOffset: 0 = current week, -1 = pichli week, -2 = usse pehle, etc.
function getWeekRange(weekOffset = -1) {
  const now = new Date();
  // IST offset
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);

  // Monday of current IST week
  const day = ist.getUTCDay(); // 0=Sun
  const diffToMon = (day === 0) ? -6 : 1 - day;
  const monday = new Date(ist);
  monday.setUTCDate(ist.getUTCDate() + diffToMon);
  monday.setUTCHours(0, 0, 0, 0);

  // Apply weekOffset (in weeks)
  const weekStart = new Date(monday.getTime() + weekOffset * 7 * 24 * 3600 * 1000);
  const weekEnd   = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000 - 1); // Sunday end

  // Convert back to UTC for DB query
  const startUTC = new Date(weekStart.getTime() - 5.5 * 60 * 60 * 1000);
  const endUTC   = new Date(weekEnd.getTime()   - 5.5 * 60 * 60 * 1000);

  const fmt = d => d.toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric' });

  return {
    start:      startUTC,
    end:        endUTC,
    label:      `${fmt(startUTC)} → ${fmt(endUTC)}`,
    weekOffset
  };
}

// ── Core delete function ──────────────────────────────────────────────────────
// rangeStart, rangeEnd: Date objects for UTC range
// If both null → delete ALL api transactions (full reset)
async function deleteAPITransactions({ start, end, triggeredBy = 'manual', label = '' }) {
  let query = { type: 'api' };
  if (start && end) {
    query.tx_time = { $gte: start, $lte: end };
  }

  const result = await Transaction.deleteMany(query);
  const count  = result.deletedCount;

  await sendTG(ADMIN_TG,
    `🗑️ *API Transactions Reset*\n\n` +
    `📊 Deleted: *${count}* transactions\n` +
    `📅 Range: ${label || 'All'}\n` +
    `⚙️ Trigger: *${triggeredBy}*\n` +
    `🕐 Time: ${istNow()}\n\n` +
    `_UNIO Wallet Reset System_`
  );

  console.log(`✅ [RESET] ${count} deleted | Range: ${label} | By: ${triggeredBy}`);
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /reset/weeks — list of all available weeks with transaction counts
router.get('/weeks', adminAuth, async (req, res) => {
  try {
    // Find oldest API transaction to know how far back to go
    const oldest = await Transaction.findOne({ type: 'api' }).sort({ tx_time: 1 }).select('tx_time');
    if (!oldest) return res.json({ status: 'success', weeks: [] });

    const weeks = [];
    let offset  = -1; // start from last week

    while (true) {
      const range = getWeekRange(offset);
      // Stop if range start is before oldest transaction
      if (range.end < oldest.tx_time) break;

      const count = await Transaction.countDocuments({
        type:    'api',
        tx_time: { $gte: range.start, $lte: range.end }
      });

      weeks.push({
        weekOffset: offset,
        label:      range.label,
        count
      });

      offset--;
      if (offset < -104) break; // max 2 saal back
    }

    res.json({ status: 'success', weeks });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// DELETE /reset/week — specific week delete
// Body: { weekOffset: -1 }  (-1 = last week, -2 = week before that, etc.)
router.delete('/week', adminAuth, async (req, res) => {
  try {
    const weekOffset = parseInt(req.body.weekOffset ?? req.query.weekOffset ?? -1);
    if (weekOffset >= 0)
      return res.status(400).json({ status: 'error', message: 'weekOffset must be negative (pichli weeks only)' });

    const range = getWeekRange(weekOffset);
    const count = await deleteAPITransactions({
      start:       range.start,
      end:         range.end,
      triggeredBy: 'manual-admin',
      label:       range.label
    });

    res.json({
      status:  'success',
      message: `${count} transactions deleted for week: ${range.label}`,
      deleted: count,
      week:    range.label
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// DELETE /reset/api-transactions — delete ALL api transactions
router.delete('/api-transactions', adminAuth, async (req, res) => {
  try {
    const count = await deleteAPITransactions({ triggeredBy: 'manual-admin-all', label: 'ALL' });
    res.json({ status: 'success', message: `${count} API transactions deleted.`, deleted: count });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// GET /reset/api-transactions/count — total count
router.get('/api-transactions/count', adminAuth, async (req, res) => {
  try {
    const count   = await Transaction.countDocuments({ type: 'api' });
    const oldest  = await Transaction.findOne({ type: 'api' }).sort({ tx_time:  1 }).select('tx_time');
    const newest  = await Transaction.findOne({ type: 'api' }).sort({ tx_time: -1 }).select('tx_time');
    res.json({ status: 'success', count, oldest_tx: oldest?.tx_time || null, newest_tx: newest?.tx_time || null });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// GET /reset/next-reset — when is next auto reset
let nextResetTime = Date.now() + 7 * 24 * 3600 * 1000;

router.get('/next-reset', adminAuth, async (req, res) => {
  const remaining = nextResetTime - Date.now();
  const days  = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const mins  = Math.floor((remaining % 3600000) / 60000);
  res.json({
    status:       'success',
    next_reset:   new Date(nextResetTime).toISOString(),
    remaining:    `${days}d ${hours}h ${mins}m`,
    remaining_ms: Math.max(0, remaining)
  });
});

// ── Weekly Auto Reset ─────────────────────────────────────────────────────────
// Har 7 din mein last week ki transactions delete hoti hain automatically
function scheduleWeeklyReset() {
  const WEEK = 7 * 24 * 3600 * 1000;
  const delay = Math.max(0, nextResetTime - Date.now());

  console.log(`⏰ [SCHEDULER] Auto-reset in ${Math.round(delay/3600000)}h`);

  setTimeout(async () => {
    try {
      const range = getWeekRange(-1);
      await deleteAPITransactions({
        start:       range.start,
        end:         range.end,
        triggeredBy: 'weekly-auto',
        label:       range.label
      });
    } catch(e) { console.error('Auto-reset error:', e.message); }
    nextResetTime = Date.now() + WEEK;
    scheduleWeeklyReset();
  }, delay);
}

scheduleWeeklyReset();

module.exports = router;
      
