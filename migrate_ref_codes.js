/**
 * migrate_ref_codes.js
 * ─────────────────────────────────────────────
 * Ek baar chalao — sab purane users ka ref_code
 * generate ho jayega jo abhi tak empty/missing hai.
 *
 * Usage:
 *   node migrate_ref_codes.js
 *
 * Apna MongoDB URI niche set karo ya .env se lo.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { generateRefCode } = require('./models/User');
const User = require('./models/User');

const MONGO_URI = process.env.MONGO_URI || 'YOUR_MONGODB_URI_HERE';

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected');

  // Sirf woh users jinka ref_code empty ya missing hai
  const users = await User.find({
    $or: [{ ref_code: '' }, { ref_code: null }, { ref_code: { $exists: false } }]
  });

  console.log(`Found ${users.length} users without ref_code`);

  let updated = 0;
  for(const user of users) {
    const code = generateRefCode(user.mobile);
    await User.findByIdAndUpdate(user._id, { ref_code: code });
    updated++;
    console.log(`  ✔ ${user.mobile} → ${code}`);
  }

  console.log(`\n✅ Done! ${updated} users updated.`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});

