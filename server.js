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

// ====== Xodimlar (kassir, oshpaz, sklad, dostavka) — har bir egasining o'z ro'yxati ichida saqlanadi ======
const STAFF_ROLES = {
  kassir: 'Kassir',
  oshpaz: 'Oshpaz',
  sklad: 'Sklad mas\'uli',
  dostavka: 'Dostavkachi'
};

function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(STAFF_ROLES, role);
}

// Berilgan userId qaysi egasining xodimi ekanini (va rolini) topadi
function findStaffInfo(owners, userId) {
  for (const owner of owners) {
    const staff = (owner.staff || []).find(s => String(s.id) === String(userId));
    if (staff) {
      return {
        ownerId: owner.id,
        ownerName: (owner.profile && owner.profile.name) || null,
        role: staff.role,
        staff
      };
    }
  }
  return null;
}

// Berilgan userId qaysi oshxonaga tegishli ekanini aniqlaydi (egasining o'zi yoki uning xodimi)
// Qaytaradi: { owner, role } — role: 'egasi' yoki 'kassir'/'oshpaz'/'sklad'/'dostavka'; topilmasa null
function resolveOwnerContext(owners, userId) {
  const owner = findOwner(owners, userId);
  if (isOwnerAccessValid(owner)) return { owner, role: 'egasi' };

  const staffInfo = findStaffInfo(owners, userId);
  if (staffInfo) {
    const staffOwner = owners.find(o => String(o.id) === String(staffInfo.ownerId));
    if (staffOwner) return { owner: staffOwner, role: staffInfo.role };
  }
  return null;
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

// Telegram xabarlari HTML parse_mode bilan yuborilgani uchun, foydalanuvchi kiritgan matnni xavfsiz qilib chiqaramiz
function escapeHtmlServer(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ====== Obuna muddati tugashini kuzatish (avtomatik bloklash + admin/egaga eslatma) ======
const EXPIRY_CHECK_INTERVAL_MS = 60 * 60 * 1000; // har soatda tekshiradi
const REMINDER_BEFORE_MS = 24 * 60 * 60 * 1000; // muddat tugashiga 1 kun qolganda eslatma yuboradi

function ownerLabel(owner) {
  return owner.username ? '@' + owner.username : `ID: ${owner.id}`;
}

async function checkOwnerExpirations() {
  const owners = loadOwners();
  const now = Date.now();
  let changed = false;
  const stillActive = [];

  for (const owner of owners) {
    if (!owner.expiresAt) { stillActive.push(owner); continue; }
    const expiresMs = new Date(owner.expiresAt).getTime();

    if (expiresMs <= now) {
      // Muddati tugadi — ro'yxatdan chiqariladi (stillActive'ga qo'shilmaydi) va xabar beriladi
      changed = true;
      await sendMessage(ADMIN_ID,
        `⏰ <b>Obuna muddati tugadi</b>\n${ownerLabel(owner)} (ID: <code>${owner.id}</code>) uchun Mini App'ga kirish avtomatik yopildi.`);
      await sendMessage(owner.id,
        `⏰ Sizning obuna muddatingiz tugadi, Mini App'ga kirish yopildi.\nDavom ettirish uchun administrator bilan bog'laning.`);
      continue;
    }

    if (!owner.reminderSentAt && expiresMs - now <= REMINDER_BEFORE_MS) {
      changed = true;
      owner.reminderSentAt = new Date().toISOString();
      const daysLeft = Math.max(1, Math.ceil((expiresMs - now) / 86400000));
      await sendMessage(ADMIN_ID,
        `🔔 <b>Obuna tugashiga oz qoldi</b>\n${ownerLabel(owner)} (ID: <code>${owner.id}</code>) — taxminan ${daysLeft} kundan keyin tugaydi.`);
      await sendMessage(owner.id,
        `🔔 Sizning obunangiz tez orada tugaydi (taxminan ${daysLeft} kun qoldi).\nUzaytirish uchun administrator bilan bog'laning.`);
    }

    stillActive.push(owner);
  }

  if (changed) saveOwners(stillActive);
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
      [{ text: '✏️ Boshqa son (kun kiritish)', callback_data: `custom:${reqId}` }],
      [{ text: '❌ Rad etish', callback_data: `rej:${reqId}` }]
    ]
  };
}

