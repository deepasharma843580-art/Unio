// --- Send Forgot OTP (Format as requested) ---
router.post('/send-forgot-otp', async (req, res) => {
  try {
    const { tg_id } = req.body;
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    
    // otpStore mein save karo (auth.js mein already define hai)
    otpStore[tg_id] = { otp, expires: Date.now() + 5 * 60 * 1000 };

    await sendTG(tg_id, 
      `<b>FORGOT PASSWORD</b> 🔑\n\n` +
      `<b>OTP = ${otp}</b>\n\n` +
      `KEEP YOUR PASSWORD SAFE\n\n` +
      `THANKS FROM UNIO HAZEL ❤️`
    );
    res.json({ status: 'success' });
  } catch(e) { res.status(500).json({ status:'error', message: e.message }); }
});

// --- Verify OTP ---
router.post('/verify-forgot-otp', async (req, res) => {
    const { tg_id, otp } = req.body;
    const stored = otpStore[tg_id];
    if(stored && stored.otp === otp.toString() && Date.now() < stored.expires) {
        // Verification success
        res.json({ status: 'success' });
    } else {
        res.status(400).json({ status: 'error', message: 'Invalid OTP' });
    }
});

// --- Final Password Reset ---
router.post('/reset-password', async (req, res) => {
    try {
        const { mobile, password } = req.body;
        // Seedhe database update
        const user = await User.findOne({ mobile });
        if(!user) return res.status(404).json({ status:'error', message:'User not found' });
        
        user.password = password; // hashed ho jayega agar schema mein .pre('save') hai
        await user.save();
        
        res.json({ status: 'success', message: 'DB updated' });
    } catch(e) { res.status(500).json({ status:'error', message: e.message }); }
});
           
