// Eng yengil Telegram Mini App backend — tashqi kutubxonalarsiz (faqat Node.js o'zi)
// Ishga tushirish: BOT_TOKEN va ADMIN_ID ni sozlab, `node server.js`

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ====== SOZLAMALAR (o'zingiznikiga almashtiring) ======
const BOT_TOKEN = process.env.BOT_TOKEN || 'BOT_TOKEN_BU_YERGA';
const ADMIN_ID = process.env.ADMIN_ID || 'ADMIN_TELEGRAM_ID_BU_YERGA'; // masalan: 123456789
const PORT = process.env.PORT || 3000;
// DATA_DIR — Railway'da Volume ulaganda shu yerga mount yo'lini yozing (masalan: /data)
// Agar sozlanmasa, owners.json shu loyiha papkasida saqlanadi (Volume'siz, deploy'da o'chib ketishi mumkin)
const DATA_DIR = process.env.DATA_DIR || __dirname;
const OWNERS_FILE = path.join(DATA_DIR, 'owners.json');
// ========================================================

function verifyTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'hash yo\'q' };
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) {
    return { ok: false, reason: 'imzo mos emas (soxta so\'rov)' };
  }

  // auth_date freshness tekshiruvi (24 soatdan eski bo'lsa rad etamiz)
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) {
    return { ok: false, reason: 'sessiya eskirgan' };
  }

  const userRaw = params.get('user');
  let user = null;
  try { user = userRaw ? JSON.parse(userRaw) : null; } catch (e) {}

  return { ok: true, user };
}

// ====== Do'kon egalari (owners) — oddiy JSON fayl orqali saqlanadi ======
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

function loadOwners() {
  try {
    const raw = fs.readFileSync(OWNERS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveOwners(owners) {
  fs.writeFileSync(OWNERS_FILE, JSON.stringify(owners, null, 2), 'utf8');
}

function isAdminId(userId) {
  return String(userId) === String(ADMIN_ID);
}

function findOwner(owners, userId) {
  return owners.find(o => String(o.id) === String(userId));
}

// Telegram Bot API'ga so'rov yuborish (masalan @username orqali foydalanuvchini topish uchun)
function telegramApi(method, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}?${qs}`;
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Admin kiritgan matnni (ID yoki username/link) haqiqiy Telegram ID'ga aylantirish
async function resolveUserInput(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return { error: 'Ma\'lumot kiritilmagan' };

  // 1) To'g'ridan-to'g'ri raqamli ID (masalan: 123456789)
  if (/^\d{5,}$/.test(trimmed)) {
    return { id: trimmed };
  }

  // 2) tg://user?id=123456789 ko'rinishidagi havola
  let m = trimmed.match(/id=(\d{5,})/);
  if (m) return { id: m[1] };

  // 3) @username yoki https://t.me/username ko'rinishidagi havola
  m = trimmed.match(/(?:t\.me\/|@)([a-zA-Z0-9_]{4,32})/i);
  if (m) {
    const username = m[1];
    try {
      const result = await telegramApi('getChat', { chat_id: '@' + username });
      if (result.ok && result.result && result.result.id) {
        return { id: String(result.result.id), username: result.result.username || username };
      }
      return { error: 'Foydalanuvchi topilmadi. Unga botga /start yozishni so\'rang yoki to\'g\'ridan-to\'g\'ri Telegram ID raqamini kiriting (ID ni @userinfobot orqali bilib olish mumkin).' };
    } catch (e) {
      return { error: 'Telegram bilan bog\'lanishda xatolik yuz berdi. Qaytadan urinib ko\'ring.' };
    }
  }

  return { error: 'Noto\'g\'ri format. Telegram ID raqamini, @username yoki t.me havolasini kiriting.' };
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, cb) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    try { cb(null, JSON.parse(body || '{}')); }
    catch (e) { cb(e); }
  });
}

const server = http.createServer((req, res) => {
  // ---- API: initData tekshirish (mini app ochilganda) ----
  if (req.method === 'POST' && req.url === '/api/verify') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData } = payload;
      if (!initData) return sendJSON(res, 400, { ok: false, reason: 'initData yo\'q' });

      const result = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!result.ok) return sendJSON(res, 200, { ok: false, reason: result.reason });

      const userId = String(result.user && result.user.id);
      const admin = isAdminId(userId);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      const ok = admin || !!owner;

      return sendJSON(res, 200, {
        ok,
        isAdmin: admin,
        reason: ok ? null : 'Bu ilova faqat administrator va tasdiqlangan do\'kon egalari uchun.'
      });
    });
    return;
  }

  // ---- API: do'kon egalari ro'yxatini olish (faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/owners') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyTelegramInitData(payload.initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin ko\'ra oladi' });

      return sendJSON(res, 200, { ok: true, owners: loadOwners() });
    });
    return;
  }

  // ---- API: yangi do'kon egasini qo'shish (faqat admin, tasdiqdan keyin frontend chaqiradi) ----
  if (req.method === 'POST' && req.url === '/api/add-owner') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, input } = payload;
      const check = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin qo\'sha oladi' });

      const resolved = await resolveUserInput(input);
      if (resolved.error) return sendJSON(res, 200, { ok: false, reason: resolved.error });

      const owners = loadOwners();
      if (isAdminId(resolved.id)) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu foydalanuvchi allaqachon administrator' });
      }
      if (findOwner(owners, resolved.id)) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu foydalanuvchi ro\'yxatda allaqachon bor' });
      }

      const newOwner = {
        id: resolved.id,
        username: resolved.username || null,
        addedAt: new Date().toISOString()
      };
      owners.push(newOwner);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, owner: newOwner });
    });
    return;
  }

  // ---- API: do'kon egasini ro'yxatdan o'chirish (faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/remove-owner') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin o\'chira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      let owners = loadOwners();
      const before = owners.length;
      owners = owners.filter(o => String(o.id) !== String(id));
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, removed: before !== owners.length });
    });
    return;
  }

  // ---- Statik fayllarni berish (faqat public papkasidan) ----
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', path.normalize(filePath).replace(/^(\.\.[\/\\])+/, ''));

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404');
    }
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : 'text/plain';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});
