const axios       = require('axios');
const User        = require('../models/User');

const BOT_TOKEN   = process.env.BOT_TOKEN   || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '8509393869';

async function sendTG(tg_id, text) {
  if(!tg_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id:    tg_id,
      text:       text,
      parse_mode: 'Markdown'
    }, { timeout: 8000 });
  } catch(e) {
    console.error('TG Error:', e.message);
  }
}

async function notifyPayment({ txId, amt, comment, dt, senderId, receiverId, to }) {
  try {
    const sNew = await User.findById(senderId).select('balance tg_id name mobile');
    const rNew = await User.findById(receiverId).select('balance tg_id name mobile');

    // Debit Alert → Sender
    if(sNew && sNew.tg_id && sNew.tg_id !== ADMIN_TG_ID) {
      await sendTG(sNew.tg_id,
`⚡ *DEBIT ALERT*

━━━━━━━━━━━━━━
⚡   UNIO WALLET ✅ ⚡
━━━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 Sent To : \`${to}\`
👤 Name : ${rNew?.name||'User'}
🆔 Txn ID : \`${txId}\`
📋 Type : API TRANSFER
💬 Comment : ${comment||'—'}
📅 Date : ${dt}

━━━━━━━━━━━━━━
🪙 Balance : ₹${sNew.balance}
━━━━━━━━━━━━━━

⚡ Amount Debited through UNIO Wallet`
      );
    }

    // Credit Alert → Receiver
    if(rNew && rNew.tg_id && rNew.tg_id !== ADMIN_TG_ID) {
      await sendTG(rNew.tg_id,
`⚡ *CREDIT ALERT*

━━━━━━━━━━━━━━
⚡   UNIO WALLET ✅ ⚡
━━━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 From : \`${sNew?.mobile||'—'}\`
👤 Name : ${sNew?.name||'User'}
🆔 Txn ID : \`${txId}\`
📋 Type : API TRANSFER
💬 Comment : ${comment||'—'}
📅 Date : ${dt}

━━━━━━━━━━━━━━
🪙 Balance : ₹${rNew.balance}
━━━━━━━━━━━━━━

⚡ Amount Credited through UNIO Wallet`
      );
    }

    // Admin Alert
    if(ADMIN_TG_ID) {
      await sendTG(ADMIN_TG_ID,
`⚡ *API TRANSACTION*

💰 Amount : ₹${amt}
👤 From : ${sNew?.name||'User'} (${sNew?.mobile||'—'})
👤 To : ${rNew?.name||'User'} (${to})
💬 Comment : ${comment||'—'}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}`
      );
    }

  } catch(e) {
    console.error('Notify error:', e.message);
  }
}

module.exports = { notifyPayment };

