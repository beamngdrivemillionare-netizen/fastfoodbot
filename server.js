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
// ANTHROPIC_API_KEY — ixtiyoriy. Sozlansa, "AI savol-javob" bo'limi haqiqiy AI (Claude) orqali javob beradi.
// Sozlanmasa, shu bo'lim tayyor qoidalar asosida (foyda, top taom, pik vaqt, kam qolgan mahsulot) javob beradi.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'claude-3-5-haiku-20241022';
const OWNERS_FILE = path.join(DATA_DIR, 'owners.json');
const INVITES_FILE = path.join(DATA_DIR, 'invites.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');
// profiles.json — har bir bot foydalanuvchisining (mijoz, xodim, egasi — hammasi
// uchun umumiy, oshxonaga bog'liq emas) ism/familiya/telefon ma'lumotlari.
// Qarang: "Ro'yxatdan o'tish" bo'limi (handleTelegramUpdate ichida).
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
// tariffs.json — admin belgilaydigan obuna tariflari katalogi (F-bo'lim,
// 51-70-bosqich). Har bir do'kon egasiga shu ro'yxatdan bitta tarif
// biriktiriladi (owner.tariffId — 55-bosqichda tarif o'chirishda tekshiriladi,
// egaga biriktirish UI'si 57-bosqichda qo'shiladi).
const TARIFFS_FILE = path.join(DATA_DIR, 'tariffs.json');
// ========================================================

// ---- 50-bosqich: admin uchun "System status" paneli uchun kichik metrikalar ----
// Faqat xotirada saqlanadi (server qayta ishga tushsa — 0'dan boshlanadi),
// bazaga yozilmaydi — shunchaki joriy server holatini ko'rsatish uchun.
const SERVER_STARTED_AT = new Date().toISOString();
const webhookStats = { received: 0, errors: 0, lastAt: null };

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

// ====== Login/parol orqali kirish (oshxona egasi uchun, Telegram tashqarisidan ham) ======
// Admin har bir oshxona egasiga login+parol biriktirib qo'yishi mumkin (owner.login,
// owner.passwordHash — "tuz:hash" ko'rinishida, scrypt bilan). Owner shu login/parol
// bilan /api/owner-login orqali kirsa, unga "sess_<token>" ko'rinishidagi sessiya
// beriladi — frontend buni xuddi Telegram initData o'rniga ishlatadi. Shu sababli
// pastdagi verifyAuth() BARCHA endpoint'larda verifyTelegramInitData o'rniga
// chaqiriladi va ikkala usulni ham (Telegram initData YOKI sess_ token) tushunadi —
// shu bilan minglab qatordagi endpoint kodini o'zgartirmasdan ikkala kirish usuli ham ishlaydi.
const SESSION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 kun

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const computed = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(computed, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

// initData ham Telegram'dan (imzolangan), ham login/parol orqali olingan
// "sess_<token>" bo'lishi mumkin — shu yerda ikkalasi ham tekshiriladi va
// natija har doim bir xil shaklda ({ok, user:{id,...}} yoki {ok:false, reason})
// qaytariladi, shunda pastdagi barcha /api/... endpoint'lar o'zgarishsiz ishlayveradi.
function verifyAuth(initData) {
  if (typeof initData === 'string' && initData.startsWith('sess_')) {
    const token = initData.slice('sess_'.length);
    const owners = loadOwners();
    const owner = owners.find(o => o.sessionToken === token);
    if (!owner) return { ok: false, reason: 'Sessiya topilmadi. Iltimos, qaytadan login/parol bilan kiring.' };
    if (!owner.sessionExpiresAt || new Date(owner.sessionExpiresAt).getTime() < Date.now()) {
      return { ok: false, reason: 'Sessiya muddati tugagan. Iltimos, qaytadan login/parol bilan kiring.' };
    }
    return {
      ok: true,
      user: {
        id: owner.id,
        username: owner.username || owner.login || null,
        first_name: (owner.profile && owner.profile.name) || owner.login || 'Egasi'
      }
    };
  }
  return verifyTelegramInitData(initData, BOT_TOKEN);
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

// ====== Shaxsiy profil (ism, familiya, telefon) — har bir bot foydalanuvchisi
// (mijoz, xodim, egasi) uchun umumiy, bitta martalik ro'yxatdan o'tish ======
function loadProfiles() { return loadJSONArray(PROFILES_FILE); }
function saveProfiles(list) { saveJSONArray(PROFILES_FILE, list); }
function findProfile(userId) { return loadProfiles().find(p => String(p.id) === String(userId)); }
function isRegisteredUser(userId) {
  const p = findProfile(userId);
  return !!(p && p.registeredAt);
}

// ====== Obuna tariflari (F-bo'lim, 51-70-bosqich) — admin belgilaydigan katalog ======
function loadTariffs() { return loadJSONArray(TARIFFS_FILE); }
function saveTariffs(list) { saveJSONArray(TARIFFS_FILE, list); }

// ====== 53-bosqich: tizimdagi barcha funksiyalar ro'yxati ======
// Bu — kod ichida qattiq belgilangan (hardcoded) katalog, chunki bular
// tizimning haqiqiy imkoniyatlari (kod bo'limlari), admin ularni
// qo'shmaydi/o'chirmaydi — faqat har bir tarifga qaysi funksiyalar
// kirishini (54-bosqich, ✅/❌ jadval) belgilaydi. Har bir yozuv:
//  - id: barqaror kalit — tariff.features{} ichida shu kalit bilan
//        ✅/❌ saqlanadi (54-bosqich), va bloklash tekshiruvida (59-60)
//        shu id orqali ruxsat so'raladi.
//  - name: admin panelida ko'rinadigan o'zbekcha nom.
//  - group: 54-bosqichdagi jadvalni guruhlab ko'rsatish uchun.
const FEATURE_GROUPS = [
  { id: 'boshqaruv', name: "Boshqaruv va xodimlar" },
  { id: 'menyu', name: "Menyu va mahsulotlar" },
  { id: 'buyurtma', name: "Buyurtmalar va yetkazish" },
  { id: 'ombor_moliya', name: "Ombor va moliya" },
  { id: 'statistika', name: "Statistika va AI" },
  { id: 'mijoz', name: "Mijozlar (mini-ilova)" },
  { id: 'tizim', name: "Tizim va xavfsizlik" }
];
const FEATURE_CATALOG = [
  // Boshqaruv va xodimlar
  { id: 'manager-panel', name: "Menejer paneli", group: 'boshqaruv' },
  { id: 'cashier-panel', name: "Kassir paneli", group: 'boshqaruv' },
  { id: 'courier-panel', name: "Kuryer paneli", group: 'boshqaruv' },
  { id: 'kitchen-panel', name: "Oshpaz paneli", group: 'boshqaruv' },
  { id: 'staff-invite', name: "Xodim taklifnomalari", group: 'boshqaruv' },
  { id: 'staff-roles', name: "Xodim rollari va huquqlari", group: 'boshqaruv' },
  { id: 'branch-manage', name: "Filiallar boshqaruvi", group: 'boshqaruv' },
  { id: 'shift-toggle', name: "Smena boshlash/tugatish", group: 'boshqaruv' },
  // Menyu va mahsulotlar
  { id: 'menu-manage', name: "Menyu boshqaruvi", group: 'menyu' },
  { id: 'category-manage', name: "Kategoriyalar boshqaruvi", group: 'menyu' },
  { id: 'combo-manage', name: "Combo boshqaruvi", group: 'menyu' },
  { id: 'promo-manage', name: "Aksiya/promo boshqaruvi", group: 'menyu' },
  // Buyurtmalar va yetkazish
  { id: 'orders-manage', name: "Buyurtmalarni boshqarish", group: 'buyurtma' },
  { id: 'delivery-group', name: "Dostavka guruh xabarnomasi", group: 'buyurtma' },
  { id: 'kitchen-group', name: "Oshxona guruh xabarnomasi", group: 'buyurtma' },
  { id: 'courier-report', name: "Kuryer hisoboti", group: 'buyurtma' },
  // Ombor va moliya
  { id: 'stock-manage', name: "Ombor boshqaruvi", group: 'ombor_moliya' },
  { id: 'expense-manage', name: "Xarajatlar", group: 'ombor_moliya' },
  { id: 'cashflow', name: "Kassa oqimi", group: 'ombor_moliya' },
  { id: 'z-report', name: "Z-hisobot", group: 'ombor_moliya' },
  { id: 'bonus-settings', name: "Bonus sozlamalari", group: 'ombor_moliya' },
  // Statistika va AI
  { id: 'dashboard', name: "Boshqaruv paneli (Dashboard)", group: 'statistika' },
  { id: 'staff-performance', name: "Xodimlar statistikasi", group: 'statistika' },
  { id: 'ai-analytics', name: "AI tahlil", group: 'statistika' },
  { id: 'ai-director', name: "AI Direktor", group: 'statistika' },
  { id: 'audit', name: "Auditlar", group: 'statistika' },
  // Mijozlar (mini-ilova)
  { id: 'customer-menu', name: "Mijoz uchun menyu va buyurtma", group: 'mijoz' },
  { id: 'customer-account', name: "Mijoz profili va tarixi", group: 'mijoz' },
  // Tizim va xavfsizlik
  { id: 'restaurant-brand', name: "Restoran brendi (logo, nom)", group: 'tizim' },
  { id: 'system-status', name: "Tizim holati paneli", group: 'tizim' },
  { id: 'notification-log', name: "Xatolik jurnali", group: 'tizim' }
];
function getFeatureCatalogGrouped() {
  return FEATURE_GROUPS.map(g => ({
    id: g.id,
    name: g.name,
    features: FEATURE_CATALOG.filter(f => f.group === g.id).map(f => ({ id: f.id, name: f.name }))
  }));
}

// ====== 59-bosqich: tarifda yo'q funksiyaga kirishni bloklash ======
// Muhim: owner.tariffId belgilanmagan (yoki tarif o'chirilgan) bo'lsa —
// CHEKLOVSIZ. Bu — eski, tarif tizimidan oldingi do'kon egalari (57-bosqich
// hali ularga tarif biriktirmagan) ishlashda davom etishi uchun muhim.
// Faqat admin ongli ravishda bir tarifni biriktirganda, o'sha tarifning
// features{} xaritasi amal qila boshlaydi.
function ownerCanUseFeature(owner, featureId) {
  if (!owner || !owner.tariffId) return true;
  const tariff = loadTariffs().find(t => t.id === owner.tariffId);
  if (!tariff) return true;
  return !!(tariff.features && tariff.features[featureId] === true);
}

// 60-bosqich: bloklangan joyda aniq va tushunarli xabar — qaysi funksiya
// va nima uchun yopilganini bildiradi (admin bilan bog'lanishni so'raydi).
function featureBlockedResult(featureId) {
  const feature = FEATURE_CATALOG.find(f => f.id === featureId);
  const label = feature ? feature.name : 'Bu funksiya';
  return {
    ok: false,
    reason: `"${label}" joriy tarifingizga kiritilmagan. Kengaytirish uchun administrator bilan bog'laning.`,
    blockedFeature: true,
    featureId
  };
}

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
  dostavka: 'Kuryer'
};

// ====== Filiallar (G. Filiallar tizimi) — har bir egasi bir nechta filial ocha oladi ======
function findBranch(owner, branchId) {
  return (owner.branches || []).find(b => String(b.id) === String(branchId));
}

function generateBranchId() {
  return crypto.randomBytes(6).toString('hex');
}

// Berilgan branchId bo'yicha sklad "pool"ini aniqlaydi: branchId bo'lmasa — markaziy sklad (owner o'zi),
// branchId bo'lsa — o'sha filialning o'z sklad massivi (kerak bo'lsa lazy yaratiladi)
function resolveStockPool(owner, branchId) {
  if (!branchId) return owner; // markaziy sklad — owner.stock / owner.stockMovements
  const branch = findBranch(owner, branchId);
  if (!branch) return null;
  if (!branch.stock) branch.stock = [];
  if (!branch.stockMovements) branch.stockMovements = [];
  return branch;
}

// ====== Xarajat kategoriyalari (F. Moliya bo'limi uchun) ======
const EXPENSE_CATEGORIES = {
  ijara: 'Ijara',
  maosh: 'Maosh',
  kommunal: 'Kommunal',
  mahsulot: 'Mahsulot xaridi',
  // 7-10-bosqich: sklad-add orqali AVTOMATIK yoziladigan xarajatlar shu
  // kategoriyada — "Mahsulot xaridi"dan ataylab alohida, chunki u qo'lda
  // (/api/expense-add) kiritilgan xarajatlar uchun, buni esa foydalanuvchi
  // qo'lda tanlamaydi, faqat /api/stock-add o'zi yozadi.
  sklad_xarid: 'Sklad xaridlari',
  boshqa: 'Boshqa'
};

// ====== Menyu bo'limlari / kategoriyalari — F-bo'lim (36-40-bosqich) ======
// Har bir egasi endi o'zining tuzilmali bo'limlar ro'yxatiga ega:
// owner.categories = [{id, name, order}, ...]. Taom (`menu` item)ning
// `category` maydoni hamon oddiy matn (nom) sifatida saqlanadi — shu bilan
// eski kod (menyuni ko'rsatish, guruhlash) o'zgarishsiz ishlayveradi, faqat
// endi bu nomlar "erkin matn" emas, shu ro'yxatdan tanlanadi.
//
// Eski ma'lumotlarda (birinchi marta shu funksiyaga murojaat qilinganda)
// owner.categories hali yo'q — shu holda owner.menu ichidagi mavjud
// category qiymatlaridan (takrorlanmas holda, birinchi uchragan tartibda)
// avtomatik ro'yxat yasaladi (migratsiya). Shundan keyin owner.categories
// doim massiv deb hisoblanishi mumkin.
function ensureOwnerCategories(owner) {
  if (!Array.isArray(owner.categories)) {
    const seen = new Set();
    const migrated = [];
    (owner.menu || []).forEach(item => {
      const name = String(item.category || '').trim();
      const key = name.toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        migrated.push({ id: crypto.randomBytes(4).toString('hex'), name, order: migrated.length });
      }
    });
    owner.categories = migrated;
  }
  return owner.categories;
}

// Tartib (order) bo'yicha saralangan holda qaytaradi — ro'yxatni ko'rsatish/
// yuborishdan oldin har doim shu orqali o'qish kerak.
function sortedOwnerCategories(owner) {
  return ensureOwnerCategories(owner).slice().sort((a, b) => a.order - b.order);
}

// ====== D-bo'lim (28-31-bosqich): Combo — bir nechta taomni birlashtirib,
// mijozga alohida bo'lim sifatida ko'rinadigan, o'z narxiga ega "to'plam"
// sifatida sotish. Combo o'zi sklad bilan BEVOSITA bog'lanmaydi — u faqat
// mavjud menyu taomlarining (owner.menu) qaysi biri va necha donadan
// tarkibga kirishini saqlaydi (itemIds: [{menuItemId, qty}]). Buyurtma
// qilinganda combo tarkibidagi HAR BIR taomning o'z retsepti (yoki
// to'g'ridan-sklad turi) bo'yicha sklad kamayadi — xuddi o'sha taomlar
// alohida-alohida buyurtma qilingandek (faqat narx combo narxi bo'yicha
// hisoblanadi, tarkibidagi taomlarning yig'indi narxi emas — buning
// farqini priceMode belgilaydi: "auto" = tarkib narxlari yig'indisi,
// "manual" = egasi qo'lda kiritgan narx).
function findCombo(owner, id) {
  return (owner.combos || []).find(c => c.id === id);
}

// Combo tarkibidagi taomlar narxining yig'indisini hisoblaydi ("avtomatik"
// narx rejimi uchun — 31-bosqich). Menyudan o'chirilgan/topilmagan taom
// bo'lsa, uning ulushi yig'indiga qo'shilmaydi (0 sifatida hisoblanadi).
function comboAutoPrice(owner, itemIds) {
  return (itemIds || []).reduce((sum, entry) => {
    const menuItem = (owner.menu || []).find(m => m.id === entry.menuItemId);
    return sum + (menuItem ? menuItem.price * entry.qty : 0);
  }, 0);
}

// Combo bitta buyurtma miqdorida (comboQty) qancha sklad mahsuloti talab
// qilishini hisoblaydi — natija {stockId, qty, viaName} massivi;
// checkStockAvailability (tekshirish) va haqiqiy kamaytirish (consumption)
// bir xil shu ro'yxatdan foydalanadi, shu bilan ikkalasida mantiq
// bir-biridan farq qilib qolmaydi.
function comboStockNeeds(owner, combo, comboQty) {
  const needs = [];
  for (const entry of ((combo && combo.itemIds) || [])) {
    const menuItem = (owner.menu || []).find(m => m.id === entry.menuItemId);
    if (!menuItem) continue;
    const unitsNeeded = entry.qty * comboQty;
    if (menuItem.directStockId) {
      needs.push({ stockId: menuItem.directStockId, qty: Math.round(unitsNeeded * 1000) / 1000, viaName: menuItem.name });
      continue;
    }
    const recipe = Array.isArray(menuItem.recipe) ? menuItem.recipe : [];
    for (const ing of recipe) {
      needs.push({ stockId: ing.stockId, qty: Math.round(ing.qty * unitsNeeded * 1000) / 1000, viaName: menuItem.name });
    }
  }
  return needs;
}

// 47-bosqich: sklad tugagach taom/combo avtomatik "Tugagan" deb belgilanishi
// uchun — egasi qo'lda o'chirgan "available" belgisidan MUSTAQIL, real vaqtda
// hisoblanadigan ko'rsatkich. Taom sklad bilan bog'lanmagan bo'lsa (na
// directStockId, na recipe) — cheklovsiz, doim mavjud deb hisoblanadi.
function menuItemOutOfStock(owner, menuItem) {
  if (!menuItem) return false;
  if (menuItem.directStockId) {
    const stockItem = (owner.stock || []).find(s => s.id === menuItem.directStockId);
    if (!stockItem) return false; // sklad kartochkasi topilmasa — eski xatti-harakat saqlanadi (cheklanmaydi)
    return stockItem.qty < 1;
  }
  const recipe = Array.isArray(menuItem.recipe) ? menuItem.recipe : [];
  if (!recipe.length) return false;
  return recipe.some(ing => {
    const stockItem = (owner.stock || []).find(s => s.id === ing.stockId);
    if (!stockItem) return false;
    return stockItem.qty < ing.qty;
  });
}

// Combo uchun xuddi shu qoida — tarkibidagi taomlardan BIRORTASI uchun ham
// sklad yetarli bo'lmasa, combo ham "Tugagan" deb ko'rsatiladi (bitta
// combo — comboQty=1 — tayyorlash uchun yetarli sklad bormi tekshiriladi).
function comboOutOfStock(owner, combo) {
  if (!combo) return false;
  const needs = comboStockNeeds(owner, combo, 1);
  return needs.some(need => {
    const stockItem = (owner.stock || []).find(s => s.id === need.stockId);
    if (!stockItem) return false;
    return stockItem.qty < need.qty;
  });
}

// ====== Sklad birliklari va buyurtma turlari (module darajasida — bir nechta joyda ishlatiladi) ======
const STOCK_UNITS = { kg: 'kg', g: 'g', l: 'l', ml: 'ml', dona: 'dona' };
const ORDER_TYPES = { stol: 'Stolga', olib_ketish: 'Olib ketish', dostavka: 'Dostavka' };
const PAYMENT_TYPES = { naqd: 'Naqd', karta: 'Karta', dostavka_orqali: 'Dostavka orqali' };
// "Dostavka orqali" to'langan buyurtmalarda pul avval kuryerning o'z qo'lida
// turadi — kuryer shu pulni oshxonaga/egasiga jismonan topshirmaguncha
// (courierCashCollected === true bo'lmaguncha) bu summa hech qanday daromad
// hisobotiga (kassa, kunlik Z-hisobot, cashflow va h.k.) QO'SHILMAYDI. Karta
// orqali to'lovda pul to'g'ridan-to'g'ri hisobga/kassaga tushadi va kuryerning
// qo'lida "yotib qolmaydi", shuning uchun karta har doim darhol daromadga
// qo'shiladi (eski buyurtmalarda maydon bo'lmasa ham — moslik uchun default true).
function orderIncomeAmount(o) {
  if (o.paymentType === 'dostavka_orqali' && o.courierCashCollected === false) return 0;
  return o.total || 0;
}
// ---- Buyurtma holati bosqichlari: Yangi -> Tayyorlanmoqda -> Tayyor ----
const ORDER_STATUSES = { yangi: 'Yangi', tayyorlanmoqda: 'Tayyorlanmoqda', tayyor: 'Tayyor' };
// 5-bosqich: "Kechikayotgan" tayyor holatida bo'lmagan ma'lumot modelida
// mavjud emas — shu sababli hisoblab chiqariladi: buyurtma yaratilganidan
// shuncha daqiqa o'tib ham hali "tayyor" bo'lmasa, kechikkan hisoblanadi.
// Hozircha taxminiy qiymat — kerak bo'lsa keyinroq moslashtirish mumkin.
const ORDER_DELAY_THRESHOLD_MINUTES = 20;

// ---- Buyurtma yaratishda "ikki marta bosish" / tarmoq qayta yuborishi tufayli ----
// ---- bitta buyurtmaning ikki marta yaratilib ketishining oldini olish ----
// Klient har bir chek-aut urinishi uchun bitta `requestId` yuboradi. Shu
// `requestId` bilan avval muvaffaqiyatli buyurtma yaratilgan bo'lsa, server
// yangi buyurtma yaratmasdan, oldingi natijani qaytaradi (sklad ham qayta
// kamaytirilmaydi). Yozuvlar xotirada saqlanadi va bir muddatdan so'ng
// avtomatik tozalanadi — bu faqat qisqa muddatli himoya, doimiy audit emas.
const ORDER_REQUEST_CACHE_TTL_MS = 10 * 60 * 1000; // 10 daqiqa
const orderRequestCache = new Map(); // key: `${ownerId}:${userId}:${requestId}` -> { response, expiresAt }

function getCachedOrderResponse(ownerId, userId, requestId) {
  if (!requestId) return null;
  const key = `${ownerId}:${userId}:${requestId}`;
  const entry = orderRequestCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    orderRequestCache.delete(key);
    return null;
  }
  return entry.response;
}

function setCachedOrderResponse(ownerId, userId, requestId, response) {
  if (!requestId) return;
  const key = `${ownerId}:${userId}:${requestId}`;
  orderRequestCache.set(key, { response, expiresAt: Date.now() + ORDER_REQUEST_CACHE_TTL_MS });
}

// Eskirgan keshlarni vaqti-vaqti bilan tozalab turadi (xotira sizib ketmasligi uchun)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of orderRequestCache) {
    if (entry.expiresAt < now) orderRequestCache.delete(key);
  }
}, 5 * 60 * 1000);

function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(STAFF_ROLES, role);
}

