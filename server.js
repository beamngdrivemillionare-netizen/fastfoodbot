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
// 72-BOSQICH: Obuna trial/grace muddatlari — ENV orqali sozlanadi, sozlanmasa
// hisob-kitob-bot'dagidek standart qiymatlar ishlatiladi (config.py:
// SUBSCRIPTION_TRIAL_DAYS=14, SUBSCRIPTION_GRACE_DAYS=3).
// - SUBSCRIPTION_TRIAL_DAYS: o'zi ro'yxatdan o'tgan yangi oshxona egasiga
//   admin tasdiqlaganda taklif qilinadigan standart sinov kunlari soni
//   (admin buni tasdiqlash paytida boshqa songa o'zgartirishi ham mumkin —
//   qarang: kelgusi "trial tasdiqlash oqimi" bosqichi).
// - SUBSCRIPTION_GRACE_DAYS: subscriptionUntil o'tgandan keyin ham kirish
//   hali ochiq turadigan "muhlat" kunlari — shu muddat ichida owner
//   bloklanmaydi, lekin ⏳ belgisi bilan ogohlantiriladi (qarang: kelgusi
//   "grace period va o'chirishni bekor qilish" bosqichi).
const SUBSCRIPTION_TRIAL_DAYS = parseInt(process.env.SUBSCRIPTION_TRIAL_DAYS, 10) || 14;
const SUBSCRIPTION_GRACE_DAYS = parseInt(process.env.SUBSCRIPTION_GRACE_DAYS, 10) || 3;
const OWNERS_FILE = path.join(DATA_DIR, 'owners.json');
// admins.json — 78-BOSQICH: bootstrap ADMIN_ID'dan tashqari qo'shimcha
// adminlar ro'yxati (hisob-kitob-bot'dagi access_control.py'dagi
// `_extra_admin_ids` kabi). Har bir yozuv: { id, addedAt, addedBy }.
// Bootstrap ADMIN_ID bu faylda YO'Q — u doim ENV orqali, alohida ustuvor
// tarzda tekshiriladi (qarang: isAdminId()). Server ishga tushganda
// EXTRA_ADMIN_IDS xotiradagi Set'iga yuklanadi (qarang: reloadAdminsCache()),
// shunda har bir so'rovda faylni qayta o'qishga hojat qolmaydi.
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
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
// payments.json — har bir "to'landi" deb belgilangan voqea alohida yozuv
// sifatida shu yerga yoziladi (67-bosqich: admin dashboardida umumiy
// daromadni FAQAT joriy holat snapshoti emas, balki haqiqiy tarix bo'yicha
// hisoblash uchun). Bitta yozuv: { id, ownerId, amount, tariffId, at }.
// owner.json'dagi paid/paidAt/price — joriy holatning "hozirgi surat"i,
// bu fayl esa — vaqt bo'yicha to'liq jurnal (owner o'chirilsa ham saqlanadi,
// 69-bosqich talabiga mos).
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
// archived_orders.json — 69-bosqich: do'kon egasi (obunachi) admin tomonidan
// o'chirilganda, egasi bilan birga owner.orders massivi ham yo'qolib
// ketmasligi uchun, o'chirishdan OLDIN shu yerga arxivlanadi. Bitta yozuv —
// bitta o'chirilgan egaga tegishli barcha buyurtmalar: { ownerId, ownerLabel,
// removedAt, orders: [...] }. owners.json'dan o'chirilgandan keyin ham
// buyurtmalar tarixi shu faylda saqlanib qoladi.
const ARCHIVED_ORDERS_FILE = path.join(DATA_DIR, 'archived_orders.json');
// subscription_plans.json — 73-bosqich: TARIFFS_FILE'dan ATAYLAB ajratilgan.
// tariffs.json (F-bo'lim) — "qaysi FUNKSIYALAR ochiq" katalogi (owner.tariffId
// orqali biriktiriladi, admin qo'lda belgilaydi). subscription_plans.json esa —
// "necha oyga qancha to'lash kerak" narxlar ro'yxati (hisob-kitob-bot'dagi
// config.SUBSCRIPTION_PLANS bilan bir xil vazifa): owner "💳 Obuna" bo'limida
// shu ro'yxatdan birini tanlab, TO'LOV qilib, subscriptionUntil'ni o'zi
// uzaytiradi. Ikkalasi mustaqil: bitta owner istalgan funksiya-tarifda
// bo'lishi mumkin, obuna reja narxi esa faqat muddatga ta'sir qiladi.
const SUBSCRIPTION_PLANS_FILE = path.join(DATA_DIR, 'subscription_plans.json');
// settings.json — 74-bosqich: obuna to'lovlari uchun rekvizitlar (karta,
// Click, Payme raqamlari) — hisob-kitob-bot'dagi db.get_payment_requisites()
// bilan bir xil vazifa. Owner "💳 Obuna" bo'limida tarif tanlaganda shu
// rekvizitlar ko'rsatiladi. Admin panelidan o'zgartirilishi mumkin bo'ladi
// (UI keyingi bosqichda qo'shiladi) — hozircha faqat standart qiymatlar bilan
// avtomatik yaratiladi.
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
// broadcasts.json — 48-51-bosqich: admin tomonidan yuborilgan har bir
// umumiy e'lon/broadcast xabari shu yerga jurnallanadi (matn, rasm, tugma,
// qabul qiluvchi turi, yuborilgan/yetib bormagan sonlar). Faqat tarix —
// qayta yuborish uchun ishlatilmaydi.
const BROADCASTS_FILE = path.join(DATA_DIR, 'broadcasts.json');
// ========================================================

// ==================== G-bo'lim: Obuna va oshxona egalari boshqaruvi ====================
// (hisob-kitob-bot'dagi access_control.py + handlers/subscription.py bilan bir xil
// mantiqqa o'tkazish uchun yangi reja, 71-bosqichdan boshlanadi — F-bo'lim (tarif/
// funksiya tizimi, 51-70-bosqich) bilan almashtirilmaydi, ustiga qo'shiladi.)
//
// 71-BOSQICH: Obuna sxemasini kengaytirish.
// Hozirgacha owner.expiresAt/paid/price orqali "muddat tugadimi" degan savolga
// oddiy ha/yo'q javob berilardi va muddat tugashi bilan pruneExpiredOwners()
// ownerni BUTUNLAY o'chirib yuborardi (menyu, xodimlar, buyurtmalar bilan birga).
// Bu — hisob-kitob-bot'dagi yumshoq bloklash (grace period) mantig'iga zid.
//
// Shu bosqichda owner obyektiga quyidagi yangi maydonlar qo'shiladi (eski
// expiresAt/paid/price maydonlari ORQAGA MOSLIK uchun saqlanadi, hozircha
// o'chirilmaydi — ular hali boshqa joylarda ishlatilyapti):
//   - subscriptionStatus: 'pending_trial' | 'active' | 'blocked'
//   - subscriptionUntil: ISO sana yoki null (null = muddatsiz/doimiy ruxsat)
//   - graceUntil: ISO sana yoki null (subscriptionUntil o'tgach ham
//     shu sanagacha kirish hali ochiq turadi — SUBSCRIPTION_GRACE_DAYS)
//   - trialGivenAt: ISO sana yoki null (birinchi marta sinov muddati
//     tasdiqlangan payt, statistik/audit maqsadida)
//
// MUHIM: bu bosqichda hali hech qanday BLOKLASH mantig'i o'zgarmaydi —
// isOwnerAccessValid/pruneExpiredOwners hozircha eski holicha ishlayveradi.
// Yangi maydonlar faqat owners.json'ga "orqa fonda" qo'shib qo'yiladi va
// keyingi bosqichlarda (grace period, obuna menyusi, to'lov oqimi) shular
// asosida ishlatiladi. Shu tufayli bu o'zgarish TO'LIQ orqaga moslashuvchan —
// eski kod ham, eski owners.json yozuvlari ham buzilmaydi.
const SUBSCRIPTION_STATUS = {
  PENDING_TRIAL: 'pending_trial',
  ACTIVE: 'active',
  BLOCKED: 'blocked'
};

// Bitta owner obyektida yangi obuna maydonlari yo'q bo'lsa (eski yozuv yoki
// admin tomonidan qo'lda /api/add-owner orqali qo'shilgan yozuv), ularni
// MAVJUD expiresAt/paid asosida "taxmin qilib" to'ldiradi — hech narsani
// o'zgartirmaydi/saqlamaydi (faqat xotirada, o'qish paytida), shuning uchun
// bu funksiyani xohlagancha marta chaqirish xavfsiz.
//
// Qoida: agar owner.expiresAt bo'lmasa (doimiy) yoki hali tugamagan bo'lsa —
// 'active'; aks holda — 'blocked' (grace period hisobini keyingi bosqich
// qo'shadi, hozircha faqat maydon mavjudligini ta'minlaydi).
function ensureSubscriptionFields(owner) {
  if (!owner) return owner;
  if (owner.subscriptionStatus === undefined) {
    const stillValid = !owner.expiresAt || new Date(owner.expiresAt).getTime() > Date.now();
    owner.subscriptionStatus = stillValid ? SUBSCRIPTION_STATUS.ACTIVE : SUBSCRIPTION_STATUS.BLOCKED;
  }
  if (owner.subscriptionUntil === undefined) {
    owner.subscriptionUntil = owner.expiresAt || null;
  }
  if (owner.graceUntil === undefined) {
    owner.graceUntil = null;
  }
  if (owner.trialGivenAt === undefined) {
    owner.trialGivenAt = null;
  }
  // 76-bosqich: "bloklandi" xabari faqat bir marta yuborilishi uchun
  // (checkOwnerExpirations() ishlatadi) — qarang shu funksiya izohi.
  if (owner.blockedNotifiedAt === undefined) {
    owner.blockedNotifiedAt = null;
  }
  // Mijozlar "karta" to'lovini tanlaganda ko'radigan, DO'KON EGASINING O'ZI
  // to'ldiradigan karta raqami/egasi. Bu — subscriptionPaymentRequisites'dan
  // (platforma egasining obuna kartasi) FARQLI: har bir do'kon o'zining
  // mijozlaridan pul qabul qilish uchun o'z kartasini kiritadi.
  if (owner.customerPaymentCard === undefined) {
    owner.customerPaymentCard = { cardNumber: '', cardHolder: '' };
  }
  // Joriy TASDIQLANGAN rejaning "kunlik narxi" (proratsiya hisob-kitobi
  // uchun, qarang: createSubscriptionPaymentRequest / decideSubscriptionPayment).
  // Bu maydonlar faqat tariffId biriktiruvchi reja tasdiqlanganda yangilanadi.
  if (owner.activePlanDailyPrice === undefined) {
    owner.activePlanDailyPrice = null;
  }
  if (owner.activePlanTariffId === undefined) {
    owner.activePlanTariffId = owner.tariffId || null;
  }
  return owner;
}

// 73-BOSQICH: Obuna rejalari (1/3/12 oylik narxlar).
// hisob-kitob-bot'dagi config.SUBSCRIPTION_PLANS'ga o'xshab, kalit sifatida
// barqaror id ('1m'/'3m'/'12m') ishlatiladi — kelgusi bosqichlarda owner
// tanlagan reja shu id orqali eslab qolinadi (narx keyin o'zgarsa ham,
// tanlangan paytdagi narxdan to'laydi, xuddi hisob-kitob'dagidek).
// Narxlar so'mda, admin panelidan keyinchalik o'zgartirilishi mumkin bo'ladi
// (hozircha faqat standart qiymatlar — sozlash UI'si keyingi bosqichda).
// tariffId: reja tasdiqlanganda owner'ga AVTOMATIK biriktiriladigan F-bo'lim
// tarifi (qarang: decideSubscriptionPayment). null bo'lsa — owner'ning joriy
// tarifi o'zgarmaydi (faqat muddat uzayadi). Bu maydon admin panelidan
// "Obuna rejalari" bo'limida sozlanadi (qarang: /api/subscription-plan-*).
const DEFAULT_SUBSCRIPTION_PLANS = {
  '1m': { id: '1m', label: '1 oy', days: 30, price: 50000, discountNote: null, tariffId: null, order: 0 },
  '3m': { id: '3m', label: '3 oy', days: 90, price: 135000, discountNote: 'chegirmali', tariffId: null, order: 1 },
  '12m': { id: '12m', label: '12 oy', days: 365, price: 480000, discountNote: 'chegirmali', tariffId: null, order: 2 }
};

// Fayl hali mavjud bo'lmasa (birinchi ishga tushirish) — standart rejalar
// bilan avtomatik yaratadi, shunda admin hech narsa qo'lda sozlamasa ham
// "💳 Obuna" bo'limi bo'sh qolib ketmaydi.
function loadSubscriptionPlans() {
  try {
    if (!fs.existsSync(SUBSCRIPTION_PLANS_FILE)) {
      saveSubscriptionPlans(DEFAULT_SUBSCRIPTION_PLANS);
      return Object.assign({}, DEFAULT_SUBSCRIPTION_PLANS);
    }
    const raw = fs.readFileSync(SUBSCRIPTION_PLANS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
      return Object.assign({}, DEFAULT_SUBSCRIPTION_PLANS);
    }
    return parsed;
  } catch (e) {
    console.error('subscription_plans.json o\'qishda xatolik:', e.message);
    return Object.assign({}, DEFAULT_SUBSCRIPTION_PLANS);
  }
}

function saveSubscriptionPlans(plans) {
  try {
    fs.writeFileSync(SUBSCRIPTION_PLANS_FILE, JSON.stringify(plans, null, 2));
  } catch (e) {
    console.error('subscription_plans.json yozishda xatolik:', e.message);
  }
}

// 74-BOSQICH: To'lov rekvizitlari (karta/Click/Payme).
// Owner chek/skrinshot yubormasdan oldin shu ma'lumotlarni ko'radi. Admin
// haqiqiy rekvizitlarni sozlagunga qadar "***" bilan boshlangan ko'rinishda
// turadi — bu admin hali sozlamaganini bildiradi (tasodifan soxta/bo'sh
// karta raqami ko'rsatilib qolmasligi uchun).
const DEFAULT_PAYMENT_REQUISITES = {
  cardNumber: '**** **** **** ****',
  cardHolder: 'ADMIN ISM FAMILIYA',
  clickNumber: '+998 90 000 00 00',
  paymeNumber: '+998 90 000 00 00'
};

function loadPaymentRequisites() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      const initial = { paymentRequisites: DEFAULT_PAYMENT_REQUISITES };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(initial, null, 2));
      return Object.assign({}, DEFAULT_PAYMENT_REQUISITES);
    }
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Object.assign({}, DEFAULT_PAYMENT_REQUISITES, (parsed && parsed.paymentRequisites) || {});
  } catch (e) {
    console.error('settings.json (paymentRequisites) o\'qishda xatolik:', e.message);
    return Object.assign({}, DEFAULT_PAYMENT_REQUISITES);
  }
}

// MUHIM: settings.json kelgusida boshqa umumiy sozlamalarni ham saqlashi
// mumkin bo'lgani uchun, bu funksiya butun faylni EMAS, faqat
// paymentRequisites bo'limini almashtiradi — mavjud boshqa kalitlar (agar
// bo'lsa) saqlanib qoladi.
function savePaymentRequisites(requisites) {
  let current = {};
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      current = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {};
    }
  } catch (e) {
    console.error('settings.json o\'qishda xatolik (saqlashdan oldin):', e.message);
  }
  current.paymentRequisites = Object.assign({}, DEFAULT_PAYMENT_REQUISITES, current.paymentRequisites || {}, requisites || {});
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(current, null, 2));
  } catch (e) {
    console.error('settings.json yozishda xatolik:', e.message);
  }
  return current.paymentRequisites;
}

// ==================== 82-BOSQICH: Egasi o'zi obuna sotib olishi ====================
// (avtomatik so'rov + admin tasdig'i). Owner "💳 Obuna" bo'limida (Mini App'da
// yoki bot ichida /obuna_menyu orqali) tarif tanlaydi -> to'lov skrinshotini
// shu botga rasm qilib yuboradi -> BARCHA adminlarga (allAdminIds()) ✅/❌
// tugmali xabar boradi -> admin tasdiqlasa subscriptionUntil AVTOMATIK
// tanlangan tarif muddatiga uzaytiriladi va to'lov payments.json'ga yoziladi.
//
// owner.subscriptionPaymentRequest — bitta owner uchun FAQAT bitta joriy
// so'rov saqlanadi (yangi tarif tanlansa eskisi ustidan yoziladi):
//   { id, planId, planLabel, amount, days,
//     status: 'kutilmoqda_skrinshot' | 'kutilmoqda_tasdiq' | 'tasdiqlandi' | 'rad_etildi',
//     screenshotFileId, requestedAt, screenshotSentAt, decidedAt, decidedBy }
// PRORATSIYA (tarif yuqorilashida narx farqi): agar owner hali tugamagan
// "qoldiq kunlar"ga ega bo'lsa (masalan, arzon Starter rejasidan 29 kun
// qolgan) va yangi tanlangan reja BOSHQA (va qimmatroq) F-bo'lim tarifiga
// bog'langan bo'lsa (masalan, Business), o'sha qoldiq kunlar ESKI (arzon)
// narxda emas, YANGI (qimmat) tarif narxida hisoblanishi kerak — aks holda
// owner "narxlar farqi"ni umuman to'lamay, qoldiq kunlarni yangi qimmat
// tarifda bepul ishlatib qoladi (shu funksiyaning yuqoridagi izohidagi
// ekspluatatsiya). Shu sabab: qoldiq kunlar uchun (yangi_kunlik_narx −
// eski_kunlik_narx) farqi qo'shimcha to'lov sifatida qo'shiladi.
// Eslatma: faqat YUQORILASHDA (farq musbat bo'lganda) qo'llanadi — pastroq
// tarifga o'tishda (yoki tariffId o'zgarmasa) hech qanday ustama olinmaydi,
// owner shunchaki yangi reja narxini to'lab davom etadi.
function calcTariffUpgradeSurcharge(owner, plan) {
  const result = { surcharge: 0, remainingDays: 0, isUpgrade: false, oldDailyPrice: 0, newDailyPrice: 0 };
  if (!plan || !plan.tariffId || !plan.days) return result;
  // Owner hali biror tarifda bo'lmasa (yangi ro'yxatdan o'tgan yoki
  // tariffId'siz reja bilan boshlagan) — solishtiradigan "eski narx" yo'q,
  // ustama hisoblanmaydi (bu birinchi tarif tanlovi, "yuqorilash" emas).
  if (!owner.activePlanTariffId) return result;
  // Tarif o'zgarmasa (xuddi shu tariffId'ga qayta/uzaytirib sotib olish) —
  // ustama yo'q, oddiy uzaytirish.
  if (owner.activePlanTariffId === plan.tariffId) return result;
  const untilMs = owner.subscriptionUntil ? new Date(owner.subscriptionUntil).getTime() : NaN;
  const remainingMs = (Number.isFinite(untilMs) && untilMs > Date.now()) ? (untilMs - Date.now()) : 0;
  if (remainingMs <= 0) return result; // qoldiq kun yo'q — ustama uchun asos yo'q
  const remainingDays = Math.ceil(remainingMs / 86400000);
  const oldDailyPrice = owner.activePlanDailyPrice || 0;
  const newDailyPrice = plan.price / plan.days;
  result.remainingDays = remainingDays;
  result.oldDailyPrice = oldDailyPrice;
  result.newDailyPrice = newDailyPrice;
  const diffPerDay = newDailyPrice - oldDailyPrice;
  if (diffPerDay > 0) {
    result.isUpgrade = true;
    result.surcharge = Math.round(diffPerDay * remainingDays);
  }
  return result;
}

function createSubscriptionPaymentRequest(owner, planId) {
  const plans = loadSubscriptionPlans();
  const plan = plans[planId];
  if (!plan) return null;
  // Reja qaysi F-bo'lim tarifini bilan bog'langan bo'lsa (admin
  // "Obuna rejalari"da sozlagan), shu tarif nomini ham so'rovga
  // "suratga olib" saqlaymiz — keyin tarif o'chirilsa/o'zgarsa ham
  // so'rovdagi ko'rsatilgan nom to'g'ri qoladi.
  let tariffLabel = null;
  if (plan.tariffId) {
    const tariff = loadTariffs().find(t => t.id === plan.tariffId);
    tariffLabel = tariff ? tariff.name : null;
  }
  const upgrade = calcTariffUpgradeSurcharge(owner, plan);
  owner.subscriptionPaymentRequest = {
    id: crypto.randomBytes(6).toString('hex'),
    planId: plan.id,
    planLabel: plan.label,
    baseAmount: plan.price,
    upgradeSurcharge: upgrade.surcharge,
    upgradeRemainingDays: upgrade.isUpgrade ? upgrade.remainingDays : 0,
    amount: plan.price + upgrade.surcharge,
    days: plan.days,
    tariffId: plan.tariffId || null,
    tariffLabel,
    status: 'kutilmoqda_skrinshot',
    screenshotFileId: null,
    requestedAt: new Date().toISOString(),
    screenshotSentAt: null,
    decidedAt: null,
    decidedBy: null
  };
  return owner.subscriptionPaymentRequest;
}

// Owner "💳 Obuna" bo'limini ochganda ko'radigan matn+tugmalar (bot ichida
// ham, Mini App'dan "skrinshot yuboring" bosqichiga o'tishda ham ishlatiladi).
async function sendObunaPlansMenu(owner, chatId) {
  const requisites = loadPaymentRequisites();
  const plans = loadSubscriptionPlans();
  const tariffs = loadTariffs();
  const list = Object.values(plans).sort((a, b) => (a.order || 0) - (b.order || 0));
  const planLines = list.map(p => {
    const tariff = p.tariffId ? tariffs.find(t => t.id === p.tariffId) : null;
    const tariffNote = tariff ? ` — tarif: ${escapeHtmlServer(tariff.name)}` : '';
    const upgrade = calcTariffUpgradeSurcharge(owner, p);
    const upgradeNote = upgrade.isUpgrade
      ? ` <i>(+${fmtNum(upgrade.surcharge)} so'm ustama — qolgan ${upgrade.remainingDays} kun uchun tarif farqi, jami ${fmtNum(p.price + upgrade.surcharge)} so'm)</i>`
      : '';
    return `• <b>${escapeHtmlServer(p.label)}</b> — ${fmtNum(p.price)} so'm${p.discountNote ? ' (' + escapeHtmlServer(p.discountNote) + ')' : ''}${tariffNote}${upgradeNote}`;
  }).join('\n');
  const text = `💳 <b>Obuna tarifini tanlang</b>\n\n${planLines}\n\n` +
    `To'lov rekvizitlari:\n💳 Karta: <code>${escapeHtmlServer(requisites.cardNumber)}</code>\n👤 Egasi: ${escapeHtmlServer(requisites.cardHolder)}\n\n` +
    `Tarifni tanlang, so'ng shu summani ko'rsatilgan kartaga o'tkazib, TO'LOV CHEKI (skrinshot) ni shu botga rasm qilib yuboring.`;
  const kb = { inline_keyboard: list.map(p => [{ text: `${p.label} — ${fmtNum(p.price)} so'm`, callback_data: `subplan:${p.id}` }]) };
  await sendMessage(chatId, text, kb);
}

// Admin ✅/❌ bosganda (bot callback'dan) VA admin panelidan (Mini App API'dan)
// bir xil natija chiqishi uchun qaror mantiqi shu YAGONA joyda. Chaqiruvchi
// tomon saveOwners(owners)ni O'ZI qiladi (bu funksiya faylga yozmaydi).
function decideSubscriptionPayment(owner, action, decidedByUserId, reasonText) {
  const reqData = owner && owner.subscriptionPaymentRequest;
  if (!reqData || reqData.status !== 'kutilmoqda_tasdiq') {
    return { ok: false, reason: 'So\'rov topilmadi yoki allaqachon ko\'rib chiqilgan.' };
  }

  if (action === 'approve') {
    const plans = loadSubscriptionPlans();
    const plan = plans[reqData.planId];
    const days = (plan && plan.days) || reqData.days || 30;
    // Muddat hali tugamagan bo'lsa - USHBU muddatning USTIGA qo'shiladi (grace
    // davrida bo'lsa yoki allaqachon tugagan bo'lsa - hozirgi vaqtdan boshlanadi).
    const baseMs = (owner.subscriptionUntil && new Date(owner.subscriptionUntil).getTime() > Date.now())
      ? new Date(owner.subscriptionUntil).getTime()
      : Date.now();
    const newUntil = new Date(baseMs + days * 86400000);
    owner.subscriptionUntil = newUntil.toISOString();
    owner.expiresAt = owner.subscriptionUntil; // orqaga moslik uchun eski maydon ham yangilanadi
    owner.subscriptionStatus = SUBSCRIPTION_STATUS.ACTIVE;
    owner.graceUntil = null;
    owner.blockedNotifiedAt = null;
    owner.reminderSentAt = null; // keyingi muddat uchun eslatma qaytadan yuborilishi kerak
    owner.paid = true;
    owner.paidAt = new Date().toISOString();
    // Reja bilan F-bo'lim tarifi ham bog'langan bo'lsa (admin "Obuna
    // rejalari"da tariffId sozlagan), owner'ning funksiya-tarifi ham shu
    // rejaga mos tarifga AVTOMATIK o'zgaradi. tariffId yo'q (null) bo'lsa —
    // owner'ning joriy tarifi tegilmaydi (faqat muddat uzayadi).
    const grantedTariffId = plan ? (plan.tariffId || null) : null;
    if (grantedTariffId) {
      owner.tariffId = grantedTariffId;
      // Keyingi safar (agar owner yana boshqa tarifga o'tsa) proratsiya
      // to'g'ri hisoblanishi uchun, HOZIR tasdiqlangan rejaning kunlik
      // narxini "joriy tarif narxi" sifatida eslab qolamiz (qarang:
      // calcTariffUpgradeSurcharge).
      owner.activePlanTariffId = grantedTariffId;
      owner.activePlanDailyPrice = plan.days ? (plan.price / plan.days) : 0;
    }
    reqData.status = 'tasdiqlandi';
    reqData.decidedAt = new Date().toISOString();
    reqData.decidedBy = decidedByUserId;
    recordPayment(owner, reqData.amount, {
      planId: reqData.planId, planLabel: reqData.planLabel, days,
      baseAmount: reqData.baseAmount != null ? reqData.baseAmount : reqData.amount,
      upgradeSurcharge: reqData.upgradeSurcharge || 0,
      source: 'subscription'
    });
    const tariffNote = reqData.tariffLabel ? `\nTarif: ${escapeHtmlServer(reqData.tariffLabel)}` : '';
    sendMessage(owner.id,
      `✅ <b>Obuna to'lovingiz tasdiqlandi!</b>\nReja: ${escapeHtmlServer(reqData.planLabel)}${tariffNote}\n` +
      `Yangi muddat: ${newUntil.toLocaleDateString('uz-UZ')}gacha.\nRahmat! 🙏`);
    return { ok: true, newUntil: owner.subscriptionUntil };
  }

  if (action === 'reject') {
    reqData.status = 'rad_etildi';
    reqData.decidedAt = new Date().toISOString();
    reqData.decidedBy = decidedByUserId;
    const trimmedReason = reasonText ? String(reasonText).trim() : '';
    reqData.rejectReason = trimmedReason || null;
    const reasonLine = trimmedReason
      ? `Sabab: ${escapeHtmlServer(trimmedReason)}`
      : 'Skrinshot noto\'g\'ri yoki summa mos emas bo\'lishi mumkin.';
    sendMessage(owner.id,
      `❌ <b>Obuna to'lovingiz rad etildi.</b>\n${reasonLine}\n` +
      `Qaytadan tarif tanlab urinib ko'ring yoki administrator bilan bog'laning.`);
    return { ok: true };
  }

  return { ok: false, reason: 'Noma\'lum amal.' };
}


// (hisob-kitob-bot'dagi access_control.check_subscription_access() bilan bir
// xil vazifa). Bitta owner obyekti uchun holatni hisoblaydi:
//   - pending_trial — admin hali trial muddatini tasdiqlamagan (kirish yo'q).
//   - subscriptionUntil yo'q (null) — muddatsiz/doimiy ruxsat.
//   - subscriptionUntil hali o'tmagan — faol, daysLeft bilan.
//   - subscriptionUntil o'tgan, lekin graceUntil (yoki standart
//     SUBSCRIPTION_GRACE_DAYS) ichida — hali ruxsat bor, lekin inGrace:true
//     (⏳ ogohlantirish uchun, keyingi bosqichda ishlatiladi).
//   - graceUntil ham o'tgan — bloklangan.
// DIQQAT: bu funksiya hali hech qayerdan CHAQIRILMAYDI — faqat tayyorlab
// qo'yilyapti. Haqiqiy bloklash (Mini App API va bot xabarlari darajasida)
// keyingi ikkita bosqichda ulanadi.
function getOwnerSubscriptionAccess(owner) {
  if (!owner) return { allowed: false, status: 'unknown', daysLeft: null, inGrace: false };

  if (owner.subscriptionStatus === SUBSCRIPTION_STATUS.PENDING_TRIAL) {
    return { allowed: false, status: SUBSCRIPTION_STATUS.PENDING_TRIAL, daysLeft: null, inGrace: false };
  }

  if (!owner.subscriptionUntil) {
    return { allowed: true, status: SUBSCRIPTION_STATUS.ACTIVE, daysLeft: null, inGrace: false };
  }

  const untilMs = new Date(owner.subscriptionUntil).getTime();
  const now = Date.now();
  if (Number.isFinite(untilMs) && untilMs > now) {
    const daysLeft = Math.ceil((untilMs - now) / 86400000);
    return { allowed: true, status: SUBSCRIPTION_STATUS.ACTIVE, daysLeft, inGrace: false };
  }

  // Muddat tugagan — graceUntil belgilangan bo'lsa shundan, bo'lmasa
  // SUBSCRIPTION_GRACE_DAYS asosida standart muhlat hisoblanadi.
  const graceMs = owner.graceUntil
    ? new Date(owner.graceUntil).getTime()
    : (Number.isFinite(untilMs) ? untilMs + SUBSCRIPTION_GRACE_DAYS * 86400000 : NaN);
  if (Number.isFinite(graceMs) && graceMs > now) {
    return { allowed: true, status: SUBSCRIPTION_STATUS.ACTIVE, daysLeft: 0, inGrace: true };
  }

  return { allowed: false, status: SUBSCRIPTION_STATUS.BLOCKED, daysLeft: null, inGrace: false };
}

