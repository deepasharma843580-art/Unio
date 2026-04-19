// tgch.js — UNIO TG Admin Tool

const API          = 'https://unio-hazel.vercel.app/api';
const ADMIN_PASS   = '8434';
const token        = localStorage.getItem('token');

let currentUser    = null;   // fetched user object
let authed         = false;

// ── Auth Header ──────────────────────────────────────────────────
function headers() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token
  };
}

// ── Password Toggle ──────────────────────────────────────────────
function toggleEye() {
  const inp  = document.getElementById('admin-pass');
  const icon = document.getElementById('eye-icon');
  if (inp.type === 'password') {
    inp.type  = 'text';
    icon.className = 'fa-solid fa-eye-slash inp-icon';
  } else {
    inp.type  = 'password';
    icon.className = 'fa-solid fa-eye inp-icon';
  }
}

// ── Check Auth ──────────────────────────────────────────────────
function checkAuth() {
  const pass = document.getElementById('admin-pass').value.trim();
  if (!pass) return toast('Password dalo', 'error');

  const btn = document.getElementById('auth-btn');
  btn.classList.add('loading'); btn.disabled = true;

  setTimeout(() => {
    btn.classList.remove('loading'); btn.disabled = false;

    if (pass === ADMIN_PASS) {
      authed = true;
      document.getElementById('auth-section').style.display = 'none';
      document.getElementById('main-section').style.display = 'block';
      toast('Access mil gaya!', 'success');
    } else {
      toast('Wrong password!', 'error');
      document.getElementById('admin-pass').value = '';
    }
  }, 500);
}

// ── Search Input Handler ─────────────────────────────────────────
function onSearchInput() {
  const val = document.getElementById('search-mobile').value;
  document.getElementById('clear-icon').style.display = val.length ? 'block' : 'none';

  // Auto-search when 10 digits entered
  if (val.length === 10) searchUser();
}

function clearSearch() {
  document.getElementById('search-mobile').value = '';
  document.getElementById('clear-icon').style.display = 'none';
  document.getElementById('result-area').innerHTML = `
    <div class="empty-hint">
      <i class="fa-solid fa-mobile-screen-button"></i>
      <p>Mobile number dalo aur search karo</p>
    </div>`;
  currentUser = null;
}

