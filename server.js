require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limit payment API
const payLimiter = rateLimit({ windowMs: 15*60*1000, max: 200,
  message: { status:'error', message:'Too many requests' } });

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',     require('./routes/auth'));
app.use('/wallet',   require('./routes/wallet'));
app.use('/transfer', require('./routes/transfer'));
app.use('/lifafa',   require('./routes/lifafa'));
app.use('/admin',    require('./routes/admin'));

// ★ THE MAIN PAYMENT API ★
// /payment?key={api_key}&to={mobile}&amt={amount}
app.use('/payment', payLimiter, require('./routes/payment'));

// DB Connect
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(e => console.error('❌ DB Error:', e.message));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 UNIO Wallet on port ${PORT}`));