// Foydalanuvchi ID bo'yicha (admin/owner/xodim — kim bo'lishidan qat'iy
// nazar) yagona tekshiruv. `owners` ixtiyoriy — chaqiruvchi allaqachon
// loadOwners() qilgan bo'lsa, qayta o'qimaslik uchun uzatilishi mumkin.
function checkSubscriptionAccess(userId, owners) {
  if (isAdminId(userId)) {
    return { allowed: true, status: 'admin', daysLeft: null, inGrace: false };
  }

  const list = owners || loadOwners();

  const owner = findOwner(list, userId);
  if (owner) return getOwnerSubscriptionAccess(owner);

  const staffInfo = findStaffInfo(list, userId);
  if (staffInfo) {
    const staffOwner = list.find(o => String(o.id) === String(staffInfo.ownerId));
    return getOwnerSubscriptionAccess(staffOwner);
  }

  return { allowed: false, status: 'unknown', daysLeft: null, inGrace: false };
}

// 77-BOSQICH: Mini App API darajasida bloklash. `resolveOwnerContext()` (va
// bir nechta joyda to'g'ridan-to'g'ri `isOwnerAccessValid()`) allaqachon
// muddati (grace period bilan) chindan tugagan egalar/xodimlarni "topilmadi"
// (null / ruxsat yo'q) deb hisoblab, ularni amaldagi funksiyalarga
// kiritmaydi — ya'ni HAQIQIY bloklash allaqachon ishlayapti.
//
// Lekin bu holatda frontend'ga qaytadigan xabar boshqa har qanday "ruxsat
// yo'q" holati (masalan, umuman ro'yxatdan o'tmagan begona foydalanuvchi)
// bilan bir xil edi — frontend ular orasidagi farqni bilolmasdi, shuning
// uchun ✋ "obunani uzaytiring" ekranini emas, oddiy xato xabarini ko'rsatib
// qo'yardi. Quyidagi ikkita funksiya shu farqni chiqaradi:
//   - getBlockedOwnerAccess(): userId biror EGA yoki XODIM ekanini (hatto
//     bloklangan bo'lsa ham) aniqlaydi va aynan SHU sabab (obuna) tufayli
//     ruxsat yo'qligini alohida ko'rsatadi (aks holda null qaytaradi —
//     ya'ni muammo obunada emas, masalan foydalanuvchi umuman egasi/xodim
//     emas yoki roli mos kelmayapti).
//   - subscriptionBlockedJSON(): endpoint javobini tayyorlaydi — agar sabab
//     aynan obuna bo'lsa maxsus { reason:'subscription_blocked', access }
//     shaklida, aks holda avvalgidek oddiy fallbackReason bilan.
function getBlockedOwnerAccess(owners, userId) {
  if (isAdminId(userId)) return null;

  const owner = findOwner(owners, userId);
  if (owner) {
    const access = getOwnerSubscriptionAccess(owner);
    return access.allowed ? null : access;
  }

  const staffInfo = findStaffInfo(owners, userId);
  if (staffInfo) {
    const staffOwner = owners.find(o => String(o.id) === String(staffInfo.ownerId));
    const access = getOwnerSubscriptionAccess(staffOwner);
    return access.allowed ? null : access;
  }

  return null;
}

function subscriptionBlockedJSON(owners, userId, fallbackReason) {
  const access = getBlockedOwnerAccess(owners, userId);
  if (access) return { ok: false, reason: 'subscription_blocked', access };
  return { ok: false, reason: fallbackReason };
}

// 79-BOSQICH: Telegram bot darajasida bloklash (8-bosqichdagi Mini App API
// bloklashning bot tomonidagi jufti — hisob-kitob-bot'dagi
// OwnerOnlyMiddleware._send_blocked_screen andozasida). Owner yoki uning
// xodimi bot ichida biror amal (guruh biriktirish, buyurtmani "qabul
// qilish"/"tayyor" deb belgilash, to'lovni tasdiqlash va h.k.) bajarmoqchi
// bo'lganda, lekin obunasi (grace period bilan birga) chindan tugagan
// bo'lsa — shu ekran chiqadi. `/start` va kelgusi "Ro'yxatdan o'tish"
// (10-bosqich) bu tekshiruvdan MUSTASNO — ular har doim ishlaydi, chunki
// ular handleStartCommand() ichida, bu funksiyani chaqirmasdan alohida
// ishlaydi.
async function sendSubscriptionBlockedScreen(chatId, access) {
  // 10-bosqich: o'zi ro'yxatdan o'tgan, lekin admin hali tasdiqlamagan
  // ("pending_trial") holat — "obunangiz TUGAGAN" degan matn noto'g'ri
  // bo'lardi (u hali boshlanmagan ham), shuning uchun alohida xabar.
  if (access.status === SUBSCRIPTION_STATUS.PENDING_TRIAL) {
    await sendMessage(chatId,
      "🕓 <b>So'rovingiz hali ko'rib chiqilmoqda</b>\n" +
      "Administrator tasdiqlagach, sizga xabar boradi va Mini App ochiladi.");
    return;
  }
  const graceNote = access.inGrace ? '\n(Muhlat davri ham tugadi.)' : '';
  await sendMessage(chatId,
    `⛔ <b>Obunangiz tugagan</b>\nBotdagi va Mini App'dagi amallar vaqtincha bloklandi.${graceNote}\n` +
    `Ma'lumotlaringiz (menyu, xodimlar, buyurtmalar tarixi) saqlanib qolyapti — obunani uzaytirsangiz, kirish avtomatik tiklanadi.`,
    { inline_keyboard: [[{ text: '💳 Obunani uzaytirish', callback_data: 'obuna_menyu' }]] });
}

// Berilgan ownerId (callback_data'dagi) egasi obuna sababli bloklanganmi —
// tekshiradi, bloklangan bo'lsa callback'ga qisqa javob + shaxsiy chatga
// to'liq bloklash ekranini yuboradi va true qaytaradi (chaqiruvchi shu
// holda darhol `return` qilishi kerak). Bloklanmagan bo'lsa false qaytadi.
async function guardCallbackSubscription(cq, owners, ownerId) {
  const owner = findOwner(owners, ownerId);
  const access = getOwnerSubscriptionAccess(owner);
  if (access.allowed) return false;
  await answerCallbackQuery(cq.id, '⛔ Obuna muddati tugagan.', true);
  await sendSubscriptionBlockedScreen(cq.from.id, access);
  return true;
}

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

// 71-bosqich: har bir o'qishda owner obyektlariga yangi obuna maydonlarini
// (mavjud bo'lmasa) to'ldirib beradi — shu bilan owners.json faylini qo'lda
// migratsiya qilmasdan turib ham, kod ichida hamma joyda yangi maydonlar
// (subscriptionStatus/subscriptionUntil/graceUntil/trialGivenAt) doim mavjud
// bo'lishi kafolatlanadi.
function loadOwners() { return loadJSONArray(OWNERS_FILE).map(ensureSubscriptionFields); }
function saveOwners(owners) { saveJSONArray(OWNERS_FILE, owners); }

function loadInvites() { return loadJSONArray(INVITES_FILE); }
function saveInvites(invites) { saveJSONArray(INVITES_FILE, invites); }

function loadRequests() { return loadJSONArray(REQUESTS_FILE); }
function saveRequests(reqs) { saveJSONArray(REQUESTS_FILE, reqs); }

// ====== To'lovlar tarixi (67-bosqich) — har bir "to'landi" voqeasi alohida
// yozuv sifatida saqlanadi, shunda admin dashboardida haqiqiy (joriy holat
// emas, balki vaqt bo'yicha) daromad hisoblanadi. Owner o'chirilsa/muddati
// tugasa ham bu yozuvlar saqlanib qoladi (69-bosqich).
function loadPayments() { return loadJSONArray(PAYMENTS_FILE); }
function savePayments(list) { saveJSONArray(PAYMENTS_FILE, list); }

// ====== E'lon/broadcast tarixi (48-51-bosqich) ======
function loadBroadcasts() { return loadJSONArray(BROADCASTS_FILE); }
function saveBroadcasts(list) { saveJSONArray(BROADCASTS_FILE, list); }

function recordPayment(owner, amount, extra) {
  const amountVal = Number(amount) || 0;
  if (amountVal <= 0) return; // 0 so'mlik "to'lov"ni jurnalga yozmaymiz
  const payments = loadPayments();
  payments.push({
    id: crypto.randomBytes(6).toString('hex'),
    ownerId: owner.id,
    ownerLabel: owner.username ? '@' + owner.username : String(owner.id),
    amount: amountVal,
    tariffId: owner.tariffId || null,
    // 15-bosqich (B-bo'lim): agar bu to'lov "💳 Obuna" (tarif muddatini
    // uzaytirish) orqali bo'lgan bo'lsa, qaysi reja/necha kunlik ekanligi
    // ham saqlanadi — owner o'ziga tegishli "Obuna tarixi"ni ko'rishi uchun
    // (qarang: /api/subscription-history). Boshqa manbalardan (masalan,
    // admin qo'lda "to'landi" belgilashi) kelgan to'lovlarda bu maydonlar
    // shunchaki null bo'lib qoladi — orqaga moslik buzilmaydi.
    planId: (extra && extra.planId) || null,
    planLabel: (extra && extra.planLabel) || null,
    days: (extra && extra.days) || null,
    source: (extra && extra.source) || null,
    // Tarif yuqorilashida qo'shilgan ustama (agar bo'lsa) — hisobot/audit
    // uchun asosiy narxdan alohida saqlanadi (qarang: calcTariffUpgradeSurcharge).
    baseAmount: (extra && extra.baseAmount != null) ? extra.baseAmount : null,
    upgradeSurcharge: (extra && extra.upgradeSurcharge) || 0,
    at: new Date().toISOString()
  });
  savePayments(payments);
}

// ====== Buyurtmalar arxivi (69-bosqich) — obunachi (do'kon egasi) o'chirilganda
// owner.orders shu yerga ko'chiriladi, shunda buyurtmalar tarixi yo'qolmaydi ======
function loadArchivedOrders() { return loadJSONArray(ARCHIVED_ORDERS_FILE); }
function saveArchivedOrders(list) { saveJSONArray(ARCHIVED_ORDERS_FILE, list); }
function archiveOwnerOrders(owner) {
  const orders = owner && owner.orders;
  if (!orders || !orders.length) return; // buyurtmasi bo'lmagan egani arxivlashning hojati yo'q
  const archive = loadArchivedOrders();
  archive.push({
    type: 'owner_removed', // butunlay o'chirilgan owner'ning buyurtmalari (Savatcha/tozalash oqimi)
    ownerId: owner.id,
    ownerLabel: owner.username ? '@' + owner.username : String(owner.id),
    removedAt: new Date().toISOString(),
    orders
  });
  saveArchivedOrders(archive);
}

// ====== Buyurtmalar retensiyasi (100-bosqich) — owners.json cheksiz
// o'sib ketmasligi uchun, ESKI (ORDERS_RETENTION_DAYS'dan katta) buyurtmalar
// owner.orders'dan olib tashlanadi va shu YUQORIDAGI arxiv fayliga
// ('archived_orders.json', type: 'retention') ko'chiriladi — O'CHIRILMAYDI,
// faqat asosiy (har so'rovda to'liq o'qib-yoziladigan) fayldan chiqariladi.
// Bu bilan: 1) owners.json hajmi va har bir yozish tezligi vaqt o'tishi bilan
// cheksiz o'smaydi; 2) statistikaga (cashflow, AI Direktor, xodimlar
// hisoboti) ta'sir qilmaydi, chunki ular hammasi oxirgi 30-90 kunga qaraydi,
// bu esa ORDERS_RETENTION_DAYS'dan ancha kam; 3) ma'lumot yo'qolmaydi —
// kerak bo'lsa archived_orders.json'dan tiklash/ko'rish mumkin.
const ORDERS_RETENTION_DAYS = parseInt(process.env.ORDERS_RETENTION_DAYS, 10) || 120;
const ORDERS_ARCHIVE_HOUR = 4; // Toshkent vaqti, tungi soat 04:00 — eng kam yuklama vaqti
let lastOrdersArchiveDateKey = null; // shu kun uchun allaqachon ishlaganini bildiradi (qayta-qayta ishlab ketmasligi uchun)

function archiveOldOrdersAcrossOwners() {
  const owners = loadOwners();
  const cutoffTime = Date.now() - ORDERS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const archive = loadArchivedOrders();
  let ownersChanged = false;
  let archiveChanged = false;
  let totalArchived = 0;

  for (const owner of owners) {
    const orders = owner.orders;
    if (!orders || !orders.length) continue;
    const keep = [];
    const old = [];
    for (const o of orders) {
      const t = new Date(o.createdAt).getTime();
      // createdAt noto'g'ri/yo'q bo'lsa — xavfsiz tomonda qolamiz: o'chirmaymiz.
      if (Number.isFinite(t) && t < cutoffTime) old.push(o);
      else keep.push(o);
    }
    if (old.length) {
      archive.push({
        type: 'retention',
        ownerId: owner.id,
        ownerLabel: owner.username ? '@' + owner.username : String(owner.id),
        archivedAt: new Date().toISOString(),
        retentionDays: ORDERS_RETENTION_DAYS,
        count: old.length,
        orders: old
      });
      owner.orders = keep;
      ownersChanged = true;
      archiveChanged = true;
      totalArchived += old.length;
    }
  }

  if (archiveChanged) saveArchivedOrders(archive);
  if (ownersChanged) saveOwners(owners);
  return totalArchived;
}

// Har 10 daqiqada tekshiradi: Toshkent vaqti ORDERS_ARCHIVE_HOUR bo'lganda
// va bugun hali ishlamagan bo'lsa — bir marta arxivlashni ishga tushiradi.
setInterval(() => {
  try {
    if (aiDirTashkentHour(new Date()) !== ORDERS_ARCHIVE_HOUR) return;
    const todayKey = aiDirDateKey(new Date());
    if (lastOrdersArchiveDateKey === todayKey) return;
    lastOrdersArchiveDateKey = todayKey;
    const count = archiveOldOrdersAcrossOwners();
    if (count > 0) console.log(`[buyurtmalar arxivlandi] ${count} ta eski buyurtma owners.json'dan archived_orders.json'ga ko'chirildi.`);
  } catch (err) {
    console.error('[buyurtmalar arxivlash xatosi]', err && err.message);
  }
}, 10 * 60 * 1000);

// ==================== C-bo'lim (16-22-bosqich): "Savatcha" (o'chirilgan
// do'kon egalarini vaqtincha saqlash) ====================
// Ilgari /api/remove-owner ownerni owners.json'dan BUTUNLAY, DARHOL
// o'chirib yuborardi (faqat buyurtmalar tarixi alohida arxivlanardi —
// menyu, xodimlar, sozlamalar esa qaytarib bo'lmaydigan tarzda yo'qolardi).
// Endi shu o'rniga owner TO'LIQ holicha (barcha maydonlari bilan) "Savatcha"
// (trash.json) ga ko'chiriladi va TRASH_AUTO_PURGE_DAYS muddat ichida:
//   - admin xohlagan payt admin paneldan to'g'ridan-to'g'ri tiklashi mumkin;
//   - YOKI o'chirilgan owner o'zi botga /start yozganda "tiklashni so'rash"
//     tugmasini bosadi -> so'rov BARCHA adminlarga boradi -> admin
//     tasdiqlasa (✅/❌ tugmalari bilan, boshqa hech kim emas — 21-bosqich)
//     owner AYNAN o'sha holatida (sozgamalari bilan, 20-bosqich) qaytariladi.
// Muddat o'tsa (19-bosqich) — avtomatik, qaytarib bo'lmaydigan tarzda
// o'chiriladi (faqat buyurtmalar tarixi archiveOwnerOrders() orqali
// saqlanib qoladi, xuddi ilgarigidek). Har bir voqea (trashed/restore
// so'ralgan/tiklandi/rad etildi/butunlay o'chirildi) trash_log.json'ga
// yoziladi (22-bosqich).
const TRASH_FILE = path.join(DATA_DIR, 'trash.json');
const TRASH_LOG_FILE = path.join(DATA_DIR, 'trash_log.json');
const TRASH_AUTO_PURGE_DAYS = 3;

function loadTrash() { return loadJSONArray(TRASH_FILE); }
function saveTrash(list) { saveJSONArray(TRASH_FILE, list); }
function loadTrashLog() { return loadJSONArray(TRASH_LOG_FILE); }
function saveTrashLog(list) { saveJSONArray(TRASH_LOG_FILE, list); }

// 22-bosqich: Savatcha bilan bog'liq har bir voqea shu yerga yoziladi —
// admin keyinchalik "kim, qachon, nima uchun o'chirilgan/tiklangan" ni
// tekshira olishi uchun (owner o'chirilgan taqdirda ham log qolaveradi).
function logTrashEvent(action, owner, extra) {
  const log = loadTrashLog();
  log.push(Object.assign({
    id: crypto.randomBytes(6).toString('hex'),
    action, // 'trashed' | 'restore_requested' | 'restored' | 'restore_rejected' | 'purged'
    ownerId: owner ? owner.id : null,
    ownerLabel: owner ? ownerLabel(owner) : null,
    at: new Date().toISOString()
  }, extra || {}));
  saveTrashLog(log);
}

// 16-bosqich: ownerni butunlay o'chirish o'rniga shu funksiya chaqiriladi.
function moveOwnerToTrash(owner, trashedByUserId) {
  const trash = loadTrash();
  const trashedAt = new Date();
  const autoPurgeAt = new Date(trashedAt.getTime() + TRASH_AUTO_PURGE_DAYS * 86400000);
  trash.push({
    id: crypto.randomBytes(6).toString('hex'),
    ownerSnapshot: owner,
    trashedAt: trashedAt.toISOString(),
    autoPurgeAt: autoPurgeAt.toISOString(),
    trashedBy: trashedByUserId ? String(trashedByUserId) : null,
    restoreStatus: 'none', // 'none' | 'pending' | 'rejected'
    restoreRequestedAt: null
  });
  saveTrash(trash);
  logTrashEvent('trashed', owner, { trashedBy: trashedByUserId ? String(trashedByUserId) : null });
}

function findTrashEntry(trash, trashId) {
  return trash.find(t => t.id === trashId);
}

function findTrashEntryByOwnerId(trash, ownerId) {
  return trash.find(t => String(t.ownerSnapshot && t.ownerSnapshot.id) === String(ownerId));
}

// 20-bosqich: tiklanganda ownerSnapshot TO'LIQ (barcha sozlamalari,
// menyusi, xodimlari, buyurtmalari bilan) owners.json'ga qaytariladi —
// admin yoki owner hech narsani qayta sozlashi shart emas.
function restoreOwnerFromTrash(trashEntry) {
  const owners = loadOwners();
  if (findOwner(owners, trashEntry.ownerSnapshot.id)) {
    return { ok: false, reason: 'Bu ID bilan allaqachon boshqa do\'kon egasi mavjud.' };
  }
  owners.push(trashEntry.ownerSnapshot);
  saveOwners(owners);
  return { ok: true };
}

// 19-bosqich: har soatlik interval (checkOwnerExpirations bilan bir
// vaqtda) TRASH_AUTO_PURGE_DAYS muddati o'tgan yozuvlarni butunlay,
// qaytarib bo'lmaydigan tarzda o'chiradi — faqat buyurtmalar tarixi
// (archiveOwnerOrders orqali) alohida saqlanib qoladi.
async function checkTrashAutoPurge() {
  const trash = loadTrash();
  const now = Date.now();
  const remaining = [];
  let purgedAny = false;
  for (const entry of trash) {
    if (new Date(entry.autoPurgeAt).getTime() <= now) {
      purgedAny = true;
      archiveOwnerOrders(entry.ownerSnapshot);
      logTrashEvent('purged', entry.ownerSnapshot, { reason: 'auto_3_kun' });
    } else {
      remaining.push(entry);
    }
  }
  if (purgedAny) saveTrash(remaining);
}

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
  { id: 'banner-manage', name: "Reklama banner boshqaruvi", group: 'menyu' },
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
  { id: 'support-chat', name: "Tezkor qo'llab-quvvatlash chat", group: 'mijoz' },
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

// 78-BOSQICH: Ko'p adminli tizim.
// admins.json'ni o'qiydi/yozadi. Har bir yozuv: { id, addedAt, addedBy }.
function loadAdmins() { return loadJSONArray(ADMINS_FILE); }
function saveAdmins(admins) {
  saveJSONArray(ADMINS_FILE, admins);
  reloadAdminsCache(admins);
}

// Xotiradagi Set — har bir so'rovda faylni qayta o'qimaslik uchun. Server
// ishga tushganda (server.listen ichida) va admins.json har safar
// o'zgartirilganda (saveAdmins() orqali) yangilanadi.
let EXTRA_ADMIN_IDS = new Set();
function reloadAdminsCache(admins) {
  const list = admins || loadAdmins();
  EXTRA_ADMIN_IDS = new Set(list.map(a => String(a.id)));
}

// Qo'shimcha admin qo'shish/o'chirish (keyingi bosqichda admin panelidagi
// "Adminlar" bo'limi shu funksiyalarni chaqiradi). Bootstrap ADMIN_ID bu
// yerga hech qachon qo'shilmaydi — u alohida, ENV orqali ustuvor tekshiriladi.
function addExtraAdmin(id, addedBy) {
  const idStr = String(id);
  if (idStr === String(ADMIN_ID)) return loadAdmins(); // bootstrap allaqachon admin — qo'shishning hojati yo'q
  const admins = loadAdmins();
  if (admins.some(a => String(a.id) === idStr)) return admins; // allaqachon bor
  admins.push({ id: idStr, addedAt: new Date().toISOString(), addedBy: addedBy ? String(addedBy) : null });
  saveAdmins(admins);
  return admins;
}
function removeExtraAdmin(id) {
  const idStr = String(id);
  const admins = loadAdmins().filter(a => String(a.id) !== idStr);
  saveAdmins(admins);
  return admins;
}

// Bootstrap ADMIN_ID (ENV) YOKI admins.json'dagi (xotiraga yuklangan)
// qo'shimcha adminlardan biri bo'lsa — admin hisoblanadi.
function isAdminId(userId) {
  const idStr = String(userId);
  return idStr === String(ADMIN_ID) || EXTRA_ADMIN_IDS.has(idStr);
}

// 10-bosqich: o'zi ro'yxatdan o'tgan yangi oshxona egasi haqidagi xabar
// BARCHA adminlarga (bootstrap ADMIN_ID + admins.json'dagi qo'shimchalar)
// yuborilishi kerak — faqat bittasiga emas (78-bosqichdagi ko'p adminli
// tizimga mos).
function allAdminIds() {
  return Array.from(new Set([String(ADMIN_ID), ...EXTRA_ADMIN_IDS]));
}

function findOwner(owners, userId) {
  return owners.find(o => String(o.id) === String(userId));
}

// 76-BOSQICH: MUHIM TUZATISH. Ilgari bu funksiya faqat owner.expiresAt'ga
// qarab ha/yo'q javob berardi — grace period (muhlat) tushunchasi umuman
// yo'q edi. Endi 75-bosqichda tayyorlangan getOwnerSubscriptionAccess()'ga
// ishlaydi: muddat tugagan bo'lsa ham, SUBSCRIPTION_GRACE_DAYS ichida hali
// kirish ruxsat etiladi (hisob-kitob-bot'dagi trial+grace mantig'i bilan bir
// xil). owner.expiresAt endi to'g'ridan-to'g'ri ishlatilmaydi — buning
// o'rniga owner.subscriptionUntil/subscriptionStatus (71-bosqichda
// ensureSubscriptionFields orqali expiresAt'dan hosil qilingan) ishlatiladi.
function isOwnerAccessValid(owner) {
  return getOwnerSubscriptionAccess(owner).allowed;
}

// 76-BOSQICH: MUHIM TUZATISH. Ilgari bu funksiya nomiga mos ravishda
// muddati tugagan (isOwnerAccessValid()===false) egalarni owners.json'dan
// BUTUNLAY O'CHIRIB YUBORARDI — menyu, xodimlar, buyurtmalar tarixi bilan
// birga. Bu hisob-kitob-bot'dagi yumshoq bloklash (grace period, ma'lumot
// hech qachon o'chmasligi) mantig'iga ZID edi va eng jiddiy farq shu edi.
//
// ENDI BU FUNKSIYA HECH KIMNI O'CHIRMAYDI. Vazifasi: muddati (grace period
// bilan birga) chindan tugagan egalarning subscriptionStatus maydonini
// 'blocked' deb belgilab qo'yish (va aksincha — to'lov/uzaytirish natijasida
// yana faol bo'lib qolganlarni 'active'ga qaytarish), so'ng owners.json'ga
// saqlash va TO'LIQ ro'yxatni (bloklanganlar ham ichida) qaytarish.
//
// Funksiya nomi ATAYLAB eskicha qoldirilgan (pruneExpiredOwners) — bu nom
// kod bo'ylab 40dan ortiq joyda "joriy owners ro'yxatini olib kelish"
// ma'nosida chaqirilgan; ularning barchasini qayta yozib, xato qilib
// qo'yish xavfi o'rniga, xulq shu YAGONA joyda xavfsiz tarzda o'zgartirildi.
// pending_trial holatidagi egalarga tegilmaydi — ular hali obuna
// boshlamagan, ularning statusini admin trial tasdiqlash oqimi o'zgartiradi.
function pruneExpiredOwners() {
  const owners = loadOwners();
  let changed = false;
  owners.forEach(owner => {
    if (owner.subscriptionStatus === SUBSCRIPTION_STATUS.PENDING_TRIAL) return;
    const nextStatus = getOwnerSubscriptionAccess(owner).allowed
      ? SUBSCRIPTION_STATUS.ACTIVE
      : SUBSCRIPTION_STATUS.BLOCKED;
    if (owner.subscriptionStatus !== nextStatus) {
      owner.subscriptionStatus = nextStatus;
      changed = true;
    }
  });
  if (changed) saveOwners(owners);
  return owners;
}

// ====== Xodimlar (kassir, oshpaz, sklad, dostavka) — har bir egasining o'z ro'yxati ichida saqlanadi ======
const STAFF_ROLES = {
  kassir: 'Kassir',
  oshpaz: 'Oshpaz',
  sklad: 'Sklad mas\'uli',
  dostavka: 'Kuryer'
};

// 2-4-bosqich: har bir xodim roliga mos "panel" funksiyasi (tarif orqali
// yopilishi mumkin bo'lgan FEATURE_CATALOG id'si). `sklad` bu yerda yo'q —
// uning kirishi allaqachon 'stock-manage' funksiyasi orqali cheklanadi.
const ROLE_PANEL_FEATURE = {
  kassir: 'cashier-panel',
  oshpaz: 'kitchen-panel',
  dostavka: 'courier-panel'
};

// Xodimning barcha rollaridan FAQAT egasining joriy tarifida ochiq bo'lganlarini
// qaytaradi. Tarifda mos panel funksiyasi ❌ qilingan bo'lsa — o'sha rol
// ro'yxatdan olib tashlanadi (xodim o'sha panelga umuman kira olmaydi).
function allowedStaffRoles(owner, roles) {
  return (roles || []).filter(r => {
    const featureId = ROLE_PANEL_FEATURE[r];
    if (!featureId) return true; // bu rol uchun alohida panel-funksiyasi yo'q (masalan sklad) — cheklanmaydi
    return ownerCanUseFeature(owner, featureId);
  });
}

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

// ---- Dostavka bekor qilinishi (mijoz javob bermay/telefon o'chirib qo'yib
// kuryerga yetkazib berilmagan buyurtmalar) takrorlansa - shu mijozga endi
// "naqd/dostavka orqali" to'lov ko'rsatilmaydi, faqat "Karta" (oldindan
// to'lov) qoladi. Shunda kuryer behuda yo'lga chiqib, pulini ololmay
// qolish xavfi kamayadi. ----
const CARD_ONLY_AFTER_CANCELLED_DELIVERIES = 2;
function customerCancelledDeliveryCount(owner, userId) {
  return (owner.orders || []).filter(o =>
    String(o.customerId) === String(userId) &&
    o.orderType === 'dostavka' &&
    o.status === 'bekor_qilindi'
  ).length;
}
function customerIsCardOnlyRestricted(owner, userId) {
  // Egasi "Cheklangan mijozlar" ekranidan bu cheklovni qo'lda olib tashlagan
  // bo'lishi mumkin (masalan, bekor qilishning sababi asosli bo'lgan) —
  // shunday bo'lsa, bekor qilingan buyurtmalar soni chegaradan oshgan
  // bo'lsa ham cheklov qo'llanmaydi.
  if ((owner.cardOnlyOverrides || []).some(id => String(id) === String(userId))) return false;
  return customerCancelledDeliveryCount(owner, userId) >= CARD_ONLY_AFTER_CANCELLED_DELIVERIES;
}

