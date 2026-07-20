# Faqat admin uchun Telegram Mini App — sozlash yo'riqnomasi

## 1. BotFather orqali bot yaratish
1. Telegramda **@BotFather** ni oching.
2. `/newbot` yuboring, keyin bot nomi va username kiriting (username `bot` bilan tugashi kerak, masalan `MeningAdminBotim_bot`).
3. BotFather sizga **BOT_TOKEN** beradi (masalan `123456:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxx`) — uni saqlab qo'ying, hech kimga bermang.

## 2. O'zingizning Telegram ID (ADMIN_ID) ni bilib olish
1. Telegramda **@userinfobot** ga o'ting va `/start` bosing.
2. U sizga `Id: 123456789` deb ko'rsatadi — shu raqam sizning `ADMIN_ID`.

## 3. Serverni ishga tushirish
Bu papkada 2 ta asosiy fayl bor: `server.js` va `public/index.html`. Tashqi kutubxona kerak emas — faqat Node.js o'rnatilgan bo'lsa yetarli.

```bash
export BOT_TOKEN="BotFather'dan olingan token"
export ADMIN_ID="123456789"
node server.js
```

Server `http://localhost:3000` da ishga tushadi.

## 4. Internetga chiqarish (HTTPS shart!)
Telegram Mini App faqat **HTTPS** manzilda ishlaydi. Eng oson yo'llar:
- **Railway.app**, **Render.com** yoki **Vercel** kabi bepul xostingga joylash (loyihani shunchaki yuklaysiz, ular avtomatik HTTPS beradi).
- Yoki test uchun `ngrok http 3000` orqali vaqtinchalik HTTPS link olish.

Muhit o'zgaruvchilarini (`BOT_TOKEN`, `ADMIN_ID`) shu xostingning "Environment Variables" bo'limiga qo'shishni unutmang.

## 5. BotFather'da Mini App (Web App) ulash
1. @BotFather ga qayting.
2. `/mybots` → botingizni tanlang → **Bot Settings** → **Menu Button** → **Configure Menu Button**.
3. Web App URL sifatida serveringiz manzilini kiriting, masalan: `https://sizning-domeningiz.com`
4. Tugma nomini kiriting, masalan: `Ochish`

Shundan so'ng bot chatida pastda menyu tugmasi chiqadi — bosilganda Mini App ochiladi.

## Qanday ishlaydi (xavfsizlik)
- Telegram Mini App ochilganda `initData` degan imzolangan ma'lumot beriladi — unda foydalanuvchi ID'si va Telegram'ning raqamli imzosi bor.
- Backend (`server.js`) shu imzoni **BOT_TOKEN** yordamida qayta hisoblab, Telegram'ning o'zi yuborganini tasdiqlaydi (soxtalashtirib bo'lmaydi).
- Imzo to'g'ri chiqsa va foydalanuvchi ID'si `ADMIN_ID` ga teng bo'lsagina — "Salom" chiqadi.
- Boshqa har qanday holatda (begona odam, soxta so'rov, brauzerdan to'g'ridan-to'g'ri ochish) — xato ekrani chiqadi.

## Muhim eslatma
`BOT_TOKEN` faqat serverda (`server.js` ichida, muhit o'zgaruvchisi sifatida) turishi kerak — uni frontendga yoki GitHub'ga hech qachon ochiq qo'ymang.
