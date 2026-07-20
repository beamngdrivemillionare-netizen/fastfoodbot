// Eng yengil Telegram Mini App backend — tashqi kutubxonalarsiz (faqat Node.js o'zi)
// Ishga tushirish: BOT_TOKEN va ADMIN_ID ni sozlab, `node server.js`

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ====== SOZLAMALAR (o'zingiznikiga almashtiring) ======
const BOT_TOKEN = process.env.BOT_TOKEN || 'BOT_TOKEN_BU_YERGA';
const ADMIN_ID = process.env.ADMIN_ID || 'ADMIN_TELEGRAM_ID_BU_YERGA'; // masalan: 123456789
const PORT = process.env.PORT || 3000;
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

const server = http.createServer((req, res) => {
  // ---- API: initData tekshirish ----
  if (req.method === 'POST' && req.url === '/api/verify') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const { initData } = JSON.parse(body || '{}');
        if (!initData) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, reason: 'initData yo\'q' }));
        }
        const result = verifyTelegramInitData(initData, BOT_TOKEN);
        if (!result.ok) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, reason: result.reason }));
        }
        const userId = String(result.user && result.user.id);
        const isAdmin = userId === String(ADMIN_ID);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: isAdmin, reason: isAdmin ? null : 'admin emas' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, reason: 'noto\'g\'ri so\'rov' }));
      }
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
