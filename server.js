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
// BOT_USERNAME — taklif havolasini (t.me/BOT_USERNAME?start=...) yasash uchun kerak, @ belgisiz yozing
const BOT_USERNAME = (process.env.BOT_USERNAME || 'BOT_USERNAME_BU_YERGA').replace(/^@/, '');
// PUBLIC_URL — serveringizning ochiq (https) manzili, masalan: https://sizning-domeningiz.com
// Agar shu sozlansa, server ishga tushganda Telegram webhook'ni avtomatik o'rnatadi.
const PUBLIC_URL = process.env.PUBLIC_URL || '';
// WEBHOOK_SECRET — ixtiyoriy, webhook so'rovlari haqiqatan Telegram'dan kelayotganini tekshirish uchun
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
// DATA_DIR — Railway'da Volume ulaganda shu yerga mount yo'lini yozing (masalan: /data)
// Agar sozlanmasa, owners.json shu loyiha papkasida saqlanadi (Volume'siz, deploy'da o'chib ketishi mumkin)
const DATA_DIR = process.env.DATA_DIR || __dirname;
const OWNERS_FILE = path.join(DATA_DIR, 'owners.json');
const INVITES_FILE = path.join(DATA_DIR, 'invites.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');
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

function loadJSONArray(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveJSONArray(file, arr) {
  fs.writeFileSync(file, JSON.stringify(arr, null, 2), 'utf8');
}

function loadOwners() { return loadJSONArray(OWNERS_FILE); }
function saveOwners(owners) { saveJSONArray(OWNERS_FILE, owners); }

function loadInvites() { return loadJSONArray(INVITES_FILE); }
function saveInvites(invites) { saveJSONArray(INVITES_FILE, invites); }

function loadRequests() { return loadJSONArray(REQUESTS_FILE); }
function saveRequests(reqs) { saveJSONArray(REQUESTS_FILE, reqs); }

function isAdminId(userId) {
  return String(userId) === String(ADMIN_ID);
}

function findOwner(owners, userId) {
  return owners.find(o => String(o.id) === String(userId));
}

// Muddati o'tgan-o'tmaganini tekshiradi (expiresAt=null bo'lsa — doimiy ruxsat)
function isOwnerAccessValid(owner) {
  if (!owner) return false;
  if (!owner.expiresAt) return true;
  return new Date(owner.expiresAt).getTime() > Date.now();
}

// Muddati o'tgan do'kon egalarini ro'yxatdan avtomatik tozalaydi
function pruneExpiredOwners() {
  const owners = loadOwners();
  const fresh = owners.filter(isOwnerAccessValid);
  if (fresh.length !== owners.length) saveOwners(fresh);
  return fresh;
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

function sendMessage(chatId, text, replyMarkup) {
  const params = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) params.reply_markup = JSON.stringify(replyMarkup);
  return telegramApi('sendMessage', params).catch(() => {});
}

function answerCallbackQuery(callbackId, text) {
  const params = { callback_query_id: callbackId };
  if (text) params.text = text;
  return telegramApi('answerCallbackQuery', params).catch(() => {});
}

function editMessageText(chatId, messageId, text, replyMarkup) {
  const params = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (replyMarkup) params.reply_markup = JSON.stringify(replyMarkup);
  else params.reply_markup = JSON.stringify({ inline_keyboard: [] });
  return telegramApi('editMessageText', params).catch(() => {});
}

function displayName(user) {
  if (!user) return 'Noma\'lum';
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || (user.username ? '@' + user.username : String(user.id));
}

// ====== Bir martalik taklif havolalari (invites) ======
function createInvite() {
  const token = crypto.randomBytes(16).toString('hex');
  const invites = loadInvites();
  invites.push({ token, createdAt: new Date().toISOString(), used: false, usedBy: null, usedAt: null });
  saveInvites(invites);
  return token;
}

function findInvite(token) {
  const invites = loadInvites();
  return invites.find(i => i.token === token);
}

function markInviteUsed(token, userId) {
  const invites = loadInvites();
  const inv = invites.find(i => i.token === token);
  if (inv) { inv.used = true; inv.usedBy = String(userId); inv.usedAt = new Date().toISOString(); saveInvites(invites); }
}

// ====== Adminga yuborilgan so'rovlar (do'kon egasi bo'lish uchun) ======
function createRequest(user, token) {
  const reqId = crypto.randomBytes(4).toString('hex');
  const reqs = loadRequests();
  reqs.push({
    reqId,
    token,
    userId: String(user.id),
    username: user.username || null,
    firstName: user.first_name || null,
    createdAt: new Date().toISOString()
  });
  saveRequests(reqs);
  return reqId;
}

function findRequest(reqId) {
  return loadRequests().find(r => r.reqId === reqId);
}

function removeRequest(reqId) {
  const reqs = loadRequests().filter(r => r.reqId !== reqId);
  saveRequests(reqs);
}

const DAY_LABELS = { '1': '1 kun', '7': '7 kun', '30': '30 kun', 'p': 'Doimiy' };

function daysKeyboard(reqId) {
  return {
    inline_keyboard: [
      [
        { text: '1 kun', callback_data: `apr:${reqId}:1` },
        { text: '7 kun', callback_data: `apr:${reqId}:7` },
        { text: '30 kun', callback_data: `apr:${reqId}:30` }
      ],
      [{ text: 'Doimiy ruxsat', callback_data: `apr:${reqId}:p` }],
      [{ text: '❌ Rad etish', callback_data: `rej:${reqId}` }]
    ]
  };
}

// ====== Telegram yangilanishlarini (webhook) qayta ishlash ======
async function handleTelegramUpdate(update) {
  if (update.message && update.message.text) {
    const msg = update.message;
    const text = msg.text.trim();
    const from = msg.from;
    const chatId = msg.chat.id;

    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const payload = parts.length > 1 ? parts[1].trim() : '';

      if (!payload) {
        await sendMessage(chatId, isAdminId(from.id)
          ? 'Salom, admin! Mini App tugmasi orqali boshqaruv panelini oching.'
          : 'Salom! Ushbu botdan foydalanish uchun sizga taklif havolasi kerak.');
        return;
      }

      const token = payload.replace(/^inv_/, '');
      const invite = findInvite(token);

      if (isAdminId(from.id)) {
        await sendMessage(chatId, 'Siz allaqachon administratorsiz.');
        return;
      }

      if (!invite || invite.used) {
        await sendMessage(chatId, 'Bu havola yaroqsiz yoki allaqachon ishlatilgan. Iltimos, admindan yangi havola so\'rang.');
        return;
      }

      const owners = pruneExpiredOwners();
      const existing = findOwner(owners, from.id);
      if (existing && isOwnerAccessValid(existing)) {
        markInviteUsed(token, from.id);
        await sendMessage(chatId, 'Sizda allaqachon kirish huquqi mavjud. Mini App tugmasi orqali oching.');
        return;
      }

      markInviteUsed(token, from.id);
      const reqId = createRequest(from, token);

      await sendMessage(chatId, 'So\'rovingiz adminga yuborildi. Iltimos, tasdiqlanishini kuting.');

      const infoText = `🆕 <b>Yangi do'kon egasi so'rovi</b>\n` +
        `Ism: ${displayName(from)}\n` +
        (from.username ? `Username: @${from.username}\n` : '') +
        `ID: <code>${from.id}</code>\n\n` +
        `Necha kunga ruxsat berasiz?`;
      await sendMessage(ADMIN_ID, infoText, daysKeyboard(reqId));
      return;
    }
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const from = cq.from;
    const data = cq.data || '';
    const chatId = cq.message && cq.message.chat && cq.message.chat.id;
    const messageId = cq.message && cq.message.message_id;

    if (!isAdminId(from.id)) {
      await answerCallbackQuery(cq.id, 'Faqat admin qaror qabul qila oladi.');
      return;
    }

    if (data.startsWith('apr:')) {
      const [, reqId, daysKey] = data.split(':');
      const reqInfo = findRequest(reqId);
      if (!reqInfo) {
        await answerCallbackQuery(cq.id, 'Bu so\'rov allaqachon ko\'rib chiqilgan.');
        return;
      }

      let expiresAt = null;
      let days = null;
      if (daysKey !== 'p') {
        days = parseInt(daysKey, 10);
        expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      }

      const owners = loadOwners();
      const already = findOwner(owners, reqInfo.userId);
      if (already) {
        already.expiresAt = expiresAt;
        already.username = reqInfo.username || already.username;
      } else {
        owners.push({
          id: reqInfo.userId,
          username: reqInfo.username || null,
          addedAt: new Date().toISOString(),
          expiresAt
        });
      }
      saveOwners(owners);
      removeRequest(reqId);

      const label = DAY_LABELS[daysKey] || daysKey;
      await editMessageText(chatId, messageId,
        `✅ <b>Tasdiqlandi</b>\n${displayName(reqInfo)} (ID: <code>${reqInfo.userId}</code>)\nRuxsat muddati: ${label}`);
      await sendMessage(reqInfo.userId,
        `✅ So'rovingiz tasdiqlandi! Sizga <b>${label}</b> muddatga kirish huquqi berildi.\nMini App tugmasi orqali oching.`);
      await answerCallbackQuery(cq.id, 'Tasdiqlandi ✅');
      return;
    }

    if (data.startsWith('rej:')) {
      const [, reqId] = data.split(':');
      const reqInfo = findRequest(reqId);
      if (!reqInfo) {
        await answerCallbackQuery(cq.id, 'Bu so\'rov allaqachon ko\'rib chiqilgan.');
        return;
      }
      removeRequest(reqId);
      await editMessageText(chatId, messageId,
        `❌ <b>Rad etildi</b>\n${displayName(reqInfo)} (ID: <code>${reqInfo.userId}</code>)`);
      await sendMessage(reqInfo.userId, '❌ Kechirasiz, so\'rovingiz rad etildi.');
      await answerCallbackQuery(cq.id, 'Rad etildi');
      return;
    }
  }
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
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      const ok = admin || isOwnerAccessValid(owner);

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

      return sendJSON(res, 200, { ok: true, owners: pruneExpiredOwners() });
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

  // ---- API: bir martalik taklif havolasi yaratish (faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/create-invite') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyTelegramInitData(payload.initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin havola yarata oladi' });

      if (!BOT_USERNAME || BOT_USERNAME === 'BOT_USERNAME_BU_YERGA') {
        return sendJSON(res, 200, { ok: false, reason: 'Serverda BOT_USERNAME sozlanmagan.' });
      }

      const token = createInvite();
      const link = `https://t.me/${BOT_USERNAME}?start=inv_${token}`;
      return sendJSON(res, 200, { ok: true, link });
    });
    return;
  }

  // ---- Telegram webhook: bot xabarlari va tugma bosishlari shu yerga keladi ----
  if (req.method === 'POST' && req.url === '/webhook') {
    if (WEBHOOK_SECRET) {
      const got = req.headers['x-telegram-bot-api-secret-token'];
      if (got !== WEBHOOK_SECRET) {
        res.writeHead(401); res.end(); return;
      }
    }
    readBody(req, async (err, update) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      if (err) return;
      try { await handleTelegramUpdate(update); } catch (e) { console.error('Webhook xatosi:', e); }
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

server.listen(PORT, async () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);

  if (PUBLIC_URL) {
    try {
      const params = { url: `${PUBLIC_URL.replace(/\/$/, '')}/webhook` };
      if (WEBHOOK_SECRET) params.secret_token = WEBHOOK_SECRET;
      const result = await telegramApi('setWebhook', params);
      console.log('Telegram webhook o\'rnatildi:', result.ok ? 'muvaffaqiyatli' : JSON.stringify(result));
    } catch (e) {
      console.error('Webhook o\'rnatishda xatolik:', e.message);
    }
  } else {
    console.log('Eslatma: PUBLIC_URL sozlanmagan — webhook avtomatik o\'rnatilmadi. README\'dagi qo\'lda sozlash bo\'limiga qarang.');
  }
});