// ── Search User ──────────────────────────────────────────────────
async function searchUser() {
  const mobile = document.getElementById('search-mobile').value.trim();
  if (mobile.length !== 10) return toast('Valid 10-digit mobile dalo', 'error');
  if (!token) return toast('Token nahi mila. Login karo.', 'error');

  const btn = document.getElementById('search-btn');
  btn.classList.add('loading'); btn.disabled = true;

  document.getElementById('result-area').innerHTML = `
    <div class="empty-hint">
      <i class="fa-solid fa-spinner fa-spin" style="opacity:.4"></i>
      <p>Dhoondh raha hoon...</p>
    </div>`;

  try {
    const r = await fetch(`${API}/admin/user-by-mobile/${mobile}`, { headers: headers() });
    const d = await r.json();

    if (d.status === 'success' && d.data) {
      currentUser = d.data;
      renderUserCard(d.data);
    } else {
      document.getElementById('result-area').innerHTML = `
        <div class="empty-hint">
          <i class="fa-solid fa-user-slash"></i>
          <p>${d.message || 'User nahi mila is number pe'}</p>
        </div>`;
    }
  } catch(e) {
    document.getElementById('result-area').innerHTML = `
      <div class="empty-hint">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>Network error: ${e.message}</p>
        <button class="btn btn-blue btn-sm" onclick="searchUser()" style="margin-top:.75rem;width:auto;padding:.5rem 1.25rem">&#8635; Retry</button>
      </div>`;
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
}

// ── Render User Detail Card ──────────────────────────────────────
function renderUserCard(u) {
  const initials = (u.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
  const statusClass = u.status === 'active' ? 's-active' : u.status === 'blocked' ? 's-blocked' : 's-pending';
  const tgSet = u.tg_id && u.tg_id !== '' && u.tg_id !== null && u.tg_id !== undefined;
  const tgDisplay = tgSet
    ? `<span class="info-val mono tg-set"><i class="fa-solid fa-circle-check" style="color:var(--green);margin-right:.25rem"></i>${u.tg_id}</span>`
    : `<span class="info-val tg-missing">Not set</span>`;

  const walletBal  = u.wallet_balance !== undefined ? '&#8377;' + Number(u.wallet_balance).toFixed(2) : '&#8377;0.00';
  const createdAt  = u.created_at ? new Date(u.created_at).toLocaleString('en-IN', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '–';
  const lastLogin  = u.last_login  ? new Date(u.last_login).toLocaleString('en-IN',  {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Never';

  document.getElementById('result-area').innerHTML = `

    <!-- User Banner -->
    <div class="detail-banner">
      <div class="detail-avatar">${initials}</div>
      <div class="detail-name">${u.name || 'Unknown'}</div>
      <div class="detail-mobile"><i class="fa-solid fa-phone" style="opacity:.6;margin-right:.3rem"></i>${u.mobile || '–'}</div>
      <div class="detail-badges">
        <span class="dbadge ${u.status === 'active' ? 'active' : u.status === 'blocked' ? 'blocked' : ''}">${u.status || 'unknown'}</span>
        ${u.is_admin ? '<span class="dbadge">Admin</span>' : ''}
        ${u.kyc_verified ? '<span class="dbadge active">KYC &#10003;</span>' : '<span class="dbadge">KYC Pending</span>'}
      </div>
    </div>

    <!-- Details Card -->
    <div class="card">
      <div class="card-header"><div class="card-header-title"><i class="fa-solid fa-id-card" style="color:var(--blue)"></i> &nbsp;User Details</div></div>

      <div class="info-row">
        <span class="info-label">User ID</span>
        <span class="info-val mono" style="font-size:.65rem">${u._id || '–'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Name</span>
        <span class="info-val">${u.name || '–'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Mobile</span>
        <span class="info-val">${u.mobile || '–'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Email</span>
        <span class="info-val">${u.email || 'Not set'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="status-badge ${statusClass}">${u.status || '–'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Wallet Balance</span>
        <span class="info-val" style="color:var(--green)">${walletBal}</span>
      </div>
      <div class="info-row">
        <span class="info-label">KYC</span>
        <span class="info-val">${u.kyc_verified ? '&#10003; Verified' : 'Pending'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Telegram ID</span>
        ${tgDisplay}
      </div>
      <div class="info-row">
        <span class="info-label">TG Username</span>
        <span class="info-val">${u.tg_username ? '@' + u.tg_username : 'Not set'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Joined</span>
        <span class="info-val" style="font-size:.7rem">${createdAt}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Last Login</span>
        <span class="info-val" style="font-size:.7rem">${lastLogin}</span>
      </div>
    </div>

    <!-- TG Update Card -->
    <div class="card">
      <div class="card-header"><div class="card-header-title"><i class="fa-brands fa-telegram" style="color:#229ed9"></i> &nbsp;Update Telegram ID</div></div>
      <div class="card-body">
        <div class="tg-update-wrap">
          <div class="tg-update-title"><i class="fa-brands fa-telegram"></i> Current TG ID: ${tgSet ? '<span style="color:var(--green)">' + u.tg_id + '</span>' : '<span style="color:var(--orange)">Not set</span>'}</div>
          <div class="input-wrap" style="margin-bottom:.75rem">
            <label class="input-label">New Telegram ID (numeric)</label>
            <input class="inp" type="number" id="new-tg-id" placeholder="e.g. 123456789" value="${tgSet ? u.tg_id : ''}">
          </div>
          <div style="display:flex;gap:.5rem">
            <button class="btn btn-blue" id="update-tg-btn" onclick="updateTgId('${u._id}')">
              <div class="spin"></div>
              <span class="btn-text"><i class="fa-solid fa-floppy-disk"></i> Save TG ID</span>
            </button>
            ${tgSet ? `<button class="btn btn-red btn-sm" style="flex-shrink:0;padding:.9rem 1rem" onclick="clearTgId('${u._id}')"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="card">
      <div class="card-header"><div class="card-header-title"><i class="fa-solid fa-bolt" style="color:var(--orange)"></i> &nbsp;Quick Actions</div></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:.6rem">
        <button class="btn btn-outline" onclick="copyToClip('${u._id}')"><i class="fa-solid fa-copy"></i> Copy User ID</button>
        <button class="btn btn-outline" onclick="copyToClip('${u.mobile}')"><i class="fa-solid fa-phone"></i> Copy Mobile</button>
        ${tgSet ? `<button class="btn btn-outline" onclick="copyToClip('${u.tg_id}')"><i class="fa-brands fa-telegram"></i> Copy TG ID</button>` : ''}
      </div>
    </div>
  `;
}

// ── Update TG ID ─────────────────────────────────────────────────
async function updateTgId(userId) {
  const tg_id = document.getElementById('new-tg-id').value.trim();
  if (!tg_id) return toast('TG ID dalo', 'error');
  if (isNaN(tg_id)) return toast('TG ID sirf number hona chahiye', 'error');
  if (!token) return toast('Token nahi mila', 'error');

  const btn = document.getElementById('update-tg-btn');
  btn.classList.add('loading'); btn.disabled = true;

  try {
    const r = await fetch(`${API}/admin/update-tg`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ user_id: userId, tg_id: tg_id })
    });
    const d = await r.json();

    if (d.status === 'success') {
      toast('TG ID update ho gaya! &#9989;', 'success');
      // Refresh user card
      if (currentUser) {
        currentUser.tg_id = tg_id;
        renderUserCard(currentUser);
      }
    } else {
      toast(d.message || 'Update fail ho gaya', 'error');
    }
  } catch(e) {
    toast('Network error: ' + e.message, 'error');
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
}

// ── Clear TG ID ──────────────────────────────────────────────────
async function clearTgId(userId) {
  if (!confirm('TG ID clear karna chahte ho?')) return;
  if (!token) return toast('Token nahi mila', 'error');

  try {
    const r = await fetch(`${API}/admin/update-tg`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ user_id: userId, tg_id: '' })
    });
    const d = await r.json();
    if (d.status === 'success') {
      toast('TG ID clear ho gaya', 'success');
      if (currentUser) {
        currentUser.tg_id = '';
        renderUserCard(currentUser);
      }
    } else {
      toast(d.message || 'Clear fail ho gaya', 'error');
    }
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ── Copy to Clipboard ────────────────────────────────────────────
function copyToClip(text) {
  navigator.clipboard.writeText(text).then(() => {
    toast('Copied: ' + text, 'success');
  }).catch(() => {
    toast('Copy nahi hua', 'error');
  });
}

// ── Toast ─────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.innerHTML = msg;
  t.className = 'toast show' + (type === 'error' ? ' error' : type === 'success' ? ' success-t' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
          }
  