// ---- Mijozlar reytingi (65-bosqich): har bir dostavka yetkazilgach mijoz
// 1-5 yulduz va ixtiyoriy sharh qoldirishi mumkin (qarang: 'rate:' callback
// va pastdagi pendingReviewComments). Bu funksiya o'sha baholarning
// o'rtachasini hisoblaydi — admin panelida do'konlarni reyting bo'yicha
// saralash va egasining o'z "Mijoz sharhlari" ekranida ko'rsatish uchun.
function ownerRatedOrders(owner) {
  return (owner.orders || []).filter(o => Number.isFinite(o.customerRating));
}
function ownerAverageRating(owner) {
  const rated = ownerRatedOrders(owner);
  if (!rated.length) return { avg: null, count: 0 };
  const sum = rated.reduce((s, o) => s + o.customerRating, 0);
  return { avg: Math.round((sum / rated.length) * 10) / 10, count: rated.length };
}

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
  if (o.status === 'bekor_qilindi') return 0;
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

// Berilgan userId qaysi egasining xodimi ekanini (va rol(lar)ini) topadi.
// 2-4-bosqich: xodimga biriktirilgan rollardan FAQAT tarifda ochiq bo'lgan
// panellarga mos keladiganlari qaytariladi (masalan owner kassir panelini
// tarifda yopib qo'ygan bo'lsa — kassir xodimi endi kassir sifatida hech
// narsaga kira olmaydi, garchi owner.staff'da rol hali ham saqlanayotgan
// bo'lsa ham). Owner o'z xodimlarini boshqarishda (staff-list) baribir
// RAW (filtrlanmagan) rollarni ko'radi — u yerda findStaffInfo ishlatilmaydi.
function findStaffInfo(owners, userId) {
  for (const owner of owners) {
    const staff = (owner.staff || []).find(s => String(s.id) === String(userId));
    if (staff) {
      const rawRoles = normalizeStaffRoles(staff);
      const roles = allowedStaffRoles(owner, rawRoles);
      return {
        ownerId: owner.id,
        ownerName: (owner.profile && owner.profile.name) || null,
        ownerLogoUrl: (owner.profile && owner.profile.logoUrl) || null,
        ownerBrandColor: (owner.profile && owner.profile.brandColor) || null,
        role: roles[0] || null,
        roles,
        rawRoles,
        staff
      };
    }
  }
  return null;
}

// Berilgan userId qaysi oshxonaga tegishli ekanini aniqlaydi (egasining o'zi yoki uning xodimi)
// Qaytaradi: { owner, role, roles, branchId } — role: 'egasi' yoki xodimning birinchi roli
// (orqaga moslik uchun), roles: xodimga biriktirilgan BARCHA rollar massivi; topilmasa null
function resolveOwnerContext(owners, userId, opts) {
  // 65-bosqich: admin ba'zan yangi/tajribasiz oshxona egasi uchun menyu yoki
  // skladni o'zi to'ldirib berishi kerak bo'ladi. Shunday holatda so'rov
  // payload'ida targetOwnerId yuboriladi — bu holda haqiqiy egasi/xodim
  // aniqlanmay, to'g'ridan-to'g'ri o'sha egasi nomidan "egasi" rolida ishlanadi.
  // Faqat chaqiruvchi rostdan ham admin bo'lsagina (isAdminId) ishlaydi.
  if (opts && opts.targetOwnerId && isAdminId(userId)) {
    const targetOwner = findOwner(owners, opts.targetOwnerId);
    if (!targetOwner) return null;
    return { owner: targetOwner, role: 'egasi', roles: ['egasi'], branchId: null, isAdminActing: true };
  }
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
      addresses: [],
      bonusPoints: 0,
      ordersCount: 0,
      totalSpent: 0,
      createdAt: new Date().toISOString()
    };
    owner.customers.push(c);
  } else {
    if (tgUser && tgUser.username) c.username = tgUser.username;
    if (tgUser && tgUser.first_name) c.firstName = tgUser.first_name;
    // 56-bosqich: eski mijozlarda "addresses" maydoni bo'lmasligi mumkin
    // (funksiya qo'shilishidan oldin yaratilgan) — shu yerda to'ldiramiz.
    if (!Array.isArray(c.addresses)) c.addresses = [];
  }
  return c;
}

// ---- H64-bosqich: "AI ofitsiant" — mijozni tanib, doim yoqtiradigan
// taomlarini va ularga o'xshash (bir xil toifadagi, hali sinab ko'rmagan)
// taomlarni tavsiya qiladi. Haqiqiy tashqi AI chaqirilmaydi — mijozning
// o'z xarid tarixi (customer.itemFrequency) tahlil qilinadi, shuning uchun
// tezkor va bepul ishlaydi, lekin mijozga "meni tanidi" degan tuyg'u beradi.
function buildAiWaiterRecommendations(owner, userId, availableMenu) {
  const customer = findCustomer(owner, userId);
  const empty = { favorites: [], similar: [] };
  if (!customer || !customer.itemFrequency || customer.ordersCount < 1) return empty;

  const freqEntries = Object.entries(customer.itemFrequency).sort((a, b) => b[1] - a[1]);
  if (!freqEntries.length) return empty;

  // 1) "Doim yoqtiradigan" — eng ko'p buyurtma qilingan, hozir ham menyuda
  //    mavjud bo'lgan taomlar (eng ko'pi 4 tasi, ko'zni band qilmasin).
  const favorites = [];
  for (const [itemId, count] of freqEntries) {
    const item = availableMenu.find(m => m.id === itemId);
    if (item) favorites.push(Object.assign({}, item, { orderedCount: count }));
    if (favorites.length >= 4) break;
  }
  if (!favorites.length) return empty;

  // 2) "Sizga yoqishi mumkin" — eng sevimli 2 ta taomning TOIFASIDAN, mijoz
  //    HALI SINAB KO'RMAGAN boshqa taomlar (retsept/tarkib emas, toifa
  //    bo'yicha o'xshashlik — menyu strukturasida mavjud yagona umumiy
  //    belgi shu).
  const triedIds = new Set(freqEntries.map(([id]) => id));
  const topCategories = [...new Set(favorites.slice(0, 2).map(f => f.category).filter(Boolean))];
  const similar = [];
  if (topCategories.length) {
    for (const item of availableMenu) {
      if (triedIds.has(item.id)) continue;
      if (!item.category || !topCategories.includes(item.category)) continue;
      similar.push(item);
      if (similar.length >= 4) break;
    }
  }

  return { favorites, similar };
}


const MAX_CUSTOMER_ADDRESSES = 15;