// Taom rasmi: https:// havola YOKI galereyadan tanlangan rasm (base64 data URL) bo'lishi mumkin.
// Base64 rasm hajmi cheklanadi (owners.json fayli haddan tashqari katta bo'lib ketmasligi uchun).
const MAX_MENU_IMAGE_BASE64_CHARS = 3_000_000; // taxminan ~2.2MB dekodlangan rasm (so'rov hajmi cheklovidan kichik)
function isValidImageValue(value) {
  if (!value) return true; // bo'sh qiymat ruxsat etiladi (rasm shart emas)
  if (/^https?:\/\//i.test(value)) return true;
  if (/^data:image\/(png|jpe?g|webp);base64,/i.test(value)) {
    return value.length <= MAX_MENU_IMAGE_BASE64_CHARS;
  }
  return false;
}

// Xodimning rollarini har doim massiv shaklida qaytaradi — eski ma'lumotda
// bitta `role` (string) saqlangan bo'lishi mumkin, buni ham qo'llab-quvvatlaydi.
function normalizeStaffRoles(staff) {
  if (!staff) return [];
  if (Array.isArray(staff.roles) && staff.roles.length) {
    return staff.roles.filter(isValidRole);
  }
  if (staff.role && isValidRole(staff.role)) return [staff.role];
  return [];
}

// Xodimda berilgan rol bor-yo'qligini tekshiradi (bir nechta rol biriktirilgan bo'lishi mumkin)
function staffHasRole(staff, role) {
  return normalizeStaffRoles(staff).includes(role);
}

// ctx (resolveOwnerContext natijasi) berilgan rolga ega-yo'qligini tekshiradi.
// Egasi uchun ctx.role har doim 'egasi' — xodim uchun ctx.roles massividan tekshiriladi.
function ctxHasRole(ctx, role) {
  if (!ctx) return false;
  if (ctx.role === 'egasi') return role === 'egasi';
  return Array.isArray(ctx.roles) ? ctx.roles.includes(role) : ctx.role === role;
}

// ctx berilgan rollardan BIRIGA bo'lsa ham ega bo'lsa true qaytaradi
function ctxHasAnyRole(ctx, roles) {
  return roles.some(r => ctxHasRole(ctx, r));
}

// Bir nechta rol nomlarini o'qiladigan matn qilib birlashtiradi (masalan: "Kassir, Oshpaz")
function rolesLabel(roles) {
  return (roles || []).map(r => STAFF_ROLES[r] || r).join(', ') || '—';
}

// Berilgan userId qaysi egasining xodimi ekanini (va rol(lar)ini) topadi
function findStaffInfo(owners, userId) {
  for (const owner of owners) {
    const staff = (owner.staff || []).find(s => String(s.id) === String(userId));
    if (staff) {
      const roles = normalizeStaffRoles(staff);
      return {
        ownerId: owner.id,
        ownerName: (owner.profile && owner.profile.name) || null,
        ownerLogoUrl: (owner.profile && owner.profile.logoUrl) || null,
        ownerBrandColor: (owner.profile && owner.profile.brandColor) || null,
        role: roles[0] || staff.role || null,
        roles,
        staff
      };
    }
  }
  return null;
}

// Berilgan userId qaysi oshxonaga tegishli ekanini aniqlaydi (egasining o'zi yoki uning xodimi)
// Qaytaradi: { owner, role, roles, branchId } — role: 'egasi' yoki xodimning birinchi roli
// (orqaga moslik uchun), roles: xodimga biriktirilgan BARCHA rollar massivi; topilmasa null
function resolveOwnerContext(owners, userId) {
  const owner = findOwner(owners, userId);
  if (isOwnerAccessValid(owner)) return { owner, role: 'egasi', roles: ['egasi'], branchId: null };

  const staffInfo = findStaffInfo(owners, userId);
  if (staffInfo) {
    const staffOwner = owners.find(o => String(o.id) === String(staffInfo.ownerId));
    if (staffOwner) {
      return {
        owner: staffOwner,
        role: staffInfo.role,
        roles: staffInfo.roles,
        branchId: staffInfo.staff.branchId || null
      };
    }
  }
  return null;
}

// ====== J. Mijozlar uchun menyu (38-40-bosqich) — mijozlar, sevimlilar, aksiyalar, bonus ======
// Owner ichida mijozlarni topadi/kerak bo'lsa yangi yozuv yaratadi (favorites, bonus ballari shu yerda saqlanadi)
function findCustomer(owner, userId) {
  return (owner.customers || []).find(c => String(c.id) === String(userId));
}

function findOrCreateCustomer(owner, userId, tgUser) {
  if (!owner.customers) owner.customers = [];
  let c = findCustomer(owner, userId);
  if (!c) {
    c = {
      id: String(userId),
      username: (tgUser && tgUser.username) || null,
      firstName: (tgUser && tgUser.first_name) || null,
      favorites: [],
      bonusPoints: 0,
      ordersCount: 0,
      totalSpent: 0,
      createdAt: new Date().toISOString()
    };
    owner.customers.push(c);
  } else {
    if (tgUser && tgUser.username) c.username = tgUser.username;
    if (tgUser && tgUser.first_name) c.firstName = tgUser.first_name;
  }
  return c;
}

// Berilgan promoId bo'yicha faol aksiyani topadi va chegirmani hisoblaydi
function findActivePromo(owner, promoId) {
  if (!promoId) return null;
  const promo = (owner.promotions || []).find(p => p.id === promoId && p.active);
  return promo || null;
}

function applyPromoDiscount(owner, promoId, subtotal) {
  const promo = findActivePromo(owner, promoId);
  if (!promo) return { promo: null, discountAmount: 0 };
  if (promo.minTotal && subtotal < promo.minTotal) return { promo: null, discountAmount: 0 };
  const discountAmount = Math.round(subtotal * (promo.discountPercent / 100));
  return { promo, discountAmount };
}

// ====== I. Xodimlar nazorati (35-37-bosqich) — amallar jurnali, 30 kunlik hisobot, reyting ======
// Har bir muhim amalni (kim, qachon, nima qildi) jurnalga yozadi. errorCount — audit kamomadlari uchun (reyting hisobida ayiriladi)
function logStaffAction(owner, entry) {
  if (!owner.staffActionLog) owner.staffActionLog = [];
  owner.staffActionLog.unshift(Object.assign({
    id: crypto.randomBytes(4).toString('hex'),
    errorCount: 0,
    createdAt: new Date().toISOString()
  }, entry));
  if (owner.staffActionLog.length > 2000) owner.staffActionLog.length = 2000;
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

// 12-bosqich: Ilgari sendMessage() Telegramdan qaytgan har qanday xatolikni
// (masalan "Forbidden: bot was blocked by the user" yoki "chat not found" —
// bular xodim botga hali /start bosmagan yoki uni block qilgan bo'lsa yuz
// beradi) BUTUNLAY yashirib yuborar edi (`.catch(() => {})`, natijani ham
// tekshirmasdan). Shu sababli "oshpazga buyurtma tushmayapti" kabi holatlarni
// aniqlash imkonsiz edi — xabar yuborilmagani hech qayerda ko'rinmasdi.
// Endi: Telegram `ok:false` qaytarsa ham, tarmoq xatosi bo'lsa ham — sabab
// konsolga (server logiga) chiqariladi. Chaqiruvchi funksiyalar xatti-harakati
// o'zgarmaydi (hamon reject qilmaydi, oldingidek natija bilan davom etadi) —
// faqat endi sabab KO'RINADIGAN bo'ldi. To'liq, ilova ichida ko'rinadigan
// xatolik jurnali 17-bosqichda qo'shiladi.
function sendMessage(chatId, text, replyMarkup) {
  const params = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) params.reply_markup = JSON.stringify(replyMarkup);
  return telegramApi('sendMessage', params).then(result => {
    if (!result || !result.ok) {
      const reason = (result && result.description) || 'noma\'lum xatolik';
      console.error(`[sendMessage xato] chat_id=${chatId}: ${reason}`);
    }
    return result;
  }).catch(err => {
    console.error(`[sendMessage tarmoq xatosi] chat_id=${chatId}: ${(err && err.message) || err}`);
    return null;
  });
}

// 17-bosqich: bir nechta xodimga (notifyTargets ro'yxati) bir xil matnni
// yuboradigan umumiy yordamchi. Ilgari har bir chaqiruv joyida
// `for (const targetId of new Set(notifyTargets)) sendMessage(targetId, text)`
// deb takrorlanardi — endi bitta joyda, va MUHIMI: yetkazib bo'lmagan har bir
// xabar sababi bilan birga `owner.notificationErrors`ga yoziladi (oxirgi 50
// tasi saqlanadi), shunda egasi ilova ichida ("Bildirishnoma xatolari"
// kartochkasi, Sozlamalar) buni ko'ra oladi — Telegram/server logiga
// kirish shart emas. Chaqiruvchi tomon o'zgarishdan keyin owner obyektini
// saqlashi (saveOwners) kerak — bu funksiya faylga o'zi yozmaydi.
function notifyStaffList(owner, targetIds, text, context) {
  const uniqueIds = [...new Set((targetIds || []).map(String))];
  const promises = uniqueIds.map(targetId => sendMessage(targetId, text).then(result => {
    if (!result || !result.ok) {
      const reason = (result && result.description) || 'yuborilmadi (tarmoq xatosi)';
      const staff = (owner.staff || []).find(s => String(s.id) === String(targetId));
      if (!owner.notificationErrors) owner.notificationErrors = [];
      owner.notificationErrors.unshift({
        id: crypto.randomBytes(4).toString('hex'),
        targetId,
        targetName: staff ? staffDisplayName(staff) : (String(targetId) === String(owner.id) ? 'Egasi' : `ID: ${targetId}`),
        reason,
        context: context || null,
        createdAt: new Date().toISOString()
      });
      if (owner.notificationErrors.length > 50) owner.notificationErrors.length = 50;
    }
  }));
  return Promise.all(promises);
}

function answerCallbackQuery(callbackId, text, showAlert) {
  const params = { callback_query_id: callbackId };
  if (text) params.text = text;
  if (showAlert) params.show_alert = 'true';
  return telegramApi('answerCallbackQuery', params).catch(() => {});
}

function editMessageText(chatId, messageId, text, replyMarkup) {
  const params = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (replyMarkup) params.reply_markup = JSON.stringify(replyMarkup);
  else params.reply_markup = JSON.stringify({ inline_keyboard: [] });
  return telegramApi('editMessageText', params).catch(() => {});
}

// To'lov skrinshoti kabi RASM (caption) xabarlarini tahrirlash uchun -
// editMessageText FAQAT matnli xabarlarda ishlaydi, rasm/caption'li
// xabarlarda Telegram xato qaytaradi, shuning uchun alohida.
function editMessageCaption(chatId, messageId, caption, replyMarkup) {
  const params = { chat_id: chatId, message_id: messageId, caption, parse_mode: 'HTML' };
  if (replyMarkup) params.reply_markup = JSON.stringify(replyMarkup);
  else params.reply_markup = JSON.stringify({ inline_keyboard: [] });
  return telegramApi('editMessageCaption', params).catch(() => {});
}

// Mijoz yuborgan skrinshotni (from_chat_id/message_id) qayta yuklamasdan,
// "Forwarded from" belgisisiz kassir/egasiga ko'chirib yuboradi - caption va
// tasdiqlash tugmalari bilan birga.
function copyMessageWithKeyboard(targetChatId, fromChatId, messageId, caption, replyMarkup) {
  const params = {
    chat_id: targetChatId, from_chat_id: fromChatId, message_id: messageId,
    caption, parse_mode: 'HTML'
  };
  if (replyMarkup) params.reply_markup = JSON.stringify(replyMarkup);
  return telegramApi('copyMessage', params).catch(() => {});
}

// Lokatsiya (lat/lng) berilgan bo'lsa - Google Maps havolasiga aylantiradi
// (dostavka guruhi/oshxona xabarida bosib ochish uchun).
function locationMapsLink(location) {
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') return null;
  return `https://maps.google.com/?q=${location.lat},${location.lng}`;
}

function displayName(user) {
  if (!user) return 'Noma\'lum';
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || (user.username ? '@' + user.username : String(user.id));
}

// Mijoz "Tanishuv" shaklida o'zi kiritgan Ism+Familiyani birinchi navbatda
// ishlatadi — buyurtmalarda "Mijoz:" sifatida shu ko'rsatiladi. Bu Telegram
// profilidagi (taxallus bo'lishi mumkin bo'lgan) ismdan ko'ra ishonchliroq,
// chunki mijoz buni ro'yxatdan o'tishda bevosita o'zi yozgan. Ro'yxatdan
// o'tmagan bo'lsa (masalan eski buyurtmalar) Telegram nomiga qaytadi.
function customerDisplayName(userId, tgUser) {
  const profile = findProfile(userId);
  if (profile && profile.firstName) {
    return [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  }
  return displayName(tgUser);
}

// 1-bosqich: xodimlar hisobotlarida (reyting, amallar jurnali) F.I.Sh
// (to'liq ism-familiya) ko'rsatish uchun. Xodim /api/profile-register orqali
// (mijozlar bilan bir xil umumiy ro'yxatdan o'tish oqimi — profiles.json)
// ism-familiyasini kiritgan bo'lsa, o'sha F.I.Sh qaytariladi; aks holda
// @username'ga, u ham bo'lmasa Telegram ID'siga qaytiladi.
function staffDisplayName(staff) {
  if (!staff) return null;
  const profile = findProfile(staff.id);
  if (profile && profile.firstName) {
    return [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  }
  return staff.username ? '@' + staff.username : `ID: ${staff.id}`;
}

// Telegram xabarlari HTML parse_mode bilan yuborilgani uchun, foydalanuvchi kiritgan matnni xavfsiz qilib chiqaramiz
function escapeHtmlServer(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Buyurtma haqida oshxonaning biriktirilgan (dostavka) admin guruhiga xabar yuboradi
// ("Qabul qilish" / "Tayyor" tugmalari bilan — bosilganda mijozga avtomatik xabar boradi).
// Sarlavha buyurtma turiga qarab moslashadi (Dostavka/Stolga/Olib ketish) — chunki endi
// guruhga barcha buyurtma turlari yuboriladi, faqat dostavka emas.
function notifyDeliveryGroup(owner, order, creatorLabel) {
  if (!owner.deliveryGroupId) return;
  const itemsText = order.items.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
  const mapsLink = locationMapsLink(order.location);
  const addressLines = [
    mapsLink ? `📍 Joylashuv: ${mapsLink}` : null,
    order.addressNote ? `📝 Manzil izohi: ${escapeHtmlServer(order.addressNote)}` : null,
  ].filter(Boolean).join('\n');
  const typeLabel = ORDER_TYPES[order.orderType] || order.orderType;
  const headerEmoji = order.orderType === 'dostavka' ? '🚚' : (order.orderType === 'stol' ? '🍽' : '🥡');
  const tableLine = order.tableNumber ? ` — stol ${escapeHtmlServer(order.tableNumber)}` : '';
  const text = `${headerEmoji} <b>Yangi buyurtma</b> (${typeLabel}${tableLine})${creatorLabel ? '\n' + creatorLabel : ''}\n${itemsText}\n\nJami: ${order.total} so'm\nTo'lov: ${PAYMENT_TYPES[order.paymentType] || order.paymentType}` +
    (addressLines ? `\n\n${addressLines}` : '');
  sendMessage(owner.deliveryGroupId, text, {
    inline_keyboard: [[
      { text: '✅ Qabul qilish', callback_data: `dgaccept:${owner.id}:${order.id}` },
      { text: '🏁 Tayyor', callback_data: `dgready:${owner.id}:${order.id}` }
    ]]
  }).then(result => {
    if (result && result.ok && result.result && result.result.message_id) {
      const owners2 = loadOwners();
      const o2 = findOwner(owners2, owner.id);
      const ord2 = o2 && (o2.orders || []).find(x => x.id === order.id);
      if (ord2) {
        ord2.deliveryGroupMsgId = result.result.message_id;
        saveOwners(owners2);
      }
    }
  }).catch(err => {
    console.error(`[notifyDeliveryGroup xatosi] owner=${owner.id} order=${order.id}: ${(err && err.message) || err}`);
  });
}

// 13-bosqich: "Oshpazga buyurtma tushmayapti" muammosining bir qismi — ba'zi
// oshxonalarda oshpazlar bot bilan shaxsiy chatni ochmagan/bloklagan bo'ladi,
// shu sababli ularga individual (staff.id bo'yicha) xabar UMUMAN yetib
// bormaydi. Yechim: dostavka admin guruhiga o'xshab, oshxona egasi alohida
// bir Telegram guruhini ("Oshpazlar guruhi") ham biriktira oladi — shu
// guruhga HAR BIR yangi buyurtma (turi qanday bo'lishidan qat'iy nazar)
// alohida, "✅ Qabul qilish" / "🏁 Tayyor" tugmalari bilan yuboriladi. Bu
// dostavka guruhidan MUSTAQIL — ikkalasi bir vaqtda biriktirilgan bo'lishi
// mumkin (masalan, kassirlar bitta guruhda, oshpazlar boshqa guruhda
// ishlaydi).
//
// 14-bosqich: ikkalasi (dostavka guruhi + oshpazlar guruhi) BIR XIL
// order.status maydonidan foydalanadi — shu sababli qaysi guruhda birinchi
// bosilishidan qat'iy nazar, ikkinchi guruhdagi tugma "allaqachon bajarilgan"
// deb javob beradi (dublikat yo'q), va ikkala guruhdagi xabar ham
// yangilanadi (qarang: syncGroupMessagesForOrder).
function notifyKitchenGroup(owner, order, creatorLabel) {
  if (!owner.kitchenGroupId) return;
  try {
    const itemsText = order.items.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
    const typeLabel = ORDER_TYPES[order.orderType] || order.orderType;
    const tableLine = order.tableNumber ? ` — stol ${escapeHtmlServer(order.tableNumber)}` : '';
    const text = `👨‍🍳 <b>Yangi buyurtma</b> (${typeLabel}${tableLine})${creatorLabel ? '\n' + creatorLabel : ''}\n${itemsText}\n\nJami: ${order.total} so'm`;
    sendMessage(owner.kitchenGroupId, text, {
      inline_keyboard: [[
        { text: '✅ Qabul qilish', callback_data: `kgaccept:${owner.id}:${order.id}` },
        { text: '🏁 Tayyor', callback_data: `kgready:${owner.id}:${order.id}` }
      ]]
    }).then(result => {
      if (result && result.ok && result.result && result.result.message_id) {
        const owners2 = loadOwners();
        const o2 = findOwner(owners2, owner.id);
        const ord2 = o2 && (o2.orders || []).find(x => x.id === order.id);
        if (ord2) {
          ord2.kitchenGroupMsgId = result.result.message_id;
          saveOwners(owners2);
        }
      }
    }).catch(err => {
      console.error(`[notifyKitchenGroup xatosi] owner=${owner.id} order=${order.id}: ${(err && err.message) || err}`);
    });
  } catch (err) {
    console.error(`[notifyKitchenGroup kutilmagan xatosi] owner=${owner.id} order=${order.id}: ${(err && err.message) || err}`);
  }
}

// 14/15-bosqich: dostavka guruhi va oshpazlar guruhidagi xabarlarni (agar
// ikkalasi ham biriktirilgan bo'lsa), shuningdek buyurtma holati Mini App
// orqali (kassir/oshpaz/egasi tomonidan, guruh tugmalarisiz) o'zgarganda ham
// ikkala guruh xabaridagi tugmalarni joriy holatga mos ravishda yangilaydi —
// shu bilan "bir joyda qabul qilindi, boshqa joyda hali ham eski tugma
// ko'rinadi" kabi chalkashliklarning oldi olinadi.
function syncGroupMessagesForOrder(owner, order) {
  const targets = [
    { chatId: owner.deliveryGroupId, msgId: order.deliveryGroupMsgId, prefix: 'dg' },
    { chatId: owner.kitchenGroupId, msgId: order.kitchenGroupMsgId, prefix: 'kg' }
  ].filter(t => t.chatId && t.msgId);
  if (!targets.length) return;

  for (const t of targets) {
    let kb = { inline_keyboard: [] };
    if (order.status === 'yangi') {
      kb = { inline_keyboard: [[
        { text: '✅ Qabul qilish', callback_data: `${t.prefix}accept:${owner.id}:${order.id}` },
        { text: '🏁 Tayyor', callback_data: `${t.prefix}ready:${owner.id}:${order.id}` }
      ]] };
    } else if (order.status === 'tayyorlanmoqda') {
      kb = { inline_keyboard: [[{ text: '🏁 Tayyor', callback_data: `${t.prefix}ready:${owner.id}:${order.id}` }]] };
    }
    telegramApi('editMessageReplyMarkup', {
      chat_id: t.chatId, message_id: t.msgId,
      reply_markup: JSON.stringify(kb)
    }).catch(err => {
      console.error(`[syncGroupMessagesForOrder xatosi] owner=${owner.id} order=${order.id} chat=${t.chatId}: ${(err && err.message) || err}`);
    });
  }
}

// ====== Obuna muddati tugashini kuzatish (avtomatik bloklash + admin/egaga eslatma) ======
const EXPIRY_CHECK_INTERVAL_MS = 60 * 60 * 1000; // har soatda tekshiradi
// 65-bosqich: eslatma qancha kun oldin yuborilishi endi tarifga bog'liq —
// har bir tarif o'zining reminderDays qiymatini belgilashi mumkin (admin
// panelida, Tarif tahrirlash oynasi). Tarif biriktirilmagan yoki
// reminderDays ko'rsatilmagan bo'lsa — standart qiymat shu yerdan olinadi
// (eski, tarif tizimidan oldingi umumiy 1 kunlik xulq bilan bir xil).
const DEFAULT_REMINDER_DAYS = 1;

function ownerLabel(owner) {
  return owner.username ? '@' + owner.username : `ID: ${owner.id}`;
}

// Shu do'kon egasi uchun eslatma necha kun oldin yuborilishini aniqlaydi.
function ownerReminderBeforeMs(owner) {
  let reminderDays = DEFAULT_REMINDER_DAYS;
  if (owner.tariffId) {
    const tariff = loadTariffs().find(t => t.id === owner.tariffId);
    if (tariff && Number.isFinite(tariff.reminderDays) && tariff.reminderDays > 0) {
      reminderDays = tariff.reminderDays;
    }
  }
  return reminderDays * 24 * 60 * 60 * 1000;
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

    if (!owner.reminderSentAt && expiresMs - now <= ownerReminderBeforeMs(owner)) {
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

// Juda oddiy telefon raqam tekshiruvi — bo'shliq/tire/qavslarni olib tashlab,
// +xxxxxxxxxxx yoki xxxxxxxxxxx ko'rinishini tekshiradi (qarang: /api/profile-register)
function isPlausiblePhone(str) {
  const cleaned = String(str).replace(/[\s\-()]/g, '');
  return /^\+?\d{7,15}$/.test(cleaned);
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

// /start buyrug'ining asosiy mantiqi (taklif havolasi, mijoz menyu havolasi va h.k.) —
// alohida funksiyaga ajratildi, chunki ro'yxatdan o'tish tugagandan keyin ham
// xuddi shu logikani (asl /start matni bilan) qayta ishga tushirish kerak bo'ladi.
async function handleStartCommand(chatId, from, text) {
  const parts = text.split(' ');
  const payload = parts.length > 1 ? parts[1].trim() : '';

  if (!payload) {
    await sendMessage(chatId, isAdminId(from.id)
      ? 'Salom, admin! Mini App tugmasi orqali boshqaruv panelini oching.'
      : 'Salom! Ushbu botdan foydalanish uchun sizga taklif havolasi kerak.');
    return;
  }

  // Mijoz uchun oshxona menyusi havolasi: /start menu_<ownerId>
  if (payload.startsWith('menu_')) {
    const ownerId = payload.replace(/^menu_/, '').trim();
    const owners = pruneExpiredOwners();
    const owner = findOwner(owners, ownerId);
    if (!owner || !isOwnerAccessValid(owner)) {
      await sendMessage(chatId, 'Kechirasiz, bu oshxona menyusi hozircha mavjud emas.');
      return;
    }
    if (!PUBLIC_URL) {
      await sendMessage(chatId, 'Menyu havolasi hozircha sozlanmagan. Iltimos, oshxona bilan bog\'laning.');
      return;
    }
    const restaurantName = (owner.profile && owner.profile.name) || 'Oshxona';
    const menuUrl = `${PUBLIC_URL.replace(/\/$/, '')}/?customer=${encodeURIComponent(owner.id)}`;
    await sendMessage(chatId, `🍽 <b>${escapeHtmlServer(restaurantName)}</b> menyusiga xush kelibsiz!`, {
      inline_keyboard: [[{ text: '🍽 Menyuni ochish', web_app: { url: menuUrl } }]]
    });
    return;
  }

  // Xodim uchun bir martalik taklif havolasi: /start staffinv_<ownerId>_<token>
  if (payload.startsWith('staffinv_')) {
    const rest = payload.replace(/^staffinv_/, '');
    const sepIdx = rest.indexOf('_');
    const ownerId = sepIdx >= 0 ? rest.slice(0, sepIdx) : '';
    const token = sepIdx >= 0 ? rest.slice(sepIdx + 1) : '';

    const owners = pruneExpiredOwners();
    const owner = findOwner(owners, ownerId);
    const invite = owner && (owner.staffInvites || []).find(i => i.token === token);

    if (!owner || !invite || invite.used || new Date(invite.expiresAt) <= new Date()) {
      await sendMessage(chatId, 'Bu havola yaroqsiz yoki allaqachon ishlatilgan. Iltimos, menejerdan yangi havola so\'rang.');
      return;
    }
    if (isAdminId(from.id)) {
      await sendMessage(chatId, 'Siz administratorsiz, xodim bo\'la olmaysiz.');
      return;
    }
    if (findOwner(owners, from.id)) {
      await sendMessage(chatId, 'Siz allaqachon oshxona egasisiz, xodim bo\'la olmaysiz.');
      return;
    }
    const existingStaff = findStaffInfo(owners, from.id);
    if (existingStaff) {
      await sendMessage(chatId, existingStaff.ownerId === owner.id
        ? 'Siz allaqachon shu oshxonaning xodimisiz. Mini App tugmasi orqali oching.'
        : 'Siz boshqa oshxonada xodim sifatida ro\'yxatdasiz.');
      return;
    }

    invite.used = true;
    invite.usedBy = String(from.id);
    invite.usedAt = new Date().toISOString();

    if (!owner.staff) owner.staff = [];
    owner.staff.push({
      id: String(from.id),
      username: from.username || null,
      role: invite.roles[0],
      roles: invite.roles,
      branchId: invite.branchId || null,
      addedAt: new Date().toISOString()
    });
    saveOwners(owners);

    await sendMessage(chatId,
      `👋 Siz <b>${escapeHtmlServer((owner.profile && owner.profile.name) || 'oshxona')}</b> jamoasiga <b>${escapeHtmlServer(rolesLabel(invite.roles))}</b> sifatida qo\'shildingiz.\nMini App tugmasi orqali oching.`);
    sendMessage(owner.id, `✅ ${escapeHtmlServer(displayName(from))}${from.username ? ' (@' + escapeHtmlServer(from.username) + ')' : ''} taklif havolasi orqali <b>${escapeHtmlServer(rolesLabel(invite.roles))}</b> sifatida jamoaga qo\'shildi.`);
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
}

// ====== Telegram yangilanishlarini (webhook) qayta ishlash ======
async function handleTelegramUpdate(update) {
  if (update.message && update.message.text) {
    const msg = update.message;
    const text = msg.text.trim();
    const from = msg.from;
    const chatId = msg.chat.id;

    // ---- Guruhda /biriktir: oshxona egasi shu guruhni dostavka admin guruhi sifatida bog'laydi ----
    if ((msg.chat.type === 'group' || msg.chat.type === 'supergroup') && /^\/biriktir(@\S+)?$/.test(text)) {
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, from.id);
      if (!isOwnerAccessValid(owner)) {
        await sendMessage(chatId, 'Faqat tasdiqlangan oshxona egasi guruhni biriktira oladi.');
        return;
      }
      owner.deliveryGroupId = String(chatId);
      owner.deliveryGroupTitle = msg.chat.title || null;
      saveOwners(owners);
      await sendMessage(chatId,
        `✅ Bu guruh <b>${escapeHtmlServer((owner.profile && owner.profile.name) || 'oshxona')}</b> uchun admin guruhi sifatida biriktirildi.\n` +
        `Endi mijozlar istalgan turda (Stolga, Olib ketish yoki Dostavka) buyurtma bersa, "Qabul qilish" va "Tayyor" tugmali xabarlar shu guruhga keladi.`);
      return;
    }

    // ---- Guruhda /bekor_biriktir: bog'lanishni bekor qilish ----
    if ((msg.chat.type === 'group' || msg.chat.type === 'supergroup') && /^\/bekor_biriktir(@\S+)?$/.test(text)) {
      const owners = loadOwners();
      const owner = findOwner(owners, from.id);
      if (owner && String(owner.deliveryGroupId) === String(chatId)) {
        owner.deliveryGroupId = null;
        owner.deliveryGroupTitle = null;
        saveOwners(owners);
        await sendMessage(chatId, 'Bu guruh admin guruhi sifatidan olib tashlandi.');
      }
      return;
    }

    // ---- 13-bosqich: Guruhda /oshpaz_biriktir — shu guruhni "Oshpazlar
    // guruhi" sifatida bog'laydi. Dostavka guruhidan MUSTAQIL — ikkalasi
    // bir vaqtda biriktirilgan bo'lishi mumkin (masalan, kassirlar bitta
    // guruhda, oshpazlar boshqa guruhda ishlashi uchun). ----
    if ((msg.chat.type === 'group' || msg.chat.type === 'supergroup') && /^\/oshpaz_biriktir(@\S+)?$/.test(text)) {
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, from.id);
      if (!isOwnerAccessValid(owner)) {
        await sendMessage(chatId, 'Faqat tasdiqlangan oshxona egasi guruhni biriktira oladi.');
        return;
      }
      owner.kitchenGroupId = String(chatId);
      owner.kitchenGroupTitle = msg.chat.title || null;
      saveOwners(owners);
      await sendMessage(chatId,
        `✅ Bu guruh <b>${escapeHtmlServer((owner.profile && owner.profile.name) || 'oshxona')}</b> uchun Oshpazlar guruhi sifatida biriktirildi.\n` +
        `Endi har bir yangi buyurtma (Stolga, Olib ketish yoki Dostavka) shu guruhga ham, "Qabul qilish" va "Tayyor" tugmalari bilan yuboriladi.`);
      return;
    }

    // ---- 13-bosqich: Guruhda /oshpaz_bekor_biriktir — Oshpazlar guruhi
    // bog'lanishini bekor qilish ----
    if ((msg.chat.type === 'group' || msg.chat.type === 'supergroup') && /^\/oshpaz_bekor_biriktir(@\S+)?$/.test(text)) {
      const owners = loadOwners();
      const owner = findOwner(owners, from.id);
      if (owner && String(owner.kitchenGroupId) === String(chatId)) {
        owner.kitchenGroupId = null;
        owner.kitchenGroupTitle = null;
        saveOwners(owners);
        await sendMessage(chatId, 'Bu guruh Oshpazlar guruhi sifatidan olib tashlandi.');
      }
      return;
    }

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
      await handleStartCommand(chatId, from, text);
      return;
    }
    return;
  }

  // ---- Mijoz to'lov skrinshotini shaxsiy chatga RASM qilib yuborganda ----
  // (faqat paymentType === 'karta' bo'lgan va hali "kutilmoqda"/"rad_etildi"
  // holatidagi buyurtmalar uchun - qarang: /api/customer-order'dagi
  // paymentProofStatus va pastdagi 'payok'/'payrej' callback'lari)
  if (update.message && update.message.photo && update.message.chat && update.message.chat.type === 'private') {
    const msg = update.message;
    const from = msg.from;
    const chatId = msg.chat.id;
    const userId = String(from.id);

    const owners = loadOwners();
    let targetOwner = null;
    let targetOrder = null;
    for (const owner of owners) {
      for (const order of (owner.orders || [])) {
        if (String(order.customerId) !== userId) continue;
        if (order.paymentConfirmMethod !== 'skrinshot') continue;
        if (order.paymentProofStatus !== 'kutilmoqda' && order.paymentProofStatus !== 'rad_etildi') continue;
        if (!targetOrder || new Date(order.createdAt) > new Date(targetOrder.createdAt)) {
          targetOwner = owner;
          targetOrder = order;
        }
      }
    }

    if (!targetOwner || !targetOrder) {
      // Kutilayotgan karta to'lovi topilmadi - bu oddiy rasm bo'lishi mumkin,
      // jim o'tkazib yuboramiz (xato deb hisoblamaymiz).
      return;
    }

    const photos = msg.photo;
    const bestPhoto = photos[photos.length - 1]; // Telegram eng kattasini oxiriga qo'yadi
    targetOrder.paymentProofFileId = bestPhoto.file_id;
    targetOrder.paymentProofStatus = 'kutilmoqda';
    targetOrder.paymentProofSentAt = new Date().toISOString();
    saveOwners(owners);

    await sendMessage(chatId, '📤 Skrinshot qabul qilindi, tasdiqlanishini kuting...');

    const itemsText = targetOrder.items.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
    const caption = `💳 <b>To'lov tasdiqlash so'raladi</b>\n` +
      `Mijoz: ${escapeHtmlServer(targetOrder.customerName)}\n${itemsText}\n\n` +
      `Jami: ${targetOrder.total} so'm\n${ORDER_TYPES[targetOrder.orderType] || targetOrder.orderType}` +
      `${targetOrder.tableNumber ? ' — stol ' + escapeHtmlServer(targetOrder.tableNumber) : ''}`;
    const approveKb = {
      inline_keyboard: [[
        { text: '✅ Tasdiqlash', callback_data: `payok:${targetOwner.id}:${targetOrder.id}` },
        { text: '❌ Rad etish', callback_data: `payrej:${targetOwner.id}:${targetOrder.id}` }
      ]]
    };
    const approvers = [targetOwner.id, ...((targetOwner.staff || []).filter(s => staffHasRole(s, 'kassir')).map(s => s.id))];
    for (const approverId of new Set(approvers.map(String))) {
      copyMessageWithKeyboard(approverId, chatId, msg.message_id, caption, approveKb);
    }
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const from = cq.from;
    const data = cq.data || '';
    const chatId = cq.message && cq.message.chat && cq.message.chat.id;
    const messageId = cq.message && cq.message.message_id;

    // ---- Dostavka guruhi VA Oshpazlar guruhi: "Qabul qilish" / "Tayyor"
    // tugmalari (guruh a'zolari uchun, admin cheklovisiz). 13-bosqichdan
    // boshlab ikkala guruh turi ("dg" = dostavka, "kg" = oshpaz) bir xil
    // mantiq bilan, umumiy holda ishlanadi. 14-bosqich: ikkalasi ham
    // ORDER.STATUS'NI umumiy manba sifatida ishlatadi — shu sababli qaysi
    // guruhda birinchi bosilishidan qat'iy nazar, ikkinchisida bosilsa
    // "allaqachon bajarilgan" javobi qaytadi (dublikat status o'zgarishi
    // bo'lmaydi), va syncGroupMessagesForOrder orqali ikkala guruhdagi
    // xabar tugmalari ham yangilanadi. ----
    if (data.startsWith('dgaccept:') || data.startsWith('dgready:') || data.startsWith('kgaccept:') || data.startsWith('kgready:')) {
      const [action, ownerId, orderId] = data.split(':');
      const isKitchen = action.startsWith('kg');
      const stageField = isKitchen ? 'kitchenGroupStage' : 'deliveryGroupStage';
      const acceptedByField = isKitchen ? 'kitchenAcceptedBy' : 'deliveryAcceptedBy';
      const acceptedAtField = isKitchen ? 'kitchenAcceptedAt' : 'deliveryAcceptedAt';
      const readyByField = isKitchen ? 'kitchenReadyBy' : 'deliveryReadyBy';
      const readyAtField = isKitchen ? 'kitchenReadyAt' : 'deliveryReadyAt';
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner) { await answerCallbackQuery(cq.id, 'Oshxona topilmadi.'); return; }
      const order = (owner.orders || []).find(o => o.id === orderId);
      if (!order) { await answerCallbackQuery(cq.id, 'Buyurtma topilmadi.'); return; }

      if (action === 'dgaccept' || action === 'kgaccept') {
        if (order.status !== 'yangi') {
          // Boshqa guruhda (yoki Mini App'da) allaqachon qabul qilingan —
          // dublikat qilib qayta ishlanmaydi, faqat shu haqda xabar beriladi.
          await answerCallbackQuery(cq.id, 'Allaqachon qabul qilingan.');
          syncGroupMessagesForOrder(owner, order);
          return;
        }
        order[stageField] = 'qabul_qilindi';
        order[acceptedByField] = from.id;
        order[acceptedAtField] = new Date().toISOString();
        // Guruhdagi "Qabul qilish" bosilganda buyurtmaning asosiy status'i ham
        // yangilanadi ("tayyorlanmoqda"), aks holda u Mini App bosqichlaridan
        // uzilib qoladi (masalan, keyinroq "tayyor" belgilanganda kuryerga
        // ko'rinmay qoladi — chunki kuryer ro'yxati order.status'ga qarab
        // filtrlanadi, *GroupStage maydoniga emas).
        order.status = 'tayyorlanmoqda';
        order.updatedAt = new Date().toISOString();
        order.updatedBy = String(from.id);
        if (!order.startedAt) order.startedAt = order.updatedAt;
        saveOwners(owners);

        if (chatId && messageId) {
          await editMessageText(chatId, messageId,
            `${cq.message.text || ''}\n\n✅ Qabul qilindi — ${displayName(from)}`,
            { inline_keyboard: [[{ text: '🏁 Tayyor', callback_data: `${isKitchen ? 'kgready' : 'dgready'}:${ownerId}:${orderId}` }]] });
        }
        syncGroupMessagesForOrder(owner, order);
        if (order.customerId) {
          await sendMessage(order.customerId, '✅ Buyurtmangiz qabul qilindi, tez orada tayyorlanadi!');
        }
        await answerCallbackQuery(cq.id, 'Qabul qilindi ✅');
        return;
      }

      if (action === 'dgready' || action === 'kgready') {
        if (order.status === 'tayyor') {
          await answerCallbackQuery(cq.id, 'Allaqachon tayyor deb belgilangan.');
          syncGroupMessagesForOrder(owner, order);
          return;
        }
        // "Tayyor" tugmasi faqat "Qabul qilish" bosilgandan keyin ishlashi kerak —
        // aks holda ketma-ketlik buzilib, buyurtma hech kim qabul qilmasdan
        // tayyor deb belgilanib qolar edi.
        if (order.status !== 'tayyorlanmoqda') {
          await answerCallbackQuery(cq.id, 'Avval "✅ Qabul qilish" tugmasini bosing.', true);
          return;
        }
        order[stageField] = 'tayyor';
        order[readyByField] = from.id;
        order[readyAtField] = new Date().toISOString();
        // Asosiy status ham "tayyor"ga o'tkaziladi — shu maydon orqali
        // kuryerlarga buyurtmalar ro'yxati (/api/orders-list) filtrlanadi,
        // shu jumladan guruhga yangi qo'shilgan kuryer uchun ham.
        order.status = 'tayyor';
        order.updatedAt = new Date().toISOString();
        order.updatedBy = String(from.id);
        if (!order.readyAt) order.readyAt = order.updatedAt;
        saveOwners(owners);

        if (chatId && messageId) {
          await editMessageText(chatId, messageId,
            `${cq.message.text || ''}\n\n🏁 Tayyor — ${displayName(from)}`, null);
        }
        syncGroupMessagesForOrder(owner, order);
        if (order.customerId) {
          const readyMsg = order.orderType === 'dostavka'
            ? '🏁 Buyurtmangiz tayyor, kuryer yo\'lda!'
            : '🏁 Buyurtmangiz tayyor!';
          await sendMessage(order.customerId, readyMsg);
        }
        // Kassir(lar)ga va (dostavka bo'lsa) kuryer(lar)ga ham
        // Mini App'dagi "Tayyor" tugmasidagi kabi avtomatik bildirishnoma
        // yuboriladi, xabarni o'zi yuborgan xodimdan tashqari.
        {
          const itemsText = order.items.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
          const orderLabel = `${ORDER_TYPES[order.orderType] || order.orderType}${order.tableNumber ? ' — stol ' + escapeHtmlServer(order.tableNumber) : ''}`;
          const readyText = `✅ <b>Buyurtma tayyor</b> (${orderLabel})\n${itemsText}\n\nJami: ${order.total}`;
          const staffList = owner.staff || [];
          const targetRoles = order.orderType === 'dostavka' ? ['kassir', 'dostavka'] : ['kassir'];
          const targetIds = staffList.filter(s => targetRoles.includes(s.role)).map(s => s.id);
          for (const targetId of new Set(targetIds.map(String))) {
            if (targetId === String(from.id)) continue;
            sendMessage(targetId, readyText);
          }
        }
        await answerCallbackQuery(cq.id, 'Tayyor deb belgilandi 🏁');
        return;
      }
    }

    // ---- To'lov skrinshotini tasdiqlash/rad etish (kassir yoki egasi uchun,
    // admin cheklovisiz - dgaccept/dgready bilan bir xil joyga qo'yilgan) ----
    if (data.startsWith('payok:') || data.startsWith('payrej:')) {
      const [action, ownerId, orderId] = data.split(':');
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner) { await answerCallbackQuery(cq.id, 'Oshxona topilmadi.'); return; }
      const order = (owner.orders || []).find(o => o.id === orderId);
      if (!order) { await answerCallbackQuery(cq.id, 'Buyurtma topilmadi.'); return; }

      const isOwnerUser = String(owner.id) === String(from.id);
      const isCashier = (owner.staff || []).some(s => staffHasRole(s, 'kassir') && String(s.id) === String(from.id));
      if (!isOwnerUser && !isCashier) {
        await answerCallbackQuery(cq.id, 'Sizda bu amal uchun ruxsat yo\'q (faqat kassir yoki egasi).');
        return;
      }

      // "naqd_kassa" (stolga+naqd) tasdiqlash oddiy MATN xabar bilan yuboriladi,
      // "skrinshot" (karta) tasdiqlash esa RASM (caption) bilan - shu sababli
      // tahrirlash uchun to'g'ri Telegram metodini tanlash kerak (aks holda
      // "message is not modified"/"there is no caption in the message" xatosi).
      const editConfirmMessage = (extraLine) => {
        if (!chatId || !messageId) return Promise.resolve();
        if (cq.message && cq.message.photo) {
          return editMessageCaption(chatId, messageId, `${cq.message.caption || ''}\n\n${extraLine}`, null);
        }
        return editMessageText(chatId, messageId, `${cq.message.text || ''}\n\n${extraLine}`, null);
      };

      if (order.paymentProofStatus !== 'kutilmoqda') {
        await answerCallbackQuery(cq.id, 'Bu so\'rov allaqachon ko\'rib chiqilgan.');
        await editConfirmMessage('(allaqachon ko\'rib chiqilgan)');
        return;
      }

      if (action === 'payok') {
        order.paymentProofStatus = 'tasdiqlandi';
        order.paymentProofApprovedBy = from.id;
        order.paymentProofApprovedAt = new Date().toISOString();
        saveOwners(owners);

        // ENDI (va FAQAT ENDI) - to'lov tasdiqlangach - oshxona/kassir/
        // dostavka guruhiga xabar ketadi (customer-order'dagi bilan bir xil).
        const itemsText = order.items.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
        const notifyText = `🆕 <b>Yangi mijoz buyurtmasi</b> (${ORDER_TYPES[order.orderType]}${order.tableNumber ? ' — stol ' + escapeHtmlServer(order.tableNumber) : ''})\n` +
          `Mijoz: ${escapeHtmlServer(order.customerName)}\n${itemsText}\n\nJami: ${order.total}\nTo'lov: ${PAYMENT_TYPES[order.paymentType]} (✅ tasdiqlangan)`;
        const notifyTargets = [owner.id, ...((owner.staff || []).filter(s => staffHasRole(s, 'oshpaz') || staffHasRole(s, 'kassir')).map(s => s.id))];
        await notifyStaffList(owner, notifyTargets, notifyText, `Buyurtma #${order.id} (to'lov tasdiqlangach)`);
        saveOwners(owners);
        notifyDeliveryGroup(owner, order, `Mijoz: ${escapeHtmlServer(order.customerName)}`);
        notifyKitchenGroup(owner, order, `Mijoz: ${escapeHtmlServer(order.customerName)}`);

        if (order.customerId) {
          const okText = order.paymentConfirmMethod === 'naqd_kassa'
            ? '✅ To\'lovingiz qabul qilindi! Taomingiz tayyorlanishni boshladi. Yoqimli ishtaha! 😊'
            : '✅ To\'lovingiz tasdiqlandi! Buyurtmangiz oshxonaga yuborildi.';
          await sendMessage(order.customerId, okText);
        }
        await editConfirmMessage(`✅ Tasdiqlandi — ${displayName(from)}`);
        await answerCallbackQuery(cq.id, 'Tasdiqlandi ✅');
        return;
      }

      if (action === 'payrej') {
        order.paymentProofStatus = 'rad_etildi';
        order.paymentProofRejectedBy = from.id;
        order.paymentProofRejectedAt = new Date().toISOString();
        saveOwners(owners);

        if (order.customerId) {
          const rejText = order.paymentConfirmMethod === 'naqd_kassa'
            ? '❌ Buyurtmangiz bekor qilindi. Savol bo\'lsa, kassaga murojaat qiling.'
            : '❌ To\'lov skrinshoti tasdiqlanmadi. Iltimos, to\'g\'ri skrinshotni qayta (rasm qilib) yuboring ' +
              'yoki oshxona bilan bog\'laning.';
          await sendMessage(order.customerId, rejText);
        }
        await editConfirmMessage(`❌ Rad etildi — ${displayName(from)}`);
        await answerCallbackQuery(cq.id, 'Rad etildi ❌');
        return;
      }
    }

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

// 4MB — galereyadan tanlangan taom rasmi (base64, kichraytirilgan holda) + boshqa maydonlar sig'ishi uchun
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
function readBody(req, cb) {
  let body = '';
  let tooLarge = false;
  req.on('data', chunk => {
    if (tooLarge) return;
    body += chunk;
    if (body.length > MAX_REQUEST_BODY_BYTES) {
      tooLarge = true;
      cb(new Error('body_too_large'));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (tooLarge) return;
    try { cb(null, JSON.parse(body || '{}')); }
    catch (e) { cb(e); }
  });
}

// =============================================================================
// AI DIREKTOR: har tongi avtomatik hisobot (Telegram xabari).
// Quyidagi funksiyalar pastdagi `server` (http.createServer) ichidagi
// computeCashflow/computeStockForecast/computeTopItems bilan BIR XIL
// mantiqqa asoslangan, lekin ATAYLAB shu yerda (modul darajasida) ALOHIDA
// yozilgan — chunki o'sha funksiyalar so'rov handler'ining o'zi ICHIDA
// joylashgan (har bir HTTP so'rovda qayta e'lon qilinadi) va pastdagi
// kunlik setInterval'dan (bu ham modul darajasida, so'rovdan tashqarida
// ishlashi kerak) chaqirib bo'lmaydi. Hisoblash formulalari bir xil,
// faqat joylashuvi boshqa — ikkalasini ham o'zgartirsangiz ikkalasida ham
// yangilang.
// =============================================================================

const AI_DIRECTOR_HOUR = 8; // Toshkent vaqti bilan soat nechada yuborilishi (08:00)
const AI_DIRECTOR_TZ_OFFSET_MS = 5 * 60 * 60 * 1000;

function aiDirDateKey(input) {
  const d = (input instanceof Date) ? input : new Date(input);
  return new Date(d.getTime() + AI_DIRECTOR_TZ_OFFSET_MS).toISOString().slice(0, 10);
}
function aiDirDayStartFromKey(dateKey) {
  return new Date(new Date(dateKey + 'T00:00:00.000Z').getTime() - AI_DIRECTOR_TZ_OFFSET_MS);
}
function aiDirDayStart(input) {
  return aiDirDayStartFromKey(aiDirDateKey(input));
}
function aiDirTashkentHour(input) {
  const d = (input instanceof Date) ? input : new Date(input);
  return new Date(d.getTime() + AI_DIRECTOR_TZ_OFFSET_MS).getUTCHours();
}

// [fromDate, toDate) oralig'idagi kirim/xarajat/foyda/buyurtmalar soni.
function aiDirCashBucket(owner, fromDate, toDate) {
  const orders = (owner.orders || []).filter(o => { const t = new Date(o.createdAt); return t >= fromDate && t < toDate; });
  const expenses = (owner.expenses || []).filter(e => { const t = new Date(e.createdAt); return t >= fromDate && t < toDate; });
  const income = orders.reduce((s, o) => s + orderIncomeAmount(o), 0);
  const expense = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  return { income, expense, net: income - expense, orderCount: orders.length };
}

// [fromDate, toDate) oralig'ida taom bo'yicha sotilgan miqdor/tushum (Map: id -> {name, qty, revenue})
function aiDirItemStats(owner, fromDate, toDate) {
  const orders = (owner.orders || []).filter(o => { const t = new Date(o.createdAt); return t >= fromDate && t < toDate; });
  const byId = new Map();
  for (const o of orders) {
    for (const it of (o.items || [])) {
      const cur = byId.get(it.id) || { id: it.id, name: it.name, qty: 0, revenue: 0 };
      cur.qty += it.qty;
      cur.revenue += it.price * it.qty;
      byId.set(it.id, cur);
    }
  }
  return byId;
}

// Oxirgi 7 kunni undan oldingi 7 kun bilan solishtirib, sezilarli (kamida
// 15%) kamaygan taomlarni topadi. Juda kam sondagi (haftasiga 5 donadan
// kam) taomlar hisobga olinmaydi — kichik sonlarda foiz ma'nosiz katta
// chiqib ketishi mumkin (masalan 1 donadan 0 taga - "100% kamaydi" degani
// chalg'ituvchi bo'lardi).
function aiDirDecliningItems(owner) {
  const todayStart = aiDirDayStart(new Date());
  const last7Start = new Date(todayStart.getTime() - 7 * 86400000);
  const prev7Start = new Date(todayStart.getTime() - 14 * 86400000);

  const last7 = aiDirItemStats(owner, last7Start, todayStart);
  const prev7 = aiDirItemStats(owner, prev7Start, last7Start);

  const declining = [];
  for (const [id, cur] of last7) {
    const prev = prev7.get(id);
    if (!prev || prev.qty < 5) continue;
    const changePercent = ((cur.qty - prev.qty) / prev.qty) * 100;
    if (changePercent <= -15) {
      declining.push({ id, name: cur.name, qtyNow: cur.qty, qtyPrev: prev.qty, changePercent: Math.round(changePercent) });
    }
  }
  declining.sort((a, b) => a.changePercent - b.changePercent);
  return declining;
}

// Sklad: qaysi mahsulotlar necha kunga (taxminan) yetishini hisoblaydi
// (markaziy sklad + BARCHA filiallar birga) - oxirgi 7 kunlik "chiqim"
// (buyurtma orqali sarflangan) harakatlar o'rtachasi asosida.
function aiDirStockRunway(owner) {
  const since = new Date(Date.now() - 7 * 86400000);
  const pools = [owner, ...(owner.branches || [])];
  const result = [];
  for (const pool of pools) {
    const usageById = new Map();
    for (const m of (pool.stockMovements || [])) {
      if (m.type !== 'chiqim') continue;
      if (!m.note || !m.note.startsWith('Buyurtma:')) continue;
      if (new Date(m.createdAt) < since) continue;
      usageById.set(m.stockId, (usageById.get(m.stockId) || 0) + m.qty);
    }
    for (const item of (pool.stock || [])) {
      const used7d = usageById.get(item.id) || 0;
      if (used7d <= 0) continue;
      const avgDaily = used7d / 7;
      if (avgDaily <= 0) continue;
      result.push({ name: item.name, unit: item.unit, qty: item.qty, avgDaily, daysLeft: item.qty / avgDaily });
    }
  }
  result.sort((a, b) => a.daysLeft - b.daysLeft);
  return result;
}

// Eng ko'p TUSHUM keltirgan taom (oxirgi 7 kun). Diqqat: menyu taomlarida
// tan narxi (cost) kuzatilmagani sabab bu "eng FOYDALI" emas — halol,
// chalg'itmaydigan atama sifatida "eng ko'p tushum keltirgan" ishlatiladi.
function aiDirTopItem(owner) {
  const todayStart = aiDirDayStart(new Date());
  const last7Start = new Date(todayStart.getTime() - 7 * 86400000);
  const stats = aiDirItemStats(owner, last7Start, todayStart);
  let top = null;
  for (const it of stats.values()) {
    if (!top || it.revenue > top.revenue) top = it;
  }
  return top;
}

// To'liq "AI Direktor" kunlik hisobotini Telegram uchun tayyor (HTML) matn
// qilib tuzadi - qoidaviy (AI kaliti kerak emas, har doim ishlaydi).
function buildAiDirectorText(owner) {
  const todayStart = aiDirDayStart(new Date());
  const yestStart = new Date(todayStart.getTime() - 86400000);
  const dayBeforeStart = new Date(todayStart.getTime() - 2 * 86400000);

  const yesterday = aiDirCashBucket(owner, yestStart, todayStart);
  const dayBefore = aiDirCashBucket(owner, dayBeforeStart, yestStart);
  const incomeChangePercent = dayBefore.income > 0
    ? Math.round(((yesterday.income - dayBefore.income) / dayBefore.income) * 100)
    : null;

  const topItem = aiDirTopItem(owner);
  const runway = aiDirStockRunway(owner);
  const urgentStock = runway.filter(r => r.daysLeft <= 3).slice(0, 3);
  const declining = aiDirDecliningItems(owner);

  const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ');

  const lines = ['📊 <b>Bugungi holat</b>', ''];
  lines.push(`Kecha tushum: <b>${fmt(yesterday.income)} so'm</b>` +
    (incomeChangePercent !== null ? ` (${incomeChangePercent > 0 ? '+' : ''}${incomeChangePercent}%)` : ''));
  lines.push(`Foyda: <b>${fmt(yesterday.net)} so'm</b>`);
  if (topItem) lines.push(`Eng ko'p tushum keltirgan taom (7 kun): <b>${escapeHtmlServer(topItem.name)}</b>`);

  if (urgentStock.length) {
    lines.push('');
    for (const s of urgentStock) {
      lines.push(s.daysLeft < 1
        ? `⚠️ ${escapeHtmlServer(s.name)} bugun tugashi mumkin.`
        : `⚠️ ${escapeHtmlServer(s.name)} taxminan ${Math.floor(s.daysLeft)} kunga yetadi.`);
    }
  }

  if (declining.length) {
    const d = declining[0];
    lines.push('');
    lines.push(`Oxirgi 7 kunda <b>${escapeHtmlServer(d.name)}</b> savdosi ${Math.abs(d.changePercent)}% kamaygan.`);
    lines.push('');
    lines.push(`💡 <b>Tavsiya:</b> bugun ${escapeHtmlServer(d.name)} uchun aksiya qiling yoki xaridni kamaytiring.`);
  }

  return lines.join('\n');
}

// Bitta egaga AI Direktor hisobotini yuboradi va yuborilgan sanani
// (bugungi.zayta yubormaslik uchun) yozib qo'yadi. `force` — Mini App'dan
// "Hozir yubor" bosilganda bugun allaqachon yuborilgan bo'lsa ham qayta
// yuborish uchun.
async function sendAiDirectorDigest(owner, force) {
  const todayKey = aiDirDateKey(new Date());
  if (!force && owner.aiDirectorLastSent === todayKey) return false;
  const text = buildAiDirectorText(owner);
  await sendMessage(owner.id, text);
  owner.aiDirectorLastSent = todayKey;
  return true;
}

// Har 10 daqiqada bir marta tekshiradi: Toshkent vaqti bilan soat
// AI_DIRECTOR_HOUR bo'lgan (va bugun hali yuborilmagan) har bir egaga
// avtomatik yuboradi. `aiDirectorEnabled` egasi tomonidan o'chirilgan
// bo'lsa (=== false), o'sha egaga yuborilmaydi (standart holat - yoqilgan).
setInterval(() => {
  if (aiDirTashkentHour(new Date()) !== AI_DIRECTOR_HOUR) return;
  const owners = pruneExpiredOwners();
  let changed = false;
  (async () => {
    for (const owner of owners) {
      if (!isOwnerAccessValid(owner)) continue;
      if (owner.aiDirectorEnabled === false) continue;
      const sent = await sendAiDirectorDigest(owner, false);
      if (sent) changed = true;
    }
    if (changed) saveOwners(owners);
  })().catch(() => {});
}, 10 * 60 * 1000);

const server = http.createServer((req, res) => {
  // ---- API: initData tekshirish (mini app ochilganda) ----
  if (req.method === 'POST' && req.url === '/api/verify') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData } = payload;
      if (!initData) return sendJSON(res, 400, { ok: false, reason: 'initData yo\'q' });

      const result = verifyAuth(initData);
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
        roles: staffInfo ? staffInfo.roles : null,
        roleLabel: staffInfo ? rolesLabel(staffInfo.roles) : null,
        ownerRestaurantName: staffInfo ? staffInfo.ownerName : (ownerOk ? ((owner.profile && owner.profile.name) || null) : null),
        ownerLogoUrl: staffInfo ? staffInfo.ownerLogoUrl : (ownerOk ? ((owner.profile && owner.profile.logoUrl) || null) : null),
        ownerBrandColor: staffInfo ? staffInfo.ownerBrandColor : (ownerOk ? ((owner.profile && owner.profile.brandColor) || null) : null),
        hasProfile: !admin && ownerOk && !!(owner && owner.profile && owner.profile.completedAt),
        // Egasi uchun admin login/parol o'rnatib qo'ygan bo'lsa — Telegram orqali
        // kirganda ham (initData avtomatik bo'lsa-da) bir martalik parol so'raladi
        // (qarang: frontend'dagi owner password-gate va /api/owner-confirm-password).
        hasOwnerLogin: !admin && ownerOk && !!(owner && owner.login && owner.passwordHash),
        personRegistered: admin || isRegisteredUser(userId),
        reason: ok ? null : 'Bu ilova faqat administrator, tasdiqlangan do\'kon egalari va ularning xodimlari uchun.'
      });
    });
    return;
  }

  // ---- API: Mini App ichidan ism, familiya, telefon raqam bilan ro'yxatdan o'tish ----
  // (mijoz, xodim, egasi — barchasi uchun umumiy, botning shaxsiy chatiga
  // chiqishga hojat qoldirmaydi; qarang: findProfile/isRegisteredUser)
  if (req.method === 'POST' && req.url === '/api/profile-register') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, firstName, lastName, phone } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const ism = String(firstName || '').trim();
      const familiya = String(lastName || '').trim();
      const raqam = String(phone || '').trim();

      if (!ism || ism.length > 60) {
        return sendJSON(res, 200, { ok: false, reason: 'Ismingizni to\'g\'ri kiriting.' });
      }
      if (!familiya || familiya.length > 60) {
        return sendJSON(res, 200, { ok: false, reason: 'Familiyangizni to\'g\'ri kiriting.' });
      }
      if (!isPlausiblePhone(raqam)) {
        return sendJSON(res, 200, { ok: false, reason: 'Telefon raqam noto\'g\'ri formatda (masalan: +998901234567).' });
      }

      const userId = String(check.user && check.user.id);
      const profiles = loadProfiles();
      const idx = profiles.findIndex(p => String(p.id) === userId);
      const profile = {
        id: userId,
        username: (check.user && check.user.username) || null,
        firstName: ism,
        lastName: familiya,
        phone: raqam,
        registeredAt: new Date().toISOString()
      };
      if (idx >= 0) profiles[idx] = profile; else profiles.push(profile);
      saveProfiles(profiles);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: egasining o'z xodimlari ro'yxatini olish ----
  if (req.method === 'POST' && req.url === '/api/staff-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi ko\'ra oladi' });

      return sendJSON(res, 200, { ok: true, staff: owner.staff || [] });
    });
    return;
  }

  // ---- API: egasi xodim qo'shadi (kassir/oshpaz/sklad/dostavka — bir nechta rol birga bo'lishi mumkin) ----
  if (req.method === 'POST' && req.url === '/api/add-staff') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, input, role, roles, branchId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi xodim qo\'sha oladi' });

      // `roles` massiv sifatida keladi (checkbox'lar) — eski frontend hali bitta `role` yuborsa ham ishlaydi
      const rolesArr = Array.isArray(roles) ? roles : (role ? [role] : []);
      const uniqueRoles = [...new Set(rolesArr)].filter(isValidRole);
      if (!uniqueRoles.length) {
        return sendJSON(res, 200, { ok: false, reason: 'Kamida bitta lavozim tanlang.' });
      }

      let branchIdVal = null;
      if (branchId) {
        if (!findBranch(owner, branchId)) {
          return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi.' });
        }
        branchIdVal = branchId;
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
        role: uniqueRoles[0], // orqaga moslik uchun (eski kod shu maydonni o'qishi mumkin)
        roles: uniqueRoles,
        branchId: branchIdVal,
        addedAt: new Date().toISOString()
      });
      saveOwners(owners);

      sendMessage(resolved.id,
        `👋 Sizni <b>${(owner.profile && owner.profile.name) || 'oshxona'}</b> jamoasiga <b>${rolesLabel(uniqueRoles)}</b> sifatida qo\'shishdi.\nMini App tugmasi orqali oching.`);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: xodim qo'shish uchun BIR MARTALIK havola yaratish (faqat egasi) ----
  // Manager Telegram ID/username so'ramasdan, tayyor lavozim(lar) va filial
  // bilan havola yaratadi — xodim shu havolani bosib botni ochsa, avtomatik
  // (tasdiqlashsiz) o'sha lavozim(lar) bilan jamoaga qo'shiladi. Havola FAQAT
  // bir marta ishlatiladi (birinchi bosgan odam qo'shiladi, keyin yaroqsiz
  // bo'lib qoladi) va 24 soatdan keyin muddati tugaydi.
  if (req.method === 'POST' && req.url === '/api/create-staff-invite') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, role, roles, branchId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi havola yarata oladi' });

      const rolesArr = Array.isArray(roles) ? roles : (role ? [role] : []);
      const uniqueRoles = [...new Set(rolesArr)].filter(isValidRole);
      if (!uniqueRoles.length) {
        return sendJSON(res, 200, { ok: false, reason: 'Kamida bitta lavozim tanlang.' });
      }

      let branchIdVal = null;
      if (branchId) {
        if (!findBranch(owner, branchId)) {
          return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi.' });
        }
        branchIdVal = branchId;
      }

      if (!BOT_USERNAME || BOT_USERNAME === 'BOT_USERNAME_BU_YERGA') {
        return sendJSON(res, 200, { ok: false, reason: 'Serverda BOT_USERNAME sozlanmagan.' });
      }

      const token = crypto.randomBytes(16).toString('hex');
      if (!owner.staffInvites) owner.staffInvites = [];
      // Eskirgan/ishlatilgan takliflarni tozalab boramiz — fayl cheksiz o'sib ketmasligi uchun
      owner.staffInvites = owner.staffInvites.filter(inv => !inv.used && new Date(inv.expiresAt) > new Date());
      owner.staffInvites.push({
        token,
        roles: uniqueRoles,
        branchId: branchIdVal,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        used: false,
        usedBy: null,
        usedAt: null
      });
      saveOwners(owners);

      const link = `https://t.me/${BOT_USERNAME}?start=staffinv_${owner.id}_${token}`;
      return sendJSON(res, 200, { ok: true, link, roles: uniqueRoles });
    });
    return;
  }

  // ---- API: egasi xodimning lavozimlarini o'zgartiradi (checkbox bilan - bir nechtasi bo'lishi mumkin) ----
  if (req.method === 'POST' && req.url === '/api/set-staff-roles') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, roles } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'zgartira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const staff = (owner.staff || []).find(s => String(s.id) === String(id));
      if (!staff) return sendJSON(res, 200, { ok: false, reason: 'Bunday xodim topilmadi' });

      const uniqueRoles = [...new Set(Array.isArray(roles) ? roles : [])].filter(isValidRole);
      if (!uniqueRoles.length) {
        return sendJSON(res, 200, { ok: false, reason: 'Kamida bitta lavozim tanlang.' });
      }

      staff.roles = uniqueRoles;
      staff.role = uniqueRoles[0]; // orqaga moslik uchun
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, staff });
    });
    return;
  }

  // ---- API: egasi xodimning filialini o'zgartiradi (bo'sh branchId = markaziy) ----
  if (req.method === 'POST' && req.url === '/api/set-staff-branch') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, branchId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'zgartira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const staff = (owner.staff || []).find(s => String(s.id) === String(id));
      if (!staff) return sendJSON(res, 200, { ok: false, reason: 'Bunday xodim topilmadi' });

      if (branchId) {
        if (!findBranch(owner, branchId)) return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi.' });
        staff.branchId = branchId;
      } else {
        staff.branchId = null;
      }
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, staff });
    });
    return;
  }

  // ---- API: egasi xodimni o'chiradi ----
  if (req.method === 'POST' && req.url === '/api/remove-staff') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyAuth(initData);
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

  // ---- API: egasining filiallar ro'yxatini olish (egasi va uning xodimlari ko'ra oladi) ----
  if (req.method === 'POST' && req.url === '/api/branch-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q' });

      return sendJSON(res, 200, { ok: true, branches: ctx.owner.branches || [] });
    });
    return;
  }

  // ---- API: yangi filial qo'shish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/branch-add') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, name, address, phone } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi filial qo\'sha oladi' });
      if (!ownerCanUseFeature(owner, 'branch-manage')) return sendJSON(res, 200, featureBlockedResult('branch-manage'));

      const trimmedName = String(name || '').trim();
      const trimmedAddress = String(address || '').trim();
      if (!trimmedName || !trimmedAddress) {
        return sendJSON(res, 200, { ok: false, reason: 'Filial nomi va manzilini kiriting.' });
      }

      if (!owner.branches) owner.branches = [];
      const newBranch = {
        id: generateBranchId(),
        name: trimmedName,
        address: trimmedAddress,
        phone: phone ? String(phone).trim() : null,
        createdAt: new Date().toISOString()
      };
      owner.branches.push(newBranch);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, branch: newBranch });
    });
    return;
  }

  // ---- API: filial ma'lumotlarini tahrirlash (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/branch-rename') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, name, address, phone } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'zgartira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const branch = findBranch(owner, id);
      if (!branch) return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi' });

      const trimmedName = String(name || '').trim();
      const trimmedAddress = String(address || '').trim();
      if (!trimmedName || !trimmedAddress) {
        return sendJSON(res, 200, { ok: false, reason: 'Filial nomi va manzilini kiriting.' });
      }
      branch.name = trimmedName;
      branch.address = trimmedAddress;
      branch.phone = phone ? String(phone).trim() : null;
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, branch });
    });
    return;
  }

  // ---- API: filialni o'chirish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/branch-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'chira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      owner.branches = (owner.branches || []).filter(b => String(b.id) !== String(id));
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: menyuni olish (egasi yoki uning xodimlari — masalan kassir) ----
  if (req.method === 'POST' && req.url === '/api/menu-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q' });

      const menuWithStock = (ctx.owner.menu || []).map(m => Object.assign({}, m, { outOfStock: menuItemOutOfStock(ctx.owner, m) }));
      return sendJSON(res, 200, { ok: true, menu: menuWithStock, categories: sortedOwnerCategories(ctx.owner), role: ctx.role });
    });
    return;
  }

  // ==================== F. Bo'lim (kategoriya) boshqaruvi (36-40-bosqich) ====================
  // Bo'limlar (menyu kategoriyalari) — egasi endi ularni tuzilmali ro'yxat
  // sifatida boshqaradi (qo'shish/o'chirish/tartiblash), o'sha ro'yxatdan esa
  // taom qo'shish/tahrirlash formasida (select) va mijoz/kassir menyusidagi
  // bo'lim tartibida (qarang: sortedOwnerCategories) foydalaniladi.

  // ---- API: bo'limlar ro'yxatini olish (egasi yoki uning xodimlari) ----
  if (req.method === 'POST' && req.url === '/api/category-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q' });

      return sendJSON(res, 200, { ok: true, categories: sortedOwnerCategories(ctx.owner) });
    });
    return;
  }

  // ---- API: yangi bo'lim qo'shish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/category-add') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, name } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi bo\'limlarni boshqara oladi' });

      const nameTrim = String(name || '').trim();
      if (!nameTrim) return sendJSON(res, 200, { ok: false, reason: 'Bo\'lim nomini kiriting.' });

      const categories = ensureOwnerCategories(owner);
      const exists = categories.some(c => c.name.toLowerCase() === nameTrim.toLowerCase());
      if (exists) return sendJSON(res, 200, { ok: false, reason: 'Bunday bo\'lim allaqachon mavjud.' });

      const maxOrder = categories.reduce((max, c) => Math.max(max, c.order), -1);
      const category = { id: crypto.randomBytes(4).toString('hex'), name: nameTrim, order: maxOrder + 1 };
      categories.push(category);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, category, categories: sortedOwnerCategories(owner) });
    });
    return;
  }

  // ---- API: bo'limni o'chirish (faqat egasi) ----
  // ESLATMA: shu bo'limdan foydalanayotgan taomlar avtomatik boshqa bo'limga
  // ko'chirilmaydi — ularning `category` maydoni o'zgarishsiz qoladi, lekin
  // endi ro'yxatda bo'lmagani uchun mijoz/kassir menyusida "Boshqa" bo'limi
  // ostida chiqadi (qarang: public/app.js — groupMenuItems).
  if (req.method === 'POST' && req.url === '/api/category-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'chira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      ensureOwnerCategories(owner);
      owner.categories = owner.categories.filter(c => c.id !== id);
      // qolganlarini 0 dan boshlab qayta raqamlaymiz — bo'shliq qolmasin
      owner.categories.sort((a, b) => a.order - b.order).forEach((c, i) => { c.order = i; });
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, categories: sortedOwnerCategories(owner) });
    });
    return;
  }

  // ---- API: bo'limlar tartibini o'zgartirish (faqat egasi) ----
  // Frontend to'liq tartiblangan id ro'yxatini yuboradi (masalan, ikkita
  // qo'shni bo'limni ↑/↓ tugmalari bilan almashtirgandan keyin butun
  // ro'yxatni qayta joylashtirib). Kelmagan (frontendda ko'rinmayotgan)
  // id'lar bo'lsa ham xato bermaymiz — ular oxiriga, o'zaro nisbiy
  // tartibini saqlagan holda qo'shiladi.
  if (req.method === 'POST' && req.url === '/api/category-reorder') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, orderedIds } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'zgartira oladi' });
      if (!Array.isArray(orderedIds)) return sendJSON(res, 200, { ok: false, reason: 'Tartib ro\'yxati noto\'g\'ri.' });

      const categories = ensureOwnerCategories(owner);
      const byId = new Map(categories.map(c => [c.id, c]));
      let nextOrder = 0;
      orderedIds.forEach(id => {
        const c = byId.get(String(id));
        if (c) { c.order = nextOrder++; byId.delete(String(id)); }
      });
      // ro'yxatda ko'rsatilmagan qolganlari (agar bo'lsa) — eski nisbiy
      // tartibini saqlab, oxiriga qo'shiladi.
      categories.slice().sort((a, b) => a.order - b.order)
        .filter(c => byId.has(c.id))
        .forEach(c => { c.order = nextOrder++; });

      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, categories: sortedOwnerCategories(owner) });
    });
    return;
  }

  // ---- API: menyuga taom qo'shish (faqat egasi) ----
  // C-bo'lim (11-18-bosqich): "Skladdan to'g'ridan sotuvga chiqadigan mahsulot".
  // Odatdagi taom retsept (recipe: [{stockId, qty}, ...]) orqali bir nechta
  // ingredientdan tayyorlanadi. Ba'zi "taomlar" esa aslida sklad mahsulotining
  // o'zi to'g'ridan-to'g'ri sotiladi (masalan shishada suv, banka ichimlik) —
  // bunday holda alohida retsept tuzishning hojati yo'q, taom bevosita bitta
  // sklad mahsulotiga bog'lanadi (menuItem.directStockId, faqat MARKAZIY
  // skladdagi mahsulotga — xuddi recipe.stockId kabi, filial skladiga emas,
  // chunki buyurtma vaqtida sklad ham shu tarzda faqat markaziydan kamayadi:
  // qarang pastdagi /api/create-order). Ikkalasi bir vaqtda bo'lishi mumkin
  // emas: yo retsept, yo directStockId (yoki hech qaysisi — oddiy taom).
  if (req.method === 'POST' && req.url === '/api/menu-add') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, name, price, category, description, imageUrl, directStockId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi menyuni boshqara oladi' });

      const nameTrim = String(name || '').trim();
      const priceNum = Number(price);
      if (!nameTrim) return sendJSON(res, 200, { ok: false, reason: 'Taom nomini kiriting.' });
      if (!Number.isFinite(priceNum) || priceNum <= 0) return sendJSON(res, 200, { ok: false, reason: 'Narxni to\'g\'ri kiriting.' });
      const imageTrim = String(imageUrl || '').trim();
      if (!isValidImageValue(imageTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Rasm noto\'g\'ri formatda yoki hajmi katta (rasmni kichikroq tanlang).' });
      }

      // 12-bosqich: directStockId ixtiyoriy — berilsa, markaziy skladda
      // shunday mahsulot borligini tekshiramiz. Yangi taomda recipe hali
      // yo'q (u alohida /api/menu-set-recipe orqali qo'shiladi), shuning
      // uchun bu yerda retsept bilan to'qnashuv bo'lishi mumkin emas —
      // to'qnashuvning oldini olish /api/menu-set-recipe tomonida qilinadi
      // (o'sha yerda directStockId allaqachon borligini tekshiradi).
      let directStockIdVal = null;
      if (directStockId !== undefined && directStockId !== null && directStockId !== '') {
        const stockItem = findStockItem(owner, directStockId);
        if (!stockItem) return sendJSON(res, 200, { ok: false, reason: 'Bunday sklad mahsuloti (markaziy skladda) topilmadi.' });
        directStockIdVal = directStockId;
      }

      if (!owner.menu) owner.menu = [];
      const item = {
        id: crypto.randomBytes(4).toString('hex'),
        name: nameTrim,
        price: priceNum,
        category: String(category || '').trim() || null,
        description: String(description || '').trim() || null,
        imageUrl: imageTrim || null,
        available: true,
        directStockId: directStockIdVal,
        addedAt: new Date().toISOString()
      };
      owner.menu.push(item);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, item });
    });
    return;
  }

  // ---- API: menyudagi taom ma'lumotlarini tahrirlash / ko'rinish holatini almashtirish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/menu-update') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, name, price, category, description, imageUrl, available, directStockId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi menyuni boshqara oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const item = (owner.menu || []).find(m => m.id === id);
      if (!item) return sendJSON(res, 200, { ok: false, reason: 'Taom topilmadi.' });

      if (name !== undefined) {
        const nameTrim = String(name || '').trim();
        if (!nameTrim) return sendJSON(res, 200, { ok: false, reason: 'Taom nomini kiriting.' });
        item.name = nameTrim;
      }
      if (price !== undefined) {
        const priceNum = Number(price);
        if (!Number.isFinite(priceNum) || priceNum <= 0) return sendJSON(res, 200, { ok: false, reason: 'Narxni to\'g\'ri kiriting.' });
        item.price = priceNum;
      }
      if (category !== undefined) item.category = String(category || '').trim() || null;
      if (description !== undefined) item.description = String(description || '').trim() || null;
      if (imageUrl !== undefined) {
        const imageTrim = String(imageUrl || '').trim();
        if (!isValidImageValue(imageTrim)) {
          return sendJSON(res, 200, { ok: false, reason: 'Rasm noto\'g\'ri formatda yoki hajmi katta (rasmni kichikroq tanlang).' });
        }
        item.imageUrl = imageTrim || null;
      }
      if (available !== undefined) item.available = !!available;

      // 17-bosqich: taomning turini ("Tayyorlanadigan" / "To'g'ridan skladdan")
      // tahrirlash oynasidan ham o'zgartirish mumkin. Bo'sh qator ('') yuborilsa —
      // "to'g'ridan skladdan" turi bekor qilinib, oddiy (retseptli) taomga qaytadi.
      if (directStockId !== undefined) {
        const directTrim = String(directStockId || '').trim();
        if (!directTrim) {
          item.directStockId = null;
        } else {
          // Retsepti bor taomni to'g'ridan-sklad turiga o'tkazib bo'lmaydi —
          // avval retseptni tozalash kerak (aks holda ikkalasi ham ishlaydigan
          // noaniq holat paydo bo'ladi).
          if (Array.isArray(item.recipe) && item.recipe.length) {
            return sendJSON(res, 200, { ok: false, reason: 'Bu taomda retsept bor — avval retseptni tozalang, keyin turi o\'zgartiring.' });
          }
          const stockItem = findStockItem(owner, directTrim);
          if (!stockItem) return sendJSON(res, 200, { ok: false, reason: 'Bunday sklad mahsuloti (markaziy skladda) topilmadi.' });
          item.directStockId = directTrim;
        }
      }
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
      const check = verifyAuth(initData);
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

  // ==================== D-bo'lim (28-31-bosqich): Combo — CRUD ====================
  // Combo obyekti: { id, name, itemIds: [{menuItemId, qty}], price, priceMode:
  // 'auto'|'manual', category, imageUrl, available, addedAt }. "auto" rejimda
  // narx har safar tarkib narxlari yig'indisidan qayta hisoblanadi (agar
  // tarkibdagi taomlarning narxi keyinroq o'zgarsa ham to'g'ri bo'lib turadi);
  // "manual" rejimda egasi kiritgan qiymat saqlanadi.

  // ---- API: combo ro'yxatini olish (egasi yoki uning xodimlari — kassir menyuda ko'rsatishi uchun) ----
  if (req.method === 'POST' && req.url === '/api/combo-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q' });

      const combos = (ctx.owner.combos || []).map(c => Object.assign({}, c, {
        price: c.priceMode === 'auto' ? comboAutoPrice(ctx.owner, c.itemIds) : c.price,
        outOfStock: comboOutOfStock(ctx.owner, c)
      }));
      return sendJSON(res, 200, { ok: true, combos });
    });
    return;
  }

  // ---- API: yangi combo qo'shish (28-bosqich, faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/combo-add') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, name, itemIds, priceMode, price, category, imageUrl } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi combo boshqara oladi' });
      if (!ownerCanUseFeature(owner, 'combo-manage')) return sendJSON(res, 200, featureBlockedResult('combo-manage'));

      const nameTrim = String(name || '').trim();
      if (!nameTrim) return sendJSON(res, 200, { ok: false, reason: 'Combo nomini kiriting.' });

      // Tarkib — kamida 2 ta taom (aks holda combo emas, oddiy taom bo'lardi)
      if (!Array.isArray(itemIds) || itemIds.length < 2) {
        return sendJSON(res, 200, { ok: false, reason: 'Combo tarkibida kamida 2 ta taom bo\'lishi kerak.' });
      }
      const cleanItemIds = [];
      for (const entry of itemIds) {
        const menuItem = (owner.menu || []).find(m => m.id === entry.menuItemId);
        if (!menuItem) return sendJSON(res, 200, { ok: false, reason: 'Tarkibda menyuda mavjud bo\'lmagan taom bor.' });
        const qtyNum = Number(entry.qty) || 1;
        if (qtyNum <= 0) return sendJSON(res, 200, { ok: false, reason: 'Har bir taom miqdori musbat bo\'lishi kerak.' });
        cleanItemIds.push({ menuItemId: entry.menuItemId, qty: qtyNum });
      }

      // 31-bosqich: narx — avtomatik (tarkib yig'indisi) yoki qo'lda
      const priceModeVal = priceMode === 'manual' ? 'manual' : 'auto';
      let priceVal;
      if (priceModeVal === 'manual') {
        priceVal = Number(price);
        if (!Number.isFinite(priceVal) || priceVal <= 0) return sendJSON(res, 200, { ok: false, reason: 'Combo narxini to\'g\'ri kiriting.' });
      } else {
        priceVal = comboAutoPrice(owner, cleanItemIds);
      }

      const imageTrim = String(imageUrl || '').trim();
      if (!isValidImageValue(imageTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Rasm noto\'g\'ri formatda yoki hajmi katta (rasmni kichikroq tanlang).' });
      }

      if (!owner.combos) owner.combos = [];
      const combo = {
        id: crypto.randomBytes(4).toString('hex'),
        name: nameTrim,
        itemIds: cleanItemIds,
        priceMode: priceModeVal,
        price: priceVal,
        category: String(category || '').trim() || null,
        imageUrl: imageTrim || null,
        available: true,
        addedAt: new Date().toISOString()
      };
      owner.combos.push(combo);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, combo });
    });
    return;
  }

  // ---- API: comboni tahrirlash / ko'rinish holatini almashtirish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/combo-update') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, name, itemIds, priceMode, price, category, imageUrl, available } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi combo boshqara oladi' });
      if (!ownerCanUseFeature(owner, 'combo-manage')) return sendJSON(res, 200, featureBlockedResult('combo-manage'));
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const combo = findCombo(owner, id);
      if (!combo) return sendJSON(res, 200, { ok: false, reason: 'Combo topilmadi.' });

      if (name !== undefined) {
        const nameTrim = String(name || '').trim();
        if (!nameTrim) return sendJSON(res, 200, { ok: false, reason: 'Combo nomini kiriting.' });
        combo.name = nameTrim;
      }
      if (itemIds !== undefined) {
        if (!Array.isArray(itemIds) || itemIds.length < 2) {
          return sendJSON(res, 200, { ok: false, reason: 'Combo tarkibida kamida 2 ta taom bo\'lishi kerak.' });
        }
        const cleanItemIds = [];
        for (const entry of itemIds) {
          const menuItem = (owner.menu || []).find(m => m.id === entry.menuItemId);
          if (!menuItem) return sendJSON(res, 200, { ok: false, reason: 'Tarkibda menyuda mavjud bo\'lmagan taom bor.' });
          const qtyNum = Number(entry.qty) || 1;
          if (qtyNum <= 0) return sendJSON(res, 200, { ok: false, reason: 'Har bir taom miqdori musbat bo\'lishi kerak.' });
          cleanItemIds.push({ menuItemId: entry.menuItemId, qty: qtyNum });
        }
        combo.itemIds = cleanItemIds;
      }
      if (priceMode !== undefined) combo.priceMode = priceMode === 'manual' ? 'manual' : 'auto';
      if (combo.priceMode === 'manual') {
        if (price !== undefined) {
          const priceVal = Number(price);
          if (!Number.isFinite(priceVal) || priceVal <= 0) return sendJSON(res, 200, { ok: false, reason: 'Combo narxini to\'g\'ri kiriting.' });
          combo.price = priceVal;
        }
      } else {
        // auto rejimda narx doim tarkibdan qayta hisoblanadi
        combo.price = comboAutoPrice(owner, combo.itemIds);
      }
      if (category !== undefined) combo.category = String(category || '').trim() || null;
      if (imageUrl !== undefined) {
        const imageTrim = String(imageUrl || '').trim();
        if (!isValidImageValue(imageTrim)) {
          return sendJSON(res, 200, { ok: false, reason: 'Rasm noto\'g\'ri formatda yoki hajmi katta (rasmni kichikroq tanlang).' });
        }
        combo.imageUrl = imageTrim || null;
      }
      if (available !== undefined) combo.available = !!available;
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, combo });
    });
    return;
  }

  // ---- API: comboni o'chirish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/combo-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'chira oladi' });
      if (!ownerCanUseFeature(owner, 'combo-manage')) return sendJSON(res, 200, featureBlockedResult('combo-manage'));
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      owner.combos = (owner.combos || []).filter(c => c.id !== id);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ==================== J. Mijozlar uchun menyu (38-40-bosqich) ====================

  // ---- API: egasi uchun mijoz-menyu havolasini olish ----
  if (req.method === 'POST' && req.url === '/api/customer-link') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi ko\'ra oladi' });
      if (!BOT_USERNAME || BOT_USERNAME === 'BOT_USERNAME_BU_YERGA') {
        return sendJSON(res, 200, { ok: false, reason: 'Serverda BOT_USERNAME sozlanmagan.' });
      }
      const link = `https://t.me/${BOT_USERNAME}?start=menu_${owner.id}`;
      return sendJSON(res, 200, { ok: true, link });
    });
    return;
  }

  // ---- API: dostavka admin guruhi biriktirilgan-yo'qligini olish (egasi) ----
  if (req.method === 'POST' && req.url === '/api/delivery-group-status') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi ko\'ra oladi' });
      return sendJSON(res, 200, {
        ok: true,
        bound: !!owner.deliveryGroupId,
        groupTitle: owner.deliveryGroupTitle || null
      });
    });
    return;
  }

  // ---- API: dostavka admin guruhini bog'lanishdan chiqarish (egasi) ----
  if (req.method === 'POST' && req.url === '/api/delivery-group-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'zgartira oladi' });
      owner.deliveryGroupId = null;
      owner.deliveryGroupTitle = null;
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- 13-bosqich API: Oshpazlar guruhi biriktirilgan-yo'qligini olish (egasi) ----
  if (req.method === 'POST' && req.url === '/api/kitchen-group-status') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi ko\'ra oladi' });
      return sendJSON(res, 200, {
        ok: true,
        bound: !!owner.kitchenGroupId,
        groupTitle: owner.kitchenGroupTitle || null
      });
    });
    return;
  }

  // ---- 13-bosqich API: Oshpazlar guruhini bog'lanishdan chiqarish (egasi) ----
  if (req.method === 'POST' && req.url === '/api/kitchen-group-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'zgartira oladi' });
      owner.kitchenGroupId = null;
      owner.kitchenGroupTitle = null;
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: aksiyalar ro'yxati (egasi) ----
  if (req.method === 'POST' && req.url === '/api/promo-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi ko\'ra oladi' });
      return sendJSON(res, 200, { ok: true, promotions: owner.promotions || [] });
    });
    return;
  }

  // ---- API: aksiya/chegirma qo'shish (egasi) ----
  if (req.method === 'POST' && req.url === '/api/promo-add') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, title, description, discountPercent, minTotal } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi qo\'sha oladi' });
      if (!ownerCanUseFeature(owner, 'promo-manage')) return sendJSON(res, 200, featureBlockedResult('promo-manage'));

      const titleTrim = String(title || '').trim();
      const percentNum = Number(discountPercent);
      if (!titleTrim) return sendJSON(res, 200, { ok: false, reason: 'Aksiya nomini kiriting.' });
      if (!Number.isFinite(percentNum) || percentNum <= 0 || percentNum > 90) {
        return sendJSON(res, 200, { ok: false, reason: 'Chegirma foizi 1-90 oralig\'ida bo\'lishi kerak.' });
      }
      let minTotalNum = null;
      if (minTotal !== undefined && minTotal !== null && minTotal !== '') {
        const n = Number(minTotal);
        if (!Number.isFinite(n) || n < 0) return sendJSON(res, 200, { ok: false, reason: 'Minimal summa noto\'g\'ri.' });
        minTotalNum = n;
      }

      if (!owner.promotions) owner.promotions = [];
      const promo = {
        id: crypto.randomBytes(4).toString('hex'),
        title: titleTrim,
        description: String(description || '').trim() || null,
        discountPercent: percentNum,
        minTotal: minTotalNum,
        active: true,
        createdAt: new Date().toISOString()
      };
      owner.promotions.push(promo);
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, promo });
    });
    return;
  }

  // ---- API: aksiyani faol/nofaol qilish (egasi) ----
  if (req.method === 'POST' && req.url === '/api/promo-toggle') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'zgartira oladi' });

      const promo = (owner.promotions || []).find(p => p.id === id);
      if (!promo) return sendJSON(res, 200, { ok: false, reason: 'Aksiya topilmadi.' });
      promo.active = !promo.active;
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, promo });
    });
    return;
  }

  // ---- API: aksiyani o'chirish (egasi) ----
  if (req.method === 'POST' && req.url === '/api/promo-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'chira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      owner.promotions = (owner.promotions || []).filter(p => p.id !== id);
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: bonus tizimi sozlamalarini olish (egasi) ----
  if (req.method === 'POST' && req.url === '/api/bonus-settings-get') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi ko\'ra oladi' });
      return sendJSON(res, 200, { ok: true, settings: owner.bonusSettings || { enabled: false, earnPercent: 5 } });
    });
    return;
  }

  // ---- API: bonus tizimi sozlamalarini saqlash (egasi) — qaytgan mijozlarga necha % bonus berish ----
  if (req.method === 'POST' && req.url === '/api/bonus-settings-save') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, enabled, earnPercent } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi saqlay oladi' });

      const percentNum = Number(earnPercent);
      if (!Number.isFinite(percentNum) || percentNum < 0 || percentNum > 50) {
        return sendJSON(res, 200, { ok: false, reason: 'Bonus foizi 0-50 oralig\'ida bo\'lishi kerak.' });
      }
      owner.bonusSettings = { enabled: !!enabled, earnPercent: percentNum };
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, settings: owner.bonusSettings });
    });
    return;
  }

  // ---- API: mijoz — asosiy "Ochish" tugmasi orqali kirganda (havolasiz) faol oshxonalar ro'yxati ----
  // ---- API: bitta oshxonaning ochiq brend ma'lumoti (nomi, logotipi, rangi) ----
  // Mijoz ilovasi ochilganda "Tekshirilmoqda..." o'rniga darhol shu oshxonaning
  // logotipi va "Xush kelibsiz!" yozuvini ko'rsatish uchun — shu sababli bu
  // yengil va TEZ ishlaydigan, autentifikatsiya/yozuv talab qilmaydigan
  // so'rov (bir xil ma'lumot allaqachon ochiq menyu sahifasida ko'rinadi).
  if (req.method === 'POST' && req.url === '/api/restaurant-brand') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { ownerId } = payload;
      if (!ownerId) return sendJSON(res, 200, { ok: false });
      const owner = findOwner(loadOwners(), ownerId);
      if (!owner) return sendJSON(res, 200, { ok: false });
      return sendJSON(res, 200, {
        ok: true,
        name: (owner.profile && owner.profile.name) || 'Oshxona',
        logoUrl: (owner.profile && owner.profile.logoUrl) || null,
        brandColor: (owner.profile && owner.profile.brandColor) || null
      });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/customer-restaurants-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const owners = pruneExpiredOwners();
      const restaurants = owners
        .filter(o => isOwnerAccessValid(o) && o.profile && o.profile.completedAt)
        .map(o => ({
          id: o.id,
          name: o.profile.name,
          address: o.profile.address,
          logoUrl: o.profile.logoUrl || null,
          brandColor: o.profile.brandColor || null
        }));

      return sendJSON(res, 200, { ok: true, restaurants });
    });
    return;
  }

  // ---- API: mijoz — initData tekshirib, oshxona kontekstiga kiradi (avtomatik ro'yxatga oladi) ----
  if (req.method === 'POST' && req.url === '/api/customer-verify') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      if (!ownerId) return sendJSON(res, 200, { ok: false, reason: 'Oshxona aniqlanmadi.' });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner || !isOwnerAccessValid(owner)) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });
      }

      const customer = findOrCreateCustomer(owner, userId, check.user);
      saveOwners(owners);

      return sendJSON(res, 200, {
        ok: true,
        restaurant: {
          id: owner.id,
          name: (owner.profile && owner.profile.name) || 'Oshxona',
          address: (owner.profile && owner.profile.address) || null,
          phone: (owner.profile && owner.profile.phone) || null,
          workHours: (owner.profile && owner.profile.workHours) || null,
          logoUrl: (owner.profile && owner.profile.logoUrl) || null,
          brandColor: (owner.profile && owner.profile.brandColor) || null
        },
        customer: { favorites: customer.favorites, bonusPoints: customer.bonusPoints },
        personRegistered: isRegisteredUser(userId),
        bonusEnabled: !!(owner.bonusSettings && owner.bonusSettings.enabled)
      });
    });
    return;
  }

  // ---- API: mijoz uchun katalog-menyu (faqat "available" taomlar) + faol aksiyalar ----
  if (req.method === 'POST' && req.url === '/api/customer-menu-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner || !isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });

      const menu = (owner.menu || []).filter(m => m.available !== false)
        .map(m => Object.assign({}, m, { outOfStock: menuItemOutOfStock(owner, m) }));
      // 30-bosqich: combolar ham mijoz menyusiga qo'shiladi — frontend ularni
      // alohida "Combo" bo'limi sifatida ko'rsatadi (qarang: customerMenuListHtml).
      // "auto" narx rejimidagilar uchun narx shu yerda qayta hisoblanadi, shunda
      // tarkibdagi taom narxi keyinroq o'zgargan bo'lsa ham mijozga to'g'ri ko'rinadi.
      const combos = (owner.combos || []).filter(c => c.available !== false).map(c => Object.assign({}, c, {
        price: c.priceMode === 'auto' ? comboAutoPrice(owner, c.itemIds) : c.price,
        outOfStock: comboOutOfStock(owner, c)
      }));
      const promotions = (owner.promotions || []).filter(p => p.active);
      return sendJSON(res, 200, { ok: true, menu, combos, promotions, categories: sortedOwnerCategories(owner) });
    });
    return;
  }

  // ---- API: mijoz — sevimlilarga qo'shish/olib tashlash ----
  if (req.method === 'POST' && req.url === '/api/customer-favorite-toggle') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId, itemId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      if (!itemId) return sendJSON(res, 200, { ok: false, reason: 'Taom ko\'rsatilmagan.' });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner || !isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });

      const customer = findOrCreateCustomer(owner, userId, check.user);
      const idx = customer.favorites.indexOf(itemId);
      if (idx >= 0) customer.favorites.splice(idx, 1);
      else customer.favorites.push(itemId);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, favorites: customer.favorites });
    });
    return;
  }

  // ---- API: mijozning o'z buyurtmalari tarixi ----
  if (req.method === 'POST' && req.url === '/api/customer-orders-history') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });

      const orders = (owner.orders || [])
        .filter(o => String(o.customerId) === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 50);

      return sendJSON(res, 200, { ok: true, orders });
    });
    return;
  }

  // ---- API: mijoz o'zi to'g'ridan-to'g'ri buyurtma beradi (katalog-menyu orqali) ----
  if (req.method === 'POST' && req.url === '/api/customer-order') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId, items, orderType, tableNumber, paymentType, promoId, usePoints, location, addressNote, requestId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner || !isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });

      // Mijoz hali ism, familiya va telefon raqami bilan botga tanishtirilmagan bo'lsa,
      // buyurtma qabul qilinmaydi — avval botning shaxsiy chatida /start orqali
      // ro'yxatdan o'tishi kerak (qarang: handleTelegramUpdate'dagi ro'yxatdan o'tish oqimi).
      if (!isRegisteredUser(userId)) {
        return sendJSON(res, 200, {
          ok: false,
          reason: 'Buyurtma berishdan oldin ism, familiya va telefon raqamingizni kiritib ro\'yxatdan o\'ting.'
        });
      }

      // Ikki marta bosish yoki tarmoq qayta yuborishi tufayli bitta buyurtma
      // ikki marta yaratilib ketmasligi uchun — shu requestId bilan avval
      // muvaffaqiyatli javob berilgan bo'lsa, o'shani qaytaramiz.
      const cachedResponse = getCachedOrderResponse(owner.id, userId, requestId);
      if (cachedResponse) return sendJSON(res, 200, cachedResponse);

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
      // Dostavka buyurtmasida "naqd" varianti mavjud emas — kuryer naqd
      // pulni olsa ham bu "dostavka_orqali" turi bilan hisoblanadi (pastda
      // qarang: courierCashCollected daromad hisobotlarini to'g'ri yuritish uchun).
      if (orderType === 'dostavka' && paymentType === 'naqd') {
        return sendJSON(res, 200, { ok: false, reason: 'Dostavka buyurtmalarida naqd to\'lov mavjud emas. Karta yoki dostavka orqali to\'lovni tanlang.' });
      }
      // 21/23-bosqich: "Dostavka orqali" to'lov turi FAQAT haqiqiy Dostavka
      // buyurtmalarida mavjud — Stolga/Olib ketish buyurtmalarida bu
      // variant mantiqsiz (kuryer yo'q), shuning uchun backend'da ham
      // rad etiladi (frontendda ko'rsatilmasligidan tashqari — himoya
      // ikki qavatli bo'lishi kerak).
      if (orderType !== 'dostavka' && paymentType === 'dostavka_orqali') {
        return sendJSON(res, 200, { ok: false, reason: '"Dostavka orqali" to\'lovi faqat Dostavka buyurtmalarida mavjud.' });
      }

      // YANGI: dostavka buyurtmasida manzil ma'lumoti kerak - kuryer
      // mijozni topa olishi uchun kamida BITTASI bo'lishi shart: aniqlangan
      // joylashuv (lokatsiya) YOKI qo'lda yozilgan manzil izohi.
      let deliveryLocation = null;
      if (orderType === 'dostavka') {
        if (location && typeof location.lat === 'number' && typeof location.lng === 'number' &&
            Math.abs(location.lat) <= 90 && Math.abs(location.lng) <= 180) {
          deliveryLocation = { lat: location.lat, lng: location.lng };
        }
        const addressNoteTrimmed = String(addressNote || '').trim();
        if (!deliveryLocation && !addressNoteTrimmed) {
          return sendJSON(res, 200, { ok: false, reason: 'Dostavka uchun joylashuvni aniqlang yoki manzilni yozib qoldiring.' });
        }
      }
      const addressNoteFinal = orderType === 'dostavka' ? String(addressNote || '').trim().slice(0, 300) : null;

      const menu = (owner.menu || []).filter(m => m.available !== false);
      const combosAvailable = (owner.combos || []).filter(c => c.available !== false);
      const orderItems = [];
      for (const it of items) {
        const qty = parseInt(it.qty, 10);
        if (!Number.isInteger(qty) || qty <= 0) return sendJSON(res, 200, { ok: false, reason: 'Miqdor noto\'g\'ri.' });
        if (it.isCombo) {
          const combo = combosAvailable.find(c => c.id === it.id);
          if (!combo) return sendJSON(res, 200, { ok: false, reason: 'Menyuda mavjud bo\'lmagan combo tanlangan.' });
          orderItems.push({ id: combo.id, name: combo.name, price: combo.price, qty, isCombo: true });
          continue;
        }
        const menuItem = menu.find(m => m.id === it.id);
        if (!menuItem) return sendJSON(res, 200, { ok: false, reason: 'Menyuda mavjud bo\'lmagan taom tanlangan.' });
        orderItems.push({ id: menuItem.id, name: menuItem.name, price: menuItem.price, qty, directStockId: menuItem.directStockId || null });
      }
      const subtotal = orderItems.reduce((sum, it) => sum + it.price * it.qty, 0);

      // Aksiya (agar tanlangan bo'lsa) chegirmasi
      const { promo, discountAmount } = applyPromoDiscount(owner, promoId, subtotal);
      let total = Math.max(0, subtotal - discountAmount);

      // Bonus ballaridan foydalanish (1 ball = 1 so'm)
      const customer = findOrCreateCustomer(owner, userId, check.user);
      let pointsUsed = 0;
      if (usePoints) {
        const requested = Math.max(0, Math.floor(Number(usePoints) || 0));
        pointsUsed = Math.min(requested, customer.bonusPoints, total);
        total -= pointsUsed;
      }

      // Retsept asosida skladdan mahsulot avtomatik yechiladi
      if (!owner.stock) owner.stock = [];

      const stockCheck = checkStockAvailability(owner, orderItems, menu);
      if (!stockCheck.ok) {
        return sendJSON(res, 200, { ok: false, reason: stockCheck.reason });
      }

      for (const it of orderItems) {
        if (it.isCombo) {
          const combo = findCombo(owner, it.id);
          if (combo) {
            for (const need of comboStockNeeds(owner, combo, it.qty)) {
              const stockItem = findStockItem(owner, need.stockId);
              if (!stockItem) continue;
              stockItem.qty = Math.max(0, Math.round((stockItem.qty - need.qty) * 1000) / 1000);
              addStockMovement(owner, {
                stockId: stockItem.id, stockName: stockItem.name, type: 'chiqim',
                qty: need.qty, unit: stockItem.unit,
                note: `Combo: ${combo.name} (${need.viaName}) x${it.qty}`,
                userId
              });
              checkLowStockAlert(owner, stockItem, userId);
            }
          }
          continue;
        }
        const menuItem = menu.find(m => m.id === it.id);
        // 14-bosqich: retsept o'rniga directStockId bilan bog'langan taom
        // bo'lsa - sklad miqdori to'g'ridan (1 birlik = 1 dona) kamaytiriladi,
        // retsept ingredientlari tekshirilmaydi (chunki bunday taomda recipe yo'q).
        if (menuItem && menuItem.directStockId) {
          const stockItem = findStockItem(owner, menuItem.directStockId);
          if (stockItem) {
            const consumeQty = it.qty;
            stockItem.qty = Math.max(0, Math.round((stockItem.qty - consumeQty) * 1000) / 1000);
            addStockMovement(owner, {
              stockId: stockItem.id, stockName: stockItem.name, type: 'chiqim',
              qty: consumeQty, unit: stockItem.unit,
              note: `To'g'ridan sotildi: ${menuItem.name} x${it.qty}`,
              userId
            });
            checkLowStockAlert(owner, stockItem, userId);
          }
          continue;
        }
        const recipe = (menuItem && Array.isArray(menuItem.recipe)) ? menuItem.recipe : [];
        for (const ing of recipe) {
          const stockItem = findStockItem(owner, ing.stockId);
          if (!stockItem) continue;
          const consumeQty = Math.round(ing.qty * it.qty * 1000) / 1000;
          stockItem.qty = Math.max(0, Math.round((stockItem.qty - consumeQty) * 1000) / 1000);
          addStockMovement(owner, {
            stockId: stockItem.id, stockName: stockItem.name, type: 'chiqim',
            qty: consumeQty, unit: stockItem.unit,
            note: `Mijoz buyurtmasi: ${menuItem.name} x${it.qty}`,
            userId
          });
          checkLowStockAlert(owner, stockItem, userId);
        }
      }

      // Bonus ballari to'planishi (sozlamada yoqilgan bo'lsa)
      let pointsEarned = 0;
      if (owner.bonusSettings && owner.bonusSettings.enabled) {
        pointsEarned = Math.floor(total * (owner.bonusSettings.earnPercent || 0) / 100);
      }
      customer.bonusPoints = Math.max(0, customer.bonusPoints - pointsUsed + pointsEarned);
      customer.ordersCount = (customer.ordersCount || 0) + 1;
      customer.totalSpent = (customer.totalSpent || 0) + total;

      if (!owner.orders) owner.orders = [];
      const order = {
        id: crypto.randomBytes(4).toString('hex'),
        items: orderItems,
        subtotal,
        promoId: promo ? promo.id : null,
        promoTitle: promo ? promo.title : null,
        discountAmount,
        pointsUsed,
        pointsEarned,
        total,
        orderType,
        tableNumber: orderType === 'stol' ? String(tableNumber).trim() : null,
        location: deliveryLocation,
        addressNote: addressNoteFinal,
        paymentType,
        status: 'yangi',
        // YANGI: karta bilan to'lagan mijoz to'lov skrinshotini yubormaguncha
        // va kassir/egasi shuni tasdiqlamaguncha - buyurtma "kutilmoqda"
        // holatida turadi, oshxona/dostavka guruhiga XABAR KETMAYDI (qarang:
        // pastdagi if (paymentType === 'karta') bloki va 'payok'/'payrej'
        // callback'lari). Naqd/"dostavka orqali" to'lovda bu tekshiruv
        // kerak emas - shuning uchun null.
        //
        // YANA: STOLGA + NAQD buyurtmada ham xuddi shunday - mijoz oldin
        // kassaga borib to'lashi, kassir "✅ To'lov qabul qilindi" tugmasini
        // bosishi kerak, SHUNDAN KEYIN oshpazga buyurtma ketadi (ish
        // boshlanadi). Farqi: skrinshot TALAB QILINMAYDI - kassir mijozni
        // ko'zi bilan ko'rib, naqd pulni qo'lida ushlab tasdiqlaydi.
        // paymentConfirmMethod shu ikki holatni bir-biridan ajratadi
        // (xabar matnlari va UI shunga qarab farqlanadi).
        paymentProofStatus: (paymentType === 'karta' || (orderType === 'stol' && paymentType === 'naqd')) ? 'kutilmoqda' : null,
        paymentConfirmMethod: paymentType === 'karta' ? 'skrinshot' : (orderType === 'stol' && paymentType === 'naqd') ? 'naqd_kassa' : null,
        paymentProofFileId: null,
        // Kuryer "dostavka orqali" pulni mijozdan qo'lda olgani uchun bu pul
        // egasi kuryerdan jismonan qabul qilib olmaguncha (/api/courier-collect-cash)
        // daromad hisobiga qo'shilmaydi — qarang: orderIncomeAmount().
        courierCashCollected: (orderType === 'dostavka' && paymentType === 'dostavka_orqali') ? false : true,
        branchId: null,
        customerId: userId,
        customerName: customerDisplayName(userId, check.user),
        source: 'customer',
        createdAt: new Date().toISOString(),
        createdBy: userId
      };
      owner.orders.push(order);
      logStaffAction(owner, { userId, role: 'mijoz', action: 'buyurtma_yaratdi', orderId: order.id, note: `Mijoz buyurtmasi — ${total} so'm` });
      saveOwners(owners);

      if (paymentType === 'karta') {
        // Oshxona/kassir/dostavka guruhiga HALI xabar YUBORILMAYDI - avval
        // mijoz to'lov skrinshotini shu botning shaxsiy chatiga yuborishi,
        // keyin kassir/egasi tasdiqlashi kerak (qarang: 'payok' callback -
        // xuddi shu notifyText/notifyTargets/notifyDeliveryGroup o'sha yerda
        // takrorlanadi, FAQAT tasdiqlangandan keyin ishga tushadi).
        await sendMessage(userId,
          '💳 Buyurtmangiz qabul qilindi, lekin hali <b>TASDIQLANMAGAN</b>.\n\n' +
          'Iltimos, to\'lov chekining (skrinshotning) RASMINI shu botga yuboring - ' +
          'kassir yoki oshxona egasi tekshirib tasdiqlagach, buyurtmangiz oshxonaga yuboriladi.');
      } else if (order.paymentConfirmMethod === 'naqd_kassa') {
        // YANGI: STOLGA + NAQD - mijozga YUMSHOQ, tushunarli tarzda
        // tushuntiriladi: avval kassaga to'lov, keyin tayyorlash boshlanadi.
        // Skrinshot kerak emas - kassir "✅ To'lov qabul qilindi" tugmasini
        // bosgach (naqd pulni qo'lida ko'rib) - oshpazga yuboriladi.
        await sendMessage(userId,
          `🍽 Buyurtmangiz qabul qilindi!\n\n` +
          `Iltimos, xohishingiz bo'lsa avval kassaga borib to'lovni amalga oshiring - ` +
          `to'lov qabul qilingach, taomingiz tayyorlanishni boshlaydi. Rahmat! 🙏`);

        const itemsText = orderItems.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
        const confirmCaption = `💵 <b>Naqd to'lov tasdiqlash kerak</b>\n` +
          `Stol: ${escapeHtmlServer(order.tableNumber || '-')}\nMijoz: ${escapeHtmlServer(order.customerName)}\n${itemsText}\n\n` +
          `Jami: ${total} so'm\n\nMijoz kassaga to'lov qilgach, shu yerda tasdiqlang - shundan keyin oshpazga ketadi.`;
        const confirmKb = {
          inline_keyboard: [[
            { text: '✅ To\'lov qabul qilindi', callback_data: `payok:${owner.id}:${order.id}` },
            { text: '❌ Bekor qilish', callback_data: `payrej:${owner.id}:${order.id}` }
          ]]
        };
        const cashApprovers = [owner.id, ...((owner.staff || []).filter(s => staffHasRole(s, 'kassir')).map(s => s.id))];
        for (const approverId of new Set(cashApprovers.map(String))) {
          sendMessage(approverId, confirmCaption, confirmKb);
        }
      } else {
        const itemsText = orderItems.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
        const notifyText = `🆕 <b>Yangi mijoz buyurtmasi</b> (${ORDER_TYPES[orderType]}${order.tableNumber ? ' — stol ' + escapeHtmlServer(order.tableNumber) : ''})\n` +
          `Mijoz: ${escapeHtmlServer(order.customerName)}\n${itemsText}\n\nJami: ${total}\nTo'lov: ${PAYMENT_TYPES[paymentType]}`;
        const notifyTargets = [owner.id, ...((owner.staff || []).filter(s => staffHasRole(s, 'oshpaz') || staffHasRole(s, 'kassir')).map(s => s.id))];
        await notifyStaffList(owner, notifyTargets, notifyText, `Buyurtma #${order.id} (mijoz)`);
        notifyDeliveryGroup(owner, order, `Mijoz: ${escapeHtmlServer(order.customerName)}`);
        notifyKitchenGroup(owner, order, `Mijoz: ${escapeHtmlServer(order.customerName)}`);
        saveOwners(owners);
      }

      const successResponse = {
        ok: true, orderId: order.id, total, discountAmount, pointsUsed, pointsEarned,
        bonusBalance: customer.bonusPoints, paymentPending: !!order.paymentProofStatus,
        paymentConfirmMethod: order.paymentConfirmMethod
      };
      setCachedOrderResponse(owner.id, userId, requestId, successResponse);
      return sendJSON(res, 200, successResponse);
    });
    return;
  }

  // ---- Sklad (ombor) — birliklar, harakatlar tarixi va kam qolish ogohlantirish yordamchilari ----
  function findStockItem(pool, id) {
    return (pool.stock || []).find(s => s.id === id);
  }

  // Sklad harakati (kirim/chiqim/audit tuzatish) tarixga yoziladi — kim, qachon, nima
  function addStockMovement(pool, entry) {
    if (!pool.stockMovements) pool.stockMovements = [];
    pool.stockMovements.unshift(Object.assign({
      id: crypto.randomBytes(4).toString('hex'),
      createdAt: new Date().toISOString()
    }, entry));
    if (pool.stockMovements.length > 500) pool.stockMovements.length = 500;
  }

  // Mahsulot chegaradan kam qolsa — egasi va shu joy (markaziy/filial)dagi sklad xodimlariga bir marta ogohlantirish yuboradi
  function checkLowStockAlert(owner, item, excludeUserId, branchId) {
    if (item.minQty === null || item.minQty === undefined) return;
    if (item.qty <= item.minQty) {
      if (!item.lowStockAlertSent) {
        item.lowStockAlertSent = true;
        const text = `⚠️ <b>Kam qoldi:</b> ${escapeHtmlServer(item.name)} — ${item.qty} ${escapeHtmlServer(item.unit)} qoldi (chegara: ${item.minQty} ${escapeHtmlServer(item.unit)}).`;
        const targets = [owner.id, ...((owner.staff || []).filter(s => staffHasRole(s, 'sklad') && (s.branchId || null) === (branchId || null)).map(s => s.id))];
        for (const t of new Set(targets)) {
          if (String(t) === String(excludeUserId)) continue;
          sendMessage(t, text);
        }
      }
    } else {
      item.lowStockAlertSent = false;
    }
  }

  // Buyurtmadagi barcha taomlar uchun retseptga ko'ra yetarli sklad (ombor) mahsuloti
  // bor-yo'qligini tekshiradi — hech narsani o'zgartirmaydi, faqat "yetadimi" degan
  // javob qaytaradi. Bir xil ingredient bir nechta taomda ishlatilsa, talab qilingan
  // miqdorlar jamlanadi (masalan, 2 xil taom bir xil pomidorni ishlatsa).
  // Qaytadi: { ok: true } yoki { ok: false, reason, stockName }
  function checkStockAvailability(owner, orderItems, menu) {
    const needed = new Map(); // stockId -> jami kerak bo'lgan miqdor
    for (const it of orderItems) {
      if (it.isCombo) {
        const combo = findCombo(owner, it.id);
        if (!combo) continue;
        for (const need of comboStockNeeds(owner, combo, it.qty)) {
          needed.set(need.stockId, Math.round(((needed.get(need.stockId) || 0) + need.qty) * 1000) / 1000);
        }
        continue;
      }
      const menuItem = menu.find(m => m.id === it.id);
      // 16-bosqich: retsept o'rniga directStockId bilan bog'langan taom
      // bo'lsa - bitta sklad birligi taom donasiga to'g'ri keladi (1:1),
      // shuning uchun kerakli miqdor to'g'ridan it.qty ga teng.
      if (menuItem && menuItem.directStockId) {
        const consumeQty = it.qty;
        needed.set(menuItem.directStockId, Math.round(((needed.get(menuItem.directStockId) || 0) + consumeQty) * 1000) / 1000);
        continue;
      }
      const recipe = (menuItem && Array.isArray(menuItem.recipe)) ? menuItem.recipe : [];
      for (const ing of recipe) {
        const consumeQty = Math.round(ing.qty * it.qty * 1000) / 1000;
        needed.set(ing.stockId, Math.round(((needed.get(ing.stockId) || 0) + consumeQty) * 1000) / 1000);
      }
    }
    for (const [stockId, requiredQty] of needed) {
      const stockItem = findStockItem(owner, stockId);
      if (!stockItem) continue; // sklad kartochkasi yo'q bo'lsa, eski xatti-harakatni saqlab qolamiz (o'tkazib yuboriladi)
      if (stockItem.qty < requiredQty) {
        return {
          ok: false,
          reason: `Omborda "${stockItem.name}" yetarli emas (kerak: ${requiredQty} ${stockItem.unit}, mavjud: ${stockItem.qty} ${stockItem.unit}).`,
          stockName: stockItem.name
        };
      }
    }
    return { ok: true };
  }

  // ---- API: kassir yangi buyurtma yaratadi va oshxonaga yuboradi ----
  // Ruxsat etilgan holat o'tishlari: "yangi" -> "tayyorlanmoqda" -> "tayyor".
  // Bosqich tashlab ketib bo'lmaydi (masalan, "yangi"dan to'g'ridan-to'g'ri "tayyor"ga).
  const ORDER_STATUS_TRANSITIONS = {
    yangi: ['tayyorlanmoqda'],
    tayyorlanmoqda: ['tayyor'],
    tayyor: []
  };

  // 15-bosqich: buyurtmadagi BARCHA taomlar skladdan to'g'ridan sotiladigan
  // bo'lsa (retseptsiz, directStockId orqali) - oshpaz tayyorlashi shart emas,
  // shuning uchun bunday buyurtmalar uchun "tayyorlanmoqda" bosqichi kerak emas.
  // Buyurtmaning har bir qatorida directStockId saqlanadi (qarang: /api/create-order
  // va mijoz buyurtmasi endpointi) - shu yerda faqat o'sha belgiga qaraladi.
  function orderNeedsKitchen(order) {
    const items = (order && order.items) || [];
    if (!items.length) return true;
    return items.some(it => !it.directStockId);
  }

  // Berilgan rol berilgan holatga o'tkaza olish-olmasligini tekshiradi.
  // `order` — joriy buyurtma obyekti (uning hozirgi status'idan qaysi keyingi
  // status'larga o'tish mumkinligini aniqlash uchun kerak).
  function canSetOrderStatus(ctx, order, newStatus) {
    if (!Object.prototype.hasOwnProperty.call(ORDER_STATUSES, newStatus)) return false;

    // egasi tuzatish uchun istalgan holatga o'tkaza oladi (bosqichlarni chetlab o'tishi mumkin)
    if (ctxHasRole(ctx, 'egasi')) return true;

    // boshqa rollar uchun faqat ketma-ket bosqichlarga o'tishga ruxsat bor
    const currentStatus = order ? order.status : 'yangi';
    let allowedNext = ORDER_STATUS_TRANSITIONS[currentStatus] || [];
    // 15-bosqich: retseptsiz/directStockId buyurtmalarda "yangi" dan to'g'ridan
    // "tayyor"ga o'tish ham ruxsat etiladi ("tayyorlanmoqda" bosqichi shart emas).
    if (currentStatus === 'yangi' && !orderNeedsKitchen(order)) {
      allowedNext = allowedNext.concat('tayyor');
    }
    if (!allowedNext.includes(newStatus)) return false;

    if (ctxHasRole(ctx, 'oshpaz') && (newStatus === 'tayyorlanmoqda' || newStatus === 'tayyor')) return true;
    if (ctxHasRole(ctx, 'kassir') && newStatus === 'tayyor') return true; // kassir ham "Tayyor" tugmasini bosa oladi (faqat "tayyorlanmoqda"dan keyin)
    return false;
  }

  if (req.method === 'POST' && req.url === '/api/create-order') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, items, orderType, tableNumber, paymentType, requestId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['kassir', 'egasi'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Faqat kassir buyurtma yaratishi mumkin' });
      }

      // Ikki marta bosish yoki tarmoq qayta yuborishi tufayli bitta buyurtma
      // ikki marta yaratilib ketmasligi uchun — shu requestId bilan avval
      // muvaffaqiyatli javob berilgan bo'lsa, o'shani qaytaramiz.
      const cachedResponse = getCachedOrderResponse(ctx.owner.id, userId, requestId);
      if (cachedResponse) return sendJSON(res, 200, cachedResponse);

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
      if (orderType === 'dostavka' && paymentType === 'naqd') {
        return sendJSON(res, 200, { ok: false, reason: 'Dostavka buyurtmalarida naqd to\'lov mavjud emas. Karta yoki dostavka orqali to\'lovni tanlang.' });
      }
      // 21/23-bosqich: "Dostavka orqali" to'lov turi FAQAT haqiqiy Dostavka
      // buyurtmalarida mavjud — Stolga/Olib ketish buyurtmalarida bu
      // variant mantiqsiz (kuryer yo'q), shuning uchun backend'da ham
      // rad etiladi (frontendda ko'rsatilmasligidan tashqari — himoya
      // ikki qavatli bo'lishi kerak).
      if (orderType !== 'dostavka' && paymentType === 'dostavka_orqali') {
        return sendJSON(res, 200, { ok: false, reason: '"Dostavka orqali" to\'lovi faqat Dostavka buyurtmalarida mavjud.' });
      }

      // Narxlarni klientdan emas, serverdagi menyudan olamiz (soxtalashtirilmasligi uchun)
      const menu = ctx.owner.menu || [];
      const combosAvailable = ctx.owner.combos || [];
      const orderItems = [];
      for (const it of items) {
        const qty = parseInt(it.qty, 10);
        if (!Number.isInteger(qty) || qty <= 0) return sendJSON(res, 200, { ok: false, reason: 'Miqdor noto\'g\'ri.' });
        if (it.isCombo) {
          const combo = combosAvailable.find(c => c.id === it.id);
          if (!combo) return sendJSON(res, 200, { ok: false, reason: 'Menyuda mavjud bo\'lmagan combo tanlangan.' });
          orderItems.push({ id: combo.id, name: combo.name, price: combo.price, qty, isCombo: true });
          continue;
        }
        const menuItem = menu.find(m => m.id === it.id);
        if (!menuItem) return sendJSON(res, 200, { ok: false, reason: 'Menyuda mavjud bo\'lmagan taom tanlangan.' });
        orderItems.push({ id: menuItem.id, name: menuItem.name, price: menuItem.price, qty, directStockId: menuItem.directStockId || null });
      }
      const total = orderItems.reduce((sum, it) => sum + it.price * it.qty, 0);

      // Retsept asosida skladdan mahsulot avtomatik yechiladi (taom tayyorlansa ingredient kamayadi)
      if (!ctx.owner.stock) ctx.owner.stock = [];

      const stockCheck = checkStockAvailability(ctx.owner, orderItems, menu);
      if (!stockCheck.ok) {
        return sendJSON(res, 200, { ok: false, reason: stockCheck.reason });
      }

      for (const it of orderItems) {
        if (it.isCombo) {
          const combo = findCombo(ctx.owner, it.id);
          if (combo) {
            for (const need of comboStockNeeds(ctx.owner, combo, it.qty)) {
              const stockItem = findStockItem(ctx.owner, need.stockId);
              if (!stockItem) continue;
              stockItem.qty = Math.max(0, Math.round((stockItem.qty - need.qty) * 1000) / 1000);
              addStockMovement(ctx.owner, {
                stockId: stockItem.id, stockName: stockItem.name, type: 'chiqim',
                qty: need.qty, unit: stockItem.unit,
                note: `Combo: ${combo.name} (${need.viaName}) x${it.qty}`,
                userId
              });
              checkLowStockAlert(ctx.owner, stockItem, userId);
            }
          }
          continue;
        }
        const menuItem = menu.find(m => m.id === it.id);
        // 14-bosqich: retsept o'rniga directStockId bilan bog'langan taom
        // bo'lsa - sklad miqdori to'g'ridan (1 birlik = 1 dona) kamaytiriladi.
        if (menuItem && menuItem.directStockId) {
          const stockItem = findStockItem(ctx.owner, menuItem.directStockId);
          if (stockItem) {
            const consumeQty = it.qty;
            stockItem.qty = Math.max(0, Math.round((stockItem.qty - consumeQty) * 1000) / 1000);
            addStockMovement(ctx.owner, {
              stockId: stockItem.id, stockName: stockItem.name, type: 'chiqim',
              qty: consumeQty, unit: stockItem.unit,
              note: `To'g'ridan sotildi: ${menuItem.name} x${it.qty}`,
              userId
            });
            checkLowStockAlert(ctx.owner, stockItem, userId);
          }
          continue;
        }
        const recipe = (menuItem && Array.isArray(menuItem.recipe)) ? menuItem.recipe : [];
        for (const ing of recipe) {
          const stockItem = findStockItem(ctx.owner, ing.stockId);
          if (!stockItem) continue;
          const consumeQty = Math.round(ing.qty * it.qty * 1000) / 1000;
          stockItem.qty = Math.max(0, Math.round((stockItem.qty - consumeQty) * 1000) / 1000);
          addStockMovement(ctx.owner, {
            stockId: stockItem.id, stockName: stockItem.name, type: 'chiqim',
            qty: consumeQty, unit: stockItem.unit,
            note: `Buyurtma: ${menuItem.name} x${it.qty}`,
            userId
          });
          checkLowStockAlert(ctx.owner, stockItem, userId);
        }
      }

      if (!ctx.owner.orders) ctx.owner.orders = [];
      const orderBranchId = ctx.role === 'egasi' ? (payload.branchId || null) : ctx.branchId;
      const order = {
        id: crypto.randomBytes(4).toString('hex'),
        items: orderItems,
        total,
        orderType,
        tableNumber: orderType === 'stol' ? String(tableNumber).trim() : null,
        paymentType,
        status: 'yangi',
        branchId: orderBranchId,
        // qarang: orderIncomeAmount() — kuryerda turgan naqd pul egasi
        // tomonidan olinmaguncha daromadga qo'shilmaydi.
        courierCashCollected: (orderType === 'dostavka' && paymentType === 'dostavka_orqali') ? false : true,
        createdAt: new Date().toISOString(),
        createdBy: userId
      };
      ctx.owner.orders.push(order);
      logStaffAction(ctx.owner, { userId, role: ctx.role, action: 'buyurtma_yaratdi', orderId: order.id, note: `${ORDER_TYPES[orderType]} — ${total} so'm` });
      saveOwners(owners);

      // Oshxonaga (egaga + oshpazlarga) xabar yuboriladi
      const itemsText = orderItems.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
      const notifyText = `🆕 <b>Yangi buyurtma</b> (${ORDER_TYPES[orderType]}${order.tableNumber ? ' — stol ' + escapeHtmlServer(order.tableNumber) : ''})\n` +
        `${itemsText}\n\nJami: ${total}\nTo'lov: ${PAYMENT_TYPES[paymentType]}`;
      const notifyTargets = [ctx.owner.id, ...((ctx.owner.staff || []).filter(s => staffHasRole(s, 'oshpaz')).map(s => s.id))];
      await notifyStaffList(ctx.owner, notifyTargets, notifyText, `Buyurtma #${order.id} (kassir)`);
      notifyDeliveryGroup(ctx.owner, order, `Yaratdi: ${escapeHtmlServer(displayName(check.user))} (kassir)`);
      notifyKitchenGroup(ctx.owner, order, `Yaratdi: ${escapeHtmlServer(displayName(check.user))} (kassir)`);
      saveOwners(owners);

      const successResponse = { ok: true, orderId: order.id, total };
      setCachedOrderResponse(ctx.owner.id, userId, requestId, successResponse);
      return sendJSON(res, 200, successResponse);
    });
    return;
  }

  // ---- API: buyurtmalar ro'yxatini olish (oshpaz, kassir, egasi, kuryer — real-vaqtda polling uchun) ----
  if (req.method === 'POST' && req.url === '/api/orders-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['egasi', 'kassir', 'oshpaz', 'dostavka'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'limni ko\'rishga ruxsatingiz yo\'q' });
      }

      let orders = (ctx.owner.orders || [])
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Kuryerga faqat "Tayyor" bo'lgan, hali hech kim yetkazib bermagan dostavka buyurtmalari ko'rinadi
      if (ctxHasRole(ctx, 'dostavka')) {
        orders = orders.filter(o => o.orderType === 'dostavka' && o.status === 'tayyor' && !o.deliveredBy);
      }

      orders = orders.slice(0, 100);
      return sendJSON(res, 200, { ok: true, orders, role: ctx.role });
    });
    return;
  }

  // ---- API: buyurtmalar tarixini filtrlash — sana/xodim/to'lov turi (44-bosqich) ----
  // Faqat oshxona egasiga ko'rinadi (boshqa moliyaviy hisobotlar — kuryer/Z-hisobot —
  // bilan bir xil qoida). Sana oralig'i, xodim (kim yaratgan) va to'lov turi bo'yicha
  // filtrlab, sahifalab (pagination) qaytaradi.
  if (req.method === 'POST' && req.url === '/api/order-history') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !isOwnerAccessValid(ctx.owner) || ctx.role !== 'egasi') {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });
      }

      const { dateFrom, dateTo, employeeId, paymentType, orderType } = payload;
      let page = parseInt(payload.page, 10);
      if (!Number.isFinite(page) || page < 1) page = 1;
      const PAGE_SIZE = 30;

      let orders = (ctx.owner.orders || []).slice();

      if (dateFrom) {
        const from = new Date(dateFrom + 'T00:00:00');
        if (!isNaN(from.getTime())) orders = orders.filter(o => new Date(o.createdAt) >= from);
      }
      if (dateTo) {
        const to = new Date(dateTo + 'T23:59:59');
        if (!isNaN(to.getTime())) orders = orders.filter(o => new Date(o.createdAt) <= to);
      }
      if (employeeId) {
        orders = orders.filter(o => String(o.createdBy) === String(employeeId));
      }
      if (paymentType && Object.prototype.hasOwnProperty.call(PAYMENT_TYPES, paymentType)) {
        orders = orders.filter(o => o.paymentType === paymentType);
      }
      if (orderType && Object.prototype.hasOwnProperty.call(ORDER_TYPES, orderType)) {
        orders = orders.filter(o => o.orderType === orderType);
      }

      orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const totalCount = orders.length;
      const totalSum = orders.reduce((sum, o) => sum + (o.total || 0), 0);
      const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      if (page > totalPages) page = totalPages;
      const pageOrders = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

      // Xodim F.I.Sh — buyurtmani kim yaratgani (1-bosqich bilan bir xil qoida)
      const nameCache = new Map();
      const staffNameById = (id) => {
        if (!id) return null;
        if (nameCache.has(id)) return nameCache.get(id);
        let name;
        if (String(id) === String(ctx.owner.id)) {
          name = 'Egasi';
        } else {
          const staff = (ctx.owner.staff || []).find(s => String(s.id) === String(id));
          name = staff ? staffDisplayName(staff) : `ID: ${id}`;
        }
        nameCache.set(id, name);
        return name;
      };

      const resultOrders = pageOrders.map(o => ({
        id: o.id,
        items: o.items,
        total: o.total,
        orderType: o.orderType,
        tableNumber: o.tableNumber,
        paymentType: o.paymentType,
        status: o.status,
        createdAt: o.createdAt,
        createdBy: o.createdBy,
        createdByName: staffNameById(o.createdBy)
      }));

      // Filtr uchun xodimlar ro'yxati (egasi + hozircha buyurtma yaratgan xodimlar)
      const employees = [{ id: ctx.owner.id, name: 'Egasi' }];
      (ctx.owner.staff || []).forEach(s => {
        employees.push({ id: s.id, name: staffDisplayName(s) });
      });

      return sendJSON(res, 200, {
        ok: true,
        orders: resultOrders,
        page, totalPages, totalCount, totalSum,
        pageSize: PAGE_SIZE,
        employees
      });
    });
    return;
  }

  // ---- API: xodim uchun shaxsiy kunlik/haftalik/oylik statistika (45-bosqich) ----
  // Har bir rol o'ziga tegishli ko'rsatkichni ko'radi: kassir — yaratgan
  // buyurtmalari, oshpaz — tayyorlagan buyurtmalari, kuryer — yetkazgan
  // buyurtmalari (va komissiyasi), sklad — kiritgan sklad harakatlari.
  if (req.method === 'POST' && req.url === '/api/my-stats') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, period } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['kassir', 'oshpaz', 'dostavka', 'sklad'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat xodimlarga ko\'rinadi' });
      }

      const fromDate = resolvePeriodStart(period);
      const orders = ctx.owner.orders || [];
      const stats = { period: period || 'today' };

      if (ctxHasRole(ctx, 'kassir')) {
        const mine = orders.filter(o => String(o.createdBy) === userId && new Date(o.createdAt) >= fromDate);
        stats.kassir = {
          orderCount: mine.length,
          totalAmount: mine.reduce((sum, o) => sum + (o.total || 0), 0)
        };
      }
      if (ctxHasRole(ctx, 'oshpaz')) {
        // "Tayyor" deb belgilagan (oxirgi holat o'zgartiruvchi shu xodim bo'lgan) buyurtmalar
        const mine = orders.filter(o => o.status === 'tayyor' && String(o.updatedBy) === userId && o.readyAt && new Date(o.readyAt) >= fromDate);
        stats.oshpaz = {
          orderCount: mine.length
        };
      }
      if (ctxHasRole(ctx, 'dostavka')) {
        const mine = orders.filter(o => o.orderType === 'dostavka' && String(o.deliveredBy) === userId && new Date(o.deliveredAt || o.createdAt) >= fromDate);
        const totalAmount = mine.reduce((sum, o) => sum + (o.total || 0), 0);
        const commissionPercent = Number.isFinite(ctx.owner.courierCommissionPercent) ? ctx.owner.courierCommissionPercent : 10;
        stats.dostavka = {
          orderCount: mine.length,
          totalAmount,
          commission: Math.round(totalAmount * commissionPercent / 100)
        };
      }
      if (ctxHasRole(ctx, 'sklad')) {
        const movements = (ctx.owner.stockMovements || []).filter(m => String(m.userId) === userId && new Date(m.createdAt) >= fromDate);
        stats.sklad = {
          movementCount: movements.length,
          kirimCount: movements.filter(m => m.type === 'kirim').length,
          chiqimCount: movements.filter(m => m.type === 'chiqim').length
        };
      }

      return sendJSON(res, 200, { ok: true, stats });
    });
    return;
  }

  // ---- API: 49-bosqich — kassir/oshpaz "smena" holatini olish ----
  // Xodim ekranini ochganda joriy smena holatini (faol/faol emas, boshlangan
  // vaqti) so'raydi — holat staff yozuvida saqlanadi, shuning uchun qaysi
  // qurilmadan ochilsa ham bir xil ko'rinadi.
  if (req.method === 'POST' && req.url === '/api/shift-status') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['kassir', 'oshpaz'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat kassir va oshpaz uchun' });
      }
      const staff = (ctx.owner.staff || []).find(s => String(s.id) === userId);
      if (!staff) return sendJSON(res, 200, { ok: false, reason: 'Xodim topilmadi' });

      return sendJSON(res, 200, { ok: true, active: !!staff.shiftActive, startedAt: staff.shiftStartedAt || null });
    });
    return;
  }

  // ---- API: 49-bosqich — smena boshlash/tugatish ----
  // Kassir yoki oshpaz ish boshlaganda/tugatganda bosadigan tugma. Holat
  // xodim yozuvida saqlanadi (staff.shiftActive / staff.shiftStartedAt).
  // Tugatilganda davomiylik owner.shiftHistory'ga yoziladi (kelajakda
  // smena bo'yicha hisobot uchun) va umumiy amallar jurnaliga
  // (logStaffAction) tushadi — egasi buni "Xodimlar nazorati" bo'limida
  // ko'radi.
  if (req.method === 'POST' && req.url === '/api/shift-toggle') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['kassir', 'oshpaz'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat kassir va oshpaz uchun' });
      }
      const staff = (ctx.owner.staff || []).find(s => String(s.id) === userId);
      if (!staff) return sendJSON(res, 200, { ok: false, reason: 'Xodim topilmadi' });

      const now = new Date().toISOString();
      if (staff.shiftActive) {
        if (!ctx.owner.shiftHistory) ctx.owner.shiftHistory = [];
        ctx.owner.shiftHistory.unshift({
          id: crypto.randomBytes(4).toString('hex'),
          userId,
          role: ctx.role,
          startedAt: staff.shiftStartedAt || now,
          endedAt: now
        });
        if (ctx.owner.shiftHistory.length > 1000) ctx.owner.shiftHistory.length = 1000;
        staff.shiftActive = false;
        staff.shiftStartedAt = null;
        logStaffAction(ctx.owner, { userId, role: ctx.role, action: 'smena_tugatdi', note: 'Ish smenasini tugatdi' });
      } else {
        staff.shiftActive = true;
        staff.shiftStartedAt = now;
        logStaffAction(ctx.owner, { userId, role: ctx.role, action: 'smena_boshladi', note: 'Ish smenasini boshladi' });
      }
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, active: !!staff.shiftActive, startedAt: staff.shiftStartedAt || null });
    });
    return;
  }

  // ---- API: buyurtma holatini o'zgartirish (Yangi -> Tayyorlanmoqda -> Tayyor) ----
  if (req.method === 'POST' && req.url === '/api/update-order-status') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, orderId, status } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['egasi', 'kassir', 'oshpaz'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu amalga ruxsatingiz yo\'q' });
      }

      if (!Object.prototype.hasOwnProperty.call(ORDER_STATUSES, status)) {
        return sendJSON(res, 200, { ok: false, reason: 'Noto\'g\'ri holat.' });
      }

      const order = (ctx.owner.orders || []).find(o => o.id === orderId);
      if (!order) return sendJSON(res, 200, { ok: false, reason: 'Buyurtma topilmadi.' });
      if (order.status === status) {
        return sendJSON(res, 200, { ok: true, order }); // allaqachon shu holatda
      }
      if (!canSetOrderStatus(ctx, order, status)) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu buyurtma hozirgi holatidan bunday o\'tishni qabul qilmaydi (masalan, "Tayyorlanmoqda" bosqichisiz "Tayyor" deb belgilab bo\'lmaydi).' });
      }

      order.status = status;
      order.updatedAt = new Date().toISOString();
      order.updatedBy = userId;
      if (status === 'tayyorlanmoqda' && !order.startedAt) order.startedAt = order.updatedAt;
      if (status === 'tayyor' && !order.readyAt) order.readyAt = order.updatedAt;

      logStaffAction(ctx.owner, { userId, role: ctx.role, action: `holat_${status}`, orderId: order.id, note: `Buyurtma ${ORDER_STATUSES[status]} deb belgilandi` });
      saveOwners(owners);

      // 15-bosqich: holat Mini App orqali (guruh tugmalarisiz) o'zgarganda ham
      // dostavka/oshpazlar guruhidagi xabar tugmalari joriy holatga mos
      // yangilanadi — aks holda guruh a'zolari eski "Qabul qilish"/"Tayyor"
      // tugmasini bosib, chalkash javob olishlari mumkin edi.
      syncGroupMessagesForOrder(ctx.owner, order);

      // "Tayyor" bo'lganda kassir(lar)ga va (dostavka bo'lsa) kuryer(lar)ga avtomatik bildirishnoma
      if (status === 'tayyor') {
        const itemsText = order.items.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
        const orderLabel = `${ORDER_TYPES[order.orderType] || order.orderType}${order.tableNumber ? ' — stol ' + escapeHtmlServer(order.tableNumber) : ''}`;
        const readyText = `✅ <b>Buyurtma tayyor</b> (${orderLabel})\n${itemsText}\n\nJami: ${order.total}`;

        const staffList = ctx.owner.staff || [];
        const targetRoles = order.orderType === 'dostavka' ? ['kassir', 'dostavka'] : ['kassir'];
        const targetIds = staffList.filter(s => targetRoles.includes(s.role)).map(s => s.id);
        for (const targetId of new Set(targetIds)) {
          if (String(targetId) === userId) continue; // o'zi belgilagan bo'lsa, o'ziga yubormaydi
          sendMessage(targetId, readyText);
        }
      }

      return sendJSON(res, 200, { ok: true, order });
    });
    return;
  }

  // ---- API: kuryer buyurtmani "Yetkazildi" deb belgilaydi (F/26-bosqich: kuryer hisoboti uchun asos) ----
  if (req.method === 'POST' && req.url === '/api/deliver-order') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, orderId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['dostavka', 'egasi'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Faqat kuryer bu amalni bajara oladi' });
      }

      const order = (ctx.owner.orders || []).find(o => o.id === orderId);
      if (!order) return sendJSON(res, 200, { ok: false, reason: 'Buyurtma topilmadi.' });
      if (order.orderType !== 'dostavka') {
        return sendJSON(res, 200, { ok: false, reason: 'Bu buyurtma dostavka turi emas.' });
      }
      if (order.deliveredBy) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu buyurtma allaqachon yetkazilgan deb belgilangan.' });
      }

      order.deliveredBy = userId;
      order.deliveredAt = new Date().toISOString();
      logStaffAction(ctx.owner, { userId, role: ctx.role, action: 'yetkazdi', orderId: order.id, note: `${order.total} so'm — yetkazib berildi` });
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, order });
    });
    return;
  }

  // ---- API: egasi xato bosilgan "Yetkazildi" belgisini bekor qiladi ----
  // (masalan, kuryer boshqa buyurtmani bosib yuborgan yoki hali yetkazmasdan
  // tugmani bosib yuborgan holatlarni tuzatish uchun). Faqat "egasi" roliga ruxsat
  // berilgan — kuryerning o'ziga bu huquq berilmagan, aks holda u o'z hisobotini
  // (yetkazgan buyurtmalar sonini) o'zi o'zgartira olardi.
  if (req.method === 'POST' && req.url === '/api/undo-deliver-order') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, orderId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasRole(ctx, 'egasi')) {
        return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi bu amalni bajara oladi' });
      }

      const order = (ctx.owner.orders || []).find(o => o.id === orderId);
      if (!order) return sendJSON(res, 200, { ok: false, reason: 'Buyurtma topilmadi.' });
      if (!order.deliveredBy) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu buyurtma "Yetkazildi" deb belgilanmagan.' });
      }

      const previousDeliveredBy = order.deliveredBy;
      order.deliveredBy = null;
      order.deliveredAt = null;
      logStaffAction(ctx.owner, {
        userId, role: ctx.role, action: 'yetkazish_bekor',
        orderId: order.id,
        note: `"Yetkazildi" belgisi bekor qilindi (avval: ${previousDeliveredBy})`
      });
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, order });
    });
    return;
  }

  // ---- API: sklad ro'yxatini olish (egasi, sklad mas'uli) ----
  if (req.method === 'POST' && req.url === '/api/stock-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['egasi', 'sklad'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'limni ko\'rishga ruxsatingiz yo\'q' });
      }

      const branchId = ctx.role === 'egasi' ? (payload.branchId || null) : ctx.branchId;
      const pool = resolveStockPool(ctx.owner, branchId);
      if (!pool) return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi' });

      const stock = (pool.stock || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'uz'));
      return sendJSON(res, 200, { ok: true, stock, units: STOCK_UNITS, branches: ctx.owner.branches || [], branchId });
    });
    return;
  }

  // ---- API: skladga mahsulot kiritish (yangi mahsulot yoki mavjudiga kirim qo'shish) ----
  if (req.method === 'POST' && req.url === '/api/stock-add') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, name, qty, unit, price, minQty } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['egasi', 'sklad'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu amalga ruxsatingiz yo\'q' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'stock-manage')) return sendJSON(res, 200, featureBlockedResult('stock-manage'));

      const branchId = ctx.role === 'egasi' ? (payload.branchId || null) : ctx.branchId;
      const pool = resolveStockPool(ctx.owner, branchId);
      if (!pool) return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi' });

      const nameTrim = String(name || '').trim();
      const qtyNum = Number(qty);
      if (!nameTrim) return sendJSON(res, 200, { ok: false, reason: 'Mahsulot nomini kiriting.' });
      if (!Object.prototype.hasOwnProperty.call(STOCK_UNITS, unit)) {
        return sendJSON(res, 200, { ok: false, reason: 'Birlikni tanlang (kg, g, l, ml, dona).' });
      }
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        return sendJSON(res, 200, { ok: false, reason: 'Miqdorni to\'g\'ri kiriting.' });
      }
      // 6-bosqich: narx endi MAJBURIY — bo'sh/0 bo'lsa xatolik qaytariladi,
      // chunki har bir kirim uchun avtomatik xarajat yozuvi shu narxdan hisoblanadi.
      if (price === undefined || price === null || price === '') {
        return sendJSON(res, 200, { ok: false, reason: 'Narxni kiriting — u avtomatik xarajat yozish uchun kerak.' });
      }
      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        return sendJSON(res, 200, { ok: false, reason: 'Narx musbat son bo\'lishi kerak.' });
      }
      let minQtyNum = null;
      if (minQty !== undefined && minQty !== null && minQty !== '') {
        minQtyNum = Number(minQty);
        if (!Number.isFinite(minQtyNum) || minQtyNum < 0) return sendJSON(res, 200, { ok: false, reason: 'Kam qolish chegarasi musbat son bo\'lishi kerak.' });
      }

      if (!pool.stock) pool.stock = [];
      let item = pool.stock.find(s => s.name.toLowerCase() === nameTrim.toLowerCase() && s.unit === unit);

      if (item) {
        item.qty = Math.round((item.qty + qtyNum) * 1000) / 1000;
        if (priceNum) item.price = priceNum;
        if (minQtyNum !== null) item.minQty = minQtyNum;
      } else {
        item = {
          id: crypto.randomBytes(4).toString('hex'),
          name: nameTrim,
          qty: qtyNum,
          unit,
          price: priceNum,
          minQty: minQtyNum,
          lowStockAlertSent: false,
          addedAt: new Date().toISOString()
        };
        pool.stock.push(item);
      }

      addStockMovement(pool, {
        stockId: item.id, stockName: item.name, type: 'kirim',
        qty: qtyNum, unit, note: 'Qo\'lda kiritildi', userId
      });
      checkLowStockAlert(ctx.owner, item, userId, branchId);
      logStaffAction(ctx.owner, { userId, role: ctx.role, action: 'sklad_kirim', note: `${item.name}: +${qtyNum} ${unit}` });

      // 7-8-bosqich: sklad kirimi uchun avtomatik xarajat yozuvi — narx endi
      // majburiy bo'lgani uchun har bir kirim to'g'ridan-to'g'ri moliyaga
      // (owner.expenses) "sklad_xarid" kategoriyasi bilan tushadi. note
      // maydonida qaysi mahsulot/miqdor ekani ko'rsatiladi (masalan "Un — 10 kg").
      if (!ctx.owner.expenses) ctx.owner.expenses = [];
      ctx.owner.expenses.unshift({
        id: crypto.randomBytes(4).toString('hex'),
        amount: Math.round(qtyNum * priceNum * 100) / 100,
        category: 'sklad_xarid',
        note: `${item.name} — ${qtyNum} ${unit}`,
        createdAt: new Date().toISOString(),
        createdBy: userId,
        source: 'stock',
        stockId: item.id
      });
      if (ctx.owner.expenses.length > 500) ctx.owner.expenses.length = 500;

      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, item });
    });
    return;
  }

  // ---- API: sklad mahsulotini butunlay o'chirish (faqat egasi) ----
  // 9-bosqich (hujjat): mahsulotni sklad ro'yxatidan o'chirish avvalgi
  // /api/stock-add chaqiruvlarida yozilgan "sklad_xarid" xarajatlarini
  // ORQAGA QAYTARMAYDI/o'chirmaydi — bu ataylab shunday, chunki xarid haqiqatan
  // ham amalga oshgan (pul sarflangan), mahsulot esa keyinchalik ro'yxatdan
  // olib tashlanishi (masalan boshqa nom bilan qayta kiritish uchun) buni
  // o'zgartirmaydi. Xato kiritilgan xarajatni tuzatish kerak bo'lsa, buni
  // Moliya ekranidan qo'lda (/api/expense-remove) qilish kerak.
  if (req.method === 'POST' && req.url === '/api/stock-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, branchId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'chira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const pool = resolveStockPool(owner, branchId || null);
      if (!pool) return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi' });

      pool.stock = (pool.stock || []).filter(s => s.id !== id);
      // Markaziy skladdagi mahsulot bo'lsa — bog'langan retseptlardan ham olib tashlanadi
      if (!branchId) {
        (owner.menu || []).forEach(m => {
          if (Array.isArray(m.recipe)) m.recipe = m.recipe.filter(r => r.stockId !== id);
        });
      }
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: sklad harakatlari tarixi (kim, qachon, nima kiritdi/chiqardi) ----
  if (req.method === 'POST' && req.url === '/api/stock-movements') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['egasi', 'sklad'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'limni ko\'rishga ruxsatingiz yo\'q' });
      }

      const branchId = ctx.role === 'egasi' ? (payload.branchId || null) : ctx.branchId;
      const pool = resolveStockPool(ctx.owner, branchId);
      if (!pool) return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi' });

      const movements = (pool.stockMovements || []).slice(0, 200);
      return sendJSON(res, 200, { ok: true, movements });
    });
    return;
  }

  // ---- API: markaziy skladdan filialga mahsulot o'tkazish (transfer) — faqat egasi ----
  // 9-bosqich (hujjat): transfer yangi xarid emas — mahsulot allaqachon
  // markaziy skladga /api/stock-add orqali kirganda "sklad_xarid" xarajati
  // yozilgan bo'ladi. Shu sababli bu yerda YANGI xarajat yozuvi QO'SHILMAYDI —
  // aks holda bir xil xarid ikki marta hisoblangan bo'lardi (markaziy sklad +
  // filial). Transfer faqat miqdorni bir joydan ikkinchisiga ko'chiradi.
  if (req.method === 'POST' && req.url === '/api/stock-transfer') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, stockId, branchId, qty } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi transfer qila oladi' });

      if (!branchId) return sendJSON(res, 200, { ok: false, reason: 'Qaysi filialga o\'tkazishni tanlang.' });
      const branch = findBranch(owner, branchId);
      if (!branch) return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi.' });

      const centralItem = findStockItem(owner, stockId);
      if (!centralItem) return sendJSON(res, 200, { ok: false, reason: 'Markaziy skladda bunday mahsulot topilmadi.' });

      const qtyNum = Number(qty);
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        return sendJSON(res, 200, { ok: false, reason: 'Miqdorni to\'g\'ri kiriting.' });
      }
      if (qtyNum > centralItem.qty) {
        return sendJSON(res, 200, { ok: false, reason: `Markaziy skladda yetarli emas (bor: ${centralItem.qty} ${centralItem.unit}).` });
      }

      // Markaziy skladdan kamaytiriladi
      centralItem.qty = Math.round((centralItem.qty - qtyNum) * 1000) / 1000;
      addStockMovement(owner, {
        stockId: centralItem.id, stockName: centralItem.name, type: 'chiqim',
        qty: qtyNum, unit: centralItem.unit,
        note: `Filialga o'tkazildi: ${branch.name}`, userId
      });
      checkLowStockAlert(owner, centralItem, userId, null);

      // Filial skladiga qo'shiladi (nomi+birligi mos kelsa — ustiga, bo'lmasa — yangi yozuv)
      if (!branch.stock) branch.stock = [];
      let branchItem = branch.stock.find(s => s.name.toLowerCase() === centralItem.name.toLowerCase() && s.unit === centralItem.unit);
      if (branchItem) {
        branchItem.qty = Math.round((branchItem.qty + qtyNum) * 1000) / 1000;
      } else {
        branchItem = {
          id: crypto.randomBytes(4).toString('hex'),
          name: centralItem.name,
          qty: qtyNum,
          unit: centralItem.unit,
          price: centralItem.price || 0,
          minQty: null,
          lowStockAlertSent: false,
          addedAt: new Date().toISOString()
        };
        branch.stock.push(branchItem);
      }
      addStockMovement(branch, {
        stockId: branchItem.id, stockName: branchItem.name, type: 'kirim',
        qty: qtyNum, unit: branchItem.unit,
        note: 'Markaziy skladdan transfer', userId
      });
      checkLowStockAlert(owner, branchItem, userId, branchId);

      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, centralItem, branchItem });
    });
    return;
  }

  // ---- API: taom uchun retsept (ingredientlar) belgilash (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/menu-set-recipe') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, menuId, recipe } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi retsept belgilay oladi' });

      const menuItem = (owner.menu || []).find(m => m.id === menuId);
      if (!menuItem) return sendJSON(res, 200, { ok: false, reason: 'Taom topilmadi.' });
      if (!Array.isArray(recipe)) return sendJSON(res, 200, { ok: false, reason: 'Noto\'g\'ri retsept formati.' });
      // 12-bosqich: "to'g'ridan skladdan" turdagi taomga (directStockId
      // belgilangan) alohida retsept qo'shib bo'lmaydi — ikkalasi bir vaqtda
      // bo'lishi mumkin emas. Retseptni tozalash (bo'sh massiv yuborish) esa
      // ruxsat etiladi.
      if (menuItem.directStockId && recipe.length) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu taom "to\'g\'ridan skladdan" turida — unga alohida retsept qo\'shib bo\'lmaydi.' });
      }

      const cleanRecipe = [];
      for (const r of recipe) {
        const stockItem = findStockItem(owner, r.stockId);
        if (!stockItem) return sendJSON(res, 200, { ok: false, reason: 'Retseptda mavjud bo\'lmagan sklad mahsuloti bor.' });
        const qtyNum = Number(r.qty);
        if (!Number.isFinite(qtyNum) || qtyNum <= 0) return sendJSON(res, 200, { ok: false, reason: 'Retsept miqdori musbat son bo\'lishi kerak.' });
        cleanRecipe.push({ stockId: r.stockId, qty: qtyNum });
      }

      menuItem.recipe = cleanRecipe;
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, menuItem });
    });
    return;
  }

  // ---- API: kunlik audit topshirish (rejadagi vs haqiqiy qoldiq, farqlar avtomatik hisoblanadi) ----
  if (req.method === 'POST' && req.url === '/api/audit-submit') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, entries } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['egasi', 'sklad'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu amalga ruxsatingiz yo\'q' });
      }
      if (!Array.isArray(entries) || !entries.length) {
        return sendJSON(res, 200, { ok: false, reason: 'Audit uchun kamida bitta mahsulot kiriting.' });
      }

      const branchId = ctx.role === 'egasi' ? (payload.branchId || null) : ctx.branchId;
      const pool = resolveStockPool(ctx.owner, branchId);
      if (!pool) return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi' });

      const auditEntries = [];
      for (const e of entries) {
        const stockItem = findStockItem(pool, e.stockId);
        if (!stockItem) continue;
        const actualNum = Number(e.actualQty);
        if (!Number.isFinite(actualNum) || actualNum < 0) {
          return sendJSON(res, 200, { ok: false, reason: `${stockItem.name} uchun haqiqiy qoldiqni to\'g\'ri kiriting.` });
        }
        const systemQty = stockItem.qty;
        const diff = Math.round((actualNum - systemQty) * 1000) / 1000;
        auditEntries.push({ stockId: stockItem.id, name: stockItem.name, unit: stockItem.unit, systemQty, actualQty: actualNum, diff });

        if (diff !== 0) {
          addStockMovement(pool, {
            stockId: stockItem.id, stockName: stockItem.name, type: 'audit_tuzatish',
            qty: diff, unit: stockItem.unit,
            note: diff > 0 ? 'Audit: ortiqcha topildi' : 'Audit: kamomad topildi',
            userId
          });
        }
        stockItem.qty = actualNum;
        checkLowStockAlert(ctx.owner, stockItem, userId, branchId);
      }

      if (!auditEntries.length) {
        return sendJSON(res, 200, { ok: false, reason: 'Hech qanday mos mahsulot topilmadi.' });
      }

      if (!pool.audits) pool.audits = [];
      const audit = {
        id: crypto.randomBytes(4).toString('hex'),
        date: new Date().toISOString().slice(0, 10),
        branchId,
        entries: auditEntries,
        createdBy: userId,
        createdAt: new Date().toISOString()
      };
      pool.audits.unshift(audit);
      if (pool.audits.length > 60) pool.audits.length = 60;

      const kamomadCount = auditEntries.filter(e => e.diff < 0).length;
      const ortiqchaCount = auditEntries.filter(e => e.diff > 0).length;
      logStaffAction(ctx.owner, {
        userId, role: ctx.role, action: 'audit_topshirdi',
        note: `${auditEntries.length} mahsulot tekshirildi${kamomadCount ? `, ${kamomadCount} ta kamomad` : ''}${ortiqchaCount ? `, ${ortiqchaCount} ta ortiqcha` : ''}`,
        errorCount: kamomadCount
      });

      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, audit });
    });
    return;
  }

  // ---- API: audit tarixini olish ----
  if (req.method === 'POST' && req.url === '/api/audit-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['egasi', 'sklad'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'limni ko\'rishga ruxsatingiz yo\'q' });
      }

      const branchId = ctx.role === 'egasi' ? (payload.branchId || null) : ctx.branchId;
      const pool = resolveStockPool(ctx.owner, branchId);
      if (!pool) return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi' });

      return sendJSON(res, 200, { ok: true, audits: (pool.audits || []).slice(0, 30) });
    });
    return;
  }

  // ====== F. Moliya (Cashflow) — kirim (buyurtmalar savdosi) / chiqim (xarajatlar), kunlik/haftalik/oylik ======
  //
  // TUZATISH: ilgari "bugungi kun" ikki xil, bir-biriga mos kelmaydigan
  // usul bilan hisoblanardi — ba'zi joylarda serverning MAHALLIY vaqti
  // (`setHours(0,0,0,0)`), ba'zi joylarda esa (Z-hisobot, dailySeries
  // grafik kalitlari) UTC sanasi (`iso.slice(0,10)`). Server UTC vaqt
  // zonasida ishlab turganda bular sonlar jihatidan tasodifan mos tushib
  // qolardi-yu, ikkalasi ham haqiqiy Toshkent (UTC+5) mahalliy kuniga mos
  // KELMASDI (kun almashinuvi soat 00:00 emas, ~05:00da bo'lardi) — server
  // boshqa vaqt zonasida ishga tushirilsa esa ikkalasi bir-biriga zid
  // natija berishi mumkin edi.
  //
  // Endi BUTUN hisob-kitob shu bitta yordamchi to'plam orqali, doim
  // Toshkent (UTC+5, yil davomida DST'siz) mahalliy kuniga nisbatan
  // hisoblanadi — natija serverning qaysi vaqt zonasida ishga
  // tushirilishidan mustaqil bo'ladi, chunki hammasi mutlaq (UTC) lahza
  // sifatida qaytariladi va shu holda solishtiriladi.
  const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

  // Berilgan payt (Date | ISO-satr) Toshkent taqvimida qaysi kunga to'g'ri
  // kelishini "YYYY-MM-DD" qilib qaytaradi.
  function tzDateKey(input) {
    const d = (input instanceof Date) ? input : new Date(input);
    return new Date(d.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
  }

  // Berilgan "YYYY-MM-DD" Toshkent sanasining soat 00:00 (mahalliy) lahzasini
  // mutlaq (UTC) Date sifatida qaytaradi.
  function tzDayStartFromKey(dateKey) {
    return new Date(new Date(dateKey + 'T00:00:00.000Z').getTime() - TASHKENT_OFFSET_MS);
  }

  // Berilgan paytning Toshkent kuni boshlanish lahzasi.
  function tzDayStart(input) {
    return tzDayStartFromKey(tzDateKey(input));
  }

  // Toshkent haftasining boshlanishi (Dushanba, soat 00:00 mahalliy).
  function tzWeekStart(input) {
    const d = (input instanceof Date) ? input : new Date(input);
    const shifted = new Date(d.getTime() + TASHKENT_OFFSET_MS);
    const day = shifted.getUTCDay(); // 0=yakshanba,1=dushanba,...
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const mondayKey = new Date(shifted.getTime() + diffToMonday * 86400000).toISOString().slice(0, 10);
    return tzDayStartFromKey(mondayKey);
  }

  // Toshkent oyining boshlanishi (1-kun, soat 00:00 mahalliy).
  function tzMonthStart(input) {
    const d = (input instanceof Date) ? input : new Date(input);
    const shifted = new Date(d.getTime() + TASHKENT_OFFSET_MS);
    const monthKey = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
    return tzDayStartFromKey(monthKey);
  }

  // Berilgan sanadan (fromDate) buyon bo'lgan kirim/chiqim/foyda, buyurtmalar soni va xarajat kategoriyalari bo'yicha taqsimotni hisoblaydi
  // Kirim ikkiga ajratiladi: kassaIncome (stolga/olib ketish — kassada turgan pul) va dostavkaIncome (dostavka orqali — kuryer qo'lida, kassadan alohida)
  function cashflowBucket(owner, fromDate) {
    const orders = (owner.orders || []).filter(o => new Date(o.createdAt) >= fromDate);
    const expenses = (owner.expenses || []).filter(e => new Date(e.createdAt) >= fromDate);

    const dostavkaOrders = orders.filter(o => o.orderType === 'dostavka');
    const kassaOrders = orders.filter(o => o.orderType !== 'dostavka');
    const kassaIncome = kassaOrders.reduce((sum, o) => sum + orderIncomeAmount(o), 0);
    const dostavkaIncome = dostavkaOrders.reduce((sum, o) => sum + orderIncomeAmount(o), 0);
    const income = kassaIncome + dostavkaIncome;
    const expense = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    const byCategory = {};
    for (const key of Object.keys(EXPENSE_CATEGORIES)) byCategory[key] = 0;
    for (const e of expenses) {
      const cat = Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORIES, e.category) ? e.category : 'boshqa';
      byCategory[cat] = (byCategory[cat] || 0) + (e.amount || 0);
    }

    return {
      income, expense, net: income - expense, orderCount: orders.length, byCategory,
      kassaIncome, dostavkaIncome, dostavkaOrderCount: dostavkaOrders.length
    };
  }

  // Egaga tegishli to'liq cashflow hisobotini shakllantiradi: bugun/hafta/oy + oxirgi 14 kunlik seriya
  function computeCashflow(owner) {
    const now = new Date();
    const todayStart = tzDayStart(now);
    const weekStart = tzWeekStart(now);
    const monthStart = tzMonthStart(now);

    const orders = owner.orders || [];
    const expenses = owner.expenses || [];
    const dailySeries = [];
    // 14 kunlik seriya endi serverning mahalliy sana arifmetikasiga umuman
    // tayanmaydi — har bir kunning Toshkent yarim tuni lahzasi to'g'ridan-to'g'ri
    // `todayStart`dan aniq 86400000 ms qadamlar bilan hisoblanadi, shu bilan
    // grafik kalitlari yuqoridagi bugun/hafta/oy chegaralari bilan doim mos keladi.
    for (let i = 13; i >= 0; i--) {
      const dayStart = new Date(todayStart.getTime() - i * 86400000);
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      const key = tzDateKey(dayStart);
      const dayIncome = orders.filter(o => { const t = new Date(o.createdAt); return t >= dayStart && t < dayEnd; }).reduce((s, o) => s + orderIncomeAmount(o), 0);
      const dayExpense = expenses.filter(e => { const t = new Date(e.createdAt); return t >= dayStart && t < dayEnd; }).reduce((s, e) => s + (e.amount || 0), 0);
      dailySeries.push({ date: key, income: dayIncome, expense: dayExpense, net: dayIncome - dayExpense });
    }

    return {
      today: cashflowBucket(owner, todayStart),
      week: cashflowBucket(owner, weekStart),
      month: cashflowBucket(owner, monthStart),
      dailySeries
    };
  }

  // ---- API: xarajat (chiqim) qo'shish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/expense-add') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, amount, note, category } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi xarajat kirita oladi' });
      if (!ownerCanUseFeature(owner, 'expense-manage')) return sendJSON(res, 200, featureBlockedResult('expense-manage'));

      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        return sendJSON(res, 200, { ok: false, reason: 'Summani to\'g\'ri kiriting.' });
      }
      const categoryKey = Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORIES, category) ? category : 'boshqa';
      const noteStr = String(note || '').trim().slice(0, 200);

      if (!owner.expenses) owner.expenses = [];
      const expense = {
        id: crypto.randomBytes(4).toString('hex'),
        amount: amountNum,
        category: categoryKey,
        note: noteStr,
        createdAt: new Date().toISOString(),
        createdBy: userId
      };
      owner.expenses.unshift(expense);
      if (owner.expenses.length > 500) owner.expenses.length = 500;
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, expense });
    });
    return;
  }

  // ---- API: xarajat yozuvini o'chirish (faqat egasi, xato kiritilganda tuzatish uchun) ----
  if (req.method === 'POST' && req.url === '/api/expense-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'chira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const before = (owner.expenses || []).length;
      owner.expenses = (owner.expenses || []).filter(e => e.id !== id);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, removed: before !== owner.expenses.length });
    });
    return;
  }

  // ---- API: umumiy cashflow — kirim (savdo) / chiqim (xarajat), kunlik/haftalik/oylik hisobot (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/cashflow') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });

      const cashflow = computeCashflow(owner);
      const recentExpenses = (owner.expenses || []).slice(0, 30);

      return sendJSON(res, 200, { ok: true, cashflow, expenses: recentExpenses, categories: EXPENSE_CATEGORIES });
    });
    return;
  }

  // ---- API: KitchenOS bosh sahifa uchun kunlik xulosa (4-bosqich) —
  // bugungi savdo / sof foyda / buyurtmalar / kuryer yetkazishlari va
  // shularni kechagi kunga solishtirish uchun kechagi qiymatlar (faqat
  // egasi). Foizni hisoblash frontend tomonda (7-8-bosqich) qilinadi — bu
  // yerda faqat xom raqamlar qaytariladi. (6-bosqich: "o'rtacha chek" maydoni
  // olib tashlandi — Dashboard kartochkasi 3-bosqichda "Kuryer hisoboti"ga
  // almashtirilgani uchun endi hech qayerda ishlatilmas edi.) ----
  if (req.method === 'POST' && req.url === '/api/dashboard-summary') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });

      const now = new Date();
      const todayStart = tzDayStart(now);
      const yesterdayStart = new Date(todayStart.getTime() - 86400000);

      // Bugun: mavjud cashflowBucket'dan foydalanamiz (yuqori chegarasiz —
      // kelajakdagi sanali buyurtma bo'lmagani uchun bu xavfsiz).
      const today = cashflowBucket(owner, todayStart);

      // Kecha: FAQAT kecha kuni (bugungi kunni kiritmaslik uchun ikki
      // tomonlama chegara kerak) — shu sababli alohida hisoblanadi.
      const yesterdayOrders = (owner.orders || []).filter(o => {
        const d = new Date(o.createdAt);
        return d >= yesterdayStart && d < todayStart;
      });
      const yesterdayIncome = yesterdayOrders.reduce((s, o) => s + orderIncomeAmount(o), 0);
      const yesterdayExpense = (owner.expenses || []).filter(e => {
        const d = new Date(e.createdAt);
        return d >= yesterdayStart && d < todayStart;
      }).reduce((s, e) => s + (e.amount || 0), 0);

      // 3-bosqich: Dashboarddagi "Kuryer hisoboti" KPI kartochkasi uchun —
      // bugun va kecha KURYER TOMONIDAN YETKAZIB BERILGAN dostavka
      // buyurtmalari soni. To'liq (har bir kuryer bo'yicha) hisobot allaqachon
      // /api/courier-report'da bor — bu yerda faqat kartochkaga bitta
      // umumlashtirilgan son kerak.
      const todayCourierDeliveries = (owner.orders || []).filter(o =>
        o.orderType === 'dostavka' && o.deliveredBy && new Date(o.deliveredAt || o.createdAt) >= todayStart).length;
      const yesterdayCourierDeliveries = (owner.orders || []).filter(o => {
        if (o.orderType !== 'dostavka' || !o.deliveredBy) return false;
        const d = new Date(o.deliveredAt || o.createdAt);
        return d >= yesterdayStart && d < todayStart;
      }).length;

      const summary = {
        todaySales: today.income,
        yesterdaySales: yesterdayIncome,
        todayNetProfit: today.net,
        yesterdayNetProfit: yesterdayIncome - yesterdayExpense,
        todayOrderCount: today.orderCount,
        yesterdayOrderCount: yesterdayOrders.length,
        todayCourierDeliveries,
        yesterdayCourierDeliveries
      };

      return sendJSON(res, 200, { ok: true, summary });
    });
    return;
  }

  // ---- API: KitchenOS bosh sahifa uchun buyurtma holat-sonlari (5-bosqich) —
  // "Bugungi holat" bannerida ko'rsatiladigan Yangi / Tayyorlanmoqda / Tayyor /
  // Kechikayotgan sonlari (faqat egasi). "Kechikayotgan" alohida saqlangan
  // status emas — ORDER_DELAY_THRESHOLD_MINUTES'dan hisoblab chiqariladi va
  // shu daqiqadan o'tib ketgan "yangi"/"tayyorlanmoqda" buyurtmalar
  // Yangi/Tayyorlanmoqda sonidan chiqarilib, shu yerga qo'shiladi (ikki marta
  // hisoblanmasligi uchun). ----
  if (req.method === 'POST' && req.url === '/api/order-status-counts') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });

      const now = new Date();
      const todayStart = tzDayStart(now);
      const thresholdMs = ORDER_DELAY_THRESHOLD_MINUTES * 60 * 1000;

      const todaysOrders = (owner.orders || []).filter(o => new Date(o.createdAt) >= todayStart);

      let yangi = 0, tayyorlanmoqda = 0, tayyor = 0, kechikayotgan = 0;
      for (const o of todaysOrders) {
        if (o.status === 'tayyor') { tayyor += 1; continue; }
        const ageMs = now - new Date(o.createdAt);
        if (ageMs > thresholdMs) { kechikayotgan += 1; continue; }
        if (o.status === 'tayyorlanmoqda') tayyorlanmoqda += 1;
        else yangi += 1; // status hali belgilanmagan yoki 'yangi'
      }

      return sendJSON(res, 200, {
        ok: true,
        counts: { yangi, tayyorlanmoqda, tayyor, kechikayotgan },
        delayThresholdMinutes: ORDER_DELAY_THRESHOLD_MINUTES
      });
    });
    return;
  }

  // ---- API: KitchenOS bosh sahifa uchun "Muhim ogohlantirishlar" (6-bosqich,
  // faqat egasi). Uchta narsa BITTALAB tekshiriladi va faqat DOLZARB
  // bo'lganlari (count > 0 yoki holat true) ro'yxatga qo'shiladi, shu
  // sababli natija har doim mockupdagi kabi 0 dan 3 tagacha element:
  //   1) tugayotgan ombor mahsulotlari — item.qty <= item.minQty (markaziy
  //      sklad + BARCHA filiallar birga, chunki egasi uchun bittagina umumiy
  //      ogohlantirish kifoya - qaysi joyda ekanini "Ombor" ekranining o'zi
  //      ko'rsatadi)
  //   2) kechikayotgan buyurtmalar — /api/order-status-counts'dagi bilan
  //      AYNAN BIR XIL hisoblash mantig'i (ORDER_DELAY_THRESHOLD_MINUTES)
  //   3) bugungi Z-hisobot hali yopilmagan — owner.zReports'da bugungi
  //      sana (YYYY-MM-DD) uchun yozuv yo'qligi
  // `screen` maydoni - 13-bosqichda bosilganda qaysi ekranga o'tish
  // kerakligini bildiradi uchun oldindan qo'shib qo'yildi.
  if (req.method === 'POST' && req.url === '/api/dashboard-alerts') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });

      const alerts = [];

      // 1) Tugayotgan ombor mahsulotlari (markaziy sklad + barcha filiallar)
      const stockPools = [owner, ...(owner.branches || [])];
      let lowStockCount = 0;
      for (const pool of stockPools) {
        for (const item of (pool.stock || [])) {
          if (item.minQty === null || item.minQty === undefined) continue;
          if (item.qty <= item.minQty) lowStockCount += 1;
        }
      }
      if (lowStockCount > 0) {
        alerts.push({
          type: 'low_stock', level: 'error', text: 'Tugayotgan mahsulotlar bor',
          count: lowStockCount, screen: 'ombor'
        });
      }

      // 2) Kechikayotgan buyurtmalar (bugungi, /api/order-status-counts bilan bir xil mantiq)
      const now = new Date();
      const todayStart = tzDayStart(now);
      const thresholdMs = ORDER_DELAY_THRESHOLD_MINUTES * 60 * 1000;
      const todaysOrders = (owner.orders || []).filter(o => new Date(o.createdAt) >= todayStart);
      let delayedCount = 0;
      for (const o of todaysOrders) {
        if (o.status === 'tayyor') continue;
        if ((now - new Date(o.createdAt)) > thresholdMs) delayedCount += 1;
      }
      if (delayedCount > 0) {
        alerts.push({
          type: 'delayed_orders', level: 'warning', text: 'Kechikayotgan buyurtmalar',
          count: delayedCount, screen: 'buyurtmalar_kechikkan'
        });
      }

      // 3) Bugungi Z-hisobot (kunlik yakuniy hisobot) hali yopilmaganmi.
      // TUZATISH: ilgari bu yerda `now.toISOString().slice(0,10)` (UTC sana)
      // ishlatilardi — yuqoridagi "bugun" (todayStart, endi tzDayStart orqali)
      // bilan bir xil funksiya ichida ikki xil kun tushunchasi aralashib
      // ketardi. Endi ikkalasi ham bir xil tzDateKey manbaidan keladi.
      const todayDateKey = tzDateKey(now);
      const dailyReportClosed = (owner.zReports || []).some(z => z.date === todayDateKey);
      if (!dailyReportClosed) {
        alerts.push({
          type: 'daily_report_open', level: 'info', text: 'Bugungi kun yakuni uchun hisob yopilmagan',
          count: null, screen: 'zreport'
        });
      }

      return sendJSON(res, 200, { ok: true, alerts });
    });
    return;
  }

  // Davr nomidan (bugun/hafta/oy/hammasi) boshlanish sanasini qaytaradi — cashflow va kuryerlar hisoboti uchun umumiy
  function resolvePeriodStart(period) {
    const now = new Date();
    if (period === 'week') return tzWeekStart(now);
    if (period === 'month') return tzMonthStart(now);
    if (period === 'all') return new Date(0);
    return tzDayStart(now);
  }

  // ---- API: filiallar kesimida solishtiruv hisobot — qaysi filial ko'proq sotmoqda (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/branch-report') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, period } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });

      const fromDate = resolvePeriodStart(period);
      const orders = (owner.orders || []).filter(o => new Date(o.createdAt) >= fromDate);

      const buckets = new Map();
      buckets.set(null, { branchId: null, branchName: 'Markaziy', orderCount: 0, income: 0, kassaIncome: 0, dostavkaIncome: 0 });
      for (const b of (owner.branches || [])) {
        buckets.set(b.id, { branchId: b.id, branchName: b.name, orderCount: 0, income: 0, kassaIncome: 0, dostavkaIncome: 0 });
      }

      for (const o of orders) {
        const key = buckets.has(o.branchId || null) ? (o.branchId || null) : null;
        const bucket = buckets.get(key);
        bucket.orderCount += 1;
        bucket.income += orderIncomeAmount(o);
        if (o.orderType === 'dostavka') bucket.dostavkaIncome += orderIncomeAmount(o);
        else bucket.kassaIncome += orderIncomeAmount(o);
      }

      const report = Array.from(buckets.values())
        .map(b => Object.assign({}, b, { avgCheck: b.orderCount ? Math.round(b.income / b.orderCount) : 0 }))
        .sort((a, b) => b.income - a.income);

      return sendJSON(res, 200, { ok: true, report });
    });
    return;
  }

  // ---- API: kuryerlar bo'yicha hisobot — nechta buyurtma, qancha pul, komissiya (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/courier-report') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, period } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !isOwnerAccessValid(ctx.owner) || ctx.role !== 'egasi') return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });
      const owner = ctx.owner;

      const fromDate = resolvePeriodStart(period);
      const commissionPercent = Number.isFinite(owner.courierCommissionPercent) ? owner.courierCommissionPercent : 10;

      const couriers = (owner.staff || []).filter(s => staffHasRole(s, 'dostavka'));
      const deliveredOrders = (owner.orders || []).filter(o =>
        o.orderType === 'dostavka' && o.deliveredBy && new Date(o.deliveredAt || o.createdAt) >= fromDate);

      const report = couriers.map(c => {
        const mine = deliveredOrders.filter(o => String(o.deliveredBy) === String(c.id));
        const totalAmount = mine.reduce((sum, o) => sum + (o.total || 0), 0);
        // Kuryerning qo'lida hali topshirilmagan naqd/dostavka orqali pul —
        // egasi "Pulni oldim" tugmasini bosmaguncha shu summa daromadga qo'shilmaydi.
        const pendingAmount = mine
          .filter(o => o.paymentType === 'dostavka_orqali' && o.courierCashCollected === false)
          .reduce((sum, o) => sum + (o.total || 0), 0);
        return {
          id: c.id,
          username: c.username || null,
          orderCount: mine.length,
          totalAmount,
          pendingAmount,
          commission: Math.round(totalAmount * commissionPercent / 100)
        };
      });
      report.sort((a, b) => b.orderCount - a.orderCount);

      const recentMovements = (owner.cashMovements || [])
        .filter(m => m.type === 'kuryer_kassaga_qaytarish')
        .slice(0, 20);

      return sendJSON(res, 200, { ok: true, report, commissionPercent, recentMovements });
    });
    return;
  }

  // ---- API: kuryerlar komissiya foizini o'zgartirish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/set-courier-commission') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, percent } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'zgartira oladi' });

      const p = Number(percent);
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        return sendJSON(res, 200, { ok: false, reason: 'Komissiya foizi 0 dan 100 gacha bo\'lishi kerak.' });
      }
      owner.courierCommissionPercent = p;
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, commissionPercent: p });
    });
    return;
  }

  // ---- API: kuryerdan naqd pulni "oldim" deb belgilash (faqat egasi) ----
  // Kuryer "dostavka orqali" to'lovda mijozdan naqd pulni o'zi qo'lida
  // ushlab turadi. Egasi shu pulni jismonan kuryerdan olganda shu API
  // chaqiriladi — shundan keyingina bu buyurtmalar summasi daromad
  // hisobotlariga (Z-hisobot, cashflow, filiallar hisoboti) qo'shiladi.
  // Karta orqali to'langan buyurtmalarga bu umuman tegishli emas — ular
  // har doim darhol daromadga qo'shilgan bo'ladi.
  if (req.method === 'POST' && req.url === '/api/courier-collect-cash') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, courierId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !isOwnerAccessValid(ctx.owner) || ctx.role !== 'egasi') return sendJSON(res, 200, { ok: false, reason: 'Bu amalni faqat oshxona egasi bajara oladi' });
      const owner = ctx.owner;

      if (!courierId) return sendJSON(res, 200, { ok: false, reason: 'Kuryer tanlanmagan.' });

      let collected = 0;
      let count = 0;
      for (const o of (owner.orders || [])) {
        if (o.orderType === 'dostavka' && o.paymentType === 'dostavka_orqali' &&
            String(o.deliveredBy) === String(courierId) && o.courierCashCollected === false) {
          o.courierCashCollected = true;
          o.courierCashCollectedAt = new Date().toISOString();
          collected += (o.total || 0);
          count++;
        }
      }

      // Har bir "kassaga qaytarish" amalini alohida jurnalga yozib boramiz —
      // kim, qachon, qaysi kuryerdan, qancha pul qaytarganini keyin ko'rish uchun.
      if (count > 0) {
        if (!Array.isArray(owner.cashMovements)) owner.cashMovements = [];
        const courierStaff = (owner.staff || []).find(s => String(s.id) === String(courierId));
        owner.cashMovements.unshift({
          id: crypto.randomBytes(6).toString('hex'),
          type: 'kuryer_kassaga_qaytarish',
          courierId: String(courierId),
          courierUsername: (courierStaff && courierStaff.username) || null,
          amount: collected,
          orderCount: count,
          confirmedBy: userId,
          createdAt: new Date().toISOString()
        });
        // Jurnal cheksiz o'smasligi uchun oxirgi 200 tasini saqlaymiz
        if (owner.cashMovements.length > 200) owner.cashMovements.length = 200;
      }

      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, collected, count });
    });
    return;
  }

  // ====== Kunlik yakuniy hisobot (Z-hisobot) — savdo, xarajat, sof foyda, to'lov turlari bo'yicha ======
  function buildZReport(owner, dateKey) {
    const dayStart = tzDayStartFromKey(dateKey);
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    const orders = (owner.orders || []).filter(o => {
      const t = new Date(o.createdAt);
      return t >= dayStart && t < dayEnd;
    });
    const expenses = (owner.expenses || []).filter(e => {
      const t = new Date(e.createdAt);
      return t >= dayStart && t < dayEnd;
    });

    const dostavkaOrders = orders.filter(o => o.orderType === 'dostavka');
    const kassaOrders = orders.filter(o => o.orderType !== 'dostavka');
    const kassaIncome = kassaOrders.reduce((s, o) => s + orderIncomeAmount(o), 0);
    const dostavkaIncome = dostavkaOrders.reduce((s, o) => s + orderIncomeAmount(o), 0);
    const income = kassaIncome + dostavkaIncome;

    const paymentBreakdown = {};
    for (const key of Object.keys(PAYMENT_TYPES)) paymentBreakdown[key] = 0;
    for (const o of orders) {
      const pt = Object.prototype.hasOwnProperty.call(PAYMENT_TYPES, o.paymentType) ? o.paymentType : 'naqd';
      paymentBreakdown[pt] = (paymentBreakdown[pt] || 0) + orderIncomeAmount(o);
    }

    const expenseByCategory = {};
    for (const key of Object.keys(EXPENSE_CATEGORIES)) expenseByCategory[key] = 0;
    for (const e of expenses) {
      const cat = Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORIES, e.category) ? e.category : 'boshqa';
      expenseByCategory[cat] = (expenseByCategory[cat] || 0) + (e.amount || 0);
    }
    const expense = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    return {
      date: dateKey,
      income, kassaIncome, dostavkaIncome, orderCount: orders.length,
      paymentBreakdown, expense, expenseByCategory, net: income - expense
    };
  }

  // ---- API: bugungi kunlik Z-hisobotni yaratish/yopish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/z-report-create') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });
      if (!ownerCanUseFeature(owner, 'z-report')) return sendJSON(res, 200, featureBlockedResult('z-report'));

      const dateKey = tzDateKey(new Date());
      const built = buildZReport(owner, dateKey);

      if (!owner.zReports) owner.zReports = [];
      const existing = owner.zReports.find(z => z.date === dateKey);
      const report = Object.assign({
        id: existing ? existing.id : crypto.randomBytes(4).toString('hex'),
        createdAt: new Date().toISOString(),
        createdBy: userId
      }, built);

      if (existing) {
        Object.assign(existing, report); // shu kun uchun qayta yopilsa — yangilanadi
      } else {
        owner.zReports.unshift(report);
      }
      if (owner.zReports.length > 90) owner.zReports.length = 90;
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, report, wasUpdate: !!existing });
    });
    return;
  }

  // ---- API: saqlangan Z-hisobotlar tarixini olish (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/z-report-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });

      const reports = (owner.zReports || []).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
      return sendJSON(res, 200, { ok: true, reports });
    });
    return;
  }

  // ====== H. AI analitika (32-34-bosqich): top taomlar, pik vaqtlar, ertangi sklad ehtiyoji, AI savol-javob ======
  const UZ_WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

  // Eng ko'p sotilgan taomlar — miqdor va tushum bo'yicha (berilgan sanadan buyon)
  function computeTopItems(owner, fromDate, limit) {
    const orders = (owner.orders || []).filter(o => new Date(o.createdAt) >= fromDate);
    const byId = new Map();
    for (const o of orders) {
      for (const it of (o.items || [])) {
        const cur = byId.get(it.id) || { id: it.id, name: it.name, qty: 0, revenue: 0 };
        cur.qty += it.qty;
        cur.revenue += it.price * it.qty;
        byId.set(it.id, cur);
      }
    }
    return Array.from(byId.values()).sort((a, b) => b.qty - a.qty).slice(0, limit || 5);
  }

  // Soatlik pik vaqtlar (0-23) va haftalik pik kunlar (0=Yakshanba..6=Shanba) — buyurtmalar soni bo'yicha
  function computePeakTimes(owner, fromDate) {
    const orders = (owner.orders || []).filter(o => new Date(o.createdAt) >= fromDate);
    const byHour = new Array(24).fill(0);
    const byDay = new Array(7).fill(0);
    for (const o of orders) {
      const d = new Date(o.createdAt);
      byHour[d.getHours()]++;
      byDay[d.getDay()]++;
    }
    const hours = byHour.map((count, hour) => ({ hour, count })).sort((a, b) => b.count - a.count);
    const days = byDay.map((count, day) => ({ day, dayLabel: UZ_WEEKDAYS[day], count })).sort((a, b) => b.count - a.count);
    return { byHour, byDay, topHours: hours.filter(h => h.count > 0).slice(0, 3), topDays: days.filter(d => d.count > 0).slice(0, 3) };
  }

  // Ertangi kun uchun taxminiy sklad ehtiyoji — oxirgi 7 kunlik "chiqim" (buyurtma orqali sarflangan) harakatlar o'rtachasi asosida
  function computeStockForecast(owner, branchId) {
    const pool = resolveStockPool(owner, branchId || null);
    if (!pool) return [];
    const since = new Date(Date.now() - 7 * 86400000);
    const usageById = new Map();
    for (const m of (pool.stockMovements || [])) {
      if (m.type !== 'chiqim') continue;
      if (!m.note || !m.note.startsWith('Buyurtma:')) continue;
      if (new Date(m.createdAt) < since) continue;
      usageById.set(m.stockId, (usageById.get(m.stockId) || 0) + m.qty);
    }
    const forecast = [];
    for (const item of (pool.stock || [])) {
      const used7d = usageById.get(item.id) || 0;
      if (used7d <= 0) continue; // ishlatilmagan mahsulot uchun prognoz chiqarmaymiz
      const avgDaily = Math.round((used7d / 7) * 1000) / 1000;
      const predictedNeed = Math.round(avgDaily * 1000) / 1000;
      forecast.push({
        stockId: item.id, name: item.name, unit: item.unit,
        currentQty: item.qty, avgDailyUsage: avgDaily, predictedNeed,
        shortage: item.qty < predictedNeed
      });
    }
    forecast.sort((a, b) => (b.shortage - a.shortage) || (b.avgDailyUsage - a.avgDailyUsage));
    return forecast;
  }

  // Anthropic (Claude) API orqali erkin savolga javob — faqat ANTHROPIC_API_KEY sozlangan bo'lsa ishlaydi
  function callAnthropicApi(systemPrompt, userText) {
    return new Promise((resolve, reject) => {
      if (!ANTHROPIC_API_KEY) return reject(new Error('ANTHROPIC_API_KEY sozlanmagan'));
      const body = JSON.stringify({
        model: AI_MODEL,
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }]
      });
      const reqOptions = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const apiReq = https.request(reqOptions, apiRes => {
        let data = '';
        apiRes.on('data', chunk => { data += chunk; });
        apiRes.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = (parsed.content || []).map(c => c.text || '').join('\n').trim();
            if (!text) return reject(new Error('AI javob bo\'sh qaytdi'));
            resolve(text);
          } catch (e) { reject(e); }
        });
      });
      apiReq.on('error', reject);
      apiReq.write(body);
      apiReq.end();
    });
  }

  // AI kaliti sozlanmagan (yoki xato bergan) holatda ishlaydigan, tayyor qoidalar asosidagi javob generatori
  function ruleBasedAiAnswer(question, ctx) {
    const q = String(question || '').toLowerCase();

    if (/bugun/.test(q) && /foyda|savdo|kirim/.test(q)) {
      return `Bugungi kirim: ${ctx.cashflow.today.income} so'm, xarajat: ${ctx.cashflow.today.expense} so'm, sof foyda: ${ctx.cashflow.today.net} so'm (${ctx.cashflow.today.orderCount} ta buyurtma).`;
    }
    if (/hafta/.test(q) && /foyda|savdo|kirim/.test(q)) {
      return `Shu hafta kirim: ${ctx.cashflow.week.income} so'm, xarajat: ${ctx.cashflow.week.expense} so'm, sof foyda: ${ctx.cashflow.week.net} so'm (${ctx.cashflow.week.orderCount} ta buyurtma).`;
    }
    if (/oy/.test(q) && /foyda|savdo|kirim/.test(q)) {
      return `Shu oy kirim: ${ctx.cashflow.month.income} so'm, xarajat: ${ctx.cashflow.month.expense} so'm, sof foyda: ${ctx.cashflow.month.net} so'm (${ctx.cashflow.month.orderCount} ta buyurtma).`;
    }
    if (/top|eng ko'p sotilgan|mashhur|qaysi taom/.test(q)) {
      if (!ctx.topItems.length) return 'Hozircha (so\'nggi 30 kunda) buyurtma tarixi yo\'q.';
      const list = ctx.topItems.slice(0, 3).map((it, i) => `${i + 1}. ${it.name} — ${it.qty} dona (${it.revenue} so'm)`).join('\n');
      return `Eng ko'p sotilgan taomlar (so'nggi 30 kun):\n${list}`;
    }
    if (/pik|band vaqt|qaysi soat|eng gavjum/.test(q)) {
      if (!ctx.peak.topHours.length) return 'Hozircha buyurtma tarixi yo\'q.';
      const h = ctx.peak.topHours[0];
      return `Eng band soat: ${h.hour}:00 atrofida (${h.count} ta buyurtma, so'nggi 30 kun). Eng band kun: ${ctx.peak.topDays[0] ? ctx.peak.topDays[0].dayLabel : 'ma\'lumot yo\'q'}.`;
    }
    if (/kam qolgan|tugab qolayotgan|sklad|zaxira/.test(q)) {
      const low = (ctx.forecast || []).filter(f => f.shortage);
      if (!low.length) return 'Hozircha ertangi kunga yetarli zaxira bor ko\'rinadi (oxirgi 7 kunlik iste\'mol bo\'yicha).';
      const list = low.slice(0, 5).map(f => `• ${f.name}: bor ${f.currentQty} ${f.unit}, kunlik o'rtacha sarf ${f.avgDailyUsage} ${f.unit}`).join('\n');
      return `Ertaga yetishmasligi mumkin bo'lgan mahsulotlar:\n${list}`;
    }

    // Umumiy so'rovlarga qisqa umumiy hisobot bilan javob beramiz
    const topLine = ctx.topItems[0] ? `Eng ko'p sotilgan: ${ctx.topItems[0].name}.` : '';
    return `Aniq javob topa olmadim, lekin umumiy holat shunday: bugungi sof foyda ${ctx.cashflow.today.net} so'm, shu hafta ${ctx.cashflow.week.net} so'm. ${topLine} Aniqroq javob uchun "bugun foyda qancha", "eng ko'p sotilgan taom", "pik vaqt qachon" yoki "sklad kam qolganmi" kabi savol bering.`;
  }

  // ---- API: AI analitika — top taomlar, pik vaqtlar, ertangi sklad ehtiyoji (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/ai-analytics') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, period, branchId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });
      if (!ownerCanUseFeature(owner, 'ai-analytics')) return sendJSON(res, 200, featureBlockedResult('ai-analytics'));

      const fromDate = resolvePeriodStart(period || 'week');
      const topItems = computeTopItems(owner, fromDate, 8);
      const peak = computePeakTimes(owner, fromDate);
      const forecast = computeStockForecast(owner, branchId || null);

      return sendJSON(res, 200, {
        ok: true,
        period: period || 'week',
        topItems,
        peakHours: peak.byHour,
        peakDays: peak.byDay,
        topHours: peak.topHours,
        topDays: peak.topDays,
        forecast
      });
    });
    return;
  }

  // ---- API: AI Direktor - hozirgi holatga qarab hisobotni OLDINDAN KO'RISH
  // (Mini App'da matn sifatida ko'rsatish uchun, Telegram'ga yubormasdan) ----
  if (req.method === 'POST' && req.url === '/api/ai-director-preview') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });
      if (!ownerCanUseFeature(owner, 'ai-director')) return sendJSON(res, 200, featureBlockedResult('ai-director'));

      return sendJSON(res, 200, {
        ok: true,
        text: buildAiDirectorText(owner),
        enabled: owner.aiDirectorEnabled !== false,
        sentToday: owner.aiDirectorLastSent === aiDirDateKey(new Date()),
        hour: AI_DIRECTOR_HOUR
      });
    });
    return;
  }

  // ---- API: AI Direktor hisobotini HOZIR (Telegram'ga) yuborish ----
  if (req.method === 'POST' && req.url === '/api/ai-director-send-now') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });
      if (!ownerCanUseFeature(owner, 'ai-director')) return sendJSON(res, 200, featureBlockedResult('ai-director'));

      sendAiDirectorDigest(owner, true).then(() => {
        saveOwners(owners);
        sendJSON(res, 200, { ok: true });
      }).catch(() => sendJSON(res, 200, { ok: false, reason: 'Yuborishda xatolik yuz berdi.' }));
    });
    return;
  }

  // ---- API: AI Direktorning har tongi (soat 08:00, Toshkent) avtomatik
  // xabarini yoqish/o'chirish ----
  if (req.method === 'POST' && req.url === '/api/ai-director-toggle') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, enabled } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });
      if (!ownerCanUseFeature(owner, 'ai-director')) return sendJSON(res, 200, featureBlockedResult('ai-director'));

      owner.aiDirectorEnabled = !!enabled;
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, enabled: owner.aiDirectorEnabled });
    });
    return;
  }

  // ---- API: AI orqali erkin savolga qisqa javob (faqat egasi). ANTHROPIC_API_KEY bo'lmasa — qoidaviy javob beradi ----
  if (req.method === 'POST' && req.url === '/api/ai-ask') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, question } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });
      if (!ownerCanUseFeature(owner, 'ai-analytics')) return sendJSON(res, 200, featureBlockedResult('ai-analytics'));

      const qTrim = String(question || '').trim();
      if (!qTrim) return sendJSON(res, 200, { ok: false, reason: 'Savolingizni kiriting.' });
      if (qTrim.length > 300) return sendJSON(res, 200, { ok: false, reason: 'Savol juda uzun (300 belgigacha).' });

      const monthAgo = new Date(Date.now() - 30 * 86400000);
      const ctx = {
        cashflow: computeCashflow(owner),
        topItems: computeTopItems(owner, monthAgo, 10),
        peak: computePeakTimes(owner, monthAgo),
        forecast: computeStockForecast(owner, null)
      };

      if (!ANTHROPIC_API_KEY) {
        return sendJSON(res, 200, { ok: true, answer: ruleBasedAiAnswer(qTrim, ctx), source: 'qoida' });
      }

      const systemPrompt = 'Sen oshxona (restoran) egasiga o\'zbek tilida yordam beruvchi qisqa AI tahlilchisan. ' +
        'Faqat berilgan JSON ma\'lumotlar asosida javob ber, o\'ylab topma. 2-4 gaplik, aniq raqamlar bilan qisqa javob yoz.\n' +
        'Ma\'lumotlar (JSON):\n' + JSON.stringify(ctx);

      try {
        const answer = await callAnthropicApi(systemPrompt, qTrim);
        return sendJSON(res, 200, { ok: true, answer, source: 'ai' });
      } catch (e) {
        return sendJSON(res, 200, { ok: true, answer: ruleBasedAiAnswer(qTrim, ctx), source: 'qoida' });
      }
    });
    return;
  }

  // ---- API: xodimning amallar jurnali — kim, qachon, nima qildi (faqat egasi, so'nggi yozuvlar) ----
  if (req.method === 'POST' && req.url === '/api/staff-activity-log') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, staffId, limit } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });

      const staffById = new Map((owner.staff || []).map(s => [String(s.id), s]));
      let log = owner.staffActionLog || [];
      if (staffId) log = log.filter(e => String(e.userId) === String(staffId));

      const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
      const entries = log.slice(0, lim).map(e => {
        const isOwnerEntry = String(e.userId) === String(owner.id);
        const staff = staffById.get(String(e.userId));
        return Object.assign({}, e, {
          displayName: isOwnerEntry ? 'Egasi' : (staff ? staffDisplayName(staff) : `ID: ${e.userId}`),
          roleLabel: isOwnerEntry ? 'Egasi' : (STAFF_ROLES[e.role] || e.role)
        });
      });

      return sendJSON(res, 200, { ok: true, entries, staff: owner.staff || [] });
    });
    return;
  }

  // ---- API: 17-bosqich — Telegramga yuborilmagan bildirishnomalar jurnali
  // (masalan: xodim botga /start bosmagan yoki uni block qilgan) — faqat
  // egasi ko'radi. owner.notificationErrors notifyStaffList() tomonidan
  // to'ldiriladi (qarang: sendMessage/notifyStaffList yuqorida). ----
  if (req.method === 'POST' && req.url === '/api/notification-error-log') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });

      return sendJSON(res, 200, { ok: true, entries: owner.notificationErrors || [] });
    });
    return;
  }

  // ---- API: bildirishnoma xatolari jurnalini tozalash (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/notification-error-log-clear') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });

      owner.notificationErrors = [];
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: 30 kunlik (yoki tanlangan davr) xodimlar faoliyati hisoboti + reyting (faqat egasi) ----
  if (req.method === 'POST' && req.url === '/api/staff-performance-report') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, period } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });

      const fromDate = resolvePeriodStart(period || 'month');
      const log = (owner.staffActionLog || []).filter(e => new Date(e.createdAt) >= fromDate);

      const report = (owner.staff || []).map(staff => {
        const mine = log.filter(e => String(e.userId) === String(staff.id));
        const actionCount = mine.length;
        const errorCount = mine.reduce((sum, e) => sum + (e.errorCount || 0), 0);
        const lastActiveAt = mine.length ? mine.reduce((max, e) => e.createdAt > max ? e.createdAt : max, mine[0].createdAt) : null;
        return {
          id: staff.id,
          username: staff.username || null,
          fullName: staffDisplayName(staff),
          role: staff.role,
          roles: normalizeStaffRoles(staff),
          roleLabel: rolesLabel(normalizeStaffRoles(staff)),
          actionCount, errorCount, lastActiveAt,
          score: actionCount - errorCount * 2
        };
      });

      report.sort((a, b) => b.score - a.score);
      if (report.length && report[0].actionCount > 0) report[0].isTop = true;

      return sendJSON(res, 200, { ok: true, report, period: period || 'month' });
    });
    return;
  }

  // ---- API: do'kon egasining o'z profilini olish ----
  if (req.method === 'POST' && req.url === '/api/my-profile') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      if (isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Admin uchun profil mavjud emas' });

      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q yoki muddati tugagan' });

      // 58-bosqich: do'kon egasi o'z profilida joriy tarifini ko'rishi uchun
      // tariff nomi ham shu javobga qo'shiladi (tariffId bo'lmasa yoki
      // o'chirilgan bo'lsa — null).
      let tariffInfo = null;
      if (owner.tariffId) {
        const tariff = loadTariffs().find(t => t.id === owner.tariffId);
        if (tariff) tariffInfo = { id: tariff.id, name: tariff.name };
      }

      return sendJSON(res, 200, { ok: true, profile: owner.profile || null, tariff: tariffInfo });
    });
    return;
  }

  // ---- API: do'kon egasi o'z profilini to'ldiradi/yangilaydi ----
  if (req.method === 'POST' && req.url === '/api/save-profile') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, name, address, phone, workHours, logoUrl, brandColor } = payload;
      const check = verifyAuth(initData);
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
      const brandColorTrim = String(brandColor || '').trim();

      if (!nameTrim) return sendJSON(res, 200, { ok: false, reason: 'Oshxona nomini kiriting.' });
      if (!addressTrim) return sendJSON(res, 200, { ok: false, reason: 'Manzilni kiriting.' });
      if (!phoneTrim || !/^[\d+\-\s()]{6,20}$/.test(phoneTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Telefon raqamini to\'g\'ri kiriting.' });
      }
      if (logoTrim && !isValidImageValue(logoTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Logotip rasmi noto\'g\'ri yoki hajmi juda katta. Boshqa rasm tanlang.' });
      }
      if (brandColorTrim && !/^#[0-9A-Fa-f]{6}$/.test(brandColorTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Brend rangi noto\'g\'ri formatda (masalan #E4232A).' });
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
        brandColor: brandColorTrim || null,
        completedAt: wasCompleted ? target.profile.completedAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      saveOwners(owners2);

      return sendJSON(res, 200, { ok: true, profile: target.profile });
    });
    return;
  }

  // ---- API: do'kon egalari ro'yxatini olish (faqat admin) ----
  // MUHIM: passwordHash/sessionToken kabi maxfiy maydonlar frontendga hech qachon
  // yuborilmaydi — faqat login mavjudligini bildiruvchi hasLogin bayrog'i qaytariladi.
  // ==================== F. Obuna (tarif) tizimi (51-70-bosqich) ====================
  // 51-bosqich: admin tariflar sonini va nomini o'zi belgilaydi — tariflar
  // umumiy katalog sifatida (tariffs.json) saqlanadi, keyingi bosqichlarda
  // (52-narx va 53-54-funksiyalar bosqichlari bajarildi; 57-do'kon
  // egasiga biriktirish) shu
  // yozuvlar kengaytiriladi.

  // ---- API: tizimdagi barcha funksiyalar ro'yxati (faqat admin, 53-bosqich) ----
  // 54-bosqichda shu ro'yxat asosida "Funksiya × Tarif" jadvali chiziladi;
  // hozircha faqat guruhlangan katalogni qaytaradi.
  if (req.method === 'POST' && req.url === '/api/feature-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin ko\'ra oladi' });

      return sendJSON(res, 200, { ok: true, groups: getFeatureCatalogGrouped() });
    });
    return;
  }

  // ---- API: tariflar ro'yxati (faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/tariff-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin ko\'ra oladi' });

      // 68-bosqich: tarif bo'yicha statistika — har bir tarifda nechta
      // do'kon egasi borligini ham shu yerda hisoblab qo'shamiz, frontend
      // qayta so'rov yubormasligi uchun.
      const owners = loadOwners();
      const tariffs = loadTariffs().slice().sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(t => ({ ...t, ownerCount: owners.filter(o => o.tariffId === t.id).length }));
      return sendJSON(res, 200, { ok: true, tariffs });
    });
    return;
  }

  // ---- API: yangi tarif qo'shish (faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/tariff-add') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, name, price } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin qo\'sha oladi' });

      const nameTrim = String(name || '').trim();
      if (!nameTrim) return sendJSON(res, 200, { ok: false, reason: 'Tarif nomini kiriting.' });

      let priceVal = 0;
      if (price !== undefined && price !== null && String(price).trim() !== '') {
        priceVal = Number(price);
        if (!Number.isFinite(priceVal) || priceVal < 0) return sendJSON(res, 200, { ok: false, reason: 'Narx 0 yoki musbat son bo\'lishi kerak.' });
      }

      const tariffs = loadTariffs();
      if (tariffs.some(t => t.name.toLowerCase() === nameTrim.toLowerCase())) {
        return sendJSON(res, 200, { ok: false, reason: 'Shu nomdagi tarif allaqachon mavjud.' });
      }
      const tariff = {
        id: crypto.randomBytes(4).toString('hex'),
        name: nameTrim,
        order: tariffs.length,
        price: priceVal,
        // 65-bosqich: muddat tugashiga necha kun qolganda eslatma yuborilishi —
        // har bir tarif o'zining qiymatini belgilashi mumkin (standart: 1 kun,
        // eski, tarif tizimidan oldingi umumiy xulq bilan bir xil).
        reminderDays: 1,
        features: {},
        createdAt: new Date().toISOString()
      };
      tariffs.push(tariff);
      saveTariffs(tariffs);

      return sendJSON(res, 200, { ok: true, tariff });
    });
    return;
  }

  // ---- API: tarif nomi va narxini o'zgartirish (faqat admin) ----
  // 52-bosqich: narx ham shu endpoint orqali yangilanadi — name har doim
  // yuboriladi, price ixtiyoriy (yuborilmasa eski narx saqlanib qoladi).
  if (req.method === 'POST' && req.url === '/api/tariff-rename') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, name, price, reminderDays } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin o\'zgartira oladi' });

      const nameTrim = String(name || '').trim();
      if (!nameTrim) return sendJSON(res, 200, { ok: false, reason: 'Tarif nomini kiriting.' });

      const tariffs = loadTariffs();
      const tariff = tariffs.find(t => t.id === id);
      if (!tariff) return sendJSON(res, 200, { ok: false, reason: 'Tarif topilmadi.' });
      if (tariffs.some(t => t.id !== id && t.name.toLowerCase() === nameTrim.toLowerCase())) {
        return sendJSON(res, 200, { ok: false, reason: 'Shu nomdagi tarif allaqachon mavjud.' });
      }
      if (price !== undefined && price !== null && String(price).trim() !== '') {
        const priceVal = Number(price);
        if (!Number.isFinite(priceVal) || priceVal < 0) return sendJSON(res, 200, { ok: false, reason: 'Narx 0 yoki musbat son bo\'lishi kerak.' });
        tariff.price = priceVal;
      }
      // 65-bosqich: shu tarifdagi egalar uchun muddat tugashi eslatmasi
      // necha kun oldin yuborilishi (checkOwnerExpirations() shundan foydalanadi).
      if (reminderDays !== undefined && reminderDays !== null && String(reminderDays).trim() !== '') {
        const reminderVal = parseInt(reminderDays, 10);
        if (!Number.isInteger(reminderVal) || reminderVal <= 0) {
          return sendJSON(res, 200, { ok: false, reason: 'Eslatma kunlari musbat butun son bo\'lishi kerak.' });
        }
        tariff.reminderDays = reminderVal;
      }
      tariff.name = nameTrim;
      saveTariffs(tariffs);

      return sendJSON(res, 200, { ok: true, tariff });
    });
    return;
  }

  // ---- API: tarifni o'chirish (faqat admin, 55-bosqich) ----
  // Agar tarif biror do'kon egasiga biriktirilgan bo'lsa (owner.tariffId),
  // oddiy so'rovda o'chirishga yo'l qo'yilmaydi — admin avval buni bilishi
  // kerak. force:true yuborilsa, biriktirilgan egalar tarifsiz (tariffId:null)
  // qoldiriladi va tarif shunday ham o'chiriladi.
  if (req.method === 'POST' && req.url === '/api/tariff-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, force } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin o\'chira oladi' });

      const tariffs = loadTariffs();
      const idx = tariffs.findIndex(t => t.id === id);
      if (idx === -1) return sendJSON(res, 200, { ok: false, reason: 'Tarif topilmadi.' });

      const owners = loadOwners();
      const assignedOwners = owners.filter(o => o.tariffId === id);
      if (assignedOwners.length && !force) {
        return sendJSON(res, 200, {
          ok: false,
          reason: `Bu tarifga ${assignedOwners.length} ta do'kon egasi biriktirilgan. Avval ularni boshqa tarifga o'tkazing, yoki tasdiqlab, ularni tarifsiz qoldirib o'chiring.`,
          blockedCount: assignedOwners.length
        });
      }
      if (assignedOwners.length && force) {
        assignedOwners.forEach(o => { o.tariffId = null; });
        saveOwners(owners);
      }

      tariffs.splice(idx, 1);
      // Qolgan tariflarning order'ini qayta tekislaydi (ro'yxatda bo'shliq qolmasin)
      tariffs.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((t, i) => { t.order = i; });
      saveTariffs(tariffs);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: tarifga funksiyalarni ✅/❌ belgilash (faqat admin, 54-bosqich) ----
  // features — { featureId: true|false } ko'rinishidagi to'liq xarita;
  // faqat FEATURE_CATALOG'da mavjud id'lar qabul qilinadi, qolgani e'tiborsiz
  // qoldiriladi. Yuborilgan xarita tarifning eski features'ini TO'LIQ
  // almashtiradi (checkbox'lar UI'da hammasi birga saqlanadi).
  if (req.method === 'POST' && req.url === '/api/tariff-set-features') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, features } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin belgilay oladi' });

      const tariffs = loadTariffs();
      const tariff = tariffs.find(t => t.id === id);
      if (!tariff) return sendJSON(res, 200, { ok: false, reason: 'Tarif topilmadi.' });

      const validIds = new Set(FEATURE_CATALOG.map(f => f.id));
      const cleaned = {};
      if (features && typeof features === 'object') {
        for (const fid of Object.keys(features)) {
          if (validIds.has(fid)) cleaned[fid] = !!features[fid];
        }
      }
      tariff.features = cleaned;
      saveTariffs(tariffs);

      return sendJSON(res, 200, { ok: true, tariff });
    });
    return;
  }
  // Serverning umumiy holatini (ishlash vaqti, xotira, xodimlar/buyurtmalar
  // soni, ma'lumot fayllari hajmi, webhook statistikasi) bitta so'rovda
  // qaytaradi — faqat admin ko'ra oladi.
  if (req.method === 'POST' && req.url === '/api/system-status') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin ko\'ra oladi' });

      const owners = loadOwners();
      const activeOwners = owners.filter(isOwnerAccessValid);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      let totalStaff = 0, totalOrders = 0, todayOrders = 0, totalNotifErrors = 0;
      owners.forEach(o => {
        totalStaff += (o.staff || []).length;
        const orders = o.orders || [];
        totalOrders += orders.length;
        todayOrders += orders.filter(ord => ord.createdAt && new Date(ord.createdAt) >= todayStart).length;
        totalNotifErrors += (o.notificationErrors || []).length;
      });

      function fileInfo(file) {
        try {
          const st = fs.statSync(file);
          return { exists: true, sizeKb: Math.round(st.size / 1024 * 10) / 10 };
        } catch (e) {
          return { exists: false, sizeKb: 0 };
        }
      }

      const mem = process.memoryUsage();

      return sendJSON(res, 200, {
        ok: true,
        status: {
          uptimeSeconds: Math.floor(process.uptime()),
          serverStartedAt: SERVER_STARTED_AT,
          nodeVersion: process.version,
          memoryRssMb: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
          owners: { total: owners.length, active: activeOwners.length, expired: owners.length - activeOwners.length },
          totalStaff,
          totalOrders,
          todayOrders,
          notificationErrors: totalNotifErrors,
          webhook: webhookStats,
          botConfigured: !!BOT_TOKEN && BOT_TOKEN !== 'BOT_TOKEN_BU_YERGA',
          publicUrlConfigured: !!PUBLIC_URL,
          dataFiles: {
            owners: fileInfo(OWNERS_FILE),
            invites: fileInfo(INVITES_FILE),
            requests: fileInfo(REQUESTS_FILE),
            profiles: fileInfo(PROFILES_FILE)
          }
        }
      });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/owners') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin ko\'ra oladi' });

      const owners = pruneExpiredOwners().map(o => {
        const clean = Object.assign({}, o);
        delete clean.passwordHash;
        delete clean.sessionToken;
        delete clean.sessionExpiresAt;
        clean.hasLogin = !!(o.login && o.passwordHash);
        return clean;
      });
      return sendJSON(res, 200, { ok: true, owners });
    });
    return;
  }

  // ---- API: do'kon egasiga tarif biriktirish (faqat admin, 57-bosqich) ----
  // tariffId — tariffs.json'dagi bitta yozuvning id'si, yoki null/bo'sh —
  // egani tarifsiz qoldirish uchun (masalan tarif o'chirilganda ham shu
  // holatga tushadi, qarang: /api/tariff-remove).
  if (req.method === 'POST' && req.url === '/api/owner-set-tariff') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, tariffId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin belgilay oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const owners = loadOwners();
      const owner = findOwner(owners, id);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Bunday do\'kon egasi topilmadi' });

      if (tariffId) {
        const tariffs = loadTariffs();
        if (!tariffs.some(t => t.id === tariffId)) {
          return sendJSON(res, 200, { ok: false, reason: 'Bunday tarif topilmadi.' });
        }
        owner.tariffId = tariffId;
      } else {
        owner.tariffId = null;
      }
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, tariffId: owner.tariffId });
    });
    return;
  }
  // ====== 63/64-bosqich: obuna muddatini uzaytirish/qisqartirish/bekor qilish ======
  // action:
  //  - 'extend'    : joriy muddatga (yoki u tugagan/yo'q bo'lsa hozirgi vaqtga)
  //                  `days` kun qo'shadi.
  //  - 'setDate'   : `date` (YYYY-MM-DD) ga aniq belgilaydi — kelajakdagi sana
  //                  uzaytirish, o'tmishdagi/bugungi sana esa qisqartirish
  //                  bo'lib, pastdagi darhol bloklash bilan bir xil ishlaydi.
  //  - 'unlimited' : expiresAt'ni tozalaydi (doimiy ruxsat).
  //  - 'cancelNow' : obunani darhol bekor qiladi — checkOwnerExpirations()
  //                  bilan bir xil xulq (owner ro'yxatdan olib tashlanadi,
  //                  admin va egaga xabar boradi). Buyurtmalar tarixi
  //                  owners.json'dan mustaqil saqlanadi (69-bosqich).
  // Har ikkala holatda ham owner.reminderSentAt tozalanadi — muddat
  // o'zgargach, "tez orada tugaydi" eslatmasi yangi muddatga nisbatan
  // to'g'ri vaqtda qayta yuborilishi uchun (65-bosqich).
  if (req.method === 'POST' && req.url === '/api/owner-set-expiry') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, action, days, date } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin o\'zgartira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const owners = loadOwners();
      const owner = findOwner(owners, id);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Bunday do\'kon egasi topilmadi' });

      if (action === 'extend') {
        const n = parseInt(days, 10);
        if (!Number.isInteger(n) || n <= 0) {
          return sendJSON(res, 200, { ok: false, reason: 'Kun soni musbat butun son bo\'lishi kerak.' });
        }
        const currentMs = owner.expiresAt ? new Date(owner.expiresAt).getTime() : NaN;
        const base = Number.isFinite(currentMs) && currentMs > Date.now() ? currentMs : Date.now();
        owner.expiresAt = new Date(base + n * 86400000).toISOString();
        owner.reminderSentAt = null;
        saveOwners(owners);
        return sendJSON(res, 200, { ok: true, owner });
      }

      if (action === 'setDate') {
        const d = new Date(date);
        if (!date || isNaN(d.getTime())) {
          return sendJSON(res, 200, { ok: false, reason: 'Sana noto\'g\'ri.' });
        }
        // Kun boshidan emas, kun oxiridan (23:59:59) hisoblanadi — admin
        // "shu kungacha" deb tanlagan kun to'liq amal qilishi uchun.
        d.setHours(23, 59, 59, 999);
        if (d.getTime() <= Date.now()) {
          const remaining = owners.filter(o => o.id !== owner.id);
          saveOwners(remaining);
          await sendMessage(ADMIN_ID,
            `⏰ <b>Obuna muddati qisqartirildi</b>\n${ownerLabel(owner)} (ID: <code>${owner.id}</code>) uchun Mini App'ga kirish admin tomonidan yopildi.`);
          await sendMessage(owner.id,
            `⏰ Sizning obuna muddatingiz administrator tomonidan qisqartirildi, Mini App'ga kirish yopildi.\nDavom ettirish uchun administrator bilan bog'laning.`);
          return sendJSON(res, 200, { ok: true, removed: true });
        }
        owner.expiresAt = d.toISOString();
        owner.reminderSentAt = null;
        saveOwners(owners);
        return sendJSON(res, 200, { ok: true, owner });
      }

      if (action === 'unlimited') {
        owner.expiresAt = null;
        owner.reminderSentAt = null;
        saveOwners(owners);
        return sendJSON(res, 200, { ok: true, owner });
      }

      if (action === 'cancelNow') {
        const remaining = owners.filter(o => o.id !== owner.id);
        saveOwners(remaining);
        await sendMessage(ADMIN_ID,
          `⏰ <b>Obuna bekor qilindi</b>\n${ownerLabel(owner)} (ID: <code>${owner.id}</code>) uchun Mini App'ga kirish admin tomonidan yopildi.`);
        await sendMessage(owner.id,
          `⏰ Sizning obunangiz administrator tomonidan bekor qilindi, Mini App'ga kirish yopildi.`);
        return sendJSON(res, 200, { ok: true, removed: true });
      }

      return sendJSON(res, 200, { ok: false, reason: 'Noto\'g\'ri amal.' });
    });
    return;
  }
  // Shu login/parol bilan owner Mini App'ni Telegram tashqarisida (brauzerdan)
  // ham ochib, o'z panelига kira oladi (qarang: pastdagi /api/owner-login).
  if (req.method === 'POST' && req.url === '/api/set-owner-credentials') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, login, password } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin belgilay oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const owners = loadOwners();
      const owner = findOwner(owners, id);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Bunday do\'kon egasi topilmadi' });

      const loginNorm = normalizeLogin(login);
      if (!/^[a-z0-9_.]{3,32}$/.test(loginNorm)) {
        return sendJSON(res, 200, { ok: false, reason: 'Login 3-32 belgi, faqat lotin harflari/raqam/._ bo\'lishi mumkin.' });
      }
      const passwordStr = String(password || '');
      if (passwordStr.length < 6) {
        return sendJSON(res, 200, { ok: false, reason: 'Parol kamida 6 belgidan iborat bo\'lishi kerak.' });
      }
      const clash = owners.find(o => normalizeLogin(o.login) === loginNorm && String(o.id) !== String(owner.id));
      if (clash) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu login band, boshqasini tanlang.' });
      }

      owner.login = loginNorm;
      owner.passwordHash = hashPassword(passwordStr);
      // Parol yangilansa, oldingi barcha sessiyalar bekor qilinadi (xavfsizlik uchun)
      owner.sessionToken = null;
      owner.sessionExpiresAt = null;
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, login: owner.login });
    });
    return;
  }

  // ---- API: admin do'kon egasidan login/parolni olib tashlaydi (Telegram orqali kirish ishlayveradi) ----
  if (req.method === 'POST' && req.url === '/api/remove-owner-credentials') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin o\'chira oladi' });
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const owners = loadOwners();
      const owner = findOwner(owners, id);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Bunday do\'kon egasi topilmadi' });

      owner.login = null;
      owner.passwordHash = null;
      owner.sessionToken = null;
      owner.sessionExpiresAt = null;
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: Telegram orqali kirgan egasi uchun bir martalik parol tasdig'i ----
  // (Telegram initData o'zi kimligini tasdiqlaydi, lekin admin login/parol
  // o'rnatib qo'ygan bo'lsa, qurilmada eslab qolinmaguncha parol so'raladi —
  // qarang: frontend'dagi renderOwnerTelegramPasswordGate.)
  if (req.method === 'POST' && req.url === '/api/owner-confirm-password') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, password } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q yoki muddati tugagan' });

      if (!owner.login || !owner.passwordHash) {
        // Admin bu egasiga login/parol o'rnatmagan — tekshirishning hojati yo'q
        return sendJSON(res, 200, { ok: true, skipped: true });
      }
      if (!verifyPassword(password, owner.passwordHash)) {
        return sendJSON(res, 200, { ok: false, reason: 'Parol noto\'g\'ri.' });
      }
      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: egasi (admin emas, o'zi) o'z parolini o'zgartiradi ----
  // Login o'zgarmaydi — faqat parol. Joriy parol tasdiqlanadi, so'ng
  // /api/set-owner-credentials'dagi bilan bir xil uzunlik validatsiyasi
  // qo'llaniladi. Xavfsizlik uchun barcha eski sessiyalar (sess_ tokenlar)
  // bekor qilinadi — shu qatordagi so'rov o'zi ham sess_ token orqali kirgan
  // bo'lsa, keyingi so'rovlar uchun qayta login qilishi kerak bo'ladi.
  if (req.method === 'POST' && req.url === '/api/owner-change-password') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, currentPassword, newPassword } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q yoki muddati tugagan' });

      if (!owner.login || !owner.passwordHash) {
        return sendJSON(res, 200, { ok: false, reason: 'Sizga hali login/parol biriktirilmagan. Administrator bilan bog\'laning.' });
      }
      if (!verifyPassword(currentPassword, owner.passwordHash)) {
        return sendJSON(res, 200, { ok: false, reason: 'Joriy parol noto\'g\'ri.' });
      }

      // set-owner-credentials'dagi bilan bir xil parol validatsiyasi
      const newPasswordStr = String(newPassword || '');
      if (newPasswordStr.length < 6) {
        return sendJSON(res, 200, { ok: false, reason: 'Yangi parol kamida 6 belgidan iborat bo\'lishi kerak.' });
      }

      const owners2 = loadOwners();
      const target = findOwner(owners2, owner.id);
      if (!target) return sendJSON(res, 200, { ok: false, reason: 'Bunday do\'kon egasi topilmadi' });

      target.passwordHash = hashPassword(newPasswordStr);
      // Parol o'zgarganda, oldingi barcha sessiyalar bekor qilinadi (xavfsizlik uchun)
      target.sessionToken = null;
      target.sessionExpiresAt = null;
      saveOwners(owners2);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: egasi (admin emas, o'zi) login+parolini butunlay o'chiradi ----
  // Shundan keyin faqat Telegram orqali kirish qoladi (xuddi admin
  // /api/remove-owner-credentials orqali o'chirganidagi kabi natija),
  // lekin bu yerda amalni egasining o'zi, joriy parolini tasdiqlab bajaradi.
  if (req.method === 'POST' && req.url === '/api/owner-remove-password') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, currentPassword } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q yoki muddati tugagan' });

      if (!owner.login || !owner.passwordHash) {
        // Login/parol allaqachon yo'q — o'chiradigan narsa yo'q
        return sendJSON(res, 200, { ok: true, alreadyRemoved: true });
      }
      if (!verifyPassword(currentPassword, owner.passwordHash)) {
        return sendJSON(res, 200, { ok: false, reason: 'Joriy parol noto\'g\'ri.' });
      }

      const owners2 = loadOwners();
      const target = findOwner(owners2, owner.id);
      if (!target) return sendJSON(res, 200, { ok: false, reason: 'Bunday do\'kon egasi topilmadi' });

      target.login = null;
      target.passwordHash = null;
      target.sessionToken = null;
      target.sessionExpiresAt = null;
      saveOwners(owners2);

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: oshxona egasi login+parol bilan kiradi (Telegram tashqarisidan, masalan oddiy brauzerdan) ----
  // Muvaffaqiyatli bo'lsa "sess_<token>" beriladi — frontend buni initData o'rniga ishlatadi.
  if (req.method === 'POST' && req.url === '/api/owner-login') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { login, password } = payload;
      const loginNorm = normalizeLogin(login);
      if (!loginNorm || !password) {
        return sendJSON(res, 200, { ok: false, reason: 'Login va parolni kiriting.' });
      }

      const owners = pruneExpiredOwners();
      const owner = owners.find(o => normalizeLogin(o.login) === loginNorm);
      if (!owner || !owner.passwordHash || !verifyPassword(password, owner.passwordHash)) {
        return sendJSON(res, 200, { ok: false, reason: 'Login yoki parol noto\'g\'ri.' });
      }
      if (!isOwnerAccessValid(owner)) {
        return sendJSON(res, 200, { ok: false, reason: 'Obuna muddati tugagan. Administrator bilan bog\'laning.' });
      }

      const owners2 = loadOwners();
      const target = findOwner(owners2, owner.id);
      const token = crypto.randomBytes(24).toString('hex');
      target.sessionToken = token;
      target.sessionExpiresAt = new Date(Date.now() + SESSION_TOKEN_TTL_MS).toISOString();
      saveOwners(owners2);

      return sendJSON(res, 200, {
        ok: true,
        sessionToken: `sess_${token}`,
        restaurantName: (target.profile && target.profile.name) || null
      });
    });
    return;
  }

  // ---- API: oshxona egasi chiqadi (joriy sessiyani bekor qiladi) ----
  if (req.method === 'POST' && req.url === '/api/owner-logout') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData } = payload;
      if (typeof initData === 'string' && initData.startsWith('sess_')) {
        const token = initData.slice('sess_'.length);
        const owners = loadOwners();
        const owner = owners.find(o => o.sessionToken === token);
        if (owner) {
          owner.sessionToken = null;
          owner.sessionExpiresAt = null;
          saveOwners(owners);
        }
      }
      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: yangi do'kon egasini qo'shish (faqat admin, tasdiqdan keyin frontend chaqiradi) ----
  if (req.method === 'POST' && req.url === '/api/add-owner') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, input, days, price, paid } = payload;
      const check = verifyAuth(initData);
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
      const check = verifyAuth(initData);
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
      const check = verifyAuth(initData);
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
      const check = verifyAuth(payload.initData);
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
      webhookStats.received++;
      webhookStats.lastAt = new Date().toISOString();
      try { await handleTelegramUpdate(update); } catch (e) { webhookStats.errors++; console.error('Webhook xatosi:', e); }
    });
    return;
  }

  // ---- Statik fayllarni berish (faqat public papkasidan) ----
  const urlPathOnly = req.url.split('?')[0];
  let filePath = (urlPathOnly === '/' || urlPathOnly === '') ? '/index.html' : urlPathOnly;
  filePath = path.join(__dirname, 'public', path.normalize(filePath).replace(/^(\.\.[\/\\])+/, ''));

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404');
    }
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html'
      : ext === '.js' ? 'application/javascript'
      : ext === '.css' ? 'text/css'
      : ext === '.json' ? 'application/json'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.png' ? 'image/png'
      : 'text/plain';
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
