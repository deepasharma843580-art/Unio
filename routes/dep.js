const express = require('express');
const router = express.Router();
const Deposit = require('../models/dep');
const User = require('../models/User');
const axios = require('axios');

const FAMPAY_UPI = "sumitgausevaksangh@fam";
const FAMPAY_NAME = "UNIO Wallet";
const BOT_TOKEN = process.env.BOT_TOKEN || "7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow";
const ADMIN_TG_ID = "8509393869";

// ── GAS se payment receive ──
router.post('/receive', async (req, res) => {
    try {
        const { amount, txn_id, sender } = req.body;

        if (!amount || !txn_id) {
            return res.status(400).json({ success: false, message: "Missing fields" });
        }

        // Already processed check
        const existing = await Deposit.findOne({ txn_id: txn_id });
        if (existing && existing.status === "success") {
            return res.status(200).json({ success: false, message: "Already processed" });
        }

        // Pending deposit dhundho amount se
        const deposit = await Deposit.findOne({
            amount: String(parseFloat(amount)),
            status: "pending"
        }).sort({ created_at: -1 });

        if (!deposit) {
            // Unmatched save karo
            await Deposit.create({
                uid: "unknown",
                txn_id: txn_id,
                ref_id: "UNMATCHED_" + txn_id,
                amount: String(parseFloat(amount)),
                sender: sender || "Unknown",
                status: "unmatched"
            });

            // Admin ko notify karo
            try {
                await axios.get(
                    "https://api.telegram.org/bot" + BOT_TOKEN +
                    "/sendMessage?chat_id=" + ADMIN_TG_ID +
                    "&text=" + encodeURIComponent(
                        "⚠️ Unmatched Payment!\n\n" +
                        "💰 Amount: ₹" + amount + "\n" +
                        "🆔 Txn: " + txn_id + "\n" +
                        "👤 From: " + (sender || "Unknown")
                    ) +
                    "&parse_mode=HTML"
                );
            } catch(e) {}

            return res.status(200).json({ success: false, message: "No pending deposit found" });
        }

        // Deposit update karo
        deposit.txn_id = txn_id;
        deposit.sender = sender || "Unknown";
        deposit.status = "success";
        deposit.paid_at = new Date();
        await deposit.save();

        // User balance update karo
        const user = await User.findOne({ mobile: deposit.mobile });
        if (user) {
            user.balance = (parseFloat(user.balance || 0) + parseFloat(amount)).toFixed(2);
            await user.save();

            // User ko notify karo
            if (user.telegramId) {
                try {
                    await axios.get(
                        "https://api.telegram.org/bot" + BOT_TOKEN +
                        "/sendMessage?chat_id=" + user.telegramId +
                        "&text=" + encodeURIComponent(
                            "✅ Deposit Successful!\n\n" +
                            "💰 Amount: ₹" + amount + "\n" +
                            "👤 From: " + (sender || "Unknown") + "\n" +
                            "🆔 Txn ID: " + txn_id + "\n\n" +
                            "💵 New Balance: ₹" + user.balance
                        ) +
                        "&parse_mode=HTML"
                    );
                } catch(e) {}
            }
        }

        // Admin ko bhi notify karo
        try {
            await axios.get(
                "https://api.telegram.org/bot" + BOT_TOKEN +
                "/sendMessage?chat_id=" + ADMIN_TG_ID +
                "&text=" + encodeURIComponent(
                    "💰 Deposit Received!\n\n" +
                    "👤 User: " + (user ? user.mobile : deposit.mobile) + "\n" +
                    "💵 Amount: ₹" + amount + "\n" +
                    "🆔 Txn: " + txn_id + "\n" +
                    "👤 From: " + (sender || "Unknown")
                ) +
                "&parse_mode=HTML"
            );
        } catch(e) {}

        return res.status(200).json({ success: true, message: "Payment processed!" });

    } catch(err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ── New deposit create ──
router.post('/create', async (req, res) => {
    try {
        const { uid, mobile, amount } = req.body;

        if (!uid || !amount) {
            return res.status(400).json({ success: false, message: "Missing fields" });
        }

        const amt = parseFloat(amount);
        if (amt < 10) {
            return res.status(400).json({ success: false, message: "Min deposit ₹10!" });
        }

        // Old pending deposits expire karo (30 min se purane)
        await Deposit.updateMany(
            {
                uid: uid,
                status: "pending",
                created_at: { $lt: new Date(Date.now() - 30 * 60 * 1000) }
            },
            { $set: { status: "expired" } }
        );

        // Ref ID generate karo
        const ref_id = "DEP_" + uid + "_" + Date.now();

        // Save deposit
        const deposit = await Deposit.create({
            uid: uid,
            mobile: mobile || uid,
            amount: String(amt),
            ref_id: ref_id,
            status: "pending"
        });

        // QR generate karo
        const upiData = "upi://pay?pa=" + FAMPAY_UPI +
            "&pn=" + encodeURIComponent(FAMPAY_NAME) +
            "&am=" + amt +
            "&tn=" + ref_id +
            "&cu=INR";

        const qr_url = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" +
            encodeURIComponent(upiData);

        return res.status(200).json({
            success: true,
            ref_id: ref_id,
            qr_url: qr_url,
            upi_id: FAMPAY_UPI,
            upi_name: FAMPAY_NAME,
            amount: amt
        });

    } catch(err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ── Payment status check (polling) ──
router.get('/check/:ref_id', async (req, res) => {
    try {
        const deposit = await Deposit.findOne({ ref_id: req.params.ref_id });

        if (!deposit) {
            return res.status(404).json({ success: false, status: "not_found" });
        }

        return res.status(200).json({
            success: true,
            status: deposit.status,
            amount: deposit.amount,
            txn_id: deposit.txn_id || "",
            sender: deposit.sender || "",
            paid_at: deposit.paid_at || ""
        });

    } catch(err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ── Deposit history ──
router.get('/history/:uid', async (req, res) => {
    try {
        const deposits = await Deposit.find({ uid: req.params.uid })
            .sort({ created_at: -1 })
            .limit(10);

        return res.status(200).json({ success: true, deposits: deposits });

    } catch(err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