// ====== "Boshqa son" — admin qo'lda kun sonini yozmoqchi bo'lganda, shu so'rov navbatda kutib turadi ======
const AWAITING_FILE = path.join(DATA_DIR, 'awaiting.json');

function getAwaitingCustom() {
  try {
    const raw = fs.readFileSync(AWAITING_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function setAwaitingCustom(reqId, promptMessageId) {
  fs.writeFileSync(AWAITING_FILE, JSON.stringify({ reqId, promptMessageId }), 'utf8');
}

function clearAwaitingCustom() {
  try { fs.unlinkSync(AWAITING_FILE); } catch (e) {}
}

// Bitta so'rovni belgilangan kun soni (yoki doimiy, days=null) bilan tasdiqlash — tugma va matn orqali kirish uchun umumiy funksiya
function approveRequest(reqInfo, days) {
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86400000).toISOString();
  const owners = loadOwners();
  const already = findOwner(owners, reqInfo.userId);
  if (already) {
    already.expiresAt = expiresAt;
    already.username = reqInfo.username || already.username;
    already.reminderSentAt = null;
  } else {
    owners.push({
      id: reqInfo.userId,
      username: reqInfo.username || null,
      addedAt: new Date().toISOString(),
      expiresAt,
      price: 0,
      paid: false,
      paidAt: null
    });
  }
  saveOwners(owners);
  removeRequest(reqInfo.reqId);
  const label = days === null ? 'Doimiy' : `${days} kun`;
  return label;
}

// ====== Telegram yangilanishlarini (webhook) qayta ishlash ======
async function handleTelegramUpdate(update) {
  if (update.message && update.message.text) {
    const msg = update.message;
    const text = msg.text.trim();
    const from = msg.from;
    const chatId = msg.chat.id;

    // Admin "Boshqa son" tugmasini bosgandan keyin, keyingi xabarini kun soni sifatida kutamiz
    if (isAdminId(from.id) && !text.startsWith('/')) {
      const awaiting = getAwaitingCustom();
      if (awaiting && awaiting.reqId) {
        const reqInfo = findRequest(awaiting.reqId);
        if (!reqInfo) {
          clearAwaitingCustom();
          await sendMessage(chatId, 'Bu so\'rov allaqachon ko\'rib chiqilgan.');
          return;
        }
        const n = parseInt(text, 10);
        if (!Number.isInteger(n) || n <= 0 || String(n) !== text) {
          await sendMessage(chatId, 'Iltimos, faqat musbat butun son yuboring (masalan: 14). Bekor qilish uchun /bekor yozing.');
          return;
        }
        clearAwaitingCustom();
        const label = approveRequest(reqInfo, n);
        if (awaiting.promptMessageId) {
          await editMessageText(chatId, awaiting.promptMessageId,
            `✅ <b>Tasdiqlandi</b>\n${displayName(reqInfo)} (ID: <code>${reqInfo.userId}</code>)\nRuxsat muddati: ${label}`);
        } else {
          await sendMessage(chatId, `✅ Tasdiqlandi. Ruxsat muddati: ${label}`);
        }
        await sendMessage(reqInfo.userId,
          `✅ So'rovingiz tasdiqlandi! Sizga <b>${label}</b> muddatga kirish huquqi berildi.\nMini App tugmasi orqali oching.`);
        return;
      }
    }

    if (isAdminId(from.id) && text === '/bekor') {
      const awaiting = getAwaitingCustom();
      if (awaiting) {
        clearAwaitingCustom();
        await sendMessage(chatId, 'Bekor qilindi.');
      }
      return;
    }

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

    if (data.startsWith('custom:')) {
      const [, reqId] = data.split(':');
      const reqInfo = findRequest(reqId);
      if (!reqInfo) {
        await answerCallbackQuery(cq.id, 'Bu so\'rov allaqachon ko\'rib chiqilgan.');
        return;
      }
      setAwaitingCustom(reqId, messageId);
      await editMessageText(chatId, messageId,
        `🆕 <b>Yangi do'kon egasi so'rovi</b>\n${displayName(reqInfo)} (ID: <code>${reqInfo.userId}</code>)\n\n` +
        `✏️ Necha kunga ruxsat berishni istaysiz? Kun sonini oddiy xabar qilib yuboring (masalan: 14).\nBekor qilish uchun /bekor yozing.`);
      await answerCallbackQuery(cq.id);
      return;
    }

    if (data.startsWith('apr:')) {
      const [, reqId, daysKey] = data.split(':');
      const reqInfo = findRequest(reqId);
      if (!reqInfo) {
        await answerCallbackQuery(cq.id, 'Bu so\'rov allaqachon ko\'rib chiqilgan.');
        return;
      }

      const days = daysKey === 'p' ? null : parseInt(daysKey, 10);
      const label = approveRequest(reqInfo, days);

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
      const ownerOk = isOwnerAccessValid(owner);
      const staffInfo = (!admin && !ownerOk) ? findStaffInfo(owners, userId) : null;
      const ok = admin || ownerOk || !!staffInfo;

      return sendJSON(res, 200, {
        ok,
        isAdmin: admin,
        isOwner: !admin && ownerOk,
        role: staffInfo ? staffInfo.role : null,
        roleLabel: staffInfo ? (STAFF_ROLES[staffInfo.role] || staffInfo.role) : null,
        ownerRestaurantName: staffInfo ? staffInfo.ownerName : null,
        hasProfile: !admin && ownerOk && !!(owner && owner.profile && owner.profile.completedAt),
        reason: ok ? null : 'Bu ilova faqat administrator, tasdiqlangan do\'kon egalari va ularning xodimlari uchun.'
      });
    });
    return;
  }

  // ---- API: egasining o'z xodimlari ro'yxatini olish ----
  if (req.method === 'POST' && req.url === '/api/staff-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyTelegramInitData(payload.initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi ko\'ra oladi' });

      return sendJSON(res, 200, { ok: true, staff: owner.staff || [] });
    });
    return;
  }

  // ---- API: egasi xodim qo'shadi (kassir/oshpaz/sklad/dostavka) ----
  if (req.method === 'POST' && req.url === '/api/add-staff') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, input, role } = payload;
      const check = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi xodim qo\'sha oladi' });

      if (!isValidRole(role)) {
        return sendJSON(res, 200, { ok: false, reason: 'Noto\'g\'ri rol tanlandi.' });
      }

      const resolved = await resolveUserInput(input);
      if (resolved.error) return sendJSON(res, 200, { ok: false, reason: resolved.error });

      if (isAdminId(resolved.id)) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu foydalanuvchi administrator, xodim qilib bo\'lmaydi.' });
      }
      if (findOwner(owners, resolved.id)) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu foydalanuvchi allaqachon oshxona egasi.' });
      }
      const existingStaff = findStaffInfo(owners, resolved.id);
      if (existingStaff) {
        return sendJSON(res, 200, { ok: false, reason: existingStaff.ownerId === owner.id
          ? 'Bu foydalanuvchi allaqachon sizning xodimingiz.'
          : 'Bu foydalanuvchi boshqa oshxonada xodim sifatida ro\'yxatda.' });
      }

      if (!owner.staff) owner.staff = [];
      owner.staff.push({
        id: resolved.id,
        username: resolved.username || null,
        role,
        addedAt: new Date().toISOString()
      });
      saveOwners(owners);

      sendMessage(resolved.id,
        `👋 Sizni <b>${(owner.profile && owner.profile.name) || 'oshxona'}</b> jamoasiga <b>${STAFF_ROLES[role]}</b> sifatida qo\'shishdi.\nMini App tugmasi orqali oching.`);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: egasi xodimni o'chiradi ----
  if (req.method === 'POST' && req.url === '/api/remove-staff') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'chira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      owner.staff = (owner.staff || []).filter(s => String(s.id) !== String(id));
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: menyuni olish (egasi yoki uning xodimlari — masalan kassir) ----
  if (req.method === 'POST' && req.url === '/api/menu-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyTelegramInitData(payload.initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q' });

      return sendJSON(res, 200, { ok: true, menu: ctx.owner.menu || [], role: ctx.role });
    });
    return;
  }

  // ---- API: menyuga taom qo'shish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/menu-add') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, name, price, category } = payload;
      const check = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi menyuni boshqara oladi' });

      const nameTrim = String(name || '').trim();
      const priceNum = Number(price);
      if (!nameTrim) return sendJSON(res, 200, { ok: false, reason: 'Taom nomini kiriting.' });
      if (!Number.isFinite(priceNum) || priceNum <= 0) return sendJSON(res, 200, { ok: false, reason: 'Narxni to\'g\'ri kiriting.' });

      if (!owner.menu) owner.menu = [];
      const item = {
        id: crypto.randomBytes(4).toString('hex'),
        name: nameTrim,
        price: priceNum,
        category: String(category || '').trim() || null,
        addedAt: new Date().toISOString()
      };
      owner.menu.push(item);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, item });
    });
    return;
  }

  // ---- API: menyudan taomni o'chirish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/menu-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'chira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      owner.menu = (owner.menu || []).filter(m => m.id !== id);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: kassir yangi buyurtma yaratadi va oshxonaga yuboradi ----
  const ORDER_TYPES = { stol: 'Stolga', olib_ketish: 'Olib ketish', dostavka: 'Dostavka' };
  const PAYMENT_TYPES = { naqd: 'Naqd', karta: 'Karta', dostavka_orqali: 'Dostavka orqali' };

  if (req.method === 'POST' && req.url === '/api/create-order') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, items, orderType, tableNumber, paymentType } = payload;
      const check = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || (ctx.role !== 'kassir' && ctx.role !== 'egasi')) {
        return sendJSON(res, 200, { ok: false, reason: 'Faqat kassir buyurtma yaratishi mumkin' });
      }

      if (!Array.isArray(items) || !items.length) {
        return sendJSON(res, 200, { ok: false, reason: 'Savat bo\'sh. Kamida bitta taom tanlang.' });
      }
      if (!Object.prototype.hasOwnProperty.call(ORDER_TYPES, orderType)) {
        return sendJSON(res, 200, { ok: false, reason: 'Buyurtma turini tanlang.' });
      }
      if (!Object.prototype.hasOwnProperty.call(PAYMENT_TYPES, paymentType)) {
        return sendJSON(res, 200, { ok: false, reason: 'To\'lov turini tanlang.' });
      }
      if (orderType === 'stol' && !String(tableNumber || '').trim()) {
        return sendJSON(res, 200, { ok: false, reason: 'Stol raqamini kiriting.' });
      }

      // Narxlarni klientdan emas, serverdagi menyudan olamiz (soxtalashtirilmasligi uchun)
      const menu = ctx.owner.menu || [];
      const orderItems = [];
      for (const it of items) {
        const menuItem = menu.find(m => m.id === it.id);
        if (!menuItem) return sendJSON(res, 200, { ok: false, reason: 'Menyuda mavjud bo\'lmagan taom tanlangan.' });
        const qty = parseInt(it.qty, 10);
        if (!Number.isInteger(qty) || qty <= 0) return sendJSON(res, 200, { ok: false, reason: 'Miqdor noto\'g\'ri.' });
        orderItems.push({ id: menuItem.id, name: menuItem.name, price: menuItem.price, qty });
      }
      const total = orderItems.reduce((sum, it) => sum + it.price * it.qty, 0);

      if (!ctx.owner.orders) ctx.owner.orders = [];
      const order = {
        id: crypto.randomBytes(4).toString('hex'),
        items: orderItems,
        total,
        orderType,
        tableNumber: orderType === 'stol' ? String(tableNumber).trim() : null,
        paymentType,
        status: 'yangi',
        createdAt: new Date().toISOString(),
        createdBy: userId
      };
      ctx.owner.orders.push(order);
      saveOwners(owners);

      // Oshxonaga (egaga + oshpazlarga) xabar yuboriladi
      const itemsText = orderItems.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
      const notifyText = `🆕 <b>Yangi buyurtma</b> (${ORDER_TYPES[orderType]}${order.tableNumber ? ' — stol ' + escapeHtmlServer(order.tableNumber) : ''})\n` +
        `${itemsText}\n\nJami: ${total}\nTo'lov: ${PAYMENT_TYPES[paymentType]}`;
      const notifyTargets = [ctx.owner.id, ...((ctx.owner.staff || []).filter(s => s.role === 'oshpaz').map(s => s.id))];
      for (const targetId of new Set(notifyTargets)) {
        sendMessage(targetId, notifyText);
      }

      return sendJSON(res, 200, { ok: true, orderId: order.id, total });
    });
    return;
  }

  // ---- API: do'kon egasining o'z profilini olish ----
  if (req.method === 'POST' && req.url === '/api/my-profile') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyTelegramInitData(payload.initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      if (isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Admin uchun profil mavjud emas' });

      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q yoki muddati tugagan' });

      return sendJSON(res, 200, { ok: true, profile: owner.profile || null });
    });
    return;
  }

  // ---- API: do'kon egasi o'z profilini to'ldiradi/yangilaydi ----
  if (req.method === 'POST' && req.url === '/api/save-profile') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, name, address, phone, workHours, logoUrl } = payload;
      const check = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      if (isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Admin uchun profil mavjud emas' });

      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q yoki muddati tugagan' });

      const nameTrim = String(name || '').trim();
      const addressTrim = String(address || '').trim();
      const phoneTrim = String(phone || '').trim();
      const workHoursTrim = String(workHours || '').trim();
      const logoTrim = String(logoUrl || '').trim();

      if (!nameTrim) return sendJSON(res, 200, { ok: false, reason: 'Oshxona nomini kiriting.' });
      if (!addressTrim) return sendJSON(res, 200, { ok: false, reason: 'Manzilni kiriting.' });
      if (!phoneTrim || !/^[\d+\-\s()]{6,20}$/.test(phoneTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Telefon raqamini to\'g\'ri kiriting.' });
      }
      if (logoTrim && !/^https?:\/\//i.test(logoTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Logotip uchun to\'g\'ri havola (https://...) kiriting.' });
      }

      const owners2 = loadOwners();
      const target = findOwner(owners2, userId);
      const wasCompleted = !!(target.profile && target.profile.completedAt);
      target.profile = {
        name: nameTrim,
        address: addressTrim,
        phone: phoneTrim,
        workHours: workHoursTrim || null,
        logoUrl: logoTrim || null,
        completedAt: wasCompleted ? target.profile.completedAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      saveOwners(owners2);

      return sendJSON(res, 200, { ok: true, profile: target.profile });
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
      const { initData, input, days, price, paid } = payload;
      const check = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin qo\'sha oladi' });

      const resolved = await resolveUserInput(input);
      if (resolved.error) return sendJSON(res, 200, { ok: false, reason: resolved.error });

      let expiresAt = null;
      if (days !== undefined && days !== null && days !== '') {
        const n = parseInt(days, 10);
        if (!Number.isInteger(n) || n <= 0) {
          return sendJSON(res, 200, { ok: false, reason: 'Kun soni musbat butun son bo\'lishi kerak, yoki bo\'sh qoldiring (doimiy).' });
        }
        expiresAt = new Date(Date.now() + n * 86400000).toISOString();
      }

      // Obuna narxi — ixtiyoriy, kiritilmasa 0 deb saqlanadi
      let priceVal = 0;
      if (price !== undefined && price !== null && price !== '') {
        const p = Number(price);
        if (!Number.isFinite(p) || p < 0) {
          return sendJSON(res, 200, { ok: false, reason: 'Narx musbat son bo\'lishi kerak.' });
        }
        priceVal = p;
      }

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
        addedAt: new Date().toISOString(),
        expiresAt,
        price: priceVal,
        paid: !!paid,
        paidAt: paid ? new Date().toISOString() : null
      };
      owners.push(newOwner);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, owner: newOwner });
    });
    return;
  }

  // ---- API: do'kon egasining obuna narxi / to'lov holatini yangilash (faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/update-owner-billing') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, price, paid } = payload;
      const check = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin o\'zgartira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const owners = loadOwners();
      const owner = findOwner(owners, id);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Bunday do\'kon egasi topilmadi' });

      if (price !== undefined && price !== null && price !== '') {
        const p = Number(price);
        if (!Number.isFinite(p) || p < 0) {
          return sendJSON(res, 200, { ok: false, reason: 'Narx musbat son bo\'lishi kerak.' });
        }
        owner.price = p;
      }

      if (paid !== undefined && paid !== null) {
        const wasPaid = !!owner.paid;
        owner.paid = !!paid;
        if (owner.paid && !wasPaid) owner.paidAt = new Date().toISOString();
        if (!owner.paid) owner.paidAt = null;
      }

      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, owner });
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

  // Obuna muddatlarini tekshirish — darhol bir marta, keyin har soatda
  checkOwnerExpirations().catch(e => console.error('Muddat tekshirishda xatolik:', e.message));
  setInterval(() => {
    checkOwnerExpirations().catch(e => console.error('Muddat tekshirishda xatolik:', e.message));
  }, EXPIRY_CHECK_INTERVAL_MS);

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