function findCustomerAddress(customer, addressId) {
  return (customer.addresses || []).find(a => a.id === addressId);
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
function notifyStaffList(owner, targetIds, text, context, category) {
  // 59-bosqich: agar `category` berilgan bo'lsa va egasi shu toifani
  // o'chirib qo'ygan bo'lsa (owner.notificationPrefs[category] === false),
  // EGANING o'ziga xabar yubormaymiz — lekin xodimlarga baribir boradi
  // (bu sozlama faqat egasi uchun, xodimlar o'z xabarlarini o'chira olmaydi).
  const ownerMuted = category && isNotificationCategoryMuted(owner, category);
  const uniqueIds = [...new Set((targetIds || []).map(String))]
    .filter(id => !(ownerMuted && id === String(owner.id)));
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

// 59-bosqich: owner.notificationPrefs — { newOrder, lowStock, staffActions }
// (hammasi standart bo'yicha yoqilgan — maydon umuman yo'q yoki `undefined`
// bo'lsa MUTED emas deb hisoblanadi, faqat ANIQ `false` o'chirilgan deb
// hisoblanadi). Obuna/to'lov/tasdiqlash kabi MUHIM xabarlar bu yerga
// kirmaydi — ular hech qachon o'chirib bo'lmaydi.
const NOTIFICATION_CATEGORIES = {
  newOrder: 'Yangi buyurtma xabarlari',
  lowStock: 'Ombordagi kam qoldiq ogohlantirishlari'
};

function isNotificationCategoryMuted(owner, category) {
  return !!(owner && owner.notificationPrefs && owner.notificationPrefs[category] === false);
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

// Xodimlarga (kassir/oshpaz/dostavka guruhi) yuboriladigan xabarlarda mijoz
// ism-familiyasi VA telefon raqami har doim birga ko'rsatilishi uchun —
// order.customerPhone mavjud bo'lsa qo'shimcha qator qo'shiladi.
function orderCustomerContactLabel(order) {
  const lines = [`Mijoz: ${escapeHtmlServer(order.customerName)}`];
  if (order.customerPhone) lines.push(`Tel: ${escapeHtmlServer(order.customerPhone)}`);
  return lines.join('\n');
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

// 71-BOSQICH: raqamlarni o'qishga oson qilib chiqarish uchun (1000 -> "1 000",
// 100000 -> "100 000"). Pul summalari va boshqa katta raqamlar shu orqali chiqariladi.
function fmtNum(n) {
  const num = Math.round(Number(n) || 0);
  return num.toLocaleString('ru-RU').replace(/,/g, ' ');
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
  if (!ownerCanUseFeature(owner, 'delivery-group')) return; // 11-bosqich: tarif keyin o'zgartirilgan bo'lsa ham xabar ketmasin
  const itemsText = order.items.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
  const mapsLink = locationMapsLink(order.location);
  const addressLines = [
    mapsLink ? `📍 Joylashuv: ${mapsLink}` : null,
    order.addressNote ? `📝 Manzil izohi: ${escapeHtmlServer(order.addressNote)}` : null,
    order.extraPhone ? `📞 Qo'shimcha tel: ${escapeHtmlServer(order.extraPhone)}` : null,
  ].filter(Boolean).join('\n');
  const typeLabel = ORDER_TYPES[order.orderType] || order.orderType;
  const headerEmoji = order.orderType === 'dostavka' ? '🚚' : (order.orderType === 'stol' ? '🍽' : '🥡');
  const tableLine = order.tableNumber ? ` — stol ${escapeHtmlServer(order.tableNumber)}` : '';
  const text = `${headerEmoji} <b>Yangi buyurtma</b> (${typeLabel}${tableLine})${creatorLabel ? '\n' + creatorLabel : ''}\n${itemsText}\n\nJami: ${fmtNum(order.total)} so'm\nTo'lov: ${PAYMENT_TYPES[order.paymentType] || order.paymentType}` +
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
  if (!ownerCanUseFeature(owner, 'kitchen-group')) return; // 11-bosqich: tarif keyin o'zgartirilgan bo'lsa ham xabar ketmasin
  try {
    const itemsText = order.items.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
    const typeLabel = ORDER_TYPES[order.orderType] || order.orderType;
    const tableLine = order.tableNumber ? ` — stol ${escapeHtmlServer(order.tableNumber)}` : '';
    const text = `👨‍🍳 <b>Yangi buyurtma</b> (${typeLabel}${tableLine})${creatorLabel ? '\n' + creatorLabel : ''}\n${itemsText}\n\nJami: ${fmtNum(order.total)} so'm`;
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

// 76-BOSQICH (davomi): Bu funksiya YUQORIDAGI pruneExpiredOwners()dan
// MUSTAQIL, alohida yo'l bilan har soatda (setInterval, server.listen
// ichida) ishga tushadi va u ham xuddi shunday muddati tugagan egalarni
// owners.json'dan BUTUNLAY o'chirib yuborardi (stillActive massivi orqali).
// Ya'ni faqat pruneExpiredOwners()ni tuzatish YETARLI EMAS edi — bu funksiya
// ham xuddi shu muammoga ega edi. Endi ikkalasi ham bir xil: hech kimni
// o'chirmaydi, faqat subscriptionStatus'ni yangilaydi.
//
// "Bloklandi" xabari endi FAQAT BIR MARTA yuboriladi (owner.blockedNotifiedAt
// orqali kuzatiladi) — aks holda har soat qayta-qayta kelaverardi. Owner
// qayta faol bo'lib qolsa (to'lov/uzaytirish natijasida), shu maydon
// tozalanadi — keyingi safar chindan bloklansa, xabar yana yuboriladi.
async function checkOwnerExpirations() {
  const owners = loadOwners();
  let changed = false;

  for (const owner of owners) {
    // O'zi ro'yxatdan o'tib, admin hali trial muddatini tasdiqlamagan
    // egalarga bu yerda tegilmaydi — ularning holati faqat admin
    // tasdiqlash/rad etish oqimi orqali o'zgaradi.
    if (owner.subscriptionStatus === SUBSCRIPTION_STATUS.PENDING_TRIAL) continue;

    const access = getOwnerSubscriptionAccess(owner);

    if (!access.allowed) {
      if (owner.subscriptionStatus !== SUBSCRIPTION_STATUS.BLOCKED) {
        owner.subscriptionStatus = SUBSCRIPTION_STATUS.BLOCKED;
        changed = true;
      }
      if (!owner.blockedNotifiedAt) {
        owner.blockedNotifiedAt = new Date().toISOString();
        changed = true;
        await sendMessage(ADMIN_ID,
          `⏰ <b>Obuna muddati tugadi</b>\n${ownerLabel(owner)} (ID: <code>${owner.id}</code>) uchun Mini App'ga kirish bloklandi.\nMa'lumotlari (menyu, xodimlar, buyurtmalar) saqlanib qolyapti — obuna uzaytirilsa, kirish avtomatik tiklanadi.`);
        await sendMessage(owner.id,
          `⏰ Sizning obuna muddatingiz tugadi, Mini App'ga kirish bloklandi.\nMa'lumotlaringiz saqlanib qolyapti — obunani uzaytirsangiz, kirish avtomatik tiklanadi.\nUzaytirish uchun Mini App'dagi "💳 Obuna" bo'limini oching yoki quyidagi tugmani bosing.`,
          { inline_keyboard: [[{ text: '💳 Obunani uzaytirish', callback_data: 'obuna_menyu' }]] });
      }
      continue;
    }

    // Hali ruxsat bor (faol yoki grace davrida) — status shunga mos
    // yangilanadi va eski bloklanish belgisi tozalanadi.
    if (owner.subscriptionStatus !== SUBSCRIPTION_STATUS.ACTIVE) {
      owner.subscriptionStatus = SUBSCRIPTION_STATUS.ACTIVE;
      changed = true;
    }
    if (owner.blockedNotifiedAt) {
      owner.blockedNotifiedAt = null;
      changed = true;
    }

    if (owner.subscriptionUntil && !owner.reminderSentAt) {
      const expiresMs = new Date(owner.subscriptionUntil).getTime();
      const now = Date.now();
      if (Number.isFinite(expiresMs) && expiresMs > now && expiresMs - now <= ownerReminderBeforeMs(owner)) {
        changed = true;
        owner.reminderSentAt = new Date().toISOString();
        const daysLeft = Math.max(1, Math.ceil((expiresMs - now) / 86400000));
        await sendMessage(ADMIN_ID,
          `🔔 <b>Obuna tugashiga oz qoldi</b>\n${ownerLabel(owner)} (ID: <code>${owner.id}</code>) — taxminan ${daysLeft} kundan keyin tugaydi.`);
        await sendMessage(owner.id,
          `🔔 Sizning obunangiz tez orada tugaydi (taxminan ${daysLeft} kun qoldi).\nUzaytirish uchun Mini App'dagi "💳 Obuna" bo'limini oching yoki quyidagi tugmani bosing.`,
          { inline_keyboard: [[{ text: '💳 Obunani uzaytirish', callback_data: 'obuna_menyu' }]] });
      }
    }
  }

  if (changed) saveOwners(owners);
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

// ==================== 52-54-BOSQICH: DB zaxira (backup) eksport/import ====================
// Butun bazani (DATA_DIR ichidagi barcha .json fayllar) bitta faylga
// jamlab yuklab olish (52), o'sha faylni yuklab bazani tiklash (53) va
// buni xavfsiz, ikki bosqichli tasdiqlash bilan qilish (54).
// MUHIM: bu ro'yxat DATA_DIR'dagi HAMMA fayl konstantalarini o'z ichiga
// olishi kerak — yangi *_FILE qo'shilsa, shu yerga ham (key + file) qo'shing.
const BACKUP_FILE_DEFS = [
  { key: 'owners', file: OWNERS_FILE },
  { key: 'admins', file: ADMINS_FILE },
  { key: 'invites', file: INVITES_FILE },
  { key: 'requests', file: REQUESTS_FILE },
  { key: 'profiles', file: PROFILES_FILE },
  { key: 'tariffs', file: TARIFFS_FILE },
  { key: 'payments', file: PAYMENTS_FILE },
  { key: 'archived_orders', file: ARCHIVED_ORDERS_FILE },
  { key: 'subscription_plans', file: SUBSCRIPTION_PLANS_FILE },
  { key: 'settings', file: SETTINGS_FILE },
  { key: 'broadcasts', file: BROADCASTS_FILE },
  { key: 'trash', file: TRASH_FILE },
  { key: 'trash_log', file: TRASH_LOG_FILE },
  { key: 'awaiting', file: AWAITING_FILE }
];
const BACKUP_FORMAT_VERSION = 1;
// Tiklashdan OLDIN joriy holatni avtomatik saqlab qo'yish uchun papka —
// noto'g'ri/eskirgan zaxira yuklansa ham, oldingi holatga qaytish imkoni bo'lsin.
const PRE_RESTORE_BACKUP_DIR = path.join(DATA_DIR, 'pre_restore_backups');
// Tasdiqlash kodlari xotirada saqlanadi (server qayta ishga tushsa, eskiradi —
// bu ataylab shunday: xavfsizlik uchun kod umr bo'yi kuchda qolmasligi kerak).
const pendingBackupRestores = new Map(); // token -> { adminId, contentHash, createdAt, snapshot }
const BACKUP_RESTORE_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 daqiqa

function readJSONFileRaw(file) {
  try {
    if (!fs.existsSync(file)) return { present: false, value: null };
    const raw = fs.readFileSync(file, 'utf8');
    return { present: true, value: JSON.parse(raw) };
  } catch (e) {
    return { present: false, value: null, error: e.message };
  }
}

// 52-bosqich: barcha DB fayllarini bitta obyektga jamlaydi.
function buildBackupSnapshot(adminId) {
  const files = {};
  const counts = {};
  for (const def of BACKUP_FILE_DEFS) {
    const r = readJSONFileRaw(def.file);
    files[def.key] = r.present ? r.value : (Array.isArray(r.value) ? [] : null);
    counts[def.key] = Array.isArray(files[def.key]) ? files[def.key].length
      : (files[def.key] && typeof files[def.key] === 'object' ? Object.keys(files[def.key]).length : 0);
  }
  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: String(adminId),
    counts,
    files
  };
}

// 53-bosqich: zaxiradan olingan fayllarni DATA_DIR'ga qaytaradi. Har bir
// fayl avval vaqtinchalik nomga yoziladi, so'ng almashtiriladi (atomik) —
// yozish paytida xatolik chiqib qolsa ham eski fayl buzilmaydi.
function writeJSONFileAtomic(file, value) {
  const tmp = file + '.tmp' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function applyBackupSnapshot(snapshot) {
  const applied = [];
  for (const def of BACKUP_FILE_DEFS) {
    if (!snapshot.files || !(def.key in snapshot.files)) continue; // zaxirada yo'q — teginilmaydi
    const value = snapshot.files[def.key];
    if (value === null || value === undefined) continue;
    writeJSONFileAtomic(def.file, value);
    applied.push(def.key);
  }
  reloadAdminsCache(); // admins.json to'g'ridan-to'g'ri yozildi — xotiradagi Set yangilanishi shart
  return applied;
}

// Tiklashdan oldin joriy holatni diskka saqlab qo'yadi (xavfsizlik).
function savePreRestoreSafetySnapshot(adminId) {
  try {
    fs.mkdirSync(PRE_RESTORE_BACKUP_DIR, { recursive: true });
    const snapshot = buildBackupSnapshot(adminId);
    const filename = `pre_restore_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(PRE_RESTORE_BACKUP_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    // Faqat oxirgi 10 tasini saqlaymiz — disk to'lib ketmasligi uchun.
    const files = fs.readdirSync(PRE_RESTORE_BACKUP_DIR).filter(f => f.startsWith('pre_restore_')).sort();
    while (files.length > 10) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(PRE_RESTORE_BACKUP_DIR, old)); } catch (e) {}
    }
    return filename;
  } catch (e) {
    console.error('pre-restore xavfsizlik nusxasini saqlashda xatolik:', e.message);
    return null;
  }
}

// Eski (muddati o'tgan) tasdiqlash kodlarini vaqti-vaqti bilan tozalab turadi.
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of pendingBackupRestores.entries()) {
    if (now - entry.createdAt > BACKUP_RESTORE_TOKEN_TTL_MS) pendingBackupRestores.delete(token);
  }
}, 5 * 60 * 1000);

function getAwaitingCustom() {
  try {
    const raw = fs.readFileSync(AWAITING_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function setAwaitingCustom(reqId, promptMessageId) {
  fs.writeFileSync(AWAITING_FILE, JSON.stringify({ kind: 'approve_days', reqId, promptMessageId }), 'utf8');
}

// 10-bosqich: admin obuna to'lovini rad etayotganda sababni yozib yuborishini
// kutish uchun (yuqoridagi setAwaitingCustom bilan bir xil AWAITING_FILE'ni
// ishlatadi, lekin `kind` orqali ajratiladi — bir vaqtda faqat bitta admin
// amali "kutilayotgan" bo'lishi mumkin, bu butun botdagi umumiy naqshga mos).
function setAwaitingSubRejectReason(ownerId, chatId, messageId, hasPhoto, originalContent) {
  fs.writeFileSync(AWAITING_FILE, JSON.stringify({ kind: 'sub_reject_reason', ownerId, chatId, messageId, hasPhoto, originalContent }), 'utf8');
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

// ====== 10-BOSQICH: o'z-o'zidan ro'yxatdan o'tish (self-registration) ======
// Notanish foydalanuvchi "📝 Ro'yxatdan o'tish" tugmasini bossa, uning
// keyingi yuboradigan xabarini OSHXONA NOMI sifatida kutamiz. Xotirada
// saqlanadi (server qayta ishga tushsa tozalanadi — foydalanuvchi tugmani
// qayta bossa yetarli, ma'lumot yo'qolmaydi, chunki hali owner sifatida
// SAQLANMAGAN).
const pendingSelfRegistration = new Set(); // userId(string) larni saqlaydi
// 65-bosqich: mijoz yulduz bilan baholagach, keyingi (buyruq bo'lmagan)
// matnli xabarini shu buyurtmaga sharh sifatida bog'laymiz. Key: mijoz
// telegram ID'si (string) -> { ownerId, orderId, expiresAt }. 30 daqiqadan
// keyin eskirgan deb hisoblanadi (pastda tekshiriladi) — shundan keyin
// kelgan oddiy xabar sharh sifatida qabul qilinmaydi.
const pendingReviewComments = new Map();
const REVIEW_COMMENT_WINDOW_MS = 30 * 60 * 1000;

// /start buyrug'ining asosiy mantiqi (taklif havolasi, mijoz menyu havolasi va h.k.) —
// alohida funksiyaga ajratildi, chunki ro'yxatdan o'tish tugagandan keyin ham
// xuddi shu logikani (asl /start matni bilan) qayta ishga tushirish kerak bo'ladi.
async function handleStartCommand(chatId, from, text) {
  const parts = text.split(' ');
  const payload = parts.length > 1 ? parts[1].trim() : '';

  if (!payload) {
    if (isAdminId(from.id)) {
      await sendMessage(chatId, 'Salom, admin! Mini App tugmasi orqali boshqaruv panelini oching.');
      return;
    }
    const owners = loadOwners();
    if (findOwner(owners, from.id) || findStaffInfo(owners, from.id)) {
      await sendMessage(chatId, 'Salom! Mini App tugmasi orqali boshqaruv panelini oching.');
      return;
    }
    // 17-bosqich: agar bu foydalanuvchi "Savatcha"da bo'lsa (admin tomonidan
    // o'chirilgan, lekin hali TRASH_AUTO_PURGE_DAYS muddati o'tmagan) —
    // ro'yxatdan o'tish o'rniga tiklashni so'rash imkoni ko'rsatiladi.
    const trash = loadTrash();
    const trashEntry = findTrashEntryByOwnerId(trash, from.id);
    if (trashEntry) {
      if (trashEntry.restoreStatus === 'pending') {
        await sendMessage(chatId,
          '🕓 Oshxonangizni tiklash so\'rovingiz allaqachon adminga yuborilgan, tasdiqlanishini kuting.');
        return;
      }
      const daysLeft = Math.max(0, Math.ceil((new Date(trashEntry.autoPurgeAt).getTime() - Date.now()) / 86400000));
      await sendMessage(chatId,
        `⚠️ Oshxonangiz o'chirilgan (Savatchada saqlanmoqda, ${daysLeft} kun ichida tiklash mumkin).\n` +
        `Barcha ma'lumotlaringiz (menyu, xodimlar, sozlamalar) saqlanib turibdi. Tiklashni so'rasangiz, so'rovingiz administratorga yuboriladi.`,
        { inline_keyboard: [[{ text: '🔄 Tiklashni so\'rash', callback_data: `request_restore:${trashEntry.id}` }]] });
      return;
    }
    // 10-bosqich: avval bu yerda "sizga taklif havolasi kerak" deb qat'iy
    // to'xtatilardi — endi notanish foydalanuvchi ham o'zi ro'yxatdan
    // o'tishi mumkin, taklif havolasiz.
    await sendMessage(chatId,
      `👋 <b>KitchenOS</b>ga xush kelibsiz!\n` +
      `Bu — oshxonangiz uchun buyurtma qabul qilish va boshqarish tizimi (menyu, xodimlar, sklad, hisobotlar).\n\n` +
      `O'z oshxonangizni ro'yxatdan o'tkazish uchun quyidagi tugmani bosing:`,
      { inline_keyboard: [[{ text: "📝 Ro'yxatdan o'tish", callback_data: 'self_register_start' }]] });
    return;
  }

  // Mijoz uchun oshxona menyusi havolasi: /start menu_<ownerId>
  // 57-bosqich: QR-kod orqali stolga bog'langan havola bo'lsa —
  // /start menu_<ownerId>_table_<stolRaqami> ko'rinishida keladi (qarang:
  // /api/table-qr-link — egasi shu havoladan stol uchun QR yaratadi).
  // Bunday holatda Mini App to'g'ridan-to'g'ri o'sha stol raqami bilan,
  // "Stolga" buyurtma turi oldindan tanlangan holda ochiladi.
  if (payload.startsWith('menu_')) {
    let rest = payload.replace(/^menu_/, '').trim();
    let tableNumber = null;
    const tableMatch = rest.match(/^(.*)_table_(.+)$/);
    if (tableMatch) {
      rest = tableMatch[1];
      tableNumber = tableMatch[2];
    }
    const ownerId = rest;
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
    let menuUrl = `${PUBLIC_URL.replace(/\/$/, '')}/?customer=${encodeURIComponent(owner.id)}`;
    if (tableNumber) menuUrl += `&table=${encodeURIComponent(tableNumber)}`;
    const welcomeText = tableNumber
      ? `🍽 <b>${escapeHtmlServer(restaurantName)}</b> — stol ${escapeHtmlServer(tableNumber)} uchun buyurtma bering!`
      : `🍽 <b>${escapeHtmlServer(restaurantName)}</b> menyusiga xush kelibsiz!`;
    await sendMessage(chatId, welcomeText, {
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
        const blocked = getBlockedOwnerAccess(owners, from.id);
        if (blocked) await sendSubscriptionBlockedScreen(chatId, blocked);
        else await sendMessage(chatId, 'Faqat tasdiqlangan oshxona egasi guruhni biriktira oladi.');
        return;
      }
      if (!ownerCanUseFeature(owner, 'delivery-group')) {
        await sendMessage(chatId, featureBlockedResult('delivery-group').reason);
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
        const blocked = getBlockedOwnerAccess(owners, from.id);
        if (blocked) await sendSubscriptionBlockedScreen(chatId, blocked);
        else await sendMessage(chatId, 'Faqat tasdiqlangan oshxona egasi guruhni biriktira oladi.');
        return;
      }
      if (!ownerCanUseFeature(owner, 'kitchen-group')) {
        await sendMessage(chatId, featureBlockedResult('kitchen-group').reason);
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

    // ---- 65-bosqich: yulduz bilan baholagandan keyin so'ralgan ixtiyoriy
    // sharh — mijoz yozgan keyingi (buyruq bo'lmagan) oddiy xabarni shu
    // buyurtmaga sharh sifatida yozib qo'yamiz va egasi/adminlarga xabar
    // qilamiz (ular buni "Mijoz sharhlari" ekranida ham ko'rishadi). ----
    if (!text.startsWith('/') && pendingReviewComments.has(String(from.id))) {
      const pending = pendingReviewComments.get(String(from.id));
      pendingReviewComments.delete(String(from.id));
      if (pending.expiresAt >= Date.now()) {
        const owners = loadOwners();
        const owner = findOwner(owners, pending.ownerId);
        const order = owner && (owner.orders || []).find(o => String(o.id) === String(pending.orderId));
        if (owner && order && !order.customerComment) {
          const commentTrim = text.trim().slice(0, 500);
          if (commentTrim) {
            order.customerComment = commentTrim;
            order.customerCommentAt = new Date().toISOString();
            saveOwners(owners);
            await sendMessage(chatId, 'Fikringiz uchun rahmat! 🙏');

            const starsText = '⭐️'.repeat(order.customerRating || 0);
            const notifyText = `💬 <b>Mijoz sharhi</b> (${starsText})\n"${escapeHtmlServer(commentTrim)}"\n\nMijoz: ${orderCustomerContactLabel(order)}`;
            const staffList = owner.staff || [];
            const targetIds = staffList.filter(s => ['egasi', 'kassir'].includes(s.role)).map(s => s.id);
            for (const targetId of new Set([owner.id, ...targetIds])) {
              sendMessage(targetId, notifyText);
            }
            for (const adminId of allAdminIds()) {
              sendMessage(adminId, `${notifyText}\n\nOshxona: ${escapeHtmlServer((owner.profile && owner.profile.name) || owner.id)}`);
            }
          }
        }
      }
      return;
    }

    // ---- 10-bosqich: "📝 Ro'yxatdan o'tish" bosilgandan keyin, foydalanuvchi
    // yuborgan keyingi (buyruq bo'lmagan) xabarni OSHXONA NOMI sifatida
    // qabul qilamiz va pending_trial holatida yangi owner yaratamiz. ----
    if (!isAdminId(from.id) && !text.startsWith('/') && pendingSelfRegistration.has(String(from.id))) {
      const restaurantName = text.trim();
      if (restaurantName.length < 2 || restaurantName.length > 60) {
        await sendMessage(chatId, "Iltimos, oshxona nomini 2 tadan 60 belgigacha oralig'ida yozing.");
        return;
      }
      pendingSelfRegistration.delete(String(from.id));

      const owners = loadOwners();
      // Ehtiyot chorasi: shu vaqt ichida boshqa yo'l bilan (masalan admin
      // qo'lda) allaqachon ro'yxatga qo'shilgan bo'lishi mumkin.
      if (findOwner(owners, from.id)) {
        await sendMessage(chatId, 'Siz allaqachon ro\'yxatdan o\'tgansiz. Mini App tugmasi orqali oching.');
        return;
      }

      const newOwner = {
        id: String(from.id),
        username: from.username || null,
        addedAt: new Date().toISOString(),
        expiresAt: null,
        price: 0,
        paid: false,
        paidAt: null,
        // pending_trial — admin tasdiqlaguncha kirish yo'q (qarang:
        // getOwnerSubscriptionAccess). Tasdiqlash — 11-bosqich.
        subscriptionStatus: SUBSCRIPTION_STATUS.PENDING_TRIAL,
        subscriptionUntil: null,
        graceUntil: null,
        trialGivenAt: null,
        profile: { name: restaurantName }
      };
      owners.push(newOwner);
      saveOwners(owners);

      await sendMessage(chatId,
        `✅ So'rovingiz qabul qilindi!\n<b>${escapeHtmlServer(restaurantName)}</b> nomi bilan ro'yxatga olindi.\n` +
        `Administrator tasdiqlashini kuting — tasdiqlangach shu yerga xabar boradi.`);

      const adminText =
        `🆕 <b>Yangi oshxona — o'zi ro'yxatdan o'tdi</b>\n` +
        `Oshxona: <b>${escapeHtmlServer(restaurantName)}</b>\n` +
        `Ega: ${displayName(from)}${from.username ? ' (@' + escapeHtmlServer(from.username) + ')' : ''}\n` +
        `ID: <code>${from.id}</code>\n\n` +
        `Sinov muddatini tasdiqlaysizmi? (tasdiqlansa ${SUBSCRIPTION_TRIAL_DAYS} kunlik standart sinov beriladi)`;
      const approveKb = {
        inline_keyboard: [[
          { text: '✅ Tasdiqlash', callback_data: `approve_trial:${newOwner.id}` },
          { text: '❌ Rad etish', callback_data: `reject_trial:${newOwner.id}` }
        ]]
      };
      for (const adminId of allAdminIds()) {
        sendMessage(adminId, adminText, approveKb);
      }
      return;
    }

    // Admin "Boshqa son" tugmasini bosgandan keyin, keyingi xabarini kun soni sifatida kutamiz
    if (isAdminId(from.id) && !text.startsWith('/')) {
      const awaiting = getAwaitingCustom();
      if (awaiting && awaiting.kind === 'approve_days' && awaiting.reqId) {
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

      // 10-bosqich: admin obuna to'lovini rad etish sababini yozmoqda
      if (awaiting && awaiting.kind === 'sub_reject_reason' && awaiting.ownerId) {
        const owners = loadOwners();
        const owner = findOwner(owners, awaiting.ownerId);
        clearAwaitingCustom();
        if (!owner || !owner.subscriptionPaymentRequest || owner.subscriptionPaymentRequest.status !== 'kutilmoqda_tasdiq') {
          await sendMessage(chatId, 'Bu so\'rov allaqachon ko\'rib chiqilgan.');
          return;
        }
        const reasonText = text.trim();
        decideSubscriptionPayment(owner, 'reject', from.id, reasonText);
        saveOwners(owners);

        const restaurantName = ownerLabel(owner);
        const extraLine = `❌ Rad etildi — ${displayName(from)}\nSabab: ${escapeHtmlServer(reasonText)}`;
        if (awaiting.chatId && awaiting.messageId) {
          const mergedContent = `${awaiting.originalContent || ''}\n\n${extraLine}`;
          if (awaiting.hasPhoto) {
            await editMessageCaption(awaiting.chatId, awaiting.messageId, mergedContent, null);
          } else {
            await editMessageText(awaiting.chatId, awaiting.messageId, mergedContent, null);
          }
        } else {
          await sendMessage(chatId, `❌ Rad etildi. Oshxona: ${escapeHtmlServer(restaurantName)}\nSabab: ${escapeHtmlServer(reasonText)}`);
        }
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
      // Buyurtma to'lovi topilmadi - balki bu OSHXONA EGASINING o'ZI tanlagan
      // OBUNA TARIFI uchun skrinshot bo'lishi mumkin (82-bosqich).
      const subOwner = findOwner(owners, userId);
      if (subOwner && subOwner.subscriptionPaymentRequest &&
          subOwner.subscriptionPaymentRequest.status === 'kutilmoqda_skrinshot') {
        const reqData = subOwner.subscriptionPaymentRequest;
        const photos = msg.photo;
        const bestPhoto = photos[photos.length - 1]; // Telegram eng kattasini oxiriga qo'yadi
        reqData.screenshotFileId = bestPhoto.file_id;
        reqData.status = 'kutilmoqda_tasdiq';
        reqData.screenshotSentAt = new Date().toISOString();
        saveOwners(owners);

        await sendMessage(chatId, '📤 Skrinshot qabul qilindi. Administrator tasdiqlashini kuting...');

        const surchargeCaptionLine = (reqData.upgradeSurcharge > 0)
          ? `\nAsosiy narx: ${fmtNum(reqData.baseAmount)} so'm + tarif farqi ustamasi (qolgan ${reqData.upgradeRemainingDays} kun): ${fmtNum(reqData.upgradeSurcharge)} so'm`
          : '';
        const caption = `💳 <b>Obuna to'lovi tasdiqlash so'raladi</b>\n` +
          `Oshxona: ${escapeHtmlServer(ownerLabel(subOwner))} (ID: <code>${subOwner.id}</code>)\n` +
          `Tarif: ${escapeHtmlServer(reqData.planLabel)}\nSumma: ${fmtNum(reqData.amount)} so'm${surchargeCaptionLine}`;
        const subKb = {
          inline_keyboard: [[
            { text: '✅ Tasdiqlash', callback_data: `subok:${subOwner.id}` },
            { text: '❌ Rad etish', callback_data: `subrej:${subOwner.id}` }
          ]]
        };
        for (const adminId of allAdminIds()) {
          copyMessageWithKeyboard(adminId, chatId, msg.message_id, caption, subKb);
        }
      }
      // Kutilayotgan karta to'lovi ham, obuna so'rovi ham topilmadi - bu oddiy
      // rasm bo'lishi mumkin, jim o'tkazib yuboramiz (xato deb hisoblamaymiz).
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
      `${orderCustomerContactLabel(targetOrder)}\n${itemsText}\n\n` +
      `Jami: ${fmtNum(targetOrder.total)} so'm\n${ORDER_TYPES[targetOrder.orderType] || targetOrder.orderType}` +
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

    // ---- 79-BOSQICH: "💳 Obunani uzaytirish" tugmasi (sendSubscriptionBlockedScreen
    // orqali chiqadigan bloklash ekranida). To'liq tarif tanlash/to'lov oqimi
    // 12-15-bosqichlarda qo'shiladi — hozircha faqat administrator bilan
    // bog'lanishga yo'naltiradi, tugma "o'lik" bo'lib qolmasligi uchun. ----
    if (data === 'obuna_menyu') {
      await answerCallbackQuery(cq.id);
      const owners = loadOwners();
      const owner = findOwner(owners, from.id);
      if (!owner) {
        await sendMessage(from.id, 'Siz do\'kon egasi sifatida ro\'yxatdan o\'tmagansiz. Administrator bilan bog\'laning.');
        return;
      }
      await sendObunaPlansMenu(owner, from.id);
      return;
    }

    // ---- 82-BOSQICH: owner "💳 Obuna" menyusidan biror tarifni tanlaganda
    // (sendObunaPlansMenu orqali chiqqan tugmalardan biri bosilganda) ----
    if (data.startsWith('subplan:')) {
      const [, planId] = data.split(':');
      const owners = loadOwners();
      const owner = findOwner(owners, from.id);
      if (!owner) { await answerCallbackQuery(cq.id, 'Oshxona topilmadi.'); return; }
      const plan = loadSubscriptionPlans()[planId];
      if (!plan) { await answerCallbackQuery(cq.id, 'Tarif topilmadi.'); return; }
      const reqData = createSubscriptionPaymentRequest(owner, planId);
      saveOwners(owners);
      await answerCallbackQuery(cq.id, 'Tarif tanlandi ✅');
      const surchargeLine = (reqData.upgradeSurcharge > 0)
        ? `\n➕ Tarif farqi ustamasi (qolgan ${reqData.upgradeRemainingDays} kun uchun): ${fmtNum(reqData.upgradeSurcharge)} so'm` +
          `\n💰 <b>Jami to'lov: ${fmtNum(reqData.amount)} so'm</b>`
        : '';
      await sendMessage(from.id,
        `✅ Siz <b>${escapeHtmlServer(plan.label)}</b> tarifini tanladingiz (${fmtNum(plan.price)} so'm).${surchargeLine}\n\n` +
        `Endi to'lov chekining (skrinshotning) RASMINI shu botga yuboring — administrator tekshirib ` +
        `tasdiqlagach, obunangiz avtomatik yangilanadi.`);
      return;
    }

    // ---- 10-bosqich: "📝 Ro'yxatdan o'tish" tugmasi (payloadsiz /start
    // ekranida, notanish foydalanuvchiga ko'rsatiladi) ----
    if (data === 'self_register_start') {
      await answerCallbackQuery(cq.id);
      if (isAdminId(from.id)) {
        await sendMessage(from.id, 'Siz administratorsiz, ro\'yxatdan o\'tishning hojati yo\'q.');
        return;
      }
      const owners = loadOwners();
      if (findOwner(owners, from.id)) {
        await sendMessage(from.id, 'Siz allaqachon ro\'yxatdan o\'tgansiz. Mini App tugmasi orqali oching.');
        return;
      }
      if (findStaffInfo(owners, from.id)) {
        await sendMessage(from.id, 'Siz allaqachon boshqa oshxonaning xodimisiz, alohida ega sifatida ro\'yxatdan o\'ta olmaysiz.');
        return;
      }
      pendingSelfRegistration.add(String(from.id));
      await sendMessage(from.id, 'Oshxonangiz nomini yozib yuboring (masalan: "Sardor Osh Markazi").');
      return;
    }

    // ---- 17-bosqich: o'chirilgan (Savatchadagi) egasi "🔄 Tiklashni
    // so'rash" tugmasini bosadi -> so'rov BARCHA adminlarga ✅/❌ tugmali
    // xabar bilan boradi. ----
    if (data.startsWith('request_restore:')) {
      const trashId = data.slice('request_restore:'.length);
      await answerCallbackQuery(cq.id);
      const trash = loadTrash();
      const entry = findTrashEntry(trash, trashId);
      if (!entry) {
        await sendMessage(from.id, 'Bu so\'rov muddati o\'tgan yoki allaqachon ko\'rib chiqilgan.');
        return;
      }
      if (String(entry.ownerSnapshot.id) !== String(from.id)) {
        await sendMessage(from.id, 'Bu so\'rov sizga tegishli emas.');
        return;
      }
      if (entry.restoreStatus === 'pending') {
        await sendMessage(from.id, '🕓 So\'rovingiz allaqachon adminga yuborilgan, tasdiqlanishini kuting.');
        return;
      }
      entry.restoreStatus = 'pending';
      entry.restoreRequestedAt = new Date().toISOString();
      saveTrash(trash);
      logTrashEvent('restore_requested', entry.ownerSnapshot, {});

      await sendMessage(from.id, '📤 So\'rovingiz administratorga yuborildi, tasdiqlanishini kuting.');
      const restaurantName = (entry.ownerSnapshot.profile && entry.ownerSnapshot.profile.name) || 'oshxona';
      const daysLeft = Math.max(0, Math.ceil((new Date(entry.autoPurgeAt).getTime() - Date.now()) / 86400000));
      const kb = {
        inline_keyboard: [[
          { text: '✅ Tiklash', callback_data: `restore_approve:${trashId}` },
          { text: '❌ Rad etish', callback_data: `restore_reject:${trashId}` }
        ]]
      };
      for (const adminId of allAdminIds()) {
        await sendMessage(adminId,
          `🔄 <b>Tiklash so'ralmoqda</b>\nOshxona: <b>${escapeHtmlServer(restaurantName)}</b> (ID: <code>${entry.ownerSnapshot.id}</code>)\n` +
          `Savatchadan avtomatik o'chirilishiga: ${daysLeft} kun qoldi.`, kb);
      }
      return;
    }

    // ---- 21-bosqich: FAQAT admin tasdig'i bilan tiklanadi. Owner o'zi
    // yoki xodimlari bu tugmani bosolmaydi (isAdminId tekshiruvi). ----
    if (data.startsWith('restore_approve:') || data.startsWith('restore_reject:')) {
      if (!isAdminId(from.id)) { await answerCallbackQuery(cq.id, 'Faqat admin tasdiqlay oladi.', true); return; }
      const isApprove = data.startsWith('restore_approve:');
      const trashId = data.slice((isApprove ? 'restore_approve:' : 'restore_reject:').length);
      const trash = loadTrash();
      const entry = findTrashEntry(trash, trashId);
      if (!entry) { await answerCallbackQuery(cq.id, 'Bu yozuv Savatchada topilmadi (allaqachon ko\'rib chiqilgan bo\'lishi mumkin).', true); return; }

      const restaurantName = (entry.ownerSnapshot.profile && entry.ownerSnapshot.profile.name) || 'oshxona';

      if (isApprove) {
        const result = restoreOwnerFromTrash(entry);
        if (!result.ok) { await answerCallbackQuery(cq.id, result.reason, true); return; }
        saveTrash(trash.filter(t => t.id !== trashId));
        logTrashEvent('restored', entry.ownerSnapshot, { restoredBy: String(from.id), via: 'bot_request' });

        await answerCallbackQuery(cq.id, '✅ Tiklandi.');
        if (chatId && messageId) {
          await editMessageText(chatId, messageId, `✅ <b>Tiklandi</b>\nOshxona: <b>${escapeHtmlServer(restaurantName)}</b>`);
        }
        await sendMessage(entry.ownerSnapshot.id,
          `✅ <b>Oshxonangiz tiklandi!</b>\nBarcha ma'lumotlaringiz (menyu, xodimlar, sozlamalar) saqlanib qolgan. Mini App tugmasi orqali oching.`);
      } else {
        entry.restoreStatus = 'rejected';
        saveTrash(trash);
        logTrashEvent('restore_rejected', entry.ownerSnapshot, { rejectedBy: String(from.id) });

        await answerCallbackQuery(cq.id, '❌ Rad etildi.');
        if (chatId && messageId) {
          await editMessageText(chatId, messageId, `❌ <b>Rad etildi</b>\nOshxona: <b>${escapeHtmlServer(restaurantName)}</b>`);
        }
        await sendMessage(entry.ownerSnapshot.id,
          '❌ Afsuski, tiklash so\'rovingiz rad etildi. Savollar bo\'lsa, administrator bilan bog\'laning.');
      }
      return;
    }

    // ---- 11-bosqich: admin (yoki qo'shimcha adminlardan biri) o'zi
    // ro'yxatdan o'tgan oshxonaning sinov muddatini tasdiqlaydi — standart
    // SUBSCRIPTION_TRIAL_DAYS beriladi (kunlar sonini qo'lda kiritish
    // keyingi nozik sozlash sifatida qo'shilishi mumkin, hozircha standart
    // yetarli va tugmani "o'lik" qoldirmaydi). ----
    if (data.startsWith('approve_trial:')) {
      if (!isAdminId(from.id)) { await answerCallbackQuery(cq.id, 'Faqat admin tasdiqlay oladi.', true); return; }
      const ownerId = data.slice('approve_trial:'.length);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner) { await answerCallbackQuery(cq.id, 'Bu so\'rov topilmadi (allaqachon ko\'rib chiqilgan bo\'lishi mumkin).', true); return; }
      if (owner.subscriptionStatus !== SUBSCRIPTION_STATUS.PENDING_TRIAL) {
        await answerCallbackQuery(cq.id, 'Bu so\'rov allaqachon ko\'rib chiqilgan.', true);
        return;
      }
      const until = new Date(Date.now() + SUBSCRIPTION_TRIAL_DAYS * 86400000).toISOString();
      owner.subscriptionStatus = SUBSCRIPTION_STATUS.ACTIVE;
      owner.subscriptionUntil = until;
      owner.trialGivenAt = new Date().toISOString();
      owner.graceUntil = null;
      saveOwners(owners);

      await answerCallbackQuery(cq.id, '✅ Tasdiqlandi.');
      if (chatId && messageId) {
        await editMessageText(chatId, messageId,
          `✅ <b>Tasdiqlandi</b>\nOshxona: <b>${escapeHtmlServer((owner.profile && owner.profile.name) || 'oshxona')}</b>\nSinov muddati: ${SUBSCRIPTION_TRIAL_DAYS} kun`);
      }
      await sendMessage(owner.id,
        `✅ So'rovingiz tasdiqlandi!\nSizga <b>${SUBSCRIPTION_TRIAL_DAYS} kunlik</b> bepul sinov muddati berildi.\nMini App tugmasi orqali oching va oshxonangizni sozlashni boshlang.`);
      return;
    }

    // ---- 11-bosqich: admin so'rovni rad etadi — owner yozuvi butunlay
    // o'chiriladi (hali hech qanday ma'lumot — menyu, xodim, buyurtma —
    // yaratilmagan, faqat "ariza" bosqichida edi, shuning uchun bu yerda
    // 6-bosqichdagi "o'chirishni bekor qilish" qoidasiga zid emas). ----
    if (data.startsWith('reject_trial:')) {
      if (!isAdminId(from.id)) { await answerCallbackQuery(cq.id, 'Faqat admin rad eta oladi.', true); return; }
      const ownerId = data.slice('reject_trial:'.length);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner) { await answerCallbackQuery(cq.id, 'Bu so\'rov topilmadi (allaqachon ko\'rib chiqilgan bo\'lishi mumkin).', true); return; }
      if (owner.subscriptionStatus !== SUBSCRIPTION_STATUS.PENDING_TRIAL) {
        await answerCallbackQuery(cq.id, 'Bu so\'rov allaqachon ko\'rib chiqilgan.', true);
        return;
      }
      const restaurantName = (owner.profile && owner.profile.name) || 'oshxona';
      const remaining = owners.filter(o => String(o.id) !== String(ownerId));
      saveOwners(remaining);

      await answerCallbackQuery(cq.id, '❌ Rad etildi.');
      if (chatId && messageId) {
        await editMessageText(chatId, messageId, `❌ <b>Rad etildi</b>\nOshxona: <b>${escapeHtmlServer(restaurantName)}</b>`);
      }
      await sendMessage(ownerId, '❌ Afsuski, ro\'yxatdan o\'tish so\'rovingiz rad etildi. Savollar bo\'lsa, administrator bilan bog\'laning.');
      return;
    }

    // ---- Mijoz "Yetkazildi" xabaridagi yulduzcha tugmasini bosib xizmatni
    // baholaydi (1-5 ball). Faqat shu buyurtmaning mijozi o'zi bosishi mumkin,
    // va har bir buyurtma faqat bir marta baholanadi. ----
    if (data.startsWith('rate:')) {
      const [, ownerId, orderId, starsRaw] = data.split(':');
      const stars = Number(starsRaw);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner) { await answerCallbackQuery(cq.id, 'Oshxona topilmadi.'); return; }
      const order = (owner.orders || []).find(o => o.id === orderId);
      if (!order) { await answerCallbackQuery(cq.id, 'Buyurtma topilmadi.'); return; }
      if (String(order.customerId) !== String(from.id)) {
        await answerCallbackQuery(cq.id, 'Bu baho boshqa mijozga tegishli.');
        return;
      }
      if (order.customerRating) {
        await answerCallbackQuery(cq.id, 'Siz bu buyurtmaga allaqachon baho bergansiz, rahmat! 🙏');
        return;
      }
      if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
        await answerCallbackQuery(cq.id, 'Noto\'g\'ri baho.');
        return;
      }

      order.customerRating = stars;
      order.customerRatedAt = new Date().toISOString();
      saveOwners(owners);

      const starsText = '⭐️'.repeat(stars);
      if (chatId && messageId) {
        await editMessageText(chatId, messageId,
          `${cq.message.text || ''}\n\nSizning bahoyingiz: ${starsText}\nRahmat! 🙏`, null);
      }
      await answerCallbackQuery(cq.id, 'Bahoyingiz uchun rahmat! 🙏');

      // 65-bosqich: yulduzdan keyin ixtiyoriy matnli sharh so'raymiz — mijoz
      // yozgan keyingi (buyruq bo'lmagan) xabar shu buyurtmaga sharh sifatida
      // yoziladi (qarang: pendingReviewComments, matn xabarlari bo'limi).
      pendingReviewComments.set(String(from.id), {
        ownerId: String(owner.id),
        orderId: String(order.id),
        expiresAt: Date.now() + REVIEW_COMMENT_WINDOW_MS
      });
      await sendMessage(from.id, '✍️ Fikr-mulohazangiz bo\'lsa, shu yerga yozib qoldiring (ixtiyoriy — o\'tkazib yuborishingiz ham mumkin).');

      // Past baho (1-3) qo'yilsa — egasi va kassirlarga darhol xabar, shikoyatga
      // tezroq javob berish imkoni bo'lishi uchun.
      if (stars <= 3) {
        const itemsText = order.items.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
        const alertText = `⚠️ <b>Past baho olindi</b> (${starsText})\n${itemsText}\n\nJami: ${fmtNum(order.total)} so'm\nMijoz: ${orderCustomerContactLabel(order)}`;
        const staffList = owner.staff || [];
        const targetIds = staffList.filter(s => ['egasi', 'kassir'].includes(s.role)).map(s => s.id);
        for (const targetId of new Set([owner.id, ...targetIds])) {
          sendMessage(targetId, alertText);
        }
      }
      return;
    }

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
      if (await guardCallbackSubscription(cq, owners, ownerId)) return;
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
          const readyText = `✅ <b>Buyurtma tayyor</b> (${orderLabel})\n${itemsText}\n\nJami: ${fmtNum(order.total)} so'm`;
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
      if (await guardCallbackSubscription(cq, owners, ownerId)) return;
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
          `${orderCustomerContactLabel(order)}\n${itemsText}\n\nJami: ${fmtNum(order.total)} so'm\nTo'lov: ${PAYMENT_TYPES[order.paymentType]} (✅ tasdiqlangan)`;
        const notifyTargets = [owner.id, ...((owner.staff || []).filter(s => staffHasRole(s, 'oshpaz') || staffHasRole(s, 'kassir')).map(s => s.id))];
        await notifyStaffList(owner, notifyTargets, notifyText, `Buyurtma #${order.id} (to'lov tasdiqlangach)`, 'newOrder');
        saveOwners(owners);
        notifyDeliveryGroup(owner, order, orderCustomerContactLabel(order));
        notifyKitchenGroup(owner, order, orderCustomerContactLabel(order));

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

    // ---- 82-BOSQICH: admin owner'ning obuna to'lov skrinshotini ✅/❌ qilganda
    // (sendObunaPlansMenu -> subplan -> skrinshot -> shu tugmalar zanjiri) ----
    if (data.startsWith('subok:') || data.startsWith('subrej:')) {
      const [action, ownerId] = data.split(':');
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner) { await answerCallbackQuery(cq.id, 'Oshxona topilmadi.'); return; }

      const editConfirmMessage = (extraLine) => {
        if (!chatId || !messageId) return Promise.resolve();
        if (cq.message && cq.message.photo) {
          return editMessageCaption(chatId, messageId, `${cq.message.caption || ''}\n\n${extraLine}`, null);
        }
        return editMessageText(chatId, messageId, `${cq.message.text || ''}\n\n${extraLine}`, null);
      };

      const reqData = owner.subscriptionPaymentRequest;
      if (!reqData || reqData.status !== 'kutilmoqda_tasdiq') {
        await answerCallbackQuery(cq.id, 'Bu so\'rov allaqachon ko\'rib chiqilgan.');
        await editConfirmMessage('(allaqachon ko\'rib chiqilgan)');
        return;
      }

      if (action === 'subrej') {
        // 10-bosqich: darhol rad etish o'rniga, avval adminning sababini kutamiz
        const hasPhoto = !!(cq.message && cq.message.photo);
        const originalContent = hasPhoto ? (cq.message.caption || '') : (cq.message.text || '');
        setAwaitingSubRejectReason(owner.id, chatId, messageId, hasPhoto, originalContent);
        await answerCallbackQuery(cq.id, 'Rad etish sababini yozing');
        await sendMessage(from.id,
          `✏️ <b>${escapeHtmlServer(ownerLabel(owner))}</b> uchun rad etish sababini yozib yuboring ` +
          `(masalan: "Skrinshot noaniq" yoki "Summa mos emas"). Bekor qilish uchun /bekor yozing.`);
        return;
      }

      const result = decideSubscriptionPayment(owner, 'approve', from.id);
      saveOwners(owners);

      await editConfirmMessage(`✅ Tasdiqlandi — ${displayName(from)}`);
      await answerCallbackQuery(cq.id, 'Tasdiqlandi ✅');
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
// Haftalik hisobot (30-bosqich) qaysi kuni yuborilishi — 1 = Dushanba
// (JS getUTCDay(): 0=Yakshanba..6=Shanba). Kunlik hisobot bilan bir xil
// soatda (AI_DIRECTOR_HOUR) yuboriladi, faqat haftada bir marta.
const AI_DIRECTOR_WEEKLY_DAY = 1;
function aiDirTashkentWeekday(input) {
  const d = (input instanceof Date) ? input : new Date(input);
  return new Date(d.getTime() + AI_DIRECTOR_TZ_OFFSET_MS).getUTCDay();
}
// Haftalik hisobot qayta yuborilmasligi uchun "kalit" — joriy haftaning
// Dushanba sanasi (Toshkent vaqti bo'yicha), masalan "2026-07-20". ISO
// hafta raqamlash kutubxonasiz, yil chegarasida ham xato bermaydi.
function aiDirWeekKey(input) {
  const d = (input instanceof Date) ? input : new Date(input);
  const tashkent = new Date(d.getTime() + AI_DIRECTOR_TZ_OFFSET_MS);
  const day = tashkent.getUTCDay();
  const diffToMonday = (day === 0) ? -6 : (1 - day);
  const monday = new Date(tashkent.getTime());
  monday.setUTCDate(monday.getUTCDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
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

  const lines = ['📊 <b>Bugungi holat</b>', ''];
  lines.push(`Kecha tushum: <b>${fmtNum(yesterday.income)} so'm</b>` +
    (incomeChangePercent !== null ? ` (${incomeChangePercent > 0 ? '+' : ''}${incomeChangePercent}%)` : ''));
  lines.push(`Foyda: <b>${fmtNum(yesterday.net)} so'm</b>`);
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

// 30-bosqich (2-yarmi): "Haftalik hisobot" — kunlik hisobotdagi bilan bir
// xil ma'lumot manbalaridan (aiDirCashBucket/aiDirItemStats/aiDirStockRunway/
// aiDirDecliningItems) foydalanadi, faqat oxirgi 7 kunni BUTUNLIGICHA
// (kechagi bitta kun emas) umumlashtiradi — shu sababli alohida funksiya
// emas, mavjudlarning ustiga qurilgan.
function buildAiWeeklyDirectorText(owner) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const prevWeekAgo = new Date(now.getTime() - 14 * 86400000);

  const thisWeek = aiDirCashBucket(owner, weekAgo, now);
  const prevWeek = aiDirCashBucket(owner, prevWeekAgo, weekAgo);
  const incomeChangePercent = prevWeek.income > 0
    ? Math.round(((thisWeek.income - prevWeek.income) / prevWeek.income) * 100)
    : null;

  const itemStats = Array.from(aiDirItemStats(owner, weekAgo, now).values())
    .sort((a, b) => b.revenue - a.revenue).slice(0, 3);

  const runway = aiDirStockRunway(owner);
  const urgentStock = runway.filter(r => r.daysLeft <= 3).slice(0, 5);
  const declining = aiDirDecliningItems(owner);

  const lines = ['📅 <b>Haftalik hisobot</b>', ''];
  lines.push(`Haftalik tushum: <b>${fmtNum(thisWeek.income)} so'm</b>` +
    (incomeChangePercent !== null ? ` (${incomeChangePercent > 0 ? '+' : ''}${incomeChangePercent}%)` : ''));
  lines.push(`Haftalik foyda: <b>${fmtNum(thisWeek.net)} so'm</b> (${thisWeek.orderCount} ta buyurtma)`);

  if (itemStats.length) {
    lines.push('');
    lines.push('🏆 <b>Eng ko\'p sotilgan taomlar (7 kun):</b>');
    itemStats.forEach((it, i) => lines.push(`${i + 1}. ${escapeHtmlServer(it.name)} — ${it.qty} dona (${fmtNum(it.revenue)} so'm)`));
  }

  if (urgentStock.length) {
    lines.push('');
    lines.push('⚠️ <b>Tez tugaydigan mahsulotlar:</b>');
    for (const s of urgentStock) {
      lines.push(s.daysLeft < 1
        ? `• ${escapeHtmlServer(s.name)} — bugun-erta tugashi mumkin`
        : `• ${escapeHtmlServer(s.name)} — taxminan ${Math.floor(s.daysLeft)} kunga yetadi`);
    }
  }

  if (declining.length) {
    const d = declining[0];
    lines.push('');
    lines.push(`Oxirgi 7 kunda <b>${escapeHtmlServer(d.name)}</b> savdosi ${Math.abs(d.changePercent)}% kamaygan.`);
    lines.push(`💡 <b>Tavsiya:</b> ${escapeHtmlServer(d.name)} uchun aksiya qiling yoki keyingi haftaga xaridni kamaytiring.`);
  }

  return lines.join('\n');
}

// sendAiDirectorDigest'ga o'xshaydi, faqat haftada BIR MARTA (aiDirWeekKey
// asosida) yuboradi va owner.aiWeeklyLastSent'ga yozadi.
async function sendAiWeeklyDirectorDigest(owner, force) {
  const weekKey = aiDirWeekKey(new Date());
  if (!force && owner.aiWeeklyLastSent === weekKey) return false;
  const text = buildAiWeeklyDirectorText(owner);
  await sendMessage(owner.id, text);
  owner.aiWeeklyLastSent = weekKey;
  return true;
}

// Har 10 daqiqada bir marta tekshiradi: Toshkent vaqti bilan soat
// AI_DIRECTOR_HOUR bo'lgan (va bugun hali yuborilmagan) har bir egaga
// avtomatik yuboradi. `aiDirectorEnabled` egasi tomonidan o'chirilgan
// bo'lsa (=== false), o'sha egaga yuborilmaydi (standart holat - yoqilgan).
// Xuddi shu tekshiruv ichida — agar bugun AI_DIRECTOR_WEEKLY_DAY (Dushanba)
// bo'lsa — haftalik hisobot ham (alohida `aiWeeklyEnabled` bayrog'i bilan)
// yuboriladi. Ikkalasi bitta intervalda birlashtirilgan — ikkita alohida
// setInterval o'rniga.
setInterval(() => {
  if (aiDirTashkentHour(new Date()) !== AI_DIRECTOR_HOUR) return;
  const isWeeklyDay = aiDirTashkentWeekday(new Date()) === AI_DIRECTOR_WEEKLY_DAY;
  const owners = pruneExpiredOwners();
  let changed = false;
  (async () => {
    for (const owner of owners) {
      if (!isOwnerAccessValid(owner)) continue;
      if (owner.aiDirectorEnabled !== false) {
        const sent = await sendAiDirectorDigest(owner, false);
        if (sent) changed = true;
      }
      if (isWeeklyDay && owner.aiWeeklyEnabled !== false) {
        const sentWeekly = await sendAiWeeklyDirectorDigest(owner, false);
        if (sentWeekly) changed = true;
      }
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
      // 2-4-bosqich: xodimga rol(lar) biriktirilgan, lekin ULARNING BARCHASI
      // joriy tarifda yopilgan bo'lsa (findStaffInfo.roles bo'sh massiv
      // qaytaradi) — bu xodimni "ok:false" deb hisoblaymiz, aks holda u
      // rolsiz (bo'sh panel) holatda kirib qolardi.
      const staffBlocked = !!(staffInfo && staffInfo.rawRoles.length > 0 && staffInfo.roles.length === 0);
      const ok = admin || ownerOk || !!(staffInfo && !staffBlocked);

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
        reason: ok
          ? null
          : (staffBlocked
              ? 'Lavozimingiz (' + rolesLabel(staffInfo.rawRoles) + ') joriy tarifda yopilgan. Administrator bilan bog\'laning.'
              : 'Bu ilova faqat administrator, tasdiqlangan do\'kon egalari va ularning xodimlari uchun.')
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi ko\'ra oladi'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi xodim qo\'sha oladi'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi havola yarata oladi'));
      if (!ownerCanUseFeature(owner, 'staff-invite')) return sendJSON(res, 200, featureBlockedResult('staff-invite'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'zgartira oladi'));
      if (!ownerCanUseFeature(owner, 'staff-roles')) return sendJSON(res, 200, featureBlockedResult('staff-roles'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'zgartira oladi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'chira oladi'));
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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi filial qo\'sha oladi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'zgartira oladi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'chira oladi'));
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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));

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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));

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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi bo\'limlarni boshqara oladi'));
      const owner = ctx.owner;
      if (!ctx.isAdminActing && !ownerCanUseFeature(owner, 'category-manage')) return sendJSON(res, 200, featureBlockedResult('category-manage'));

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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'chira oladi'));
      const owner = ctx.owner;
      if (!ctx.isAdminActing && !ownerCanUseFeature(owner, 'category-manage')) return sendJSON(res, 200, featureBlockedResult('category-manage'));
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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'zgartira oladi'));
      const owner = ctx.owner;
      if (!ctx.isAdminActing && !ownerCanUseFeature(owner, 'category-manage')) return sendJSON(res, 200, featureBlockedResult('category-manage'));
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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi menyuni boshqara oladi'));
      const owner = ctx.owner;
      if (!ctx.isAdminActing && !ownerCanUseFeature(owner, 'menu-manage')) return sendJSON(res, 200, featureBlockedResult('menu-manage'));

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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi menyuni boshqara oladi'));
      const owner = ctx.owner;
      if (!ctx.isAdminActing && !ownerCanUseFeature(owner, 'menu-manage')) return sendJSON(res, 200, featureBlockedResult('menu-manage'));
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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'chira oladi'));
      const owner = ctx.owner;
      if (!ctx.isAdminActing && !ownerCanUseFeature(owner, 'menu-manage')) return sendJSON(res, 200, featureBlockedResult('menu-manage'));
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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi combo boshqara oladi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi combo boshqara oladi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'chira oladi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi ko\'ra oladi'));
      if (!BOT_USERNAME || BOT_USERNAME === 'BOT_USERNAME_BU_YERGA') {
        return sendJSON(res, 200, { ok: false, reason: 'Serverda BOT_USERNAME sozlanmagan.' });
      }
      const link = `https://t.me/${BOT_USERNAME}?start=menu_${owner.id}`;
      return sendJSON(res, 200, { ok: true, link });
    });
    return;
  }

  // ---- API: 57-bosqich — muayyan stol uchun QR-havola (tez buyurtma) ----
  // Egasi stol raqamini kiritadi, server shu stol uchun maxsus deep-link
  // qaytaradi (/start menu_<ownerId>_table_<stol>) — frontend shu havoladan
  // QR-kod rasmini yasab, chop etish/yuklab olish uchun ko'rsatadi. Mijoz
  // shu QR-ni skanerlasa, Mini App to'g'ridan-to'g'ri "Stolga" buyurtma
  // turi va stol raqami oldindan to'ldirilgan holda ochiladi.
  if (req.method === 'POST' && req.url === '/api/table-qr-link') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi ko\'ra oladi'));
      if (!BOT_USERNAME || BOT_USERNAME === 'BOT_USERNAME_BU_YERGA') {
        return sendJSON(res, 200, { ok: false, reason: 'Serverda BOT_USERNAME sozlanmagan.' });
      }
      const tableNumber = String(payload.tableNumber || '').trim().slice(0, 20);
      if (!tableNumber) return sendJSON(res, 200, { ok: false, reason: 'Stol raqamini kiriting.' });
      if (!/^[a-zA-Z0-9\-]+$/.test(tableNumber)) {
        return sendJSON(res, 200, { ok: false, reason: 'Stol raqami faqat harf, raqam va chiziqchadan iborat bo\'lsin.' });
      }
      const link = `https://t.me/${BOT_USERNAME}?start=menu_${owner.id}_table_${encodeURIComponent(tableNumber)}`;
      return sendJSON(res, 200, { ok: true, link, tableNumber });
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi ko\'ra oladi'));
      if (!ownerCanUseFeature(owner, 'delivery-group')) return sendJSON(res, 200, featureBlockedResult('delivery-group'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'zgartira oladi'));
      if (!ownerCanUseFeature(owner, 'delivery-group')) return sendJSON(res, 200, featureBlockedResult('delivery-group'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi ko\'ra oladi'));
      if (!ownerCanUseFeature(owner, 'kitchen-group')) return sendJSON(res, 200, featureBlockedResult('kitchen-group'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'zgartira oladi'));
      if (!ownerCanUseFeature(owner, 'kitchen-group')) return sendJSON(res, 200, featureBlockedResult('kitchen-group'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi ko\'ra oladi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi qo\'sha oladi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'zgartira oladi'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'chira oladi'));
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      owner.promotions = (owner.promotions || []).filter(p => p.id !== id);
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ==================== G-bo'lim: Reklama banner tizimi (45-47-bosqich) ====================
  // Bannerlar — egasi mijozlar ekraniga (mini-ilova menyusi tepasida) chiqadigan
  // rasmli reklama/e'lon kartochkalari. Har birida: rasm (majburiy, promo/menyu
  // rasmlari bilan bir xil qoidada — https:// havola yoki galereyadan tanlangan
  // base64, qarang: isValidImageValue), sarlavha va bosilganda ochiladigan havola
  // (ikkalasi ham ixtiyoriy), hamda ixtiyoriy faollik oynasi (startAt/endAt — 47-
  // bosqich: berilmasa banner cheksiz muddat faol hisoblanadi). owner.promotions
  // bilan bir xil CRUD naqshiga amal qiladi (46-bosqich: admin/egasi boshqaruvi).

  // 47-bosqich: banner hozir (joriy vaqtda) ko'rsatilishi kerakmi — faqat
  // active bayrog'i emas, startAt/endAt oynasi ham hisobga olinadi.
  function isBannerWithinWindow(banner) {
    const now = Date.now();
    if (banner.startAt && new Date(banner.startAt).getTime() > now) return false;
    if (banner.endAt && new Date(banner.endAt).getTime() < now) return false;
    return true;
  }
  // 45-bosqich: mijoz ekraniga chiqadigan, HOZIR faol bannerlar ro'yxati
  // (customer-menu-list ichida ishlatiladi — qarang pastda).
  function activeOwnerBanners(owner) {
    return (owner.banners || [])
      .filter(b => b.active !== false && isBannerWithinWindow(b))
      .map(b => ({ id: b.id, imageUrl: b.imageUrl, title: b.title, link: b.link }));
  }

  // ---- API: bannerlar ro'yxati (egasi, boshqaruv paneli — hammasi, nofaol/rejalashtirilganlari ham) ----
  if (req.method === 'POST' && req.url === '/api/banner-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi ko\'ra oladi'));
      return sendJSON(res, 200, { ok: true, banners: owner.banners || [] });
    });
    return;
  }

  // ---- API: yangi banner qo'shish (egasi) ----
  if (req.method === 'POST' && req.url === '/api/banner-add') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, imageUrl, title, link, startAt, endAt } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi qo\'sha oladi'));
      if (!ownerCanUseFeature(owner, 'banner-manage')) return sendJSON(res, 200, featureBlockedResult('banner-manage'));

      const imageTrim = String(imageUrl || '').trim();
      if (!imageTrim) return sendJSON(res, 200, { ok: false, reason: 'Banner uchun rasm tanlang.' });
      if (!isValidImageValue(imageTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Rasm noto\'g\'ri formatda yoki hajmi katta (rasmni kichikroq tanlang).' });
      }
      const linkTrim = String(link || '').trim();
      if (linkTrim && !/^https?:\/\//i.test(linkTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Havola http:// yoki https:// bilan boshlanishi kerak.' });
      }
      let startAtVal = null;
      if (startAt) {
        const d = new Date(startAt);
        if (isNaN(d.getTime())) return sendJSON(res, 200, { ok: false, reason: 'Boshlanish sanasi noto\'g\'ri.' });
        startAtVal = d.toISOString();
      }
      let endAtVal = null;
      if (endAt) {
        const d = new Date(endAt);
        if (isNaN(d.getTime())) return sendJSON(res, 200, { ok: false, reason: 'Tugash sanasi noto\'g\'ri.' });
        endAtVal = d.toISOString();
      }
      if (startAtVal && endAtVal && new Date(endAtVal).getTime() <= new Date(startAtVal).getTime()) {
        return sendJSON(res, 200, { ok: false, reason: 'Tugash sanasi boshlanish sanasidan keyin bo\'lishi kerak.' });
      }

      if (!owner.banners) owner.banners = [];
      const banner = {
        id: crypto.randomBytes(4).toString('hex'),
        imageUrl: imageTrim,
        title: String(title || '').trim() || null,
        link: linkTrim || null,
        active: true,
        startAt: startAtVal,
        endAt: endAtVal,
        createdAt: new Date().toISOString()
      };
      owner.banners.unshift(banner); // eng yangisi ro'yxat boshida ko'rinsin
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, banner });
    });
    return;
  }

  // ---- API: bannerni tahrirlash (egasi) ----
  if (req.method === 'POST' && req.url === '/api/banner-update') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, imageUrl, title, link, startAt, endAt } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'zgartira oladi'));
      if (!ownerCanUseFeature(owner, 'banner-manage')) return sendJSON(res, 200, featureBlockedResult('banner-manage'));

      const banner = (owner.banners || []).find(b => b.id === id);
      if (!banner) return sendJSON(res, 200, { ok: false, reason: 'Banner topilmadi.' });

      if (imageUrl !== undefined) {
        const imageTrim = String(imageUrl || '').trim();
        if (!imageTrim) return sendJSON(res, 200, { ok: false, reason: 'Banner uchun rasm tanlang.' });
        if (!isValidImageValue(imageTrim)) {
          return sendJSON(res, 200, { ok: false, reason: 'Rasm noto\'g\'ri formatda yoki hajmi katta (rasmni kichikroq tanlang).' });
        }
        banner.imageUrl = imageTrim;
      }
      if (title !== undefined) banner.title = String(title || '').trim() || null;
      if (link !== undefined) {
        const linkTrim = String(link || '').trim();
        if (linkTrim && !/^https?:\/\//i.test(linkTrim)) {
          return sendJSON(res, 200, { ok: false, reason: 'Havola http:// yoki https:// bilan boshlanishi kerak.' });
        }
        banner.link = linkTrim || null;
      }
      if (startAt !== undefined) {
        if (!startAt) banner.startAt = null;
        else {
          const d = new Date(startAt);
          if (isNaN(d.getTime())) return sendJSON(res, 200, { ok: false, reason: 'Boshlanish sanasi noto\'g\'ri.' });
          banner.startAt = d.toISOString();
        }
      }
      if (endAt !== undefined) {
        if (!endAt) banner.endAt = null;
        else {
          const d = new Date(endAt);
          if (isNaN(d.getTime())) return sendJSON(res, 200, { ok: false, reason: 'Tugash sanasi noto\'g\'ri.' });
          banner.endAt = d.toISOString();
        }
      }
      if (banner.startAt && banner.endAt && new Date(banner.endAt).getTime() <= new Date(banner.startAt).getTime()) {
        return sendJSON(res, 200, { ok: false, reason: 'Tugash sanasi boshlanish sanasidan keyin bo\'lishi kerak.' });
      }

      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, banner });
    });
    return;
  }

  // ---- API: bannerni faol/nofaol qilish (egasi) ----
  if (req.method === 'POST' && req.url === '/api/banner-toggle') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'zgartira oladi'));

      const banner = (owner.banners || []).find(b => b.id === id);
      if (!banner) return sendJSON(res, 200, { ok: false, reason: 'Banner topilmadi.' });
      banner.active = !banner.active;
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, banner });
    });
    return;
  }

  // ---- API: bannerni o'chirish (egasi) ----
  if (req.method === 'POST' && req.url === '/api/banner-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'chira oladi'));
      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      owner.banners = (owner.banners || []).filter(b => b.id !== id);
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi ko\'ra oladi'));
      if (!ownerCanUseFeature(owner, 'bonus-settings')) return sendJSON(res, 200, featureBlockedResult('bonus-settings'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi saqlay oladi'));
      if (!ownerCanUseFeature(owner, 'bonus-settings')) return sendJSON(res, 200, featureBlockedResult('bonus-settings'));

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
          brandColor: (owner.profile && owner.profile.brandColor) || null,
          paymentCard: owner.customerPaymentCard || { cardNumber: '', cardHolder: '' }
        },
        customer: { favorites: customer.favorites, addresses: customer.addresses || [], bonusPoints: customer.bonusPoints, cardOnlyRestricted: customerIsCardOnlyRestricted(owner, userId) },
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
      if (!ownerCanUseFeature(owner, 'customer-menu')) return sendJSON(res, 200, featureBlockedResult('customer-menu'));

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
      // 45-bosqich: rasmli reklama bannerlari — faqat HOZIR faol bo'lganlari
      // (active=true va startAt/endAt oynasi ichida), qarang: activeOwnerBanners().
      const banners = activeOwnerBanners(owner);
      const recommendations = buildAiWaiterRecommendations(owner, String(check.user && check.user.id), menu);
      return sendJSON(res, 200, { ok: true, menu, combos, promotions, banners, categories: sortedOwnerCategories(owner), recommendations });
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
      if (!ownerCanUseFeature(owner, 'customer-account')) return sendJSON(res, 200, featureBlockedResult('customer-account'));

      const customer = findOrCreateCustomer(owner, userId, check.user);
      const idx = customer.favorites.indexOf(itemId);
      if (idx >= 0) customer.favorites.splice(idx, 1);
      else customer.favorites.push(itemId);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, favorites: customer.favorites });
    });
    return;
  }

  // ---- API: 56-bosqich — mijoz uchun manzillar kitobi ----
  // Mijoz dostavka buyurtmasi berganda har safar qaytadan joylashuv/manzil
  // yozmasligi uchun — bir necha manzilni (masalan "Uy", "Ish") nom bilan
  // saqlab qo'yishi va checkout'da shulardan birini tanlashi mumkin.
  if (req.method === 'POST' && req.url === '/api/customer-address-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner || !isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });
      if (!ownerCanUseFeature(owner, 'customer-account')) return sendJSON(res, 200, featureBlockedResult('customer-account'));

      const customer = findOrCreateCustomer(owner, userId, check.user);
      return sendJSON(res, 200, { ok: true, addresses: customer.addresses || [] });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/customer-address-save') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId, addressId, label, addressNote, location, extraPhone } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner || !isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });
      if (!ownerCanUseFeature(owner, 'customer-account')) return sendJSON(res, 200, featureBlockedResult('customer-account'));

      const labelTrim = String(label || '').trim().slice(0, 40);
      if (!labelTrim) return sendJSON(res, 200, { ok: false, reason: 'Manzil nomini kiriting (masalan: Uy, Ish).' });

      let loc = null;
      if (location && typeof location.lat === 'number' && typeof location.lng === 'number' &&
          Math.abs(location.lat) <= 90 && Math.abs(location.lng) <= 180) {
        loc = { lat: location.lat, lng: location.lng };
      }
      const addressNoteTrim = String(addressNote || '').trim().slice(0, 300);
      if (!loc && !addressNoteTrim) {
        return sendJSON(res, 200, { ok: false, reason: 'Joylashuvni aniqlang yoki manzilni yozib qoldiring.' });
      }
      const extraPhoneTrim = String(extraPhone || '').trim().slice(0, 30);

      const customer = findOrCreateCustomer(owner, userId, check.user);
      if (!Array.isArray(customer.addresses)) customer.addresses = [];

      let addr = addressId ? findCustomerAddress(customer, addressId) : null;
      if (addr) {
        addr.label = labelTrim;
        addr.addressNote = addressNoteTrim;
        addr.location = loc;
        addr.extraPhone = extraPhoneTrim;
        addr.updatedAt = new Date().toISOString();
      } else {
        if (customer.addresses.length >= MAX_CUSTOMER_ADDRESSES) {
          return sendJSON(res, 200, { ok: false, reason: `Ko'pi bilan ${MAX_CUSTOMER_ADDRESSES} ta manzil saqlash mumkin.` });
        }
        addr = {
          id: crypto.randomBytes(4).toString('hex'),
          label: labelTrim,
          addressNote: addressNoteTrim,
          location: loc,
          extraPhone: extraPhoneTrim,
          createdAt: new Date().toISOString()
        };
        customer.addresses.push(addr);
      }
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, addresses: customer.addresses });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/customer-address-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId, addressId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      if (!addressId) return sendJSON(res, 200, { ok: false, reason: 'Manzil ko\'rsatilmagan.' });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner || !isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });
      if (!ownerCanUseFeature(owner, 'customer-account')) return sendJSON(res, 200, featureBlockedResult('customer-account'));

      const customer = findOrCreateCustomer(owner, userId, check.user);
      const idx = (customer.addresses || []).findIndex(a => a.id === addressId);
      if (idx < 0) return sendJSON(res, 200, { ok: false, reason: 'Manzil topilmadi.' });
      customer.addresses.splice(idx, 1);
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, addresses: customer.addresses });
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
      if (!ownerCanUseFeature(owner, 'customer-account')) return sendJSON(res, 200, featureBlockedResult('customer-account'));

      const orders = (owner.orders || [])
        .filter(o => String(o.customerId) === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 50);

      return sendJSON(res, 200, { ok: true, orders });
    });
    return;
  }

  // ---- API: 39-bosqich — mijoz uchun bildirishnomalar markazi ----
  // Owner tomonidagi "Bildirishnomalar" ekrani kabi — alohida bildirishnoma
  // bazasi kerak emas, mavjud buyurtma maydonlaridan (createdAt/startedAt/
  // readyAt/deliveredAt/cancelledAt/paymentProof*At) va faol aksiyalardan
  // ro'yxat hisoblab chiqiladi. "Ko'rilgan" belgisi mijoz tarafida
  // (localStorage) saqlanadi, shuning uchun bu yerda faqat xom ro'yxat
  // qaytariladi.
  if (req.method === 'POST' && req.url === '/api/customer-notifications') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });
      if (!ownerCanUseFeature(owner, 'customer-account')) return sendJSON(res, 200, featureBlockedResult('customer-account'));

      const myOrders = (owner.orders || [])
        .filter(o => String(o.customerId) === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 30);

      const notifications = [];
      myOrders.forEach(o => {
        const items = o.items || [];
        const itemsText = items.slice(0, 3).map(it => it.name).join(', ') + (items.length > 3 ? ' va yana...' : '');

        notifications.push({
          id: `${o.id}-created`, type: 'order', icon: 'clipboard',
          title: 'Buyurtma qabul qilindi',
          text: `${itemsText} — ${fmtNum(o.total)} so'm`,
          time: o.createdAt
        });

        if (o.status === 'tayyorlanmoqda' || (o.status === 'tayyor' && o.startedAt)) {
          notifications.push({
            id: `${o.id}-progress`, type: 'order', icon: 'chef-hat',
            title: 'Buyurtmangiz tayyorlanmoqda',
            text: itemsText,
            time: o.startedAt || o.updatedAt || o.createdAt
          });
        }

        if (o.status === 'tayyor') {
          notifications.push({
            id: `${o.id}-ready`, type: 'order', icon: 'check-circle',
            title: o.orderType === 'dostavka' ? 'Buyurtmangiz tayyor — kuryerga topshirilmoqda' : 'Buyurtmangiz tayyor!',
            text: itemsText,
            time: o.readyAt || o.updatedAt || o.createdAt
          });
        }

        if (o.deliveredAt) {
          notifications.push({
            id: `${o.id}-delivered`, type: 'order', icon: 'check-circle',
            title: 'Buyurtmangiz yetkazib berildi',
            text: itemsText,
            time: o.deliveredAt
          });
        }

        if (o.status === 'bekor_qilindi' && o.cancelledAt) {
          notifications.push({
            id: `${o.id}-cancelled`, type: 'order', icon: 'x-circle',
            title: 'Dostavka bekor qilindi',
            text: o.cancelReason || 'Kechirasiz, buyurtmangizni yetkazib bera olmadik.',
            time: o.cancelledAt
          });
        }

        if (o.paymentProofApprovedAt) {
          notifications.push({
            id: `${o.id}-payok`, type: 'order', icon: 'card',
            title: 'To\'lovingiz tasdiqlandi',
            text: itemsText,
            time: o.paymentProofApprovedAt
          });
        }

        if (o.paymentProofRejectedAt) {
          notifications.push({
            id: `${o.id}-payrej`, type: 'order', icon: 'x-circle',
            title: 'To\'lov tasdiqlanmadi',
            text: 'Iltimos, to\'g\'ri chekni qayta yuboring yoki oshxona bilan bog\'laning.',
            time: o.paymentProofRejectedAt
          });
        }
      });

      (owner.promotions || []).filter(p => p.active).forEach(p => {
        notifications.push({
          id: `promo-${p.id}`, type: 'promo', icon: 'star',
          title: `Yangi aksiya: ${p.title}`,
          text: `${p.discountPercent}% chegirma${p.minTotal ? ` (${fmtNum(p.minTotal)} so'mdan buyurtmalarga)` : ''}`,
          time: p.createdAt
        });
      });

      notifications.sort((a, b) => new Date(b.time) - new Date(a.time));
      return sendJSON(res, 200, { ok: true, notifications: notifications.slice(0, 50) });
    });
    return;
  }

  // ==================== H63-bosqich: Tezkor qo'llab-quvvatlash chat ====================
  // Mijoz botning mini-ilovasi ichidan to'g'ridan-to'g'ri oshxonaga savol/muammo
  // yozib yubora oladi, egasi/kassir esa admin panelidan javob beradi — ikkala
  // tomon ham xabarlarni Telegram orqali darhol oladi, ilova ichida esa
  // (pollingda) yangilanib turadi. Har bir owner.supportMessages — yagona tekis
  // ro'yxat: { id, customerId, from: 'customer'|'staff', text, at,
  // readByCustomer, readByStaff }. "Thread" (suhbat) shu ro'yxatni customerId
  // bo'yicha guruhlab hosil qilinadi — alohida saqlash strukturasi shart emas.
  function supportThreadMessages(owner, customerId) {
    return (owner.supportMessages || [])
      .filter(m => String(m.customerId) === String(customerId))
      .sort((a, b) => new Date(a.at) - new Date(b.at));
  }

  // ---- API: mijoz — yordam xabarini yuborish ----
  if (req.method === 'POST' && req.url === '/api/support-send') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId, text } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner || !isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });
      if (!ownerCanUseFeature(owner, 'support-chat')) return sendJSON(res, 200, featureBlockedResult('support-chat'));

      const textTrim = String(text || '').trim().slice(0, 1000);
      if (!textTrim) return sendJSON(res, 200, { ok: false, reason: 'Xabar matni bo\'sh bo\'lmasligi kerak.' });

      if (!Array.isArray(owner.supportMessages)) owner.supportMessages = [];
      const customer = findOrCreateCustomer(owner, userId, check.user);
      const msg = {
        id: crypto.randomBytes(4).toString('hex'),
        customerId: userId,
        from: 'customer',
        text: textTrim,
        at: new Date().toISOString(),
        readByCustomer: true,
        readByStaff: false
      };
      owner.supportMessages.push(msg);
      saveOwners(owners);

      const staffTargets = [owner.id, ...((owner.staff || []).filter(s => staffHasRole(s, 'egasi') || staffHasRole(s, 'kassir')).map(s => s.id))];
      const profile = findProfile(userId);
      const alertText = `🆘 <b>Yordam so'rovi</b>\n${orderCustomerContactLabel({ customerName: customerDisplayName(userId, check.user), customerPhone: (profile && profile.phone) || null })}\n\n${escapeHtmlServer(textTrim)}`;
      for (const targetId of new Set(staffTargets.map(String))) {
        sendMessage(targetId, alertText);
      }

      return sendJSON(res, 200, { ok: true, messages: supportThreadMessages(owner, userId) });
    });
    return;
  }

  // ---- API: mijoz — o'z suhbatini o'qish (pollingda chaqiriladi) ----
  if (req.method === 'POST' && req.url === '/api/support-thread') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });
      if (!ownerCanUseFeature(owner, 'support-chat')) return sendJSON(res, 200, featureBlockedResult('support-chat'));

      let changed = false;
      (owner.supportMessages || []).forEach(m => {
        if (String(m.customerId) === userId && m.from === 'staff' && !m.readByCustomer) {
          m.readByCustomer = true;
          changed = true;
        }
      });
      if (changed) saveOwners(owners);

      return sendJSON(res, 200, { ok: true, messages: supportThreadMessages(owner, userId) });
    });
    return;
  }

  // ---- API: xodim/egasi — ochiq suhbatlar ro'yxati (oxirgi xabar + o'qilmagan soni) ----
  if (req.method === 'POST' && req.url === '/api/support-inbox') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['egasi', 'kassir'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'limga faqat egasi/kassir kira oladi' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'support-chat')) return sendJSON(res, 200, featureBlockedResult('support-chat'));

      const byCustomer = new Map();
      for (const m of (ctx.owner.supportMessages || [])) {
        const list = byCustomer.get(m.customerId) || [];
        list.push(m);
        byCustomer.set(m.customerId, list);
      }
      const threads = [];
      for (const [customerId, msgs] of byCustomer.entries()) {
        msgs.sort((a, b) => new Date(a.at) - new Date(b.at));
        const last = msgs[msgs.length - 1];
        const customer = findCustomer(ctx.owner, customerId);
        threads.push({
          customerId,
          customerName: (customer && customer.firstName) || `ID: ${customerId}`,
          lastText: last.text,
          lastAt: last.at,
          lastFrom: last.from,
          unreadCount: msgs.filter(m => m.from === 'customer' && !m.readByStaff).length
        });
      }
      threads.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

      return sendJSON(res, 200, { ok: true, threads });
    });
    return;
  }

  // ---- API: xodim/egasi — bitta mijoz bilan suhbatni o'qish + javob yozish ----
  if (req.method === 'POST' && req.url === '/api/support-thread-staff') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, customerId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['egasi', 'kassir'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'limga faqat egasi/kassir kira oladi' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'support-chat')) return sendJSON(res, 200, featureBlockedResult('support-chat'));
      if (!customerId) return sendJSON(res, 200, { ok: false, reason: 'Mijoz tanlanmagan.' });

      let changed = false;
      (ctx.owner.supportMessages || []).forEach(m => {
        if (String(m.customerId) === String(customerId) && m.from === 'customer' && !m.readByStaff) {
          m.readByStaff = true;
          changed = true;
        }
      });
      if (changed) saveOwners(owners);

      return sendJSON(res, 200, { ok: true, messages: supportThreadMessages(ctx.owner, customerId) });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/support-reply') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, customerId, text } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx || !ctxHasAnyRole(ctx, ['egasi', 'kassir'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'limga faqat egasi/kassir kira oladi' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'support-chat')) return sendJSON(res, 200, featureBlockedResult('support-chat'));
      if (!customerId) return sendJSON(res, 200, { ok: false, reason: 'Mijoz tanlanmagan.' });

      const textTrim = String(text || '').trim().slice(0, 1000);
      if (!textTrim) return sendJSON(res, 200, { ok: false, reason: 'Xabar matni bo\'sh bo\'lmasligi kerak.' });

      if (!Array.isArray(ctx.owner.supportMessages)) ctx.owner.supportMessages = [];
      const msg = {
        id: crypto.randomBytes(4).toString('hex'),
        customerId: String(customerId),
        from: 'staff',
        text: textTrim,
        at: new Date().toISOString(),
        readByCustomer: false,
        readByStaff: true
      };
      ctx.owner.supportMessages.push(msg);
      saveOwners(owners);

      await sendMessage(customerId, `💬 <b>Oshxonadan javob</b>\n${escapeHtmlServer(textTrim)}`);

      return sendJSON(res, 200, { ok: true, messages: supportThreadMessages(ctx.owner, customerId) });
    });
    return;
  }


  if (req.method === 'POST' && req.url === '/api/customer-order') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, ownerId, items, orderType, tableNumber, paymentType, promoId, usePoints, location, addressNote, extraPhone, requestId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, ownerId);
      if (!owner || !isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Bu oshxona hozircha mavjud emas.' });
      if (!ownerCanUseFeature(owner, 'customer-menu')) return sendJSON(res, 200, featureBlockedResult('customer-menu'));

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
      // YANGI: kuryer avval yetkazib bera olmagan (mijoz javob bermagan/rad
      // etgan) buyurtmalar takrorlangan mijozlarga endi "dostavka orqali"
      // (naqd, kuryerga to'lov) taklif qilinmaydi — faqat Karta orqali
      // oldindan to'lov bilan buyurtma qabul qilinadi (qarang:
      // customerIsCardOnlyRestricted()).
      if (orderType === 'dostavka' && paymentType === 'dostavka_orqali' && customerIsCardOnlyRestricted(owner, userId)) {
        return sendJSON(res, 200, { ok: false, reason: 'Avvalgi buyurtma(lar)ingizda kuryer sizga bog\'lana olmagani sababli, endi faqat Karta orqali oldindan to\'lov bilan buyurtma bera olasiz.' });
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
        // YANGI: dostavka buyurtmasida qo'shimcha telefon raqam majburiy —
        // kuryer mijozga bog'lana olmay qolgan holatlar uchun zaxira aloqa.
        const extraPhoneDigits = String(extraPhone || '').replace(/\D/g, '');
        if (extraPhoneDigits.length < 7) {
          return sendJSON(res, 200, { ok: false, reason: 'Qo\'shimcha telefon raqamingizni kiriting.' });
        }
      }
      const addressNoteFinal = orderType === 'dostavka' ? String(addressNote || '').trim().slice(0, 300) : null;
      const extraPhoneFinal = orderType === 'dostavka' ? String(extraPhone || '').trim().slice(0, 30) : null;

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
      // H64-bosqich: "AI ofitsiant" — mijoz qaysi taomlarni necha marta
      // olganini kuzatib boramiz (combo va oddiy menyu taomlari birga),
      // shu asosida keyinchalik "Sizga tavsiya" ro'yxati chiqariladi
      // (qarang: buildAiWaiterRecommendations()).
      if (!customer.itemFrequency || typeof customer.itemFrequency !== 'object') customer.itemFrequency = {};
      for (const it of orderItems) {
        if (!it.id) continue;
        customer.itemFrequency[it.id] = (customer.itemFrequency[it.id] || 0) + (it.qty || 1);
      }
      customer.lastOrderedAt = new Date().toISOString();

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
        extraPhone: extraPhoneFinal,
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
        customerPhone: (findProfile(userId) || {}).phone || null,
        source: 'customer',
        createdAt: new Date().toISOString(),
        createdBy: userId
      };
      owner.orders.push(order);
      logStaffAction(owner, { userId, role: 'mijoz', action: 'buyurtma_yaratdi', orderId: order.id, note: `Mijoz buyurtmasi — ${fmtNum(total)} so'm` });
      saveOwners(owners);

      if (paymentType === 'karta') {
        // Oshxona/kassir/dostavka guruhiga HALI xabar YUBORILMAYDI - avval
        // mijoz to'lov skrinshotini shu botning shaxsiy chatiga yuborishi,
        // keyin kassir/egasi tasdiqlashi kerak (qarang: 'payok' callback -
        // xuddi shu notifyText/notifyTargets/notifyDeliveryGroup o'sha yerda
        // takrorlanadi, FAQAT tasdiqlangandan keyin ishga tushadi).
        // Karta raqami do'kon egasi tomonidan kiritiladi (qarang:
        // customerPaymentCard, /api/owner-payment-card-set). <code> tegi
        // Telegram'da bosib-nusxalash imkonini beradi.
        const payCard = owner.customerPaymentCard || {};
        const cardLine = payCard.cardNumber
          ? `\n\n💳 To'lov: <code>${escapeHtmlServer(payCard.cardNumber)}</code>` +
            (payCard.cardHolder ? ` (${escapeHtmlServer(payCard.cardHolder)})` : '')
          : '\n\n⚠️ Oshxona hali to\'lov kartasini kiritmagan — to\'lov uchun kassaga murojaat qiling.';
        await sendMessage(userId,
          '💳 Buyurtmangiz qabul qilindi, lekin hali <b>TASDIQLANMAGAN</b>.' + cardLine + '\n\n' +
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
          `Stol: ${escapeHtmlServer(order.tableNumber || '-')}\n${orderCustomerContactLabel(order)}\n${itemsText}\n\n` +
          `Jami: ${fmtNum(total)} so'm\n\nMijoz kassaga to'lov qilgach, shu yerda tasdiqlang - shundan keyin oshpazga ketadi.`;
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
          `${orderCustomerContactLabel(order)}\n${itemsText}\n\nJami: ${fmtNum(total)} so'm\nTo'lov: ${PAYMENT_TYPES[paymentType]}`;
        const notifyTargets = [owner.id, ...((owner.staff || []).filter(s => staffHasRole(s, 'oshpaz') || staffHasRole(s, 'kassir')).map(s => s.id))];
        await notifyStaffList(owner, notifyTargets, notifyText, `Buyurtma #${order.id} (mijoz)`, 'newOrder');
        notifyDeliveryGroup(owner, order, orderCustomerContactLabel(order));
        notifyKitchenGroup(owner, order, orderCustomerContactLabel(order));
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
        const ownerMuted = isNotificationCategoryMuted(owner, 'lowStock');
        const targets = [owner.id, ...((owner.staff || []).filter(s => staffHasRole(s, 'sklad') && (s.branchId || null) === (branchId || null)).map(s => s.id))];
        for (const t of new Set(targets)) {
          if (String(t) === String(excludeUserId)) continue;
          if (ownerMuted && String(t) === String(owner.id)) continue;
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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['kassir', 'egasi'])) {
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
      logStaffAction(ctx.owner, { userId, role: ctx.role, action: 'buyurtma_yaratdi', orderId: order.id, note: `${ORDER_TYPES[orderType]} — ${fmtNum(total)} so'm` });
      saveOwners(owners);

      // Oshxonaga (egaga + oshpazlarga) xabar yuboriladi
      const itemsText = orderItems.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
      const notifyText = `🆕 <b>Yangi buyurtma</b> (${ORDER_TYPES[orderType]}${order.tableNumber ? ' — stol ' + escapeHtmlServer(order.tableNumber) : ''})\n` +
        `${itemsText}\n\nJami: ${fmtNum(total)} so'm\nTo'lov: ${PAYMENT_TYPES[paymentType]}`;
      const notifyTargets = [ctx.owner.id, ...((ctx.owner.staff || []).filter(s => staffHasRole(s, 'oshpaz')).map(s => s.id))];
      await notifyStaffList(ctx.owner, notifyTargets, notifyText, `Buyurtma #${order.id} (kassir)`, 'newOrder');
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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['egasi', 'kassir', 'oshpaz', 'dostavka'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'limni ko\'rishga ruxsatingiz yo\'q' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'orders-manage')) return sendJSON(res, 200, featureBlockedResult('orders-manage'));

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

  // ---- Umumiy yordamchi: sana/xodim/to'lov/turi bo'yicha filtrlangan,
  // vaqt bo'yicha kamayish tartibida saralangan TO'LIQ buyurtmalar ro'yxatini
  // qaytaradi (sahifalashsiz) — /api/order-history (sahifalab) va
  // /api/order-history-export (44-bosqich: Excel/PDF eksport, sahifalashsiz)
  // ikkalasi ham shundan foydalanadi, filtr mantig'i ikki joyda takrorlanmasin.
  function filterOwnerOrderHistory(ctx, payload) {
    const { dateFrom, dateTo, employeeId, paymentType, orderType } = payload;
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

    return { orders, staffNameById };
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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!isOwnerAccessValid(ctx.owner) || ctx.role !== 'egasi') {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });
      }

      let page = parseInt(payload.page, 10);
      if (!Number.isFinite(page) || page < 1) page = 1;
      const PAGE_SIZE = 30;

      const { orders, staffNameById } = filterOwnerOrderHistory(ctx, payload);

      const totalCount = orders.length;
      const totalSum = orders.reduce((sum, o) => sum + (o.total || 0), 0);
      const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      if (page > totalPages) page = totalPages;
      const pageOrders = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

  // =========================================================================
  // 44-bosqich: buyurtmalar tarixini Excel (CSV) va PDF sifatida eksport
  // qilish. Loyihada hech qanday tashqi kutubxona (npm paket) ishlatilmagani
  // sababli (package.json bo'sh) — ikkalasi ham TASHQI KUTUBXONASIZ:
  //   • Excel — CSV matn (UTF-8 BOM bilan) qaytariladi, Excel'da to'g'ridan
  //     to'g'ri ochiladi.
  //   • PDF — minimal, qo'lda tuzilgan PDF fayl (standart Helvetica shrifti,
  //     WinAnsiEncoding) generatsiya qilinadi. Faqat lotin-1 diapazonidagi
  //     belgilar (asosiy lotin, aksanlar) qo'llab-quvvatlanadi — kirill yoki
  //     boshqa belgilar '?' bilan almashtiriladi (buyurtma taomlari/xodim
  //     nomlari odatda o'zbek lotin alifbosida bo'ladi).
  // =========================================================================
  function pdfSanitizeText(s) {
    return String(s == null ? '' : s).replace(/[\r\n\t]/g, ' ').split('').map(ch => {
      const code = ch.charCodeAt(0);
      return (code >= 0x20 && code <= 0x7E) || (code >= 0xA0 && code <= 0xFF) ? ch : '?';
    }).join('');
  }
  function pdfEscapeText(s) {
    return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
  function pdfCellText(value, width, fontSize) {
    const avgCharWidth = fontSize * 0.56;
    const maxChars = Math.max(1, Math.floor(width / avgCharWidth));
    let t = pdfSanitizeText(value);
    if (t.length > maxChars) t = t.slice(0, Math.max(0, maxChars - 2)) + '..';
    return pdfEscapeText(t);
  }

  // headers — ustun nomlari, colWidths — har bir ustun kengligi (pt),
  // rows — string massivlar massivi (har bir qator = har bir ustun uchun matn).
  function buildSimplePdfReport(title, generatedAtLabel, headers, colWidths, rows) {
    const pageWidth = 595, pageHeight = 842; // A4, pt
    const marginX = 40, topY = 802, bottomMargin = 40;
    const titleFontSize = 13, headerFontSize = 8, cellFontSize = 7.5, lineHeight = 13;
    const headerY = topY - 26;
    const firstRowY = headerY - lineHeight - 2;
    const rowsPerPage = Math.max(5, Math.floor((firstRowY - bottomMargin) / lineHeight));

    const pages = [];
    for (let i = 0; i < rows.length; i += rowsPerPage) pages.push(rows.slice(i, i + rowsPerPage));
    if (!pages.length) pages.push([]);

    function colX(idx) {
      let x = marginX;
      for (let i = 0; i < idx; i++) x += colWidths[i];
      return x;
    }

    const pageStreams = pages.map((pageRows, pIdx) => {
      let s = 'BT\n';
      s += `/F1 ${titleFontSize} Tf\n1 0 0 1 ${marginX} ${topY} Tm\n(${pdfEscapeText(pdfSanitizeText(title))}) Tj\n`;
      s += `/F1 7 Tf\n1 0 0 1 ${pageWidth - marginX - 130} ${topY} Tm\n(${pdfEscapeText(pdfSanitizeText(generatedAtLabel))}) Tj\n`;
      s += `/F1 ${headerFontSize} Tf\n`;
      headers.forEach((h, i) => {
        s += `1 0 0 1 ${colX(i)} ${headerY} Tm\n(${pdfCellText(h, colWidths[i], headerFontSize)}) Tj\n`;
      });
      s += `/F1 ${cellFontSize} Tf\n`;
      pageRows.forEach((row, ri) => {
        const y = firstRowY - ri * lineHeight;
        row.forEach((val, ci) => {
          s += `1 0 0 1 ${colX(ci)} ${y} Tm\n(${pdfCellText(val, colWidths[ci], cellFontSize)}) Tj\n`;
        });
      });
      s += `/F1 6.5 Tf\n1 0 0 1 ${marginX} ${bottomMargin - 15} Tm\n(${pdfEscapeText(String(pIdx + 1) + ' / ' + pages.length)}) Tj\n`;
      s += 'ET';
      return s;
    });

    // ---- PDF obyektlarini yig'ish (kutubxonasiz, qo'lda) ----
    const objects = [];
    const pageCount = pageStreams.length;
    const firstPageObjNum = 4; // 1=Catalog, 2=Pages, 3=Font
    const pageObjNums = [], contentObjNums = [];
    for (let i = 0; i < pageCount; i++) {
      pageObjNums.push(firstPageObjNum + i * 2);
      contentObjNums.push(firstPageObjNum + i * 2 + 1);
    }
    objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
    objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map(n => n + ' 0 R').join(' ')}] /Count ${pageCount} >>\nendobj\n`;
    objects[3] = `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
    for (let i = 0; i < pageCount; i++) {
      const pObjNum = pageObjNums[i], cObjNum = contentObjNums[i];
      objects[pObjNum] = `${pObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${cObjNum} 0 R >>\nendobj\n`;
      const streamBody = pageStreams[i];
      const byteLen = Buffer.byteLength(streamBody, 'latin1');
      objects[cObjNum] = `${cObjNum} 0 obj\n<< /Length ${byteLen} >>\nstream\n${streamBody}\nendstream\nendobj\n`;
    }
    const maxObjNum = 3 + pageCount * 2;
    let pdf = '%PDF-1.4\n';
    const offsets = new Array(maxObjNum + 1).fill(0);
    for (let n = 1; n <= maxObjNum; n++) {
      offsets[n] = Buffer.byteLength(pdf, 'latin1');
      pdf += objects[n];
    }
    const xrefStart = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${maxObjNum + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= maxObjNum; n++) {
      pdf += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${maxObjNum + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
  }

  function csvEscapeCell(value) {
    const s = String(value == null ? '' : value);
    return /[";\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  if (req.method === 'POST' && req.url === '/api/order-history-export') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!isOwnerAccessValid(ctx.owner) || ctx.role !== 'egasi') {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'orders-manage')) return sendJSON(res, 200, featureBlockedResult('orders-manage'));

      const format = payload.format === 'pdf' ? 'pdf' : 'csv';
      const { orders, staffNameById } = filterOwnerOrderHistory(ctx, payload);
      const exportOrders = orders.slice(0, 2000); // haddan tashqari katta fayl bo'lib ketmasligi uchun cheklov
      const totalSum = orders.reduce((sum, o) => sum + (o.total || 0), 0);
      const nowLabel = new Date().toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const restaurantName = (ctx.owner.name || 'Oshxona');

      const rows = exportOrders.map(o => {
        const d = new Date(o.createdAt);
        const sana = d.toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const itemsText = (o.items || []).map(it => `${it.name} x${it.qty}`).join(', ');
        return [
          sana,
          ORDER_TYPES[o.orderType] || o.orderType,
          o.tableNumber || '',
          PAYMENT_TYPES[o.paymentType] || o.paymentType,
          ORDER_STATUSES[o.status] || o.status,
          itemsText,
          String(o.total || 0),
          staffNameById(o.createdBy) || ''
        ];
      });

      if (format === 'csv') {
        const headers = ['Sana', 'Turi', 'Stol', "To'lov", 'Holat', 'Taomlar', 'Summa', 'Xodim'];
        let csv = headers.map(csvEscapeCell).join(',') + '\r\n';
        csv += rows.map(r => r.map(csvEscapeCell).join(',')).join('\r\n');
        csv += `\r\n\r\n${csvEscapeCell('Jami: ' + rows.length + ' ta buyurtma, ' + totalSum + ' so\'m')}\r\n`;
        const filename = `buyurtmalar_${new Date().toISOString().slice(0, 10)}.csv`;
        // UTF-8 BOM — Excel'da o'zbek harflari (', g' va h.k.) to'g'ri ko'rinishi uchun
        const content = '\uFEFF' + csv;
        return sendJSON(res, 200, { ok: true, format: 'csv', filename, mime: 'text/csv;charset=utf-8', content });
      }

      // PDF — jadval ustunlari toraytirilgan (taomlar ustuni qisqartiriladi)
      const headers = ['Sana', 'Turi', "To'lov", 'Holat', 'Summa', 'Xodim'];
      const colWidths = [95, 65, 65, 70, 75, 145];
      const pdfRows = rows.map(r => [r[0], r[1], r[3], r[4], r[6] + " so'm", r[7]]);
      const pdfBuffer = buildSimplePdfReport(
        `${restaurantName} — Buyurtmalar tarixi (${rows.length} ta, ${totalSum} so'm)`,
        nowLabel, headers, colWidths, pdfRows
      );
      const filename = `buyurtmalar_${new Date().toISOString().slice(0, 10)}.pdf`;
      return sendJSON(res, 200, { ok: true, format: 'pdf', filename, mime: 'application/pdf', contentBase64: pdfBuffer.toString('base64') });
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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['kassir', 'oshpaz', 'dostavka', 'sklad'])) {
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
  // 61-bosqich: xodim yo'q paytda egasi ham kassir/oshpaz o'rnida ishlashi
  // mumkin bo'lishi kerak — shu sababli 'egasi' ham ruxsat etilgan rollarga
  // qo'shildi. Egasi owner.staff ro'yxatida yo'q, shuning uchun uning smena
  // holati to'g'ridan-to'g'ri owner yozuvining o'zida (owner.shiftActive /
  // owner.shiftStartedAt) saqlanadi — xodimlarning alohida-alohida
  // shiftActive maydonlari bilan aralashmaydi.
  if (req.method === 'POST' && req.url === '/api/shift-status') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['kassir', 'oshpaz', 'egasi'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat kassir, oshpaz va egasi uchun' });
      }
      const target = ctx.role === 'egasi' ? ctx.owner : (ctx.owner.staff || []).find(s => String(s.id) === userId);
      if (!target) return sendJSON(res, 200, { ok: false, reason: 'Xodim topilmadi' });

      return sendJSON(res, 200, { ok: true, active: !!target.shiftActive, startedAt: target.shiftStartedAt || null });
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
  // 61-bosqich: egasi ham (xodim bo'lmagan paytda o'zi kassir/oshpaz
  // o'rnida ishlaganda) smenani boshlashi/tugatishi mumkin — shift-status
  // bilan bir xil mantiq (target: egasi bo'lsa owner yozuvining o'zi).
  if (req.method === 'POST' && req.url === '/api/shift-toggle') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['kassir', 'oshpaz', 'egasi'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat kassir, oshpaz va egasi uchun' });
      }
      const target = ctx.role === 'egasi' ? ctx.owner : (ctx.owner.staff || []).find(s => String(s.id) === userId);
      if (!target) return sendJSON(res, 200, { ok: false, reason: 'Xodim topilmadi' });
      if (!ownerCanUseFeature(ctx.owner, 'shift-toggle')) return sendJSON(res, 200, featureBlockedResult('shift-toggle'));

      const now = new Date().toISOString();
      if (target.shiftActive) {
        if (!ctx.owner.shiftHistory) ctx.owner.shiftHistory = [];
        ctx.owner.shiftHistory.unshift({
          id: crypto.randomBytes(4).toString('hex'),
          userId,
          role: ctx.role,
          startedAt: target.shiftStartedAt || now,
          endedAt: now
        });
        if (ctx.owner.shiftHistory.length > 1000) ctx.owner.shiftHistory.length = 1000;
        target.shiftActive = false;
        target.shiftStartedAt = null;
        logStaffAction(ctx.owner, { userId, role: ctx.role, action: 'smena_tugatdi', note: 'Ish smenasini tugatdi' });
      } else {
        target.shiftActive = true;
        target.shiftStartedAt = now;
        logStaffAction(ctx.owner, { userId, role: ctx.role, action: 'smena_boshladi', note: 'Ish smenasini boshladi' });
      }
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, active: !!target.shiftActive, startedAt: target.shiftStartedAt || null });
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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['egasi', 'kassir', 'oshpaz'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu amalga ruxsatingiz yo\'q' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'orders-manage')) return sendJSON(res, 200, featureBlockedResult('orders-manage'));

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
        const readyText = `✅ <b>Buyurtma tayyor</b> (${orderLabel})\n${itemsText}\n\nJami: ${fmtNum(order.total)} so'm`;

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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['dostavka', 'egasi'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Faqat kuryer bu amalni bajara oladi' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'orders-manage')) return sendJSON(res, 200, featureBlockedResult('orders-manage'));

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
      logStaffAction(ctx.owner, { userId, role: ctx.role, action: 'yetkazdi', orderId: order.id, note: `${fmtNum(order.total)} so'm — yetkazib berildi` });
      saveOwners(owners);

      // Buyurtma "Yetkazildi" deb belgilangach, mijozdan xizmatni baholashini
      // so'raymiz (1-5 yulduz, callback_data: rate:<ownerId>:<orderId>:<ball>).
      // Javob callback_query bo'limida ('rate:' prefiksi) qayta ishlanadi.
      if (order.customerId) {
        const ratingKeyboard = {
          inline_keyboard: [[
            { text: '1⭐️', callback_data: `rate:${ctx.owner.id}:${order.id}:1` },
            { text: '2⭐️', callback_data: `rate:${ctx.owner.id}:${order.id}:2` },
            { text: '3⭐️', callback_data: `rate:${ctx.owner.id}:${order.id}:3` },
            { text: '4⭐️', callback_data: `rate:${ctx.owner.id}:${order.id}:4` },
            { text: '5⭐️', callback_data: `rate:${ctx.owner.id}:${order.id}:5` }
          ]]
        };
        sendMessage(order.customerId,
          '✅ Buyurtmangiz yetkazib berildi!\n\nXizmatimizni qanday baholaysiz?',
          ratingKeyboard);
      }

      return sendJSON(res, 200, { ok: true, order });
    });
    return;
  }

  // ---- API: kuryer — mijoz buyurtmani qabul qilmadi (bekor qildi) ----
  // Kuryer manzilga borgach mijoz eshikda buyurtmadan voz kechishi mumkin
  // (fikr o'zgargan, telefon javob bermagan va h.k.). Bunday holatda buyurtma
  // "Yetkazildi" deb belgilanmaydi — "Bekor qilindi" holatiga o'tadi, daromad
  // hisobiga qo'shilmaydi (qarang: orderIncomeAmount()) va oshxona egasiga
  // xabar boradi.
  if (req.method === 'POST' && req.url === '/api/reject-delivery-order') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, orderId, reason, returnedItems } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const ctx = resolveOwnerContext(owners, userId);
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['dostavka', 'egasi'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Faqat kuryer bu amalni bajara oladi' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'orders-manage')) return sendJSON(res, 200, featureBlockedResult('orders-manage'));

      const order = (ctx.owner.orders || []).find(o => o.id === orderId);
      if (!order) return sendJSON(res, 200, { ok: false, reason: 'Buyurtma topilmadi.' });
      if (order.orderType !== 'dostavka') {
        return sendJSON(res, 200, { ok: false, reason: 'Bu buyurtma dostavka turi emas.' });
      }
      if (order.deliveredBy) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu buyurtma allaqachon yetkazilgan deb belgilangan.' });
      }
      if (order.status === 'bekor_qilindi') {
        return sendJSON(res, 200, { ok: true, order }); // allaqachon bekor qilingan
      }

      const trimmedReason = String(reason || '').trim();
      if (!trimmedReason) {
        return sendJSON(res, 200, { ok: false, reason: 'Bekor qilish sababini yozish majburiy.' });
      }

      order.status = 'bekor_qilindi';
      order.cancelReason = trimmedReason.slice(0, 200);
      order.cancelledBy = userId;
      order.cancelledAt = new Date().toISOString();

      // Ochilmagan, to'g'ridan skladdan sotilgan mahsulotlarni (masalan,
      // Kola, Pepsi kabi shishalar) skladga qaytarish. Faqat directStockId
      // bor itemlar uchun ruxsat beriladi (retsept asosida tayyorlangan
      // taomlar qaytarilmaydi, chunki ular allaqachon tayyorlangan bo'lishi
      // mumkin). Kuryer/egasi har bir item uchun nechta dona ochilmagan
      // holda qaytganini ko'rsatadi (returnedItems: [{ index, qty }]).
      const returnedNotes = [];
      if (Array.isArray(returnedItems)) {
        for (const r of returnedItems) {
          const idx = Number(r && r.index);
          if (!Number.isInteger(idx) || idx < 0 || idx >= order.items.length) continue;
          const orderItem = order.items[idx];
          if (!orderItem || !orderItem.directStockId) continue;
          const returnQty = Math.min(Math.max(0, Math.floor(Number(r.qty) || 0)), orderItem.qty);
          if (returnQty <= 0) continue;
          const stockItem = findStockItem(ctx.owner, orderItem.directStockId);
          if (!stockItem) continue;
          stockItem.qty = Math.round((stockItem.qty + returnQty) * 1000) / 1000;
          addStockMovement(ctx.owner, {
            stockId: stockItem.id, stockName: stockItem.name, type: 'kirim',
            qty: returnQty, unit: stockItem.unit,
            note: `Bekor qilingan buyurtma #${order.id} — ochilmagan, skladga qaytarildi: ${orderItem.name} x${returnQty}`,
            userId
          });
          returnedNotes.push(`${orderItem.name} x${returnQty}`);
        }
      }
      if (returnedNotes.length) order.returnedToStock = returnedNotes;

      logStaffAction(ctx.owner, { userId, role: ctx.role, action: 'dostavka_bekor', orderId: order.id, note: order.cancelReason });
      saveOwners(owners);

      syncGroupMessagesForOrder(ctx.owner, order);

      // Egasi va kassirlarga darhol xabar — kim, qaysi buyurtmani va nima
      // sababdan bekor qilganini bilishlari uchun.
      const itemsText = order.items.map(it => `• ${escapeHtmlServer(it.name)} x${it.qty}`).join('\n');
      const staffRecord = (ctx.owner.staff || []).find(s => String(s.id) === userId);
      const courierLabel = staffDisplayName(staffRecord) || `ID: ${userId}`;
      const returnedLine = returnedNotes.length
        ? `\nSkladga qaytarildi: ${escapeHtmlServer(returnedNotes.join(', '))}`
        : '';
      const alertText = `❌ <b>Dostavka bekor qilindi</b>\n${itemsText}\n\nJami: ${fmtNum(order.total)} so'm\nSabab: ${escapeHtmlServer(order.cancelReason)}\nKuryer: ${escapeHtmlServer(courierLabel)}${returnedLine}`;
      const staffList = ctx.owner.staff || [];
      const targetIds = staffList.filter(s => ['egasi', 'kassir'].includes(s.role)).map(s => s.id);
      for (const targetId of new Set([ctx.owner.id, ...targetIds])) {
        if (String(targetId) === userId) continue;
        sendMessage(targetId, alertText);
      }

      if (order.customerId) {
        sendMessage(order.customerId, '❌ Kechirasiz, dostavka buyurtmangiz bekor qilindi (yetkazib berish amalga oshmadi). Savol bo\'lsa, oshxonaga murojaat qiling.');
      }

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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasRole(ctx, 'egasi')) {
        return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi bu amalni bajara oladi' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'orders-manage')) return sendJSON(res, 200, featureBlockedResult('orders-manage'));

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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['egasi', 'sklad'])) {
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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['egasi', 'sklad'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu amalga ruxsatingiz yo\'q' });
      }
      if (!ctx.isAdminActing && !ownerCanUseFeature(ctx.owner, 'stock-manage')) return sendJSON(res, 200, featureBlockedResult('stock-manage'));

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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'chira oladi'));
      const owner = ctx.owner;
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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['egasi', 'sklad'])) {
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi transfer qila oladi'));

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
      const ctx = resolveOwnerContext(owners, userId, { targetOwnerId: payload.targetOwnerId });
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi retsept belgilay oladi'));
      const owner = ctx.owner;

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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['egasi', 'sklad'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu amalga ruxsatingiz yo\'q' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'audit')) return sendJSON(res, 200, featureBlockedResult('audit'));
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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!ctxHasAnyRole(ctx, ['egasi', 'sklad'])) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'limni ko\'rishga ruxsatingiz yo\'q' });
      }
      if (!ownerCanUseFeature(ctx.owner, 'audit')) return sendJSON(res, 200, featureBlockedResult('audit'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi xarajat kirita oladi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'chira oladi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
      if (!ownerCanUseFeature(owner, 'cashflow')) return sendJSON(res, 200, featureBlockedResult('cashflow'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
      if (!ownerCanUseFeature(owner, 'dashboard')) return sendJSON(res, 200, featureBlockedResult('dashboard'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
      if (!ownerCanUseFeature(owner, 'dashboard')) return sendJSON(res, 200, featureBlockedResult('dashboard'));

      const now = new Date();
      const todayStart = tzDayStart(now);
      const thresholdMs = ORDER_DELAY_THRESHOLD_MINUTES * 60 * 1000;

      const todaysOrders = (owner.orders || []).filter(o => new Date(o.createdAt) >= todayStart);

      let yangi = 0, tayyorlanmoqda = 0, tayyor = 0, kechikayotgan = 0;
      for (const o of todaysOrders) {
        if (o.status === 'bekor_qilindi') continue;
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
      if (!ownerCanUseFeature(owner, 'dashboard')) return sendJSON(res, 200, featureBlockedResult('dashboard'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));

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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!isOwnerAccessValid(ctx.owner) || ctx.role !== 'egasi') return sendJSON(res, 200, { ok: false, reason: 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi' });
      const owner = ctx.owner;
      if (!ownerCanUseFeature(owner, 'courier-report')) return sendJSON(res, 200, featureBlockedResult('courier-report'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Faqat oshxona egasi o\'zgartira oladi'));
      if (!ownerCanUseFeature(owner, 'courier-report')) return sendJSON(res, 200, featureBlockedResult('courier-report'));

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
      if (!ctx) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q'));
      if (!isOwnerAccessValid(ctx.owner) || ctx.role !== 'egasi') return sendJSON(res, 200, { ok: false, reason: 'Bu amalni faqat oshxona egasi bajara oladi' });
      const owner = ctx.owner;
      if (!ownerCanUseFeature(owner, 'courier-report')) return sendJSON(res, 200, featureBlockedResult('courier-report'));

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

  // ---- API: "Karta orqali to'lov"ga cheklangan mijozlar ro'yxati (faqat egasi) ----
  // Ketma-ket bir necha marta dostavkani bekor qildirgan mijozlarga tizim
  // avtomatik ravishda "naqd/dostavka orqali" to'lovni yopib qo'yadi (qarang:
  // customerIsCardOnlyRestricted()). Bu ekran egasiga: (1) kimlar shu holatda
  // ekanini, (2) har birining oxirgi bekor qilingan buyurtmalari va sababini
  // ko'rsatadi — chunki bekor qilish har doim ham mijozning aybi bo'lmasligi
  // mumkin (masalan, kuryer o'zi yetkaza olmagan holatlar ham shu ro'yxatga
  // tushadi), shu sababli egasi holatni ko'rib chiqib, kerak bo'lsa cheklovni
  // qo'lda olib tashlashi mumkin (/api/toggle-customer-restriction).
  if (req.method === 'POST' && req.url === '/api/restricted-customers') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));

      const customers = [];
      for (const c of (owner.customers || [])) {
        const cancelledCount = customerCancelledDeliveryCount(owner, c.id);
        if (cancelledCount < CARD_ONLY_AFTER_CANCELLED_DELIVERIES) continue;
        const recentCancellations = (owner.orders || [])
          .filter(o => String(o.customerId) === String(c.id) && o.orderType === 'dostavka' && o.status === 'bekor_qilindi')
          .sort((a, b) => new Date(b.cancelledAt || b.createdAt) - new Date(a.cancelledAt || a.createdAt))
          .slice(0, 5)
          .map(o => ({ reason: o.cancelReason || null, cancelledAt: o.cancelledAt || o.createdAt, total: o.total || 0 }));
        customers.push({
          id: c.id,
          name: c.firstName || c.username || `ID: ${c.id}`,
          username: c.username || null,
          cancelledCount,
          restricted: customerIsCardOnlyRestricted(owner, c.id),
          recentCancellations
        });
      }
      customers.sort((a, b) => b.cancelledCount - a.cancelledCount);

      return sendJSON(res, 200, { ok: true, customers });
    });
    return;
  }

  // ---- API: mijozlar qoldirgan reyting va sharhlar ro'yxati (65-bosqich) ----
  // Egasi o'zining ekranidan (targetOwnerId'siz) yoki admin istalgan do'kon
  // uchun (targetOwnerId bilan) chaqiradi — ikkalasi ham bir xil ma'lumotni
  // ko'radi, chunki "izoh admin va ownerlarga ko'rinsin" talabiga ko'ra.
  if (req.method === 'POST' && req.url === '/api/owner-reviews') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, targetOwnerId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      let owner;
      if (targetOwnerId && isAdminId(userId)) {
        owner = findOwner(owners, targetOwnerId);
        if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Bunday oshxona topilmadi.' });
      } else {
        owner = findOwner(owners, userId);
        if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga (yoki adminga) ko\'rinadi'));
      }

      const rating = ownerAverageRating(owner);
      const reviews = ownerRatedOrders(owner)
        .sort((a, b) => new Date(b.customerRatedAt) - new Date(a.customerRatedAt))
        .slice(0, 200)
        .map(o => ({
          orderId: o.id,
          stars: o.customerRating,
          comment: o.customerComment || null,
          ratedAt: o.customerRatedAt,
          customerName: (findCustomer(owner, o.customerId) || {}).firstName || o.customerName || null
        }));

      return sendJSON(res, 200, { ok: true, avgRating: rating.avg, ratingCount: rating.count, reviews });
    });
    return;
  }

  // ---- API: egasi mijozning "Faqat karta" cheklovini qo'lda olib tashlaydi/qaytaradi ----
  if (req.method === 'POST' && req.url === '/api/toggle-customer-restriction') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, customerId, action } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));

      if (!customerId) return sendJSON(res, 200, { ok: false, reason: 'Mijoz tanlanmagan.' });
      if (!Array.isArray(owner.cardOnlyOverrides)) owner.cardOnlyOverrides = [];

      if (action === 'clear') {
        if (!owner.cardOnlyOverrides.some(id => String(id) === String(customerId))) {
          owner.cardOnlyOverrides.push(String(customerId));
        }
      } else if (action === 'restore') {
        owner.cardOnlyOverrides = owner.cardOnlyOverrides.filter(id => String(id) !== String(customerId));
      } else {
        return sendJSON(res, 200, { ok: false, reason: 'Noto\'g\'ri amal.' });
      }

      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, restricted: customerIsCardOnlyRestricted(owner, customerId) });
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));

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
      // 26-bosqich: "necha kunda tugaydi" — joriy qoldiq / kunlik o'rtacha sarf.
      // 27-bosqich: daysLeft <= 3 bo'lgan mahsulotlar "tez tugaydigan" deb belgilanadi.
      const daysLeft = avgDaily > 0 ? Math.round((item.qty / avgDaily) * 10) / 10 : null;
      forecast.push({
        stockId: item.id, name: item.name, unit: item.unit,
        currentQty: item.qty, avgDailyUsage: avgDaily, predictedNeed,
        shortage: item.qty < predictedNeed,
        daysLeft, urgent: daysLeft !== null && daysLeft <= 3
      });
    }
    forecast.sort((a, b) => {
      const aLeft = a.daysLeft === null ? Infinity : a.daysLeft;
      const bLeft = b.daysLeft === null ? Infinity : b.daysLeft;
      return aLeft - bLeft;
    });
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
      return `Bugungi kirim: ${fmtNum(ctx.cashflow.today.income)} so'm, xarajat: ${fmtNum(ctx.cashflow.today.expense)} so'm, sof foyda: ${fmtNum(ctx.cashflow.today.net)} so'm (${ctx.cashflow.today.orderCount} ta buyurtma).`;
    }
    if (/hafta/.test(q) && /foyda|savdo|kirim/.test(q)) {
      return `Shu hafta kirim: ${fmtNum(ctx.cashflow.week.income)} so'm, xarajat: ${fmtNum(ctx.cashflow.week.expense)} so'm, sof foyda: ${fmtNum(ctx.cashflow.week.net)} so'm (${ctx.cashflow.week.orderCount} ta buyurtma).`;
    }
    if (/oy/.test(q) && /foyda|savdo|kirim/.test(q)) {
      return `Shu oy kirim: ${fmtNum(ctx.cashflow.month.income)} so'm, xarajat: ${fmtNum(ctx.cashflow.month.expense)} so'm, sof foyda: ${fmtNum(ctx.cashflow.month.net)} so'm (${ctx.cashflow.month.orderCount} ta buyurtma).`;
    }
    if (/top|eng ko'p sotilgan|mashhur|qaysi taom/.test(q)) {
      if (!ctx.topItems.length) return 'Hozircha (so\'nggi 30 kunda) buyurtma tarixi yo\'q.';
      const list = ctx.topItems.slice(0, 3).map((it, i) => `${i + 1}. ${it.name} — ${it.qty} dona (${fmtNum(it.revenue)} so'm)`).join('\n');
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
      const list = low.slice(0, 5).map(f => `• ${f.name}: bor ${fmtNum(f.currentQty)} ${f.unit}, kunlik o'rtacha sarf ${fmtNum(f.avgDailyUsage)} ${f.unit}`).join('\n');
      return `Ertaga yetishmasligi mumkin bo'lgan mahsulotlar:\n${list}`;
    }

    // Umumiy so'rovlarga qisqa umumiy hisobot bilan javob beramiz
    const topLine = ctx.topItems[0] ? `Eng ko'p sotilgan: ${ctx.topItems[0].name}.` : '';
    return `Aniq javob topa olmadim, lekin umumiy holat shunday: bugungi sof foyda ${fmtNum(ctx.cashflow.today.net)} so'm, shu hafta ${fmtNum(ctx.cashflow.week.net)} so'm. ${topLine} Aniqroq javob uchun "bugun foyda qancha", "eng ko'p sotilgan taom", "pik vaqt qachon" yoki "sklad kam qolganmi" kabi savol bering.`;
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
      if (!ownerCanUseFeature(owner, 'ai-director')) return sendJSON(res, 200, featureBlockedResult('ai-director'));

      owner.aiDirectorEnabled = !!enabled;
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, enabled: owner.aiDirectorEnabled });
    });
    return;
  }

  // ---- API: AI Direktor HAFTALIK hisobotini OLDINDAN KO'RISH (30-bosqich) ----
  if (req.method === 'POST' && req.url === '/api/ai-director-weekly-preview') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
      if (!ownerCanUseFeature(owner, 'ai-director')) return sendJSON(res, 200, featureBlockedResult('ai-director'));

      return sendJSON(res, 200, {
        ok: true,
        text: buildAiWeeklyDirectorText(owner),
        enabled: owner.aiWeeklyEnabled !== false,
        sentThisWeek: owner.aiWeeklyLastSent === aiDirWeekKey(new Date()),
        weekday: AI_DIRECTOR_WEEKLY_DAY,
        hour: AI_DIRECTOR_HOUR
      });
    });
    return;
  }

  // ---- API: AI Direktor HAFTALIK hisobotini HOZIR (Telegram'ga) yuborish ----
  if (req.method === 'POST' && req.url === '/api/ai-director-weekly-send-now') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
      if (!ownerCanUseFeature(owner, 'ai-director')) return sendJSON(res, 200, featureBlockedResult('ai-director'));

      sendAiWeeklyDirectorDigest(owner, true).then(() => {
        saveOwners(owners);
        sendJSON(res, 200, { ok: true });
      }).catch(() => sendJSON(res, 200, { ok: false, reason: 'Yuborishda xatolik yuz berdi.' }));
    });
    return;
  }

  // ---- API: AI Direktorning haftalik (Dushanba, soat 08:00 Toshkent)
  // avtomatik xabarini yoqish/o'chirish — kunlik bayrog'idan (aiDirectorEnabled)
  // MUSTAQIL, owner ikkalasini alohida yoqib/o'chira oladi ----
  if (req.method === 'POST' && req.url === '/api/ai-director-weekly-toggle') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, enabled } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
      if (!ownerCanUseFeature(owner, 'ai-director')) return sendJSON(res, 200, featureBlockedResult('ai-director'));

      owner.aiWeeklyEnabled = !!enabled;
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true, enabled: owner.aiWeeklyEnabled });
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
      if (!ownerCanUseFeature(owner, 'notification-log')) return sendJSON(res, 200, featureBlockedResult('notification-log'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
      if (!ownerCanUseFeature(owner, 'notification-log')) return sendJSON(res, 200, featureBlockedResult('notification-log'));

      owner.notificationErrors = [];
      saveOwners(owners);
      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ==================== 59-BOSQICH: Egasi uchun push-bildirishnoma sozlamalari ====================
  // Egasi qaysi toifadagi xabarlarni shaxsiy chatida olishni xohlashini
  // o'zi belgilaydi (masalan do'kon juda gavjum bo'lsa, har bir yangi
  // buyurtma haqida alohida xabar kelaverishi charchatishi mumkin — kassir
  // panelida buyurtmalar ro'yxati baribir real-vaqtda yangilanib turadi).
  // MUHIM: bu — oddiy shaxsiy sozlama, hech qanday tarifga bog'liq emas
  // (barcha egalar uchun ochiq, xuddi profil ma'lumotlari kabi).
  if (req.method === 'POST' && req.url === '/api/notification-prefs-get') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));

      const prefs = {};
      for (const key of Object.keys(NOTIFICATION_CATEGORIES)) {
        prefs[key] = !isNotificationCategoryMuted(owner, key);
      }
      return sendJSON(res, 200, {
        ok: true,
        prefs,
        categories: Object.entries(NOTIFICATION_CATEGORIES).map(([key, label]) => ({ key, label }))
      });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/notification-prefs-save') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));

      const incoming = payload.prefs && typeof payload.prefs === 'object' ? payload.prefs : {};
      if (!owner.notificationPrefs) owner.notificationPrefs = {};
      for (const key of Object.keys(NOTIFICATION_CATEGORIES)) {
        if (key in incoming) owner.notificationPrefs[key] = !!incoming[key];
      }
      saveOwners(owners);

      const prefs = {};
      for (const key of Object.keys(NOTIFICATION_CATEGORIES)) {
        prefs[key] = !isNotificationCategoryMuted(owner, key);
      }
      return sendJSON(res, 200, { ok: true, prefs });
    });
    return;
  }

  // Do'kon egasi mijozlardan "karta" to'lovini qabul qilish uchun o'z karta
  // raqamini ko'radi/tahrirlaydi (qarang: customerPaymentCard,
  // ensureSubscriptionFields). Bu — platforma egasining OBUNA kartasidan
  // (admin-payment-requisites-*) butunlay boshqa, alohida narsa.
  if (req.method === 'POST' && req.url === '/api/owner-payment-card-get') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = pruneExpiredOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));

      return sendJSON(res, 200, { ok: true, card: owner.customerPaymentCard || { cardNumber: '', cardHolder: '' } });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/owner-payment-card-set') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });

      const userId = String(check.user && check.user.id);
      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));

      const cardNumber = String(payload.cardNumber || '').trim().slice(0, 40);
      const cardHolder = String(payload.cardHolder || '').trim().slice(0, 80);
      owner.customerPaymentCard = { cardNumber, cardHolder };
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, card: owner.customerPaymentCard });
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Bu bo\'lim faqat oshxona egasiga ko\'rinadi'));
      if (!ownerCanUseFeature(owner, 'staff-performance')) return sendJSON(res, 200, featureBlockedResult('staff-performance'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q yoki muddati tugagan'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q yoki muddati tugagan'));

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

      // 19-bosqich: 'restaurant-brand' faqat logo/brend rangini o'zgartirishni
      // cheklaydi — nom/manzil/telefon/ish vaqti asosiy profil ma'lumoti bo'lgani
      // uchun tarifdan qat'i nazar har doim saqlanadi. Owner logo/rangni
      // o'zgartirmoqchi bo'lganda (mavjud qiymatdan farqli yangi qiymat
      // yuborsa) va tarifda bu funksiya yopiq bo'lsa — bloklanadi; oldingi
      // qiymatni o'zgartirmasdan qayta yuborish (masalan forma qayta
      // saqlanganda) esa xatoga olib kelmaydi.
      if (!ownerCanUseFeature(owner, 'restaurant-brand')) {
        const existingLogo = (owner.profile && owner.profile.logoUrl) || '';
        const existingBrandColor = (owner.profile && owner.profile.brandColor) || '';
        if (logoTrim !== existingLogo || brandColorTrim !== existingBrandColor) {
          return sendJSON(res, 200, featureBlockedResult('restaurant-brand'));
        }
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

  // ---- API: to'lov rekvizitlarini olish (faqat admin) — "💳 Obuna"
  // bo'limida egaga ko'rsatiladigan karta/Click/Payme ma'lumotlari. ----
  if (req.method === 'POST' && req.url === '/api/admin-payment-requisites-get') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin ko\'ra oladi' });

      return sendJSON(res, 200, { ok: true, requisites: loadPaymentRequisites() });
    });
    return;
  }

  // ---- API: to'lov rekvizitlarini tahrirlash (faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/admin-payment-requisites-set') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, cardNumber, cardHolder, clickNumber, paymeNumber } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin o\'zgartira oladi' });

      const updated = savePaymentRequisites({
        cardNumber: String(cardNumber || '').trim() || DEFAULT_PAYMENT_REQUISITES.cardNumber,
        cardHolder: String(cardHolder || '').trim() || DEFAULT_PAYMENT_REQUISITES.cardHolder,
        clickNumber: String(clickNumber || '').trim() || DEFAULT_PAYMENT_REQUISITES.clickNumber,
        paymeNumber: String(paymeNumber || '').trim() || DEFAULT_PAYMENT_REQUISITES.paymeNumber
      });

      return sendJSON(res, 200, { ok: true, requisites: updated });
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

  // =========================================================================
  // ---- API: "Obuna rejalari" (G-bo'lim, subscription_plans.json) — admin
  // panelidan owner "💳 Obuna" bo'limida ko'radigan muddat/narx rejalarini
  // to'liq boshqarish (qo'shish/tahrirlash/o'chirish). Ilgari bu rejalar
  // FAQAT kod ichidagi DEFAULT_SUBSCRIPTION_PLANS orqali qat'iy belgilangan
  // edi (admin hech narsani o'zgartira olmasdi) — endi tariffs.json'dagi
  // kabi to'liq CRUD orqali boshqariladi. Har bir rejaga ixtiyoriy ravishda
  // F-bo'lim tarifi (tariffId) ham biriktirilishi mumkin — owner shu rejani
  // tanlab to'lasa, admin tasdiqlaganda muddat bilan birga tarifi ham shu
  // tarifga o'zgaradi (qarang: decideSubscriptionPayment).
  // =========================================================================
  if (req.method === 'POST' && req.url === '/api/subscription-plan-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin ko\'ra oladi' });

      const tariffs = loadTariffs();
      const plans = Object.values(loadSubscriptionPlans())
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(p => {
          const tariff = p.tariffId ? tariffs.find(t => t.id === p.tariffId) : null;
          return { ...p, tariffLabel: tariff ? tariff.name : null };
        });
      return sendJSON(res, 200, { ok: true, plans, tariffs: tariffs.map(t => ({ id: t.id, name: t.name })) });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/subscription-plan-add') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, label, days, price, discountNote, tariffId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin qo\'sha oladi' });

      const labelTrim = String(label || '').trim();
      if (!labelTrim) return sendJSON(res, 200, { ok: false, reason: 'Reja nomini kiriting.' });

      const daysVal = parseInt(days, 10);
      if (!Number.isInteger(daysVal) || daysVal <= 0) {
        return sendJSON(res, 200, { ok: false, reason: 'Muddat (kun) musbat butun son bo\'lishi kerak.' });
      }

      const priceVal = Number(price);
      if (!Number.isFinite(priceVal) || priceVal < 0) {
        return sendJSON(res, 200, { ok: false, reason: 'Narx 0 yoki musbat son bo\'lishi kerak.' });
      }

      let tariffIdVal = null;
      if (tariffId !== undefined && tariffId !== null && String(tariffId).trim() !== '') {
        const tariffs = loadTariffs();
        if (!tariffs.some(t => t.id === tariffId)) {
          return sendJSON(res, 200, { ok: false, reason: 'Tanlangan tarif topilmadi.' });
        }
        tariffIdVal = tariffId;
      }

      const plans = loadSubscriptionPlans();
      const id = crypto.randomBytes(4).toString('hex');
      const order = Object.keys(plans).length;
      plans[id] = {
        id,
        label: labelTrim,
        days: daysVal,
        price: priceVal,
        discountNote: discountNote ? String(discountNote).trim() || null : null,
        tariffId: tariffIdVal,
        order
      };
      saveSubscriptionPlans(plans);

      return sendJSON(res, 200, { ok: true, plan: plans[id] });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/subscription-plan-update') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id, label, days, price, discountNote, tariffId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin o\'zgartira oladi' });

      const plans = loadSubscriptionPlans();
      const plan = plans[id];
      if (!plan) return sendJSON(res, 200, { ok: false, reason: 'Reja topilmadi.' });

      const labelTrim = String(label || '').trim();
      if (!labelTrim) return sendJSON(res, 200, { ok: false, reason: 'Reja nomini kiriting.' });

      const daysVal = parseInt(days, 10);
      if (!Number.isInteger(daysVal) || daysVal <= 0) {
        return sendJSON(res, 200, { ok: false, reason: 'Muddat (kun) musbat butun son bo\'lishi kerak.' });
      }

      const priceVal = Number(price);
      if (!Number.isFinite(priceVal) || priceVal < 0) {
        return sendJSON(res, 200, { ok: false, reason: 'Narx 0 yoki musbat son bo\'lishi kerak.' });
      }

      let tariffIdVal = null;
      if (tariffId !== undefined && tariffId !== null && String(tariffId).trim() !== '') {
        const tariffs = loadTariffs();
        if (!tariffs.some(t => t.id === tariffId)) {
          return sendJSON(res, 200, { ok: false, reason: 'Tanlangan tarif topilmadi.' });
        }
        tariffIdVal = tariffId;
      }

      plan.label = labelTrim;
      plan.days = daysVal;
      plan.price = priceVal;
      plan.discountNote = discountNote ? String(discountNote).trim() || null : null;
      plan.tariffId = tariffIdVal;
      saveSubscriptionPlans(plans);

      return sendJSON(res, 200, { ok: true, plan });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/subscription-plan-remove') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, id } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin o\'chira oladi' });

      const plans = loadSubscriptionPlans();
      if (!plans[id]) return sendJSON(res, 200, { ok: false, reason: 'Reja topilmadi.' });
      // Eslatma: bu rejani ilgari tanlagan so'rovlar (subscriptionPaymentRequest)
      // o'zining planLabel/amount/days "suratini" saqlaydi, shuning uchun
      // reja shu yerdan o'chirilsa ham eski so'rovlar buzilmaydi.
      delete plans[id];
      Object.values(plans).sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((p, i) => { p.order = i; });
      saveSubscriptionPlans(plans);

      return sendJSON(res, 200, { ok: true });
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
        // 65-bosqich: mijozlar qo'ygan reytingi — do'konlar shu bo'yicha
        // ro'yxatda tepaga ko'tariladi (pastda saralash qarang).
        const rating = ownerAverageRating(o);
        clean.avgRating = rating.avg;
        clean.ratingCount = rating.count;
        return clean;
      });
      // Reytingi yuqori do'konlar ro'yxat boshida ko'rinadi. Hali baholanmagan
      // (avgRating === null) do'konlar — reytingga qarab pastga tushmasin
      // uchun emas, balki hali ma'lumot yo'qligi uchun — ro'yxat oxirida,
      // lekin o'zaro nisbiy tartibini (masalan, ro'yxatga qo'shilgan vaqti)
      // saqlagan holda qoladi.
      owners.sort((a, b) => {
        if (a.avgRating === null && b.avgRating === null) return 0;
        if (a.avgRating === null) return 1;
        if (b.avgRating === null) return -1;
        return b.avgRating - a.avgRating;
      });
      // 67-bosqich: umumiy daromad — payments.json (to'liq tarix) asosida,
      // joriy owners.json holatining oddiy yig'indisi emas. Shu bilan owner
      // o'chirilgan/tarifi o'zgargan taqdirda ham o'tmishdagi to'lovlar
      // hisobdan tushib qolmaydi (69-bosqich talabiga mos).
      const payments = loadPayments();
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
      const revenue = {
        totalLifetime: payments.reduce((s, p) => s + (Number(p.amount) || 0), 0),
        thisMonth: payments.filter(p => new Date(p.at).getTime() >= monthStart).reduce((s, p) => s + (Number(p.amount) || 0), 0),
        paymentCount: payments.length
      };
      return sendJSON(res, 200, { ok: true, owners, revenue });
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
  // ====== 63/64-bosqich + 76-bosqich tuzatishi: obuna muddatini uzaytirish/qisqartirish/bekor qilish ======
  // action:
  //  - 'extend'    : joriy muddatga (yoki u tugagan/yo'q bo'lsa hozirgi vaqtga)
  //                  `days` kun qo'shadi.
  //  - 'setDate'   : `date` (YYYY-MM-DD) ga aniq belgilaydi — kelajakdagi sana
  //                  uzaytirish, o'tmishdagi/bugungi sana esa DARHOL BLOKLASH
  //                  bilan bir xil (pastga qarang).
  //  - 'unlimited' : muddatni tozalaydi (doimiy ruxsat).
  //  - 'cancelNow' : obunani darhol bloklaydi.
  //
  // 76-BOSQICH TUZATISHI: ilgari 'setDate' (o'tmish sana) va 'cancelNow'
  // ownerni owners.json'dan BUTUNLAY O'CHIRIB YUBORARDI (checkOwnerExpirations()
  // bilan bir xil xato). Endi ikkalasi ham FAQAT bloklaydi (subscriptionStatus:
  // 'blocked') — menyu, xodimlar, buyurtmalar tarixi saqlanib qoladi, admin
  // istalgan vaqt qayta uzaytirishi mumkin. Ownerni HAQIQATAN butunlay
  // o'chirish kerak bo'lsa, buning uchun alohida /api/remove-owner mavjud
  // (u ataylab, admin ongli ravishda "ro'yxatdan chiqarish"ni tanlaganda
  // ishlatiladi — bu yerdagi kabi obuna muddati sabab emas).
  //
  // Barcha amallarda ham subscriptionUntil (yangi sxema) VA expiresAt (eski,
  // frontend hali shuni o'qiydigan bo'lishi mumkin — moslik uchun) birga
  // yangilanadi. owner.reminderSentAt/blockedNotifiedAt ham tozalanadi —
  // muddat o'zgargach, eslatma/bloklanish xabari yangi holatga nisbatan
  // to'g'ri vaqtda qayta hisoblansin uchun.
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
        const currentMs = owner.subscriptionUntil ? new Date(owner.subscriptionUntil).getTime() : NaN;
        const base = Number.isFinite(currentMs) && currentMs > Date.now() ? currentMs : Date.now();
        const untilIso = new Date(base + n * 86400000).toISOString();
        owner.subscriptionUntil = untilIso;
        owner.expiresAt = untilIso;
        owner.subscriptionStatus = SUBSCRIPTION_STATUS.ACTIVE;
        owner.graceUntil = null;
        owner.reminderSentAt = null;
        owner.blockedNotifiedAt = null;
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
          owner.subscriptionUntil = d.toISOString();
          owner.expiresAt = d.toISOString();
          owner.subscriptionStatus = SUBSCRIPTION_STATUS.BLOCKED;
          owner.graceUntil = null;
          owner.blockedNotifiedAt = new Date().toISOString();
          saveOwners(owners);
          await sendMessage(ADMIN_ID,
            `⏰ <b>Obuna muddati qisqartirildi</b>\n${ownerLabel(owner)} (ID: <code>${owner.id}</code>) uchun Mini App'ga kirish admin tomonidan bloklandi.\nMa'lumotlari saqlanib qolyapti — qayta uzaytirsangiz, kirish tiklanadi.`);
          await sendMessage(owner.id,
            `⏰ Sizning obuna muddatingiz administrator tomonidan qisqartirildi, Mini App'ga kirish bloklandi.\nMa'lumotlaringiz saqlanib qolyapti. Davom ettirish uchun administrator bilan bog'laning.`);
          return sendJSON(res, 200, { ok: true, owner, blocked: true });
        }
        owner.subscriptionUntil = d.toISOString();
        owner.expiresAt = d.toISOString();
        owner.subscriptionStatus = SUBSCRIPTION_STATUS.ACTIVE;
        owner.graceUntil = null;
        owner.reminderSentAt = null;
        owner.blockedNotifiedAt = null;
        saveOwners(owners);
        return sendJSON(res, 200, { ok: true, owner });
      }

      if (action === 'unlimited') {
        owner.subscriptionUntil = null;
        owner.expiresAt = null;
        owner.subscriptionStatus = SUBSCRIPTION_STATUS.ACTIVE;
        owner.graceUntil = null;
        owner.reminderSentAt = null;
        owner.blockedNotifiedAt = null;
        saveOwners(owners);
        return sendJSON(res, 200, { ok: true, owner });
      }

      if (action === 'cancelNow') {
        const nowIso = new Date().toISOString();
        owner.subscriptionUntil = nowIso;
        owner.expiresAt = nowIso;
        owner.subscriptionStatus = SUBSCRIPTION_STATUS.BLOCKED;
        owner.graceUntil = null;
        owner.blockedNotifiedAt = nowIso;
        saveOwners(owners);
        await sendMessage(ADMIN_ID,
          `⏰ <b>Obuna bekor qilindi</b>\n${ownerLabel(owner)} (ID: <code>${owner.id}</code>) uchun Mini App'ga kirish admin tomonidan bloklandi.\nMa'lumotlari saqlanib qolyapti — qayta uzaytirsangiz, kirish tiklanadi.`);
        await sendMessage(owner.id,
          `⏰ Sizning obunangiz administrator tomonidan bekor qilindi, Mini App'ga kirish bloklandi.\nMa'lumotlaringiz saqlanib qolyapti.`);
        return sendJSON(res, 200, { ok: true, owner, blocked: true });
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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q yoki muddati tugagan'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q yoki muddati tugagan'));

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
      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, subscriptionBlockedJSON(owners, userId, 'Ruxsatingiz yo\'q yoki muddati tugagan'));

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
        return sendJSON(res, 200, subscriptionBlockedJSON(owners, owner.id, 'Obuna muddati tugagan. Administrator bilan bog\'laning.'));
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
        paidAt: paid ? new Date().toISOString() : null,
        // 71-bosqich: admin qo'lda qo'shgan owner ham darhol yangi obuna
        // sxemasiga mos keladi — expiresAt bilan sinxron holda 'active'
        // sifatida boshlanadi (o'zi ro'yxatdan o'tgan pending_trial holati
        // 10-bosqichda qo'shiladi, bu yerga tegishli emas).
        subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
        subscriptionUntil: expiresAt,
        graceUntil: null,
        trialGivenAt: null
      };
      owners.push(newOwner);
      saveOwners(owners);
      if (newOwner.paid) recordPayment(newOwner, priceVal);

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

      let justPaid = false;
      if (paid !== undefined && paid !== null) {
        const wasPaid = !!owner.paid;
        owner.paid = !!paid;
        if (owner.paid && !wasPaid) { owner.paidAt = new Date().toISOString(); justPaid = true; }
        if (!owner.paid) owner.paidAt = null;
      }

      saveOwners(owners);
      // Faqat "to'lanmagan" -> "to'langan" haqiqiy o'tishida ledger'ga
      // yozamiz (narx shu paytdagi owner.price bo'yicha — yuqorida
      // yangilangan bo'lishi mumkin) — paid:true qayta yuborilsa qayta
      // yozilmaydi.
      if (justPaid) {
        recordPayment(owner, owner.price);
      }
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
      const target = findOwner(owners, id);
      // 16-bosqich: endi butunlay o'chirilmaydi — TO'LIQ holicha "Savatcha"ga
      // ko'chiriladi (3 kun ichida tiklash mumkin, qarang: moveOwnerToTrash).
      if (target) moveOwnerToTrash(target, userId);
      owners = owners.filter(o => String(o.id) !== String(id));
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, removed: before !== owners.length });
    });
    return;
  }

  // ==================== C-bo'lim (16-22-bosqich): Savatcha API'lari ====================
  // ---- API: Savatchadagi barcha yozuvlar ro'yxati (faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/trash-list') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin ko\'ra oladi' });

      const now = Date.now();
      const list = loadTrash().map(t => ({
        id: t.id,
        ownerId: t.ownerSnapshot.id,
        ownerLabel: ownerLabel(t.ownerSnapshot),
        restaurantName: (t.ownerSnapshot.profile && t.ownerSnapshot.profile.name) || null,
        trashedAt: t.trashedAt,
        autoPurgeAt: t.autoPurgeAt,
        daysLeft: Math.max(0, Math.ceil((new Date(t.autoPurgeAt).getTime() - now) / 86400000)),
        restoreStatus: t.restoreStatus
      })).sort((a, b) => new Date(a.autoPurgeAt) - new Date(b.autoPurgeAt));

      return sendJSON(res, 200, { ok: true, trash: list });
    });
    return;
  }

  // ---- API: Savatchadan to'g'ridan-to'g'ri tiklash (faqat admin, owner
  // so'rovini kutmasdan ham qila oladi — 21-bosqich: baribir FAQAT admin
  // orqali amalga oshadi). ----
  if (req.method === 'POST' && req.url === '/api/trash-restore') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, trashId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin tiklay oladi' });
      if (!trashId) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const trash = loadTrash();
      const entry = findTrashEntry(trash, trashId);
      if (!entry) return sendJSON(res, 200, { ok: false, reason: 'Bu yozuv Savatchada topilmadi.' });

      const result = restoreOwnerFromTrash(entry);
      if (!result.ok) return sendJSON(res, 200, { ok: false, reason: result.reason });

      saveTrash(trash.filter(t => t.id !== trashId));
      logTrashEvent('restored', entry.ownerSnapshot, { restoredBy: userId, via: 'admin_panel' });
      sendMessage(entry.ownerSnapshot.id,
        `✅ <b>Oshxonangiz tiklandi!</b>\nBarcha ma'lumotlaringiz (menyu, xodimlar, sozlamalar) saqlanib qolgan. Mini App tugmasi orqali oching.`)
        .catch(() => {});

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: Savatchadan muddatidan oldin, qo'lda butunlay o'chirish
  // (faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/trash-purge-now') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, trashId } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin o\'chira oladi' });
      if (!trashId) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });

      const trash = loadTrash();
      const entry = findTrashEntry(trash, trashId);
      if (!entry) return sendJSON(res, 200, { ok: false, reason: 'Bu yozuv Savatchada topilmadi.' });

      archiveOwnerOrders(entry.ownerSnapshot);
      logTrashEvent('purged', entry.ownerSnapshot, { reason: 'admin_qolda', purgedBy: userId });
      saveTrash(trash.filter(t => t.id !== trashId));

      return sendJSON(res, 200, { ok: true });
    });
    return;
  }

  // ---- API: Savatcha bilan bog'liq loglar (faqat admin, 22-bosqich) ----
  if (req.method === 'POST' && req.url === '/api/trash-log') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin ko\'ra oladi' });

      const log = loadTrashLog().slice().sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 200);
      return sendJSON(res, 200, { ok: true, log });
    });
    return;
  }

  // ==================== 52-54-BOSQICH: DB zaxira (backup) ====================
  // ---- API: butun bazani bitta JSON faylga jamlab yuklab olish (52-bosqich, faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/backup-export') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin zaxira yuklab ola oladi' });

      let snapshot;
      try {
        snapshot = buildBackupSnapshot(userId);
      } catch (e) {
        console.error('backup-export xatolik:', e.message);
        return sendJSON(res, 200, { ok: false, reason: 'Zaxira tayyorlashda xatolik yuz berdi.' });
      }

      const json = JSON.stringify(snapshot, null, 2);
      const filename = `zaxira_${new Date().toISOString().slice(0, 10)}.json`;

      // Xavfsizlik: kim, qachon zaxira yuklab olganini BARCHA adminlarga
      // (shu jumladan boshqa qurilmadagi adminlarga ham) xabar qilamiz —
      // shu orqali ruxsatsiz/kutilmagan yuklab olishlar darhol ko'rinadi.
      const adminName = (check.user && (check.user.first_name || check.user.username)) || userId;
      const totalRecords = Object.values(snapshot.counts).reduce((a, b) => a + b, 0);
      allAdminIds().forEach(aid => {
        sendMessage(aid, `🔐 <b>DB zaxirasi yuklab olindi</b>\n👤 ${adminName} (ID: ${userId})\n🕒 ${new Date().toLocaleString('uz-UZ')}\n📦 Jami ${totalRecords} ta yozuv`)
          .catch(() => {});
      });

      return sendJSON(res, 200, {
        ok: true,
        filename,
        mime: 'application/json;charset=utf-8',
        content: json,
        counts: snapshot.counts
      });
    });
    return;
  }

  // ---- API: yuklangan zaxira faylini TEKSHIRISH va xulosa qaytarish
  // (hali hech narsa o'zgartirilmaydi — 54-bosqich, 1-qadam: ko'rib chiqish) ----
  if (req.method === 'POST' && req.url === '/api/backup-import-preview') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin bazani tiklay oladi' });

      const rawContent = payload.content;
      if (!rawContent || typeof rawContent !== 'string') {
        return sendJSON(res, 200, { ok: false, reason: 'Fayl tanlanmagan yoki bo\'sh.' });
      }

      let snapshot;
      try {
        snapshot = JSON.parse(rawContent);
      } catch (e) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu fayl to\'g\'ri JSON zaxira fayli emas.' });
      }

      if (!snapshot || typeof snapshot !== 'object' || !snapshot.files || typeof snapshot.files !== 'object') {
        return sendJSON(res, 200, { ok: false, reason: 'Fayl formati noto\'g\'ri — bu Mini App zaxira fayli emasga o\'xshaydi.' });
      }
      const knownKeys = new Set(BACKUP_FILE_DEFS.map(d => d.key));
      const fileKeys = Object.keys(snapshot.files).filter(k => knownKeys.has(k));
      if (fileKeys.length === 0) {
        return sendJSON(res, 200, { ok: false, reason: 'Faylda tanish bo\'limlar topilmadi.' });
      }

      // Tasdiqlash tokeni — 10 daqiqa amal qiladi, faqat shu admin va shu
      // aniq fayl mazmuni uchun (contentHash mos kelmasa confirm rad etiladi).
      const contentHash = crypto.createHash('sha256').update(rawContent).digest('hex');
      const token = crypto.randomBytes(16).toString('hex');
      pendingBackupRestores.set(token, { adminId: userId, contentHash, createdAt: Date.now(), snapshot });

      return sendJSON(res, 200, {
        ok: true,
        confirmToken: token,
        version: snapshot.version || null,
        exportedAt: snapshot.exportedAt || null,
        counts: snapshot.counts || null,
        sections: fileKeys
      });
    });
    return;
  }

  // ---- API: tiklashni YAKUNIY tasdiqlash va bazoni almashtirish
  // (54-bosqich, 2-qadam). Ikkita himoya qatlami talab qilinadi:
  // (1) oldingi preview'dan olingan confirmToken (10 daqiqa muddatli,
  //     faylning aniq mazmuniga bog'langan), (2) admin qo'lda kiritgan
  // "TASDIQLAYMAN" so'zi — tasodifan bosilib ketmasligi uchun. ----
  if (req.method === 'POST' && req.url === '/api/backup-import-confirm') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin bazani tiklay oladi' });

      const { confirmToken, confirmText, content } = payload;
      if ((confirmText || '').trim().toUpperCase() !== 'TASDIQLAYMAN') {
        return sendJSON(res, 200, { ok: false, reason: 'Tasdiqlash uchun "TASDIQLAYMAN" so\'zini aniq kiriting.' });
      }
      const pending = confirmToken && pendingBackupRestores.get(confirmToken);
      if (!pending) {
        return sendJSON(res, 200, { ok: false, reason: 'Tasdiqlash muddati tugagan yoki noto\'g\'ri. Faylni qaytadan yuklang.' });
      }
      if (String(pending.adminId) !== userId) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu tasdiqlash boshqa admin uchun yaratilgan.' });
      }
      if (Date.now() - pending.createdAt > BACKUP_RESTORE_TOKEN_TTL_MS) {
        pendingBackupRestores.delete(confirmToken);
        return sendJSON(res, 200, { ok: false, reason: 'Tasdiqlash muddati (10 daqiqa) tugagan. Faylni qaytadan yuklang.' });
      }
      const contentHash = crypto.createHash('sha256').update(String(content || '')).digest('hex');
      if (contentHash !== pending.contentHash) {
        return sendJSON(res, 200, { ok: false, reason: 'Fayl mazmuni preview qilingandan beri o\'zgargan. Qaytadan yuklang.' });
      }

      pendingBackupRestores.delete(confirmToken);

      let safetyFile = null;
      let applied = [];
      try {
        safetyFile = savePreRestoreSafetySnapshot(userId); // tiklashdan oldingi holatni saqlab qo'yamiz
        applied = applyBackupSnapshot(pending.snapshot);
      } catch (e) {
        console.error('backup-import-confirm xatolik:', e.message);
        return sendJSON(res, 200, { ok: false, reason: 'Bazani tiklashda xatolik yuz berdi. Hech narsa o\'zgartirilmadi yoki qisman o\'zgargan bo\'lishi mumkin — pre_restore_backups papkasini tekshiring.' });
      }

      const adminName = (check.user && (check.user.first_name || check.user.username)) || userId;
      allAdminIds().forEach(aid => {
        sendMessage(aid, `⚠️ <b>DB TIKLANDI (restore)</b>\n👤 ${adminName} (ID: ${userId})\n🕒 ${new Date().toLocaleString('uz-UZ')}\n📦 Almashtirilgan bo'limlar: ${applied.join(', ') || 'yo\'q'}\n💾 Tiklashdan oldingi holat saqlandi: ${safetyFile || 'saqlanmadi (xatolik)'}`)
          .catch(() => {});
      });

      return sendJSON(res, 200, { ok: true, applied, safetyFile });
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

  // ==================== 82-BOSQICH: Egasi obuna sotib olish (Mini App) ====================
  // ---- API: "💳 Obuna" ekrani ochilganda kerak bo'ladigan barcha ma'lumot
  // (joriy holat, to'lov rekvizitlari, tariflar ro'yxati, kutilayotgan so'rov).
  // MUHIM: bu endpoint ATAYLAB resolveOwnerContext/isOwnerAccessValid orqali
  // EMAS, to'g'ridan-to'g'ri findOwner() orqali ishlaydi - aks holda aynan
  // OBUNASI BLOKLANGAN (shu ekranga eng ko'p muhtoj) egasi kira olmay qolardi.
  if (req.method === 'POST' && req.url === '/api/subscription-status') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);

      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Faqat do\'kon egasi uchun.' });

      const access = getOwnerSubscriptionAccess(owner);
      const requisites = loadPaymentRequisites();
      const plans = loadSubscriptionPlans();
      const tariffs = loadTariffs();
      const plansList = Object.values(plans)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(p => {
          const tariff = p.tariffId ? tariffs.find(t => t.id === p.tariffId) : null;
          return { ...p, tariffLabel: tariff ? tariff.name : null };
        });

      return sendJSON(res, 200, {
        ok: true,
        status: access.status,
        allowed: access.allowed,
        daysLeft: access.daysLeft,
        inGrace: access.inGrace,
        subscriptionUntil: owner.subscriptionUntil || null,
        requisites: { cardNumber: requisites.cardNumber, cardHolder: requisites.cardHolder },
        plans: plansList,
        pendingRequest: owner.subscriptionPaymentRequest || null
      });
    });
    return;
  }

  // ---- 15-bosqich (B-bo'lim): "Obuna tarixi" — egasi o'ziga tegishli
  // barcha o'tgan obuna to'lovlarini (tasdiqlangan, muddatni uzaytirgan)
  // ko'radi. payments.json'dagi FAQAT source==='subscription' yozuvlar
  // ishlatiladi (admin qo'lda "to'landi" belgilashi yoki boshqa manbalardan
  // kelgan to'lovlar bu ro'yxatga chiqmaydi — ular obuna emas). ----
  if (req.method === 'POST' && req.url === '/api/subscription-history') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);

      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Faqat do\'kon egasi uchun.' });

      const history = loadPayments()
        .filter(p => String(p.ownerId) === String(owner.id) && p.source === 'subscription')
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .map(p => ({ planLabel: p.planLabel, amount: p.amount, days: p.days, at: p.at }));

      return sendJSON(res, 200, { ok: true, history });
    });
    return;
  }

  // ---- API: owner "💳 Obuna" ekranida bitta tarifni tanlaydi. Skrinshotning
  // O'ZI hamon Mini App'dan EMAS, botning shaxsiy chatiga RASM qilib
  // yuboriladi (Telegram Mini App'da fayl yuklash uchun maxsus infratuzilma
  // kerak bo'lmasligi uchun - qarang: yuqoridagi photo-listener, 82-bosqich).
  if (req.method === 'POST' && req.url === '/api/subscription-select-plan') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);

      const owners = loadOwners();
      const owner = findOwner(owners, userId);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Faqat do\'kon egasi uchun.' });

      const plan = loadSubscriptionPlans()[payload.planId];
      if (!plan) return sendJSON(res, 200, { ok: false, reason: 'Tarif topilmadi.' });

      const reqData = createSubscriptionPaymentRequest(owner, payload.planId);
      saveOwners(owners);

      // Botga o'tib skrinshot yuborishni eslatib, shaxsiy chatni ochish uchun link ham qaytaramiz.
      sendMessage(owner.id,
        `✅ Siz <b>${escapeHtmlServer(plan.label)}</b> tarifini tanladingiz (${fmtNum(plan.price)} so'm).\n\n` +
        `Endi to'lov chekining (skrinshotning) RASMINI shu botga yuboring — administrator tekshirib ` +
        `tasdiqlagach, obunangiz avtomatik yangilanadi.`);

      return sendJSON(res, 200, { ok: true, request: reqData, botUsername: BOT_USERNAME || null });
    });
    return;
  }

  // ---- API: admin uchun "Kutilayotgan to'lovlar" ro'yxati (skrinshot
  // yuborilgan, hali tasdiq/rad kutilayotgan barcha so'rovlar). ----
  if (req.method === 'POST' && req.url === '/api/admin-pending-subscription-payments') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin ko\'ra oladi' });

      const owners = loadOwners();
      const pending = owners
        .filter(o => o.subscriptionPaymentRequest && o.subscriptionPaymentRequest.status === 'kutilmoqda_tasdiq')
        .map(o => ({
          ownerId: o.id,
          ownerLabel: ownerLabel(o),
          restaurantName: (o.profile && o.profile.name) || null,
          request: o.subscriptionPaymentRequest
        }));

      return sendJSON(res, 200, { ok: true, pending });
    });
    return;
  }

  // ---- API: admin panelidan tasdiqlash/rad etish (bot ichidagi ✅/❌
  // tugmalari bilan bir xil decideSubscriptionPayment() mantig'idan foydalanadi). ----
  if (req.method === 'POST' && req.url === '/api/admin-subscription-decide') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin qaror qabul qila oladi' });

      const owners = loadOwners();
      const owner = findOwner(owners, payload.ownerId);
      if (!owner) return sendJSON(res, 200, { ok: false, reason: 'Oshxona topilmadi.' });

      const action = payload.action === 'approve' ? 'approve' : (payload.action === 'reject' ? 'reject' : null);
      if (!action) return sendJSON(res, 200, { ok: false, reason: 'Noto\'g\'ri amal.' });

      const result = decideSubscriptionPayment(owner, action, userId, payload.reason);
      if (!result.ok) return sendJSON(res, 200, result);
      saveOwners(owners);

      return sendJSON(res, 200, { ok: true, newUntil: result.newUntil || null });
    });
    return;
  }

  // ==================== G-bo'lim: Umumiy broadcast/e'lon tizimi (48-51-bosqich) ====================
  // Admin (ADMIN_ID yoki qo'shimcha adminlardan biri) BARCHA oshxonalar
  // bo'yicha bitta xabarni tanlangan toifaga (49-bosqich: mijoz / oshxona
  // egasi / xizmatchi) yuboradi — reklama banner (owner-darajasida, faqat
  // o'z mijozlariga) dan farqli o'laroq, bu tizim BUTUN platformaga tegishli
  // e'lonlar uchun (masalan yangi funksiya haqida xabar, texnik ishlar
  // haqida ogohlantirish). 50-bosqich: matn + rasm (https:// havola,
  // Telegram rasmni o'zi yuklab olishi kerak — base64 ishlamaydi) + tugma
  // (matn+havola) bilan yuboriladi. 51-bosqich: har bir yuborish
  // broadcasts.json'ga netija (necha kishiga yetdi/yetmadi) bilan yoziladi.

  // 49-bosqich: tanlangan toifadagi barcha (takrorlanmas) Telegram ID'lar,
  // BARCHA oshxona egalari bo'yicha yig'ib chiqiladi.
  function collectBroadcastRecipients(targetType) {
    const owners = loadOwners();
    const ids = new Set();
    if (targetType === 'owner') {
      owners.forEach(o => ids.add(String(o.id)));
    } else if (targetType === 'customer') {
      owners.forEach(o => (o.customers || []).forEach(c => ids.add(String(c.id))));
    } else if (targetType === 'staff') {
      owners.forEach(o => (o.staff || []).forEach(s => ids.add(String(s.id))));
    }
    return Array.from(ids);
  }

  // Rasm faqat https:// havola sifatida qabul qilinadi (menyu/banner
  // rasmlaridan farqli — Telegram sendPhoto rasmni o'zi shu havoladan
  // yuklab oladi, base64 data URL'ni GET so'rovda yuborib bo'lmaydi).
  function isValidBroadcastImageUrl(value) {
    if (!value) return true;
    return /^https?:\/\//i.test(value);
  }

  // Bitta qabul qiluvchiga xabar yuboradi (rasm bo'lsa sendPhoto+caption,
  // bo'lmasa oddiy sendMessage), tugma bo'lsa inline havola tugmasi bilan.
  function sendBroadcastToChat(chatId, text, imageUrl, buttonText, buttonUrl) {
    const replyMarkup = (buttonText && buttonUrl) ? { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] } : null;
    const params = { chat_id: chatId, parse_mode: 'HTML' };
    if (replyMarkup) params.reply_markup = JSON.stringify(replyMarkup);
    const method = imageUrl ? 'sendPhoto' : 'sendMessage';
    if (imageUrl) { params.photo = imageUrl; params.caption = text; }
    else { params.text = text; }
    return telegramApi(method, params).then(result => {
      if (!result || !result.ok) {
        const reason = (result && result.description) || 'noma\'lum xatolik';
        console.error(`[broadcast xato] chat_id=${chatId}: ${reason}`);
        return false;
      }
      return true;
    }).catch(err => {
      console.error(`[broadcast tarmoq xatosi] chat_id=${chatId}: ${(err && err.message) || err}`);
      return false;
    });
  }

  // 51-bosqich: barcha qabul qiluvchilarga KETMA-KET (Promise.all emas)
  // kichik tanaffus bilan yuboradi — Telegram'ning soniyasiga xabar
  // limitidan (~30/s) chiqib ketmaslik uchun.
  async function sendBroadcastSequential(recipientIds, text, imageUrl, buttonText, buttonUrl) {
    let delivered = 0, failed = 0;
    for (const chatId of recipientIds) {
      const ok = await sendBroadcastToChat(chatId, text, imageUrl, buttonText, buttonUrl);
      if (ok) delivered++; else failed++;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    return { delivered, failed };
  }

  // ---- API: e'lon/broadcast yuborish (faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/broadcast-send') {
    readBody(req, async (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const { initData, targetType, text, imageUrl, buttonText, buttonUrl } = payload;
      const check = verifyAuth(initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin yubora oladi' });

      if (!['customer', 'owner', 'staff'].includes(targetType)) {
        return sendJSON(res, 200, { ok: false, reason: 'Qabul qiluvchi turini tanlang.' });
      }
      const textTrim = String(text || '').trim();
      if (!textTrim) return sendJSON(res, 200, { ok: false, reason: 'Xabar matnini kiriting.' });
      const imageTrim = String(imageUrl || '').trim();
      if (!isValidBroadcastImageUrl(imageTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Rasm uchun to\'g\'ridan-to\'g\'ri https:// havola kiriting.' });
      }
      const buttonTextTrim = String(buttonText || '').trim();
      const buttonUrlTrim = String(buttonUrl || '').trim();
      if ((buttonTextTrim && !buttonUrlTrim) || (!buttonTextTrim && buttonUrlTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Tugma uchun ham matn, ham havola kerak (yoki ikkalasini ham bo\'sh qoldiring).' });
      }
      if (buttonUrlTrim && !/^https?:\/\//i.test(buttonUrlTrim)) {
        return sendJSON(res, 200, { ok: false, reason: 'Tugma havolasi http:// yoki https:// bilan boshlanishi kerak.' });
      }

      const recipientIds = collectBroadcastRecipients(targetType);
      if (!recipientIds.length) {
        return sendJSON(res, 200, { ok: false, reason: 'Bu toifada hozircha hech kim yo\'q.' });
      }

      const { delivered, failed } = await sendBroadcastSequential(
        recipientIds, textTrim, imageTrim || null, buttonTextTrim || null, buttonUrlTrim || null
      );

      const broadcasts = loadBroadcasts();
      const record = {
        id: crypto.randomBytes(4).toString('hex'),
        targetType,
        text: textTrim,
        imageUrl: imageTrim || null,
        buttonText: buttonTextTrim || null,
        buttonUrl: buttonUrlTrim || null,
        totalTargets: recipientIds.length,
        deliveredCount: delivered,
        failedCount: failed,
        sentBy: userId,
        sentAt: new Date().toISOString()
      };
      broadcasts.unshift(record);
      if (broadcasts.length > 200) broadcasts.length = 200; // jurnal cheksiz o'smasin
      saveBroadcasts(broadcasts);

      return sendJSON(res, 200, { ok: true, result: record });
    });
    return;
  }

  // ---- API: yuborilgan e'lonlar tarixi/statistikasi (faqat admin) ----
  if (req.method === 'POST' && req.url === '/api/broadcast-history') {
    readBody(req, (err, payload) => {
      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
      const check = verifyAuth(payload.initData);
      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
      const userId = String(check.user && check.user.id);
      if (!isAdminId(userId)) return sendJSON(res, 200, { ok: false, reason: 'Faqat admin ko\'ra oladi' });

      return sendJSON(res, 200, { ok: true, broadcasts: loadBroadcasts() });
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

  // 78-BOSQICH: admins.json'dagi qo'shimcha adminlarni xotiraga yuklash
  // (isAdminId() shu xotiradagi ro'yxatdan foydalanadi).
  reloadAdminsCache();
  console.log(`Qo'shimcha adminlar soni: ${EXTRA_ADMIN_IDS.size}`);

  // Obuna muddatlarini tekshirish — darhol bir marta, keyin har soatda
  checkOwnerExpirations().catch(e => console.error('Muddat tekshirishda xatolik:', e.message));
  setInterval(() => {
    checkOwnerExpirations().catch(e => console.error('Muddat tekshirishda xatolik:', e.message));
  }, EXPIRY_CHECK_INTERVAL_MS);

  // 19-bosqich: "Savatcha"dagi 3 kundan oshgan yozuvlarni avtomatik
  // (qaytarib bo'lmaydigan tarzda) tozalash — xuddi obuna tekshiruvi kabi,
  // darhol bir marta va keyin har soatda.
  checkTrashAutoPurge().catch(e => console.error('Savatchani tozalashda xatolik:', e.message));
  setInterval(() => {
    checkTrashAutoPurge().catch(e => console.error('Savatchani tozalashda xatolik:', e.message));
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
