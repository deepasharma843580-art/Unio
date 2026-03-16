# 💰 UNIO Wallet — Open Source

Digital Wallet with P2P Transfer, UPI Deposit, Withdraw, Lifafa System & Payment API.

---

## ⚡ Quick Setup

```bash
git clone https://github.com/yourusername/unio-wallet
cd unio-wallet
npm install
cp .env.example .env
# .env fill karo
npm start
```

---

## 🌐 Free Deploy

| Service | Kya hai |
|---------|---------|
| [Render.com](https://render.com) | Node.js backend free |
| [MongoDB Atlas](https://mongodb.com/atlas) | Database free 512MB |

---

## 📡 Payment API

### Main Endpoint
```
GET /payment?key={api_key}&to={mobile}&amt={amount}
```

**Example:**
```
https://yourapp.render.com/payment?key=UW-abc123&to=9876543210&amt=50
```

**Optional params:**
```
&remark=Order%20Payment
&txn=YOUR_TXN_ID        ← duplicate prevention
```

**Success Response:**
```json
{
  "status": "success",
  "message": "Transfer Done",
  "amount": 50,
  "txn": "UNIOA1B2C3D4E5",
  "tx_id": "TX17234567890"
}
```

**Error Response:**
```json
{ "status": "error", "message": "Receiver 9876543210 not found" }
```

---

### Balance Check
```
GET /payment/balance?key={api_key}
```

### Verify User
```
GET /payment/verify?key={api_key}&mobile=9876543210
```

---

## 🔐 User API

### Register
```http
POST /auth/register
{ "name": "Rahul", "mobile": "9876543210", "password": "pass123", "pin": "1234" }
```

### Login
```http
POST /auth/login
{ "mobile": "9876543210", "password": "pass123" }
```
Returns JWT token — sab requests mein use karo:
```
Authorization: Bearer <token>
```

### P2P Transfer
```http
POST /transfer/send
Authorization: Bearer <token>
{ "receiver_mobile": "9123456789", "amount": 100, "pin": "1234" }
```

### Lookup Name
```
GET /transfer/lookup/9876543210
```

---

## 💳 Deposit (UPI)

```
GET /wallet/deposit-info
Authorization: Bearer <token>
```

Returns UPI ID → Frontend UPI deep link banao:
```
upi://pay?pa=UPI_ID&pn=UNIO&am=AMOUNT&cu=INR&tn=UNIO_TXN_XXXX
```

Admin manually credit karta hai screenshot verify karke.

---

## 💸 Withdraw

```http
POST /wallet/withdraw
Authorization: Bearer <token>
{ "upi": "yourname@upi", "amount": 100 }
```

- Minimum ₹10
- Admin ko Telegram alert jaata hai
- Admin approve/reject karta hai

---

## 🎁 Lifafa

### Create
```http
POST /lifafa/create
Authorization: Bearer <token>
{
  "code": "DIWALI25",
  "type": "standard",
  "amt": 10,
  "users": 50,
  "channels": ["https://t.me/UNIOWALLET"]
}
```

### Claim
```http
POST /lifafa/claim
{ "code": "DIWALI25", "mobile": "9876543210" }
```

---

## 🛠 Admin API

```
Authorization: Bearer <admin_token>

GET  /admin/stats
GET  /admin/users
GET  /admin/transactions
GET  /admin/withdrawals
GET  /admin/api-transactions

POST /admin/add-balance      { "mobile": "...", "amount": 100 }
POST /admin/deduct-balance   { "mobile": "...", "amount": 50 }
POST /admin/ban/:id          { "type": 1 }   ← 1=permanent, 2=temp, 0=unban
POST /admin/approve-withdraw/:tx_id
POST /admin/reject-withdraw/:tx_id
POST /admin/notify-txn/:id   ← Manual Telegram alert
```

---

## 📁 Structure

```
unio-wallet/
├── server.js
├── routes/
│   ├── auth.js        → Register, Login
│   ├── wallet.js      → Balance, Deposit info, Withdraw
│   ├── transfer.js    → P2P Transfer
│   ├── payment.js     → /payment?key=&to=&amt= API ★
│   ├── lifafa.js      → Lifafa create/claim
│   └── admin.js       → Admin panel
├── models/
│   ├── User.js
│   ├── Transaction.js
│   └── Lifafa.js
├── middleware/
│   └── auth.js        → JWT + API Key
├── helpers/
│   └── telegram.js    → Bot alerts
├── .env.example
└── README.md
```

---

## 📌 License
MIT — Free to use
