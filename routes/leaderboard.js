// routes/leaderboard.js
// Add to server.js: app.use('/leaderboard', require('./routes/leaderboard'));

const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');

// GET /leaderboard/users
// Returns top 10 users by total API transactions count & amount
router.get('/users', async (req, res) => {
  try {
    // Aggregate API type transactions grouped by sender
    const apiStats = await Transaction.aggregate([
      { $match: { type: 'api', status: 'success' } },
      {
        $group: {
          _id:          '$sender_id',
          total_txns:   { $sum: 1 },
          total_amount: { $sum: '$amount' }
        }
      },
      { $sort: { total_txns: -1, total_amount: -1 } },
      { $limit: 10 }
    ]);

    // Populate user details
    const leaderboard = await Promise.all(
      apiStats.map(async (stat, index) => {
        const user = await User.findById(stat._id).select('name mobile');
        return {
          rank:         index + 1,
          name:         user ? user.name   : 'Unknown',
          mobile:       user ? (user.mobile.slice(0,4) + 'XXXXXX') : '---',  // masked
          total_txns:   stat.total_txns,
          total_amount: stat.total_amount
        };
      })
    );

    res.json({
      status: 'success',
      updated_at: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      leaderboard
    });

  } catch(e) {
    console.error('Leaderboard error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
      
