const tg = window.Telegram && window.Telegram.WebApp;
  const appEl = document.getElementById('app');

  // ---- 34-bosqich: Responsive mini-app — avtomatik moslashish (resize) ----
  // Mobil brauzerlarda (va ba'zi Telegram klientlarida) `100vh` manzil
  // panel/klaviatura ochilib-yopilganda noto'g'ri hisoblanadi — sahifa
  // "sakrab" turadi. Shuning uchun haqiqiy balandlikni JS orqali o'lchab,
  // --app-vh CSS o'zgaruvchisiga yozamiz (style.css'da `calc(var(--app-vh)*100)`
  // sifatida ishlatiladi). Ekran o'lchami/orientatsiyasi o'zgarganda (resize,
  // orientationchange) va Telegram WebApp'ning o'z `viewportChanged` hodisasida
  // qayta hisoblanadi — shu bilan mobil/planshet/kompyuter (31-33-bosqich)
  // orasida foydalanuvchi qo'lda hech narsa qilmasdan ham ilova to'g'ri
  // ko'rinishda qoladi.
  function applyResponsiveViewport() {
    const h = (tg && tg.viewportHeight) || window.innerHeight;
    document.documentElement.style.setProperty('--app-vh', (h * 0.01) + 'px');
  }
  applyResponsiveViewport();
  window.addEventListener('resize', applyResponsiveViewport);
  window.addEventListener('orientationchange', applyResponsiveViewport);
  if (tg && typeof tg.onEvent === 'function') {
    tg.onEvent('viewportChanged', applyResponsiveViewport);
  }

  // ---- 38-bosqich: Dark/Light rejim ----
  // Foydalanuvchi qo'lda tanlagan tema localStorage'da saqlanadi va shu
  // qurilma/brauzerda keyingi safar ochilganda ham eslab qolinadi. Hech
  // narsa tanlanmagan bo'lsa (birinchi marta ochilganda) — avvalgidek
  // Telegram'ning o'z temasi (--tg-theme-*) avtomatik ishlatiladi.
  const THEME_STORAGE_KEY = 'kitchenOsTheme';
  function getStoredTheme() {
    try { return localStorage.getItem(THEME_STORAGE_KEY); } catch (e) { return null; }
  }
  function currentActiveTheme() {
    return getStoredTheme() || (tg && tg.colorScheme) || 'light';
  }
  function applyStoredTheme() {
    const stored = getStoredTheme();
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
  applyStoredTheme();
  function toggleTheme() {
    const next = currentActiveTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch (e) {}
    applyStoredTheme();
    const btn = document.getElementById('appHeaderThemeBtn');
    if (btn) btn.innerHTML = icon(next === 'dark' ? 'sun' : 'moon', 'icon-xs');
  }
  // Login/parol orqali kirish (16-bosqich): Telegram initData bo'lmasa,
  // localStorage'da saqlangan sessiya tokeni ("sess_<token>") bo'lishi mumkin —
  // u xuddi Telegram initData o'rniga barcha /api/... so'rovlarida ishlatiladi.
  const OWNER_SESSION_STORAGE_KEY = 'kitchenOsOwnerSession';
  let initData = (tg && tg.initData) || localStorage.getItem(OWNER_SESSION_STORAGE_KEY) || null;
  let usingOwnerSession = !tg && !!initData;
  let ownerHasTelegramLogin = false;

  function ekran(html) {
    appEl.innerHTML = html;
  }

  // ---- Qo'ng'iroq qilish: mijoz/qo'shimcha telefon raqami bosilganda,
  // "Telefondan" (oddiy tel: qo'ng'iroq) yoki "Telegramdan" (mijozning
  // Telegram profili ochiladi, u yerdan qo'ng'iroq qilinadi) so'raladi.
  // Telegram varianti faqat shu raqam mijozning o'z Telegram akkauntiga
  // (customerId) tegishli bo'lsa ko'rsatiladi — qo'shimcha (extraPhone)
  // raqamlar odatda alohida odamga tegishli bo'lishi mumkin va ularning
  // Telegram ID'si bizda yo'q.
  function promptCall(phone, tgUserId) {
    if (!phone) return;
    const callByPhone = () => { window.location.href = `tel:${phone}`; };
    const callByTelegram = () => { openExternalLink(`tg://user?id=${tgUserId}`); };

    if (tg && typeof tg.showPopup === 'function') {
      const buttons = [{ id: 'phone', type: 'default', text: '📞 Telefondan' }];
      if (tgUserId) buttons.push({ id: 'telegram', type: 'default', text: '✈️ Telegramdan' });
      buttons.push({ id: 'cancel', type: 'cancel', text: 'Bekor qilish' });
      tg.showPopup({ title: 'Qo\'ng\'iroq qilish', message: phone, buttons }, (buttonId) => {
        if (buttonId === 'phone') callByPhone();
        else if (buttonId === 'telegram') callByTelegram();
      });
      return;
    }

    // Telegram WebApp mavjud bo'lmasa (masalan, oddiy brauzerda ochilgan bo'lsa) — oddiy tanlov.
    if (tgUserId && confirm(`${phone}\n\nTelegramdan qo'ng'iroq qilinsinmi? (Bekor qilinsa — telefondan qo'ng'iroq qilinadi)`)) {
      callByTelegram();
    } else {
      callByPhone();
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-call-phone]');
    if (!btn) return;
    e.preventDefault();
    promptCall(btn.getAttribute('data-call-phone'), btn.getAttribute('data-call-tgid') || null);
  });


  // 16-bosqich: tarmoq xatosi holati. apiPost endi ikki turdagi muvaffaqiyatsizlikni
  // ajratadi — (1) server javob berdi, lekin so'rov mantiqan rad etildi (masalan
  // "ruxsat yo'q") — bu {ok:false, reason} bo'lib qoladi, chaqiruvchi joy o'zi
  // matn ko'rsatadi; (2) so'rov umuman serverga yetib bormadi yoki javob
  // o'qib bo'lmadi (internet yo'q / server ishlamayapti) — bu holda
  // {ok:false, networkError:true, reason} qaytadi, shunda chaqiruvchi joy
  // "Qayta urinish" tugmali maxsus holatni ko'rsatishi mumkin.
  // 66-bosqich: admin "Do'kon egalari" ro'yxatidan bironta oshxonaning
  // menyusi/skladini o'zi to'ldirib berish uchun Sklad ekranini ochganda, shu
  // o'zgaruvchiga o'sha egasining ID'si yoziladi (qarang: renderStockScreen
  // chaqiruvi admin-ovoz bilan). Shu holatda quyidagi apiPost — menyu/sklad/
  // bo'lim endpointlariga avtomatik targetOwnerId qo'shadi, shunday qilib
  // renderStockScreen/menuAddSectionHtml kabi umumiy kod hech o'zgarishsiz
  // aynan o'sha egasi nomidan ishlay boshlaydi.
  let adminTargetOwnerId = null;
  const ADMIN_TARGET_OWNER_ENDPOINTS = [
    '/api/menu-list', '/api/menu-add', '/api/menu-update', '/api/menu-remove', '/api/menu-set-recipe',
    '/api/category-list', '/api/category-add', '/api/category-remove', '/api/category-reorder',
    '/api/stock-list', '/api/stock-add', '/api/stock-remove', '/api/stock-movements',
    '/api/branch-list'
  ];
  async function apiPost(url, body) {
    if (adminTargetOwnerId && ADMIN_TARGET_OWNER_ENDPOINTS.includes(url) && body && typeof body === 'object' && body.targetOwnerId === undefined) {
      body = Object.assign({}, body, { targetOwnerId: adminTargetOwnerId });
    }
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      return {
        ok: false,
        networkError: true,
        reason: (typeof navigator !== 'undefined' && navigator.onLine === false)
          ? "Internet aloqasi yo'q. Tarmoqni tekshirib, qayta urinib ko'ring."
          : "Serverga ulanib bo'lmadi. Birozdan so'ng qayta urinib ko'ring."
      };
    }
    try {
      return await r.json();
    } catch (e) {
      return {
        ok: false,
        networkError: true,
        reason: "Server javob bermadi. Qayta urinib ko'ring."
      };
    }
  }

  // Tarmoq xatosi holatining umumiy HTML qolipi — to'liq ekran va bitta
  // konteyner ichida ishlatilishi uchun bir xil ko'rinishda.
  function networkErrorMarkup(message) {
    return `
      <div class="network-error-state">
        ${icon('wifi-off', 'network-error-icon')}
        <div class="network-error-title">Aloqa yo'q</div>
        <div class="network-error-desc">${escapeHtml(message || "Serverga ulanib bo'lmadi.")}</div>
        <button type="button" class="btn network-error-retry-btn">${icon('refresh')}<span>Qayta urinish</span></button>
      </div>
    `;
  }

  // To'liq ekranni tarmoq xatosi holati bilan almashtiradi (masalan ilova
  // ochilishida asosiy tekshiruv muvaffaqiyatsiz bo'lsa). retryFn — tugma
  // bosilganda qayta chaqiriladigan funksiya (odatda o'sha yuklovchi funksiyaning o'zi).
  function renderNetworkErrorScreen(message, retryFn) {
    ekran(networkErrorMarkup(message));
    const btn = appEl.querySelector('.network-error-retry-btn');
    if (btn) btn.addEventListener('click', () => { btn.disabled = true; retryFn(); });
  }

  // Faqat bitta konteyner (masalan ro'yxat yoki taxta) ichida tarmoq xatosi
  // holatini ko'rsatadi — qolgan ekran (sarlavha, boshqa tab'lar) tegilmaydi.
  function renderNetworkErrorInline(container, message, retryFn) {
    if (!container) return;
    container.innerHTML = networkErrorMarkup(message);
    const btn = container.querySelector('.network-error-retry-btn');
    if (btn) btn.addEventListener('click', () => { btn.disabled = true; retryFn(); });
  }

  // ---- 60-bosqich: tarifda yo'q funksiyaga kirish bloklanganda ko'rsatiladigan
  // aniq va tushunarli xabar. Server bunday holatda {ok:false, blockedFeature:true,
  // reason, featureId} qaytaradi (qarang: server.js — ownerCanUseFeature/
  // featureBlockedResult, 59-60-bosqich). Bu — oddiy "Xatolik yuz berdi" bilan
  // aralashib ketmasligi uchun alohida, qulf ikonkali va ogohlantirish rangidagi
  // ko'rinish: (1) butun bo'lim bloklanganda konteyner ichida (masalan AI tahlil),
  // (2) bitta amal (masalan "aksiya qo'shish") rad etilganda — alohida modal.
  function featureBlockedMarkup(message) {
    return `
      <div class="feature-blocked-state">
        ${icon('lock', 'feature-blocked-icon')}
        <div class="feature-blocked-title">Bu funksiya yopilgan</div>
        <div class="feature-blocked-desc">${escapeHtml(message || "Bu funksiya joriy tarifingizga kiritilmagan.")}</div>
      </div>
    `;
  }

  function renderFeatureBlockedInline(container, message) {
    if (!container) return;
    container.innerHTML = featureBlockedMarkup(message);
  }

  // Bitta amal (tugma bosish) tarif tomonidan rad etilganda chaqiriladi —
  // xuddi shu ekrandagi "xabar" matni bilan bir qatorda, ko'zga aniq
  // tashlanadigan alohida oyna sifatida ham ko'rsatiladi.
  function showFeatureBlockedModal(message) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal feature-blocked-modal" style="max-width:340px;">
        <div class="feature-blocked-icon-wrap">${icon('lock')}</div>
        <div class="feature-blocked-title">Bu funksiya yopilgan</div>
        <div class="feature-blocked-desc">${escapeHtml(message || "Bu funksiya joriy tarifingizga kiritilmagan.")}</div>
        <div class="btn-row"><button class="btn" id="featureBlockedOkBtn">Tushunarli</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('featureBlockedOkBtn').onclick = () => overlay.remove();
  }

  // Umumiy yordamchi: apiPost natijasi tarif bloklashi bo'lsa modal ko'rsatadi
  // va true qaytaradi (chaqiruvchi joy o'zining odatiy "xabar" matnini ham
  // pastda qoldirishi mumkin); aks holda false qaytaradi.
  function handleFeatureBlocked(res) {
    if (res && res.blockedFeature) { showFeatureBlockedModal(res.reason); return true; }
    return false;
  }

  // Ikonografiya (9-bosqich): #icon-sprite ichidagi <symbol>ga ishora qiluvchi
  // <svg><use> yasovchi yagona yordamchi. name — sprite'dagi "icon-" dan keyingi
  // qism (masalan 'box' → #icon-box). extraClass ixtiyoriy (masalan 'icon-lg icon-danger').
  function icon(name, extraClass) {
    return `<svg class="icon${extraClass ? ' ' + extraClass : ''}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
  }

  // App shell (10-bosqich): #appHeader #app'dan tashqarida bo'lgani uchun
  // ekran() uni tozalamaydi — bir marta o'rnatilsa, ichki navigatsiyalar davomida
  // (tab almashish, ekranlar orasida o'tish) o'zgarmay tepada turadi.
  const appHeaderEl = document.getElementById('appHeader');
  // 11-bosqich: roleLabel — ixtiyoriy uchinchi parametr. Berilsa, header'ning
  // o'ng chetida doimiy rol-belgisi (masalan "Kassir", "Egasi") ko'rsatiladi,
  // shu bilan foydalanuvchi ilova ichida qayerda bo'lishidan qat'iy nazar
  // o'zining rolini har doim ko'rib turadi.
  // onRoleSwitch — ixtiyoriy to'rtinchi parametr: berilsa (bir nechta
  // vakolatli xodim uchun), rol belgisi yonida "🔁" tugmasi chiqadi, bosilsa
  // shu funksiya chaqiriladi (qarang: staffRoleSwitchHandler).
  function setAppHeader(logoUrl, name, roleLabel, onRoleSwitch) {
    if (!name) { clearAppHeader(); return; }
    appHeaderEl.innerHTML = `
      ${logoUrl
        ? `<img class="app-header-logo" src="${escapeHtml(logoUrl)}" onerror="this.outerHTML='<div class=&quot;app-header-logo-fallback&quot;>${icon('restaurant', 'icon-xs').replace(/"/g, '&quot;')}</div>'">`
        : `<div class="app-header-logo-fallback">${icon('restaurant', 'icon-xs')}</div>`}
      <div class="app-header-name">${escapeHtml(name)}</div>
      ${roleLabel ? `<span class="app-header-role-badge">${escapeHtml(roleLabel)}</span>` : ''}
      ${onRoleSwitch ? `<button type="button" class="app-header-role-switch-btn" id="appHeaderRoleSwitchBtn" title="Rol almashtirish">${icon('refresh', 'icon-xs')}</button>` : ''}
      <button type="button" class="app-header-theme-btn" id="appHeaderThemeBtn" title="Tungi/kunduzgi rejim">${icon(currentActiveTheme() === 'dark' ? 'sun' : 'moon', 'icon-xs')}</button>
    `;
    appHeaderEl.classList.remove('hidden');
    if (onRoleSwitch) {
      const btn = document.getElementById('appHeaderRoleSwitchBtn');
      if (btn) btn.addEventListener('click', onRoleSwitch);
    }
    document.getElementById('appHeaderThemeBtn').addEventListener('click', toggleTheme);
  }
  function clearAppHeader() {
    appHeaderEl.classList.add('hidden');
    appHeaderEl.innerHTML = '';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // 71-BOSQICH: raqamlarni o'qishga oson qilib chiqarish uchun (1000 -> "1 000",
  // 100000 -> "100 000"). Narx/summa ko'rsatiladigan barcha joylarda shu ishlatiladi.
  function fmtNum(n) {
    return Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ');
  }

  // =========================================================================
  // BREND RANGI (25-27-bosqich): tanlangan bitta asosiy rangdan barcha
  // bog'liq tokenlar (to'q soya, och foniy, ustidagi matn rangi) avtomatik
  // hisoblanadi — shu bilan har bir oshxona egasi faqat bitta rang tanlasa
  // kifoya, qolgani WCAG kontrast formulasi asosida o'zi to'g'irlanadi.
  // =========================================================================
  const BRAND_COLOR_PRESETS = ['#E4232A', '#E67E22', '#1E8A55', '#12897E', '#1E6FD9', '#7B3FE4', '#D63384', '#2B2E33'];
  const DEFAULT_BRAND_COLOR = '#E4232A';

  function isValidHexColor(hex) {
    return typeof hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(hex);
  }
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const num = parseInt(h, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  function rgbToHex({ r, g, b }) {
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
  }
  function relativeLuminance({ r, g, b }) {
    const chan = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  }
  function contrastRatio(hexA, hexB) {
    const lA = relativeLuminance(hexToRgb(hexA));
    const lB = relativeLuminance(hexToRgb(hexB));
    const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
    return (lighter + 0.05) / (darker + 0.05);
  }
  // Berilgan fon rangi ustiga oq yoki qora matn qo'yilsa qaysi biri o'qilishi
  // osonroq bo'lishini WCAG kontrast nisbati bo'yicha tanlaydi.
  // 30-bosqich QA: taqqoslash #111111 (yumshoq qora) bilan emas, aynan
  // #000000 bilan qilinadi — chunki ba'zi o'rta-to'qlikdagi asosiy ranglar
  // (masalan yashil/farrux ko'k preset) #111111'ga nisbatan ham, oq rangga
  // nisbatan ham WCAG AA (4.5:1) chegarasidan sal past qolar edi.
  function pickOnColor(hex) {
    return contrastRatio(hex, '#FFFFFF') >= contrastRatio(hex, '#000000') ? '#FFFFFF' : '#000000';
  }
  function mixColor(hex, towardHex, amount) {
    const a = hexToRgb(hex), b = hexToRgb(towardHex);
    return rgbToHex({ r: a.r + (b.r - a.r) * amount, g: a.g + (b.g - a.g) * amount, b: a.b + (b.b - a.b) * amount });
  }
  // 30-bosqich QA: 18%/90% qat'iy foizlar ba'zi ranglar uchun (masalan
  // to'q sariq preset, och sariq/oq maxsus tanlov) yorug' fon + to'q matn
  // juftligini 4.5:1 chegarasidan pastda qoldirardi. Shu sababli ajratish
  // darajasi moslashuvchan: kontrast yetarli bo'lguncha asta oshiriladi.
  function deriveBrandShades(base) {
    let darkAmt = 0.18, lightAmt = 0.90;
    let dark = mixColor(base, '#000000', darkAmt);
    let light = mixColor(base, '#FFFFFF', lightAmt);
    let guard = 0;
    while (contrastRatio(light, dark) < 4.5 && guard < 60) {
      if (darkAmt < 0.85) darkAmt += 0.025;
      if (lightAmt < 0.97) lightAmt += 0.01;
      dark = mixColor(base, '#000000', darkAmt);
      light = mixColor(base, '#FFFFFF', lightAmt);
      guard++;
    }
    return { dark, light };
  }
  // 26-bosqich: hisoblangan kontrastni foydalanuvchiga ko'rsatish (matn/tugma
  // rangi ustidagi rang bilan WCAG AA me'yoriga [>=4.5:1] mosligini tekshiradi).
  function brandContrastInfoHtml(hex) {
    const base = isValidHexColor(hex) ? hex : DEFAULT_BRAND_COLOR;
    const onColor = pickOnColor(base);
    const ratio = contrastRatio(base, onColor);
    const ok = ratio >= 4.5;
    return `
      <div class="brand-preview-contrast ${ok ? 'ok' : 'warn'}">
        ${icon(ok ? 'check' : 'warning', 'icon-xs')}
        Kontrast nisbati: ${ratio.toFixed(1)}:1 — ${ok ? "matn yaxshi o'qiladi (WCAG AA)" : "past, matn qiyin o'qilishi mumkin"}
      </div>
    `;
  }

  // Bitta asosiy rangdan --brand-primary-dark / --brand-primary-light /
  // --brand-on-primary'ni hisoblab, :root ustiga qo'yadi (jonli ko'rish —
  // 29-bosqich: saqlashdan oldin ham darhol ko'rinadi).
  function applyBrandColor(hex) {
    const base = isValidHexColor(hex) ? hex : DEFAULT_BRAND_COLOR;
    const { dark, light } = deriveBrandShades(base);
    const root = document.documentElement.style;
    root.setProperty('--brand-primary', base);
    root.setProperty('--brand-primary-dark', dark);
    root.setProperty('--brand-primary-light', light);
    root.setProperty('--brand-on-primary', pickOnColor(base));
  }
  // 27-bosqich: qo'llanish doirasi qoidasi — admin paneli yoki hali hech
  // qaysi oshxonaga bog'lanmagan ekranlar uchun standart rangga qaytaradi.
  function resetBrandColor() {
    const root = document.documentElement.style;
    root.removeProperty('--brand-primary');
    root.removeProperty('--brand-primary-dark');
    root.removeProperty('--brand-primary-light');
    root.removeProperty('--brand-on-primary');
  }

  function brandSwatchesHtml(current, shopName) {
    const cur = isValidHexColor(current) ? current.toUpperCase() : DEFAULT_BRAND_COLOR;
    const isPreset = BRAND_COLOR_PRESETS.map(c => c.toUpperCase()).includes(cur);
    const name = shopName ? escapeHtml(shopName) : "Sizning oshxonangiz";
    return `
      <div class="brand-color-swatches" id="brandSwatches">
        ${BRAND_COLOR_PRESETS.map(c => `
          <button type="button" class="brand-swatch ${cur === c.toUpperCase() ? 'selected' : ''}" data-brand-color="${c}" style="background:${c};" aria-label="${c}">
            ${cur === c.toUpperCase() ? icon('check', 'icon-xs') : ''}
          </button>
        `).join('')}
        <label class="brand-swatch brand-swatch-custom ${!isPreset ? 'selected' : ''}" style="${!isPreset ? `background:${cur};` : ''}" title="Boshqa rang">
          <input type="color" id="brandColorCustom" value="${cur}">
          ${!isPreset ? icon('check', 'icon-xs') : ''}
        </label>
      </div>
      <div class="brand-color-preview" id="brandColorPreview">
        <span class="brand-preview-label">Namuna ko'rinish — o'zgarishlar darhol, saqlashdan oldin ham ko'rinadi:</span>
        <div class="brand-preview-header">
          <span class="brand-preview-logo">${icon('restaurant', 'icon-xs')}</span>
          <span class="brand-preview-shop-name">${name}</span>
          <span class="role-badge">Egasi</span>
        </div>
        <div class="brand-preview-row">
          <button type="button" class="btn">Buyurtma berish</button>
          <button type="button" class="btn ikkinchi">Bekor qilish</button>
        </div>
        <div class="brand-preview-row">
          <span class="badge paid">Bonus: 120 ball</span>
          <span class="badge warning">Kutilmoqda</span>
        </div>
        <div id="brandPreviewContrast">${brandContrastInfoHtml(cur)}</div>
      </div>
    `;
  }
  // Palitra/moslashtirilgan rang tanlagichini formaga ulaydi. onChange(hex)
  // har bir tanlashda chaqiriladi (jonli ko'rish uchun darhol qo'llash).
  function attachBrandSwatchHandlers(onChange) {
    const wrap = document.getElementById('brandSwatches');
    if (!wrap) return;
    const updateContrast = (hex) => {
      const el = document.getElementById('brandPreviewContrast');
      if (el) el.innerHTML = brandContrastInfoHtml(hex);
    };
    wrap.querySelectorAll('[data-brand-color]').forEach(btn => btn.addEventListener('click', () => {
      wrap.querySelectorAll('.brand-swatch').forEach(el => { el.classList.remove('selected'); el.innerHTML = ''; });
      btn.classList.add('selected');
      btn.innerHTML = icon('check', 'icon-xs');
      const hex = btn.getAttribute('data-brand-color');
      onChange(hex);
      updateContrast(hex);
    }));
    const customInput = document.getElementById('brandColorCustom');
    if (customInput) customInput.addEventListener('input', (e) => {
      const hex = e.target.value;
      wrap.querySelectorAll('.brand-swatch').forEach(el => { el.classList.remove('selected'); el.innerHTML = ''; });
      const label = customInput.closest('.brand-swatch-custom');
      label.classList.add('selected');
      label.style.background = hex;
      onChange(hex);
      updateContrast(hex);
    });
  }

  // Galereyadan tanlangan rasm faylini o'qib, hajmini kichraytirib (max 800px),
  // JPEG base64 data URL shaklida qaytaradi — server hajmi cheklangan bo'lgani uchun kerak.
  function readImageFileAsCompressedDataUrl(file, maxSize = 800, quality = 0.72) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      if (!file.type || !file.type.startsWith('image/')) {
        return reject(new Error('Fayl rasm emas.'));
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Faylni o\'qib bo\'lmadi.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Rasmni ochib bo\'lmadi.'));
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxSize) {
            height = Math.round(height * (maxSize / width));
            width = maxSize;
          } else if (height > maxSize) {
            width = Math.round(width * (maxSize / height));
            height = maxSize;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---- Admin panelini chizish ----
  function expiryText(o) {
    if (!o.expiresAt) return 'Doimiy ruxsat';
    const ms = new Date(o.expiresAt).getTime() - Date.now();
    if (ms <= 0) return 'Muddati tugagan';
    const days = Math.ceil(ms / 86400000);
    return `${days} kun qoldi`;
  }

  // 17-bosqich: muddatli obunalar uchun vizual progress-bar — necha foiz
  // muddat o'tganini (addedAt'dan expiresAt'gacha bo'lgan davr ichida)
  // ko'rsatadi. Doimiy ruxsat (expiresAt=null) uchun hech narsa chizmaydi.
  function subscriptionProgressHtml(o) {
    if (!o.expiresAt) return '';
    const expiresMs = new Date(o.expiresAt).getTime();
    const startedMs = o.addedAt ? new Date(o.addedAt).getTime() : NaN;
    const nowMs = Date.now();
    const totalMs = Number.isFinite(startedMs) ? expiresMs - startedMs : NaN;
    // addedAt bo'lmasa yoki noto'g'ri bo'lsa (masalan eski yozuv), faqat
    // "qolgan vaqt"ni umumiy 30 kunlik oyga nisbatan taxminiy ko'rsatamiz.
    const remainingMs = expiresMs - nowMs;
    const remainingPercent = Number.isFinite(totalMs) && totalMs > 0
      ? Math.max(0, Math.min(100, Math.round((remainingMs / totalMs) * 100)))
      : Math.max(0, Math.min(100, Math.round((remainingMs / (30 * 86400000)) * 100)));
    let statusClass = 'ok';
    if (remainingMs <= 0) statusClass = 'danger';
    else if (remainingPercent <= 20) statusClass = 'danger';
    else if (remainingPercent <= 50) statusClass = 'warn';
    return `
      <div class="subscription-progress ${statusClass}" role="progressbar" aria-valuenow="${remainingPercent}" aria-valuemin="0" aria-valuemax="100" aria-label="Obuna muddati">
        <div class="subscription-progress-track">
          <div class="subscription-progress-fill" style="width:${remainingPercent}%;"></div>
        </div>
      </div>
    `;
  }

  function ownerSearchKey(o) {
    return [(o.profile && o.profile.name) || '', o.username || '', o.id]
      .join(' ')
      .toLowerCase();
  }

  // 57-bosqich: do'kon egasiga biriktirilgan tarifni ko'rsatish/tanlash
  // uchun oxirgi yuklangan tariflar ro'yxati shu yerda keshlanadi (owner
  // qatoridagi select shundan to'ldiriladi).
  let tariffCacheForOwners = [];
  function ownerTariffLabel(tariffId) {
    if (!tariffId) return 'Tarif belgilanmagan';
    const t = tariffCacheForOwners.find(x => x.id === tariffId);
    return t ? t.name : 'Tarif belgilanmagan';
  }

  function ownerItemHtml(o) {
    // 65/66-bosqich: mijozlar qo'ygan reyting (bo'lsa) badge sifatida
    // ko'rinadi — /api/owners javobida allaqachon reyting bo'yicha saralab
    // yuborilgan, shu sababli bu yerda faqat ko'rsatish qoladi.
    const ratingBadgeHtml = o.avgRating !== null && o.avgRating !== undefined
      ? `<span class="badge" title="${o.ratingCount} ta baho asosida">⭐ ${o.avgRating}</span>`
      : '';
    return `
      <div class="owner-item owner-item-detailed" data-search-key="${escapeHtml(ownerSearchKey(o))}">
        <div class="owner-item-head">
          <div class="owner-avatar">${escapeHtml((((o.profile && o.profile.name) || o.username || String(o.id) || '#').trim().charAt(0) || '#').toUpperCase())}</div>
          <div class="owner-item-heading">
            <div class="owner-item-top">
              <span class="owner-id">${escapeHtml(o.id)}</span>
              <span class="badge ${o.paid ? 'paid' : 'unpaid'}" data-toggle-paid="${escapeHtml(o.id)}" data-paid="${o.paid ? '1' : '0'}">
                ${o.paid ? icon('check', 'icon-xs') + " To'langan" : icon('x', 'icon-xs') + ' Qarzdor'}
              </span>
              ${ratingBadgeHtml}
            </div>
            ${o.username ? `<div class="owner-username">@${escapeHtml(o.username)}</div>` : ''}
            ${o.profile && o.profile.name ? `<div class="owner-username">${icon('restaurant', 'icon-xs icon-muted')} ${escapeHtml(o.profile.name)}</div>` : `<div class="owner-username owner-username-empty">${icon('warning', 'icon-xs')} Profil to'ldirilmagan</div>`}
          </div>
          <button class="owner-remove-btn" data-remove-id="${escapeHtml(o.id)}" aria-label="O'chirish" title="O'chirish">${icon('x', 'icon-xs')}</button>
        </div>

        <div class="owner-field-list">
          <div class="owner-field" data-edit-expiry="${escapeHtml(o.id)}" data-expiry-current="${o.expiresAt ? escapeHtml(o.expiresAt) : ''}">
            <span class="owner-field-icon">${icon('clock', 'icon-xs')}</span>
            <span class="owner-field-value">${escapeHtml(expiryText(o))}</span>
            <span class="owner-field-edit">${icon('edit', 'icon-xs')}</span>
          </div>
          ${subscriptionProgressHtml(o)}
          <div class="owner-field" data-edit-price="${escapeHtml(o.id)}">
            <span class="owner-field-icon">${icon('card', 'icon-xs')}</span>
            <span class="owner-field-value">${o.price ? fmtNum(o.price) + " so'm/oy" : 'Narx kiritilmagan'}</span>
            <span class="owner-field-edit">${icon('edit', 'icon-xs')}</span>
          </div>
          <div class="owner-field" data-edit-credentials="${escapeHtml(o.id)}">
            <span class="owner-field-icon">${icon('user', 'icon-xs')}</span>
            <span class="owner-field-value">${o.hasLogin ? `Login: ${escapeHtml(o.login)}` : 'Login/parol o\'rnatilmagan'}</span>
            <span class="owner-field-edit">${icon('edit', 'icon-xs')}</span>
          </div>
          <div class="owner-field" data-edit-tariff="${escapeHtml(o.id)}">
            <span class="owner-field-icon">${icon('star', 'icon-xs')}</span>
            <span class="owner-field-value">${escapeHtml(ownerTariffLabel(o.tariffId))}</span>
            <span class="owner-field-edit">${icon('edit', 'icon-xs')}</span>
          </div>
        </div>

        <div class="owner-action-row" style="display:flex; gap:8px; margin-top:8px;">
          <button class="row-action-btn brand" style="flex:1;" data-view-reviews="${escapeHtml(o.id)}">⭐ Sharhlar</button>
          <button class="row-action-btn brand" style="flex:1;" data-manage-menu="${escapeHtml(o.id)}" data-manage-menu-name="${escapeHtml((o.profile && o.profile.name) || o.id)}">🍽 Menyu/Sklad</button>
        </div>
      </div>
    `;
  }

  async function renderAdminPanel(owners, revenue) {
    setAppHeader(null, 'KitchenOS', 'Admin');
    const nowMs = Date.now();
    const totalCount = owners.length;
    const activeCount = owners.filter(o => !o.expiresAt || new Date(o.expiresAt).getTime() > nowMs).length;
    const expiringSoonCount = owners.filter(o => {
      if (!o.expiresAt) return false;
      const ms = new Date(o.expiresAt).getTime() - nowMs;
      return ms > 0 && ms <= 3 * 86400000;
    }).length;
    const unpaidCount = owners.filter(o => !o.paid).length;
    // 67-bosqich: admin dashboardida umumiy daromad — payments.json (to'liq
    // to'lovlar tarixi) asosida hisoblanadi (server, /api/owners), shu bilan
    // "Bu oy" va "Jami" haqiqiy tarixiy summalar (owner o'chirilgan/tarifi
    // o'zgargan taqdirda ham to'g'ri qoladi). "Kutilmoqda" — hozirgi
    // qarzdorlarning obuna narxlari yig'indisi (kelgusi kutilayotgan tushum).
    const thisMonthRevenue = revenue ? revenue.thisMonth : 0;
    const lifetimeRevenue = revenue ? revenue.totalLifetime : 0;
    const pendingRevenue = owners.filter(o => !o.paid).reduce((sum, o) => sum + (Number(o.price) || 0), 0);

    const statsHtml = `
      <div class="ko-kpi-grid admin-stats-grid">
        ${koKpiCardHtml('users', 'Jami egalar', String(totalCount), null)}
        ${koKpiCardHtml('check-circle', 'Faol', String(activeCount), null)}
        ${koKpiCardHtml('clock', 'Muddati yaqin', String(expiringSoonCount), null)}
        ${koKpiCardHtml('wallet', "Qarzdor", String(unpaidCount), null)}
        ${koKpiCardHtml('card', "Bu oy daromad", cfFormatSum(thisMonthRevenue), null)}
        ${koKpiCardHtml('trending-up', "Jami daromad", cfFormatSum(lifetimeRevenue), null)}
        ${koKpiCardHtml('warning', "Kutilmoqda (qarzdor)", cfFormatSum(pendingRevenue), null)}
      </div>
    `;

    // Admin panel endi bo'limlarga bo'lingan: bosh ekranda faqat umumiy
    // statistika va bo'limlarga o'tish menyusi, har bir bo'lim (egalar
    // ro'yxati, yangi ega qo'shish, tariflar, tizim holati) o'z alohida
    // ekraniga ega — avvalgi bitta uzun sahifa o'rniga.
    ekran(`
      <div class="panel has-ko-bottom-nav">
        <div class="salom">Salom, admin</div>
        <div class="bosh admin-subtitle">Quyidagi bo'limlardan birini tanlang.</div>

        ${statsHtml}

        <div class="ko-menu-grid admin-menu-grid">
          ${adminMenuItemHtml({ key: 'egalar', icon: 'users', label: "Do'kon egalari" })}
          ${adminMenuItemHtml({ key: 'yangiEga', icon: 'plus', label: "Yangi ega qo'shish" })}
          ${adminMenuItemHtml({ key: 'tolovlar', icon: 'card', label: "Kutilayotgan to'lovlar" })}
          ${adminMenuItemHtml({ key: 'tariflar', icon: 'star', label: 'Tariflar' })}
          ${adminMenuItemHtml({ key: 'obunaRejalari', icon: 'card', label: 'Obuna rejalari' })}
          ${adminMenuItemHtml({ key: 'tolovSozlamalari', icon: 'settings', label: "To'lov sozlamalari" })}
          ${adminMenuItemHtml({ key: 'elon', icon: 'send', label: "E'lon yuborish" })}
          ${adminMenuItemHtml({ key: 'savatcha', icon: 'trash', label: 'Savatcha' })}
          ${adminMenuItemHtml({ key: 'zaxira', icon: 'download', label: 'Zaxira (Backup)' })}
          ${adminMenuItemHtml({ key: 'tizim', icon: 'settings', label: 'Tizim holati' })}
        </div>
      </div>
      ${adminBottomNavHtml('bosh')}
    `);

    const goBack = () => loadOwnersAndRender();
    document.querySelectorAll('.admin-menu-grid [data-admin-menu-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-admin-menu-key');
        if (key === 'egalar') { renderAdminOwnersScreen(owners, goBack); return; }
        if (key === 'yangiEga') { renderAdminAddOwnerScreen(goBack); return; }
        if (key === 'tolovlar') { renderAdminPendingPaymentsScreen(goBack); return; }
        if (key === 'tariflar') { renderTariffsScreen(goBack); return; }
        if (key === 'obunaRejalari') { renderSubscriptionPlansScreen(goBack); return; }
        if (key === 'tolovSozlamalari') { renderPaymentSettingsScreen(goBack); return; }
        if (key === 'elon') { renderBroadcastScreen(goBack); return; }
        if (key === 'savatcha') { renderTrashScreen(goBack); return; }
        if (key === 'zaxira') { renderBackupScreen(goBack); return; }
        if (key === 'tizim') { loadAndShowSystemStatus(); return; }
      });
    });
    wireAdminBottomNav(owners, goBack);
  }

  // Admin panelning pastki navigatsiyasi — Bosh sahifadagi katakchalar bilan
  // bir xil 4 bo'limga o'tadi (egalar, yangi ega, tariflar, tizim), lekin
  // do'kon egasi ekranidagi (ko-bottom-nav) kabi doimiy, katta iconli va
  // markazda FAB'li panel ko'rinishida — bir xil CSS klasslar qayta
  // ishlatiladi, shu sababli icon o'lchamlari bir xil "katta" bo'ladi.
  function adminBottomNavHtml(activeKey) {
    return `
      <div class="ko-bottom-nav" id="adminBottomNav">
        <button type="button" class="ko-bottom-nav-item ${activeKey === 'bosh' ? 'active' : ''}" data-admin-nav="bosh">
          ${icon('home')}
          <span>Bosh sahifa</span>
        </button>
        <button type="button" class="ko-bottom-nav-item ${activeKey === 'egalar' ? 'active' : ''}" data-admin-nav="egalar">
          ${icon('users')}
          <span>Egalar</span>
        </button>
        <button type="button" class="ko-bottom-nav-item ko-bottom-nav-fab-item" data-admin-nav="yangiEga">
          <span class="ko-bottom-nav-fab">${icon('plus')}</span>
          <span>Yangi ega</span>
        </button>
        <button type="button" class="ko-bottom-nav-item ${activeKey === 'tariflar' ? 'active' : ''}" data-admin-nav="tariflar">
          ${icon('star')}
          <span>Tariflar</span>
        </button>
        <button type="button" class="ko-bottom-nav-item ${activeKey === 'tizim' ? 'active' : ''}" data-admin-nav="tizim">
          ${icon('settings')}
          <span>Tizim</span>
        </button>
      </div>
    `;
  }

  function wireAdminBottomNav(owners, goBack) {
    const nav = document.getElementById('adminBottomNav');
    if (!nav) return;
    nav.querySelectorAll('[data-admin-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-admin-nav');
        if (key === 'bosh') return;
        if (key === 'egalar') { renderAdminOwnersScreen(owners, goBack); return; }
        if (key === 'yangiEga') { renderAdminAddOwnerScreen(goBack); return; }
        if (key === 'tariflar') { renderTariffsScreen(goBack); return; }
        if (key === 'tizim') { loadAndShowSystemStatus(); return; }
      });
    });
  }

  function adminMenuItemHtml(item) {
    return `
      <button type="button" class="ko-menu-item" data-admin-menu-key="${item.key}">
        <span class="ko-menu-item-icon">${icon(item.icon)}</span>
        <span class="ko-menu-item-label">${escapeHtml(item.label)}</span>
      </button>
    `;
  }

  // =========================================================================
  // Admin bo'limi: "Do'kon egalari" — ro'yxat, qidiruv va har bir ega
  // ustidagi tahrirlash amallari (to'lov holati, muddat, narx, login/parol,
  // tarif, o'chirish). Har qanday amaldan keyin shu ekranning o'zi qayta
  // yuklanadi (bosh sahifaga qaytarilmaydi) — shu bilan bir nechta amalni
  // ketma-ket bajarish qulayroq.
  // =========================================================================
  async function reloadAdminOwnersScreen(goBack) {
    const res = await apiPost('/api/owners', { initData });
    if (res.networkError) { renderNetworkErrorScreen(res.reason, () => reloadAdminOwnersScreen(goBack)); return; }
    renderAdminOwnersScreen(res.ok ? res.owners : [], goBack);
  }

  async function renderAdminOwnersScreen(owners, goBack) {
    setAppHeader(null, 'KitchenOS', 'Admin');
    // 57-bosqich: owner qatorlarida tarif nomini ko'rsatish uchun tariflar
    // ro'yxatini oldindan yuklab olamiz (bo'sh bo'lsa ham davom etadi).
    const tariffRes = await apiPost('/api/tariff-list', { initData });
    if (tariffRes.ok) tariffCacheForOwners = tariffRes.tariffs;
    const totalCount = owners.length;

    const ownersHtml = owners.length
      ? owners.map(ownerItemHtml).join('')
      : `
        <div class="admin-empty-state">
          ${icon('users', 'icon-lg icon-muted')}
          <div class="bosh">Hozircha do'kon egalari yo'q.</div>
        </div>
      `;

    ekran(`
      <div class="panel">
        <button class="btn ikkinchi" id="adminOwnersBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka">
          <div class="admin-list-header">
            <h2>${icon('users', 'icon-xs')} Ruxsat berilgan do'kon egalari</h2>
            <span class="admin-list-count">${totalCount}</span>
          </div>
          ${owners.length > 3 ? `
            <div class="admin-search-wrap">
              ${icon('search', 'icon-xs icon-muted admin-search-icon')}
              <input type="text" id="ownerSearchInput" placeholder="ID, username yoki nom bo'yicha qidirish" autocomplete="off">
            </div>
          ` : ''}
          <div class="owner-list" id="ownerList">${ownersHtml}</div>
          <div class="bosh admin-no-results hidden" id="ownerNoResults">Hech narsa topilmadi.</div>
        </div>
      </div>
    `);

    document.getElementById('adminOwnersBackBtn').addEventListener('click', goBack);

    const searchInput = document.getElementById('ownerSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        const items = document.querySelectorAll('#ownerList .owner-item');
        let visibleCount = 0;
        items.forEach(item => {
          const match = !q || (item.getAttribute('data-search-key') || '').includes(q);
          item.classList.toggle('hidden', !match);
          if (match) visibleCount++;
        });
        const noResults = document.getElementById('ownerNoResults');
        if (noResults) noResults.classList.toggle('hidden', !(q && visibleCount === 0));
      });
    }

    document.getElementById('ownerList').addEventListener('click', async (e) => {
      const removeBtn = e.target.closest('[data-remove-id]');
      if (removeBtn) {
        removeBtn.disabled = true;
        await apiPost('/api/remove-owner', { initData, id: removeBtn.getAttribute('data-remove-id') });
        reloadAdminOwnersScreen(goBack);
        return;
      }

      const reviewsBtn = e.target.closest('[data-view-reviews]');
      if (reviewsBtn) {
        const ownerId = reviewsBtn.getAttribute('data-view-reviews');
        const ownerObj = owners.find(o => String(o.id) === String(ownerId));
        renderAdminOwnerReviewsScreen(ownerId, (ownerObj && ownerObj.profile && ownerObj.profile.name) || ownerId, () => renderAdminOwnersScreen(owners, goBack));
        return;
      }

      const menuBtn = e.target.closest('[data-manage-menu]');
      if (menuBtn) {
        const ownerId = menuBtn.getAttribute('data-manage-menu');
        const ownerName = menuBtn.getAttribute('data-manage-menu-name');
        // 66-bosqich: admin shu egasi nomidan menyu/skladni to'ldiradi —
        // Sklad ekrani allaqachon "egasi" rolida menyu bo'limini ham
        // ko'rsatadi (qarang: menuAddSectionHtml). Ekrandan chiqilganda
        // adminTargetOwnerId albatta tozalanadi (aks holda admin o'zining
        // keyingi amallari ham shu egasi nomidan ketib qolishi mumkin).
        adminTargetOwnerId = ownerId;
        renderStockScreen(ownerName, 'egasi', () => {
          adminTargetOwnerId = null;
          renderAdminOwnersScreen(owners, goBack);
        });
        return;
      }

      const toggleEl = e.target.closest('[data-toggle-paid]');
      if (toggleEl) {
        const current = toggleEl.getAttribute('data-paid') === '1';
        await apiPost('/api/update-owner-billing', { initData, id: toggleEl.getAttribute('data-toggle-paid'), paid: !current });
        reloadAdminOwnersScreen(goBack);
        return;
      }

      const editEl = e.target.closest('[data-edit-price]');
      if (editEl && !editEl.querySelector('input')) {
        const editId = editEl.getAttribute('data-edit-price');
        editEl.innerHTML = `
          <input type="text" inputmode="numeric" placeholder="Yangi narx" style="margin:0; padding:6px 8px; font-size:13px;" data-price-field="${escapeHtml(editId)}">
          <button data-save-price="${escapeHtml(editId)}" class="row-action-btn-solid">Saqlash</button>
        `;
      }

      const credEl = e.target.closest('[data-edit-credentials]');
      if (credEl && !credEl.querySelector('input')) {
        const editId = credEl.getAttribute('data-edit-credentials');
        const hasLoginNow = credEl.textContent.includes('Login:');
        credEl.innerHTML = `
          <input type="text" placeholder="Login" style="margin:0; padding:6px 8px; font-size:13px;" data-login-field="${escapeHtml(editId)}" autocomplete="off">
          <input type="text" placeholder="Yangi parol" style="margin:0; padding:6px 8px; font-size:13px;" data-password-field="${escapeHtml(editId)}" autocomplete="off">
          <button data-save-credentials="${escapeHtml(editId)}" class="row-action-btn-solid">Saqlash</button>
          ${hasLoginNow ? `<button data-remove-credentials="${escapeHtml(editId)}" class="row-action-btn-solid">O'chirish</button>` : ''}
        `;
      }

      const tariffEl = e.target.closest('[data-edit-tariff]');
      if (tariffEl && !tariffEl.querySelector('select')) {
        const editId = tariffEl.getAttribute('data-edit-tariff');
        const owner = owners.find(o => String(o.id) === String(editId));
        const currentTariffId = owner ? owner.tariffId : null;
        const optionsHtml = [`<option value="">Tarif belgilanmagan</option>`]
          .concat(tariffCacheForOwners.map(t => `<option value="${escapeHtml(t.id)}" ${t.id === currentTariffId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`))
          .join('');
        tariffEl.innerHTML = `
          <select data-tariff-field="${escapeHtml(editId)}" style="margin:0; padding:6px 8px; font-size:13px;">${optionsHtml}</select>
          <button data-save-tariff="${escapeHtml(editId)}" class="row-action-btn-solid">Saqlash</button>
        `;
      }

      // 63/64-bosqich: obuna muddatini uzaytirish/qisqartirish/bekor qilish —
      // amal turiga qarab kerakli maydon (kun soni yoki aniq sana) ko'rsatiladi
      // (qarang: pastdagi 'change' tinglovchisi va 'data-save-expiry' saqlash).
      const expiryEl = e.target.closest('[data-edit-expiry]');
      if (expiryEl && !expiryEl.querySelector('select')) {
        const editId = expiryEl.getAttribute('data-edit-expiry');
        expiryEl.innerHTML = `
          <select data-expiry-action="${escapeHtml(editId)}" style="margin:0; padding:6px 8px; font-size:13px;">
            <option value="extend">+ kun qo'shish</option>
            <option value="setDate">Aniq sanani belgilash</option>
            <option value="unlimited">Doimiy qilish</option>
            <option value="cancelNow">Hoziroq bekor qilish</option>
          </select>
          <input type="text" inputmode="numeric" placeholder="Necha kun" style="margin:0; padding:6px 8px; font-size:13px; width:80px;" data-expiry-days="${escapeHtml(editId)}">
          <input type="date" style="margin:0; padding:6px 8px; font-size:13px; display:none;" data-expiry-date="${escapeHtml(editId)}">
          <button data-save-expiry="${escapeHtml(editId)}" class="row-action-btn-solid">Saqlash</button>
        `;
      }
    });

    // Amal turi almashtirilganda faqat shu amalga tegishli maydonni (kun
    // soni yoki sana) ko'rsatadi — qolganini yashiradi.
    document.getElementById('ownerList').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-expiry-action]');
      if (!sel) return;
      const editId = sel.getAttribute('data-expiry-action');
      const daysInput = document.querySelector(`input[data-expiry-days="${editId}"]`);
      const dateInput = document.querySelector(`input[data-expiry-date="${editId}"]`);
      if (daysInput) daysInput.style.display = sel.value === 'extend' ? '' : 'none';
      if (dateInput) dateInput.style.display = sel.value === 'setDate' ? '' : 'none';
    });

    document.getElementById('ownerList').addEventListener('click', async (e) => {
      const saveId = e.target.getAttribute('data-save-price');
      if (saveId) {
        const input = document.querySelector(`input[data-price-field="${saveId}"]`);
        const val = input ? input.value.trim() : '';
        if (val && (!/^\d+$/.test(val) || parseInt(val, 10) < 0)) {
          alert('Narx musbat son bo\'lishi kerak.');
          return;
        }
        await apiPost('/api/update-owner-billing', { initData, id: saveId, price: val || 0 });
        reloadAdminOwnersScreen(goBack);
        return;
      }

      const saveCredId = e.target.getAttribute('data-save-credentials');
      if (saveCredId) {
        const loginInput = document.querySelector(`input[data-login-field="${saveCredId}"]`);
        const passwordInput = document.querySelector(`input[data-password-field="${saveCredId}"]`);
        const loginVal = loginInput ? loginInput.value.trim() : '';
        const passwordVal = passwordInput ? passwordInput.value : '';
        const res = await apiPost('/api/set-owner-credentials', { initData, id: saveCredId, login: loginVal, password: passwordVal });
        if (!res.ok) {
          alert(res.reason || 'Xatolik yuz berdi.');
          return;
        }
        reloadAdminOwnersScreen(goBack);
        return;
      }

      const removeCredId = e.target.getAttribute('data-remove-credentials');
      if (removeCredId) {
        await apiPost('/api/remove-owner-credentials', { initData, id: removeCredId });
        reloadAdminOwnersScreen(goBack);
        return;
      }

      const saveTariffId = e.target.getAttribute('data-save-tariff');
      if (saveTariffId) {
        const select = document.querySelector(`select[data-tariff-field="${saveTariffId}"]`);
        const val = select ? select.value : '';
        const res = await apiPost('/api/owner-set-tariff', { initData, id: saveTariffId, tariffId: val || null });
        if (!res.ok) {
          alert(res.reason || 'Xatolik yuz berdi.');
          return;
        }
        reloadAdminOwnersScreen(goBack);
        return;
      }

      const saveExpiryId = e.target.getAttribute('data-save-expiry');
      if (saveExpiryId) {
        const actionSelect = document.querySelector(`select[data-expiry-action="${saveExpiryId}"]`);
        const action = actionSelect ? actionSelect.value : '';
        const body = { initData, id: saveExpiryId, action };
        if (action === 'extend') {
          const daysInput = document.querySelector(`input[data-expiry-days="${saveExpiryId}"]`);
          const days = daysInput ? daysInput.value.trim() : '';
          if (!days || !/^\d+$/.test(days) || parseInt(days, 10) <= 0) {
            alert('Kun sonini musbat butun son sifatida kiriting.');
            return;
          }
          body.days = days;
        } else if (action === 'setDate') {
          const dateInput = document.querySelector(`input[data-expiry-date="${saveExpiryId}"]`);
          const date = dateInput ? dateInput.value : '';
          if (!date) {
            alert('Sanani tanlang.');
            return;
          }
          body.date = date;
        } else if (action === 'cancelNow') {
          if (!confirm("Obunani hoziroq bekor qilasizmi? Do'kon egasining Mini App'ga kirishi darhol yopiladi.")) return;
        }
        const res = await apiPost('/api/owner-set-expiry', body);
        if (!res.ok) {
          alert(res.reason || 'Xatolik yuz berdi.');
          return;
        }
        reloadAdminOwnersScreen(goBack);
        return;
      }
    });
  }

  // =========================================================================
  // 82-BOSQICH: Admin bo'limi "Kutilayotgan to'lovlar" — owner o'zi tarif
  // tanlab, skrinshot yuborgan, lekin hali admin tasdiqlamagan barcha
  // so'rovlar shu yerda ko'rinadi (asosiy tasdiqlash kanali - Telegram
  // chatidagi ✅/❌ tugmalari, bu ekran esa admin panelidan ham xuddi shu
  // amalni bajarish imkonini beradi - masalan admin bot chatini ko'rmasa ham).
  // =========================================================================
  async function renderAdminPendingPaymentsScreen(goBack) {
    setAppHeader(null, 'KitchenOS', 'Admin');
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Kutilayotgan to'lovlar</div>
        <button class="btn ikkinchi" id="pendingPayBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka">
          <div id="pendingPayList"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
      </div>
    `);
    document.getElementById('pendingPayBackBtn').addEventListener('click', () => goBack && goBack());
    await loadPendingPaymentsList(goBack);
  }

  async function loadPendingPaymentsList(goBack) {
    const listEl = document.getElementById('pendingPayList');
    if (!listEl) return;
    const res = await apiPost('/api/admin-pending-subscription-payments', { initData });
    if (!res.ok) {
      listEl.innerHTML = `<div class="xabar err">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
      return;
    }
    if (!res.pending.length) {
      listEl.innerHTML = `<div class="bosh">${icon('check-circle', 'icon-xs')} Hozircha kutilayotgan to'lov yo'q.</div>`;
      return;
    }
    listEl.innerHTML = res.pending.map(p => `
      <div class="owner-item owner-item-detailed" data-owner-id="${escapeHtml(String(p.ownerId))}">
        <div class="owner-item-head">
          <div class="owner-item-heading">
            <div class="owner-id">${escapeHtml(p.restaurantName || p.ownerLabel)}</div>
            <div class="owner-username">${escapeHtml(p.ownerLabel)} · ID: ${escapeHtml(String(p.ownerId))}</div>
          </div>
        </div>
        <div class="profile-row"><b>Reja:</b> ${escapeHtml(p.request.planLabel)}</div>
        <div class="profile-row"><b>Summa:</b> ${fmtNum(p.request.amount)} so'm</div>
        ${p.request.tariffLabel ? `<div class="profile-row"><b>Tarif (biriktiriladi):</b> ${escapeHtml(p.request.tariffLabel)}</div>` : ''}
        <div class="profile-row"><b>Skrinshot yuborildi:</b> ${escapeHtml(timeAgo(p.request.screenshotSentAt))}</div>
        <div class="bosh" style="margin:6px 0 10px;">Skrinshotni tekshirish uchun Telegram'dagi bot xabarini ko'ring (shu yerga avtomatik yuborilgan).</div>
        <div class="btn-row" style="margin-top:0;">
          <button class="btn" data-decide-approve="${escapeHtml(String(p.ownerId))}" style="width:auto; min-height:36px; padding:6px 14px;">✅ Tasdiqlash</button>
          <button class="btn xavfli" data-decide-reject="${escapeHtml(String(p.ownerId))}" style="width:auto; min-height:36px; padding:6px 14px;">❌ Rad etish</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('[data-decide-approve]').forEach(btn => {
      btn.addEventListener('click', () => decideAdminPendingPayment(btn.getAttribute('data-decide-approve'), 'approve', goBack));
    });
    listEl.querySelectorAll('[data-decide-reject]').forEach(btn => {
      btn.addEventListener('click', () => decideAdminPendingPayment(btn.getAttribute('data-decide-reject'), 'reject', goBack));
    });
  }

  async function decideAdminPendingPayment(ownerId, action, goBack) {
    if (action === 'reject' && !confirm("Bu to'lov so'rovini rad etasizmi?")) return;
    const res = await apiPost('/api/admin-subscription-decide', { initData, ownerId, action });
    if (!res.ok) {
      alert(res.reason || 'Xatolik yuz berdi.');
      return;
    }
    await loadPendingPaymentsList(goBack);
  }

  // =========================================================================
  // Admin bo'limi: "Yangi ega qo'shish" — bir martalik taklif havolasi
  // yaratish va ID/username orqali qo'lda qo'shish, ikkalasi shu bitta
  // ekranda. Muvaffaqiyatli qo'shilgandan so'ng ekranning o'zida qoladi
  // (bosh sahifaga qaytarilmaydi) — shu bilan ketma-ket bir nechta ega
  // qo'shish qulayroq.
  // =========================================================================
  function renderAdminAddOwnerScreen(goBack) {
    setAppHeader(null, 'KitchenOS', 'Admin');
    ekran(`
      <div class="panel">
        <button class="btn ikkinchi" id="adminAddBackBtn" style="margin-bottom:12px;">← Orqaga</button>

        <div class="kartochka">
          <h2>${icon('link', 'icon-xs')} Bir martalik taklif havolasi</h2>
          <div class="bosh">Havolani do'kon egasiga yuboring. U botni ochganda so'rovi sizga keladi — Telegramda tugma bosib, necha kunga ruxsat berishni tanlaysiz.</div>
          <button class="btn" id="createInviteBtn" style="margin-top:10px;">${icon('plus', 'icon-xs')}<span>Havola yaratish</span></button>
          <div id="inviteBoxWrap"></div>
          <div class="xabar" id="inviteMsg"></div>
        </div>

        <div class="kartochka">
          <h2>${icon('user', 'icon-xs')} Do'kon egasini ID orqali qo'shish</h2>
          <label class="field-label">Telegram ID, @username yoki havola</label>
          <input type="text" id="ownerInput" placeholder="Masalan: 123456789 yoki @username">
          <label class="field-label">Muddat (kun)</label>
          <input type="text" id="ownerDaysInput" placeholder="Bo'sh qoldirsangiz — doimiy" inputmode="numeric">
          <label class="field-label">Obuna narxi</label>
          <input type="text" id="ownerPriceInput" placeholder="So'm/oy (ixtiyoriy)" inputmode="numeric">
          <label class="check-label" for="ownerPaidInput">
            <input type="checkbox" id="ownerPaidInput"> To'lov qabul qilindi
          </label>
          <button class="btn" id="addOwnerBtn">${icon('plus', 'icon-xs')}<span>Do'kon egasi qo'shish</span></button>
          <div class="xabar" id="addMsg"></div>
        </div>
      </div>
      <div class="overlay hidden" id="confirmOverlay">
        <div class="modal">
          <h3>Tasdiqlaysizmi?</h3>
          <p id="confirmText"></p>
          <div class="btn-row">
            <button class="btn ikkinchi" id="confirmCancel">Yo'q</button>
            <button class="btn" id="confirmOk">Ha, qo'shish</button>
          </div>
        </div>
      </div>
    `);

    document.getElementById('adminAddBackBtn').addEventListener('click', goBack);

    document.getElementById('createInviteBtn').addEventListener('click', async () => {
      const msgEl = document.getElementById('inviteMsg');
      const wrap = document.getElementById('inviteBoxWrap');
      msgEl.textContent = 'Yaratilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/create-invite', { initData });
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
        wrap.innerHTML = '';
        return;
      }
      msgEl.textContent = '';
      wrap.innerHTML = `
        <div class="link-box">
          <span id="inviteLinkText">${escapeHtml(res.link)}</span>
          <button id="copyInviteBtn">${icon('link', 'icon-xs')}<span>Nusxalash</span></button>
        </div>
      `;
      document.getElementById('copyInviteBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(res.link).then(() => {
          msgEl.textContent = 'Havola nusxalandi.';
          msgEl.className = 'xabar ok';
        }).catch(() => {
          msgEl.textContent = 'Nusxalab bo\'lmadi, havolani qo\'lda ko\'chiring.';
          msgEl.className = 'xabar err';
        });
      });
    });

    document.getElementById('addOwnerBtn').addEventListener('click', () => {
      const val = document.getElementById('ownerInput').value.trim();
      const daysVal = document.getElementById('ownerDaysInput').value.trim();
      const priceVal = document.getElementById('ownerPriceInput').value.trim();
      const paidVal = document.getElementById('ownerPaidInput').checked;
      const msgEl = document.getElementById('addMsg');
      msgEl.textContent = '';
      msgEl.className = 'xabar';
      if (!val) {
        msgEl.textContent = 'Iltimos, ID yoki username kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      if (daysVal && (!/^\d+$/.test(daysVal) || parseInt(daysVal, 10) <= 0)) {
        msgEl.textContent = 'Kun soni musbat butun son bo\'lishi kerak, yoki bo\'sh qoldiring.';
        msgEl.className = 'xabar err';
        return;
      }
      if (priceVal && (!/^\d+$/.test(priceVal) || parseInt(priceVal, 10) < 0)) {
        msgEl.textContent = 'Narx musbat son bo\'lishi kerak, yoki bo\'sh qoldiring.';
        msgEl.className = 'xabar err';
        return;
      }
      const muddat = daysVal ? `${daysVal} kunga` : 'doimiy';
      const narxMatn = priceVal ? `, obuna narxi ${fmtNum(priceVal)} so'm/oy` : '';
      document.getElementById('confirmText').textContent =
        `"${val}" ni do'kon egasi sifatida qo'shib, ${muddat} mini appga kirish huquqini berasizmi${narxMatn}?`;
      document.getElementById('confirmOverlay').classList.remove('hidden');

      document.getElementById('confirmCancel').onclick = () => {
        document.getElementById('confirmOverlay').classList.add('hidden');
      };
      document.getElementById('confirmOk').onclick = async () => {
        document.getElementById('confirmOverlay').classList.add('hidden');
        msgEl.textContent = 'Qo\'shilmoqda...';
        msgEl.className = 'xabar';
        const res = await apiPost('/api/add-owner', {
          initData, input: val, days: daysVal || null,
          price: priceVal || null, paid: paidVal
        });
        if (res.ok) {
          msgEl.textContent = 'Muvaffaqiyatli qo\'shildi.';
          msgEl.className = 'xabar ok';
          document.getElementById('ownerInput').value = '';
          document.getElementById('ownerDaysInput').value = '';
          document.getElementById('ownerPriceInput').value = '';
          document.getElementById('ownerPaidInput').checked = false;
        } else {
          msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
          msgEl.className = 'xabar err';
        }
      };
    });
  }

  // Galereyadan logotip tanlash uchun umumiy blok — rasm oldindan ko'rinadi,
  // fayl tanlanganda avtomatik kichraytirilib (400px) base64 data URL'ga
  // aylantiriladi. idPrefix — shu ekrandagi elementlarning id old qo'shimchasi,
  // currentValue — hozirgi logotip (URL yoki data URL) bo'lishi mumkin.
  function logoPickerHtml(idPrefix, currentValue) {
    return `
      <label class="field-label">Logotip</label>
      <div class="logo-picker">
        <div class="logo-picker-preview-wrap">
          ${currentValue
            ? `<img id="${idPrefix}Preview" class="logo-picker-preview" src="${escapeHtml(currentValue)}" onerror="this.style.display='none'">`
            : `<div id="${idPrefix}Preview" class="logo-picker-preview logo-picker-preview-empty">${icon('restaurant', 'icon-md')}</div>`}
        </div>
        <div class="logo-picker-actions">
          <label class="logo-picker-btn" for="${idPrefix}FileInput">${icon('link', 'icon-xs')} Galereyadan tanlash</label>
          <input type="file" id="${idPrefix}FileInput" accept="image/*" class="logo-picker-file-input">
          ${currentValue ? `<button type="button" class="logo-picker-remove" id="${idPrefix}RemoveBtn">O'chirish</button>` : ''}
        </div>
      </div>
      <div class="xabar" id="${idPrefix}Err"></div>
    `;
  }

  // logoPickerHtml bilan chizilgan blokka hodisalarni ulaydi. setValue orqali
  // chaqiruvchi joy o'zining state'ini (masalan onboarding qadam ma'lumoti
  // yoki oddiy o'zgaruvchi) yangilab turadi.
  function attachLogoPickerHandlers(idPrefix, setValue) {
    const fileInput = document.getElementById(`${idPrefix}FileInput`);
    const errEl = document.getElementById(`${idPrefix}Err`);
    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        errEl.textContent = '';
        errEl.className = 'xabar';
        try {
          const dataUrl = await readImageFileAsCompressedDataUrl(file, 400, 0.75);
          setValue(dataUrl || '');
          const preview = document.getElementById(`${idPrefix}Preview`);
          if (preview && preview.tagName === 'IMG') {
            preview.src = dataUrl;
          } else if (preview) {
            preview.outerHTML = `<img id="${idPrefix}Preview" class="logo-picker-preview" src="${dataUrl}">`;
          }
        } catch (e) {
          errEl.textContent = e.message || "Rasmni yuklab bo'lmadi.";
          errEl.className = 'xabar err';
        }
        fileInput.value = '';
      });
    }
    const removeBtn = document.getElementById(`${idPrefix}RemoveBtn`);
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        setValue('');
        const preview = document.getElementById(`${idPrefix}Preview`);
        if (preview) preview.outerHTML = `<div id="${idPrefix}Preview" class="logo-picker-preview logo-picker-preview-empty">${icon('restaurant', 'icon-md')}</div>`;
        removeBtn.remove();
      });
    }
  }

  // ---- Admin: kichik "System status" paneli (50-bosqich) ----
  // Serverning umumiy holatini (ishlash vaqti, xotira, ma'lumotlar hajmi,
  // webhook statistikasi) bitta oynada ko'rsatadi. /api/system-status'dan
  // olinadi, faqat admin ko'ra oladi.
  function formatUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const parts = [];
    if (d) parts.push(`${d} kun`);
    if (h) parts.push(`${h} soat`);
    parts.push(`${m} daqiqa`);
    return parts.join(' ');
  }

  function systemStatusModalHtml(s) {
    const row = (label, value) => `
      <div class="profile-row"><b>${escapeHtml(label)}:</b> ${value}</div>
    `;
    return `
      <div class="modal" style="max-width:380px; text-align:left;">
        <h3>${icon('settings', 'icon-xs')} System status</h3>
        ${row('Server ishlayapti', formatUptime(s.uptimeSeconds))}
        ${row('Node versiyasi', escapeHtml(s.nodeVersion))}
        ${row('Xotira (RSS)', `${s.memoryRssMb} MB`)}
        ${row('Bot tokeni', s.botConfigured ? '✅ sozlangan' : '⚠️ sozlanmagan')}
        ${row('PUBLIC_URL', s.publicUrlConfigured ? '✅ sozlangan' : '⚠️ sozlanmagan')}
        <div class="kartochka" style="margin-top:10px;">
          <h2 style="font-size:14px;">Do'kon egalari</h2>
          ${row('Jami', String(s.owners.total))}
          ${row('Faol', String(s.owners.active))}
          ${row('Muddati o\'tgan', String(s.owners.expired))}
        </div>
        <div class="kartochka">
          <h2 style="font-size:14px;">Faoliyat</h2>
          ${row('Jami xodimlar', String(s.totalStaff))}
          ${row('Jami buyurtmalar', String(s.totalOrders))}
          ${row('Bugungi buyurtmalar', String(s.todayOrders))}
          ${row('Bildirishnoma xatolari', String(s.notificationErrors))}
        </div>
        <div class="kartochka">
          <h2 style="font-size:14px;">Webhook</h2>
          ${row('Qabul qilingan', String(s.webhook.received))}
          ${row('Xatoliklar', String(s.webhook.errors))}
          ${row('Oxirgisi', s.webhook.lastAt ? timeAgo(s.webhook.lastAt) : '—')}
        </div>
        <div class="kartochka">
          <h2 style="font-size:14px;">Ma'lumot fayllari</h2>
          ${row('owners.json', `${s.dataFiles.owners.sizeKb} KB`)}
          ${row('invites.json', `${s.dataFiles.invites.sizeKb} KB`)}
          ${row('requests.json', `${s.dataFiles.requests.sizeKb} KB`)}
          ${row('profiles.json', `${s.dataFiles.profiles.sizeKb} KB`)}
        </div>
        <div class="btn-row">
          <button class="btn" id="systemStatusOkBtn">Yopish</button>
        </div>
      </div>
    `;
  }

  async function loadAndShowSystemStatus() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:380px;"><div class="bosh">Yuklanmoqda...</div></div>`;
    document.body.appendChild(overlay);
    const res = await apiPost('/api/system-status', { initData });
    if (!res.ok) {
      overlay.innerHTML = `
        <div class="modal" style="max-width:380px;">
          <div class="bosh">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>
          <div class="btn-row"><button class="btn" id="systemStatusOkBtn">Yopish</button></div>
        </div>
      `;
      document.getElementById('systemStatusOkBtn').onclick = () => overlay.remove();
      return;
    }
    overlay.innerHTML = systemStatusModalHtml(res.status);
    document.getElementById('systemStatusOkBtn').onclick = () => overlay.remove();
  }

  // ---- Admin: obuna tariflari — soni va nomlari (51-bosqich) ----
  // 52-bosqich: narx ham shu ro'yxatda. 54-bosqich: har bir tarifga qaysi
  // funksiyalar (53-bosqichdagi katalogdan) kirishini ✅/❌ belgilash —
  // "Funksiyalar" tugmasi orqali alohida modalda.
  function tariffItemHtml(t) {
    const enabledCount = t.features ? Object.values(t.features).filter(Boolean).length : 0;
    return `
      <div class="owner-item" data-tariff-id="${escapeHtml(t.id)}">
        <div>
          <div class="owner-id">${escapeHtml(t.name)}</div>
          <div class="owner-username">${t.price ? cfFormatSum(t.price) + ' / oy' : 'Narx belgilanmagan'} · ${enabledCount} ta funksiya yoqilgan · Eslatma: ${t.reminderDays || 1} kun oldin</div>
          <div class="owner-username">${icon('users', 'icon-xs icon-muted')} ${t.ownerCount || 0} ta do'kon</div>
        </div>
        <div class="btn-row" style="margin-top:0;">
          <button class="btn ikkinchi" data-tariff-features="${escapeHtml(t.id)}" style="width:auto; min-height:36px; padding:6px 12px;">${icon('check-circle', 'icon-xs')}</button>
          <button class="btn ikkinchi" data-tariff-edit="${escapeHtml(t.id)}" style="width:auto; min-height:36px; padding:6px 12px;">${icon('edit', 'icon-xs')}</button>
          <button class="btn xavfli" data-tariff-remove="${escapeHtml(t.id)}" style="width:auto; min-height:36px; padding:6px 12px;">${icon('x', 'icon-xs')}</button>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Admin bo'limi: "To'lov sozlamalari" — egalarga "💳 Obuna" bo'limida
  // ko'rsatiladigan to'lov rekvizitlarini (karta raqami/egasi, Click/Payme)
  // tahrirlash. Ilgari bu ma'lumotlar faqat serverda standart ("***") qiymat
  // bilan turardi va admin ularni HECH QAYERDAN o'zgartira olmasdi.
  // =========================================================================
  async function renderPaymentSettingsScreen(onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">To'lov sozlamalari</div>
        <button class="btn ikkinchi" id="paySettingsBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka">
          <h2>${icon('card', 'icon-xs')} To'lov rekvizitlari</h2>
          <div class="bosh">Do'kon egalari "💳 Obuna" bo'limida tarif tanlaganda shu ma'lumotlarni ko'radi.</div>
          <label class="field-label" style="margin-top:10px;">Karta raqami</label>
          <input type="text" id="payCardNumberInput" placeholder="8600 **** **** ****">
          <label class="field-label">Karta egasining F.I.Sh</label>
          <input type="text" id="payCardHolderInput" placeholder="Masalan: ISMOILOV FAYZULLA">
          <label class="field-label">Click raqami</label>
          <input type="text" id="payClickNumberInput" placeholder="+998 90 000 00 00">
          <label class="field-label">Payme raqami</label>
          <input type="text" id="payPaymeNumberInput" placeholder="+998 90 000 00 00">
          <button class="btn" id="paySettingsSaveBtn" style="margin-top:10px;">Saqlash</button>
          <div class="xabar" id="paySettingsMsg"></div>
        </div>
      </div>
    `);
    document.getElementById('paySettingsBackBtn').addEventListener('click', () => onBack());

    const msgEl = document.getElementById('paySettingsMsg');
    const res = await apiPost('/api/admin-payment-requisites-get', { initData });
    if (res.ok) {
      document.getElementById('payCardNumberInput').value = res.requisites.cardNumber || '';
      document.getElementById('payCardHolderInput').value = res.requisites.cardHolder || '';
      document.getElementById('payClickNumberInput').value = res.requisites.clickNumber || '';
      document.getElementById('payPaymeNumberInput').value = res.requisites.paymeNumber || '';
    } else {
      msgEl.textContent = res.reason || 'Yuklab bo\'lmadi.';
      msgEl.className = 'xabar err';
    }

    document.getElementById('paySettingsSaveBtn').addEventListener('click', async () => {
      const cardNumber = document.getElementById('payCardNumberInput').value.trim();
      const cardHolder = document.getElementById('payCardHolderInput').value.trim();
      const clickNumber = document.getElementById('payClickNumberInput').value.trim();
      const paymeNumber = document.getElementById('payPaymeNumberInput').value.trim();
      msgEl.textContent = 'Saqlanmoqda...';
      msgEl.className = 'xabar';
      const saveRes = await apiPost('/api/admin-payment-requisites-set', {
        initData, cardNumber, cardHolder, clickNumber, paymeNumber
      });
      if (saveRes.ok) {
        msgEl.textContent = 'Saqlandi.';
        msgEl.className = 'xabar ok';
      } else {
        msgEl.textContent = saveRes.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });
  }

  // =========================================================================
  // Admin bo'limi: "E'lon yuborish" (48-51-bosqich) — admin platformadagi
  // barcha oshxonalar bo'yicha bitta toifaga (mijoz / oshxona egasi /
  // xizmatchi) matn+rasm+tugma bilan umumiy xabar yuboradi. Pastda —
  // avval yuborilgan e'lonlar tarixi va yetkazilganlik statistikasi.
  // =========================================================================
  const BROADCAST_TARGET_LABELS = { customer: 'Mijozlar', owner: "Oshxona egalari", staff: 'Xizmatchilar (xodimlar)' };

  function broadcastHistoryRowHtml(b) {
    const dateLabel = new Date(b.sentAt).toLocaleString('uz-UZ');
    return `
      <div class="owner-item" style="align-items:flex-start;">
        <div style="flex:1; min-width:0;">
          <div class="owner-id">${escapeHtml(BROADCAST_TARGET_LABELS[b.targetType] || b.targetType)}</div>
          <div class="owner-username" style="white-space:pre-wrap;">${escapeHtml(b.text.length > 140 ? b.text.slice(0, 140) + '…' : b.text)}</div>
          <div class="owner-username">${dateLabel} · ✅ ${b.deliveredCount} ${b.failedCount ? `· ❌ ${b.failedCount}` : ''} / ${b.totalTargets}</div>
        </div>
      </div>
    `;
  }

  async function loadBroadcastHistoryAndRender() {
    const listEl = document.getElementById('broadcastHistoryList');
    if (!listEl) return;
    const res = await apiPost('/api/broadcast-history', { initData });
    if (res.networkError) { renderNetworkErrorInline(listEl, res.reason, loadBroadcastHistoryAndRender); return; }
    if (!res.ok || !res.broadcasts.length) {
      listEl.innerHTML = `<div class="bosh">Hali e'lon yuborilmagan.</div>`;
      return;
    }
    listEl.innerHTML = res.broadcasts.map(broadcastHistoryRowHtml).join('');
  }

  async function renderBroadcastScreen(onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">E'lon yuborish</div>
        <button class="btn ikkinchi" id="broadcastBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka">
          <h2>${icon('send', 'icon-xs')} Yangi e'lon</h2>
          <div class="bosh">Xabar tanlangan toifadagi BARCHA foydalanuvchilarga (barcha oshxonalar bo'yicha) yuboriladi.</div>
          <label class="field-label" style="margin-top:10px;">Qabul qiluvchi</label>
          <select id="broadcastTargetInput">
            <option value="customer">Mijozlar</option>
            <option value="owner">Oshxona egalari</option>
            <option value="staff">Xizmatchilar (xodimlar)</option>
          </select>
          <label class="field-label">Xabar matni *</label>
          <textarea id="broadcastTextInput" placeholder="E'lon matnini kiriting..." rows="4"></textarea>
          <label class="field-label">Rasm havolasi (ixtiyoriy, https://...)</label>
          <input type="text" id="broadcastImageInput" placeholder="https://...">
          <label class="field-label">Tugma matni (ixtiyoriy)</label>
          <input type="text" id="broadcastBtnTextInput" placeholder="Masalan: Batafsil">
          <label class="field-label">Tugma havolasi (ixtiyoriy, https://...)</label>
          <input type="text" id="broadcastBtnUrlInput" placeholder="https://...">
          <button class="btn" id="broadcastSendBtn" style="margin-top:10px;">Yuborish</button>
          <div class="xabar" id="broadcastMsg"></div>
        </div>
        <div class="kartochka">
          <h2>Yuborilganlar tarixi</h2>
          <div class="owner-list" id="broadcastHistoryList"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
      </div>
    `);
    document.getElementById('broadcastBackBtn').addEventListener('click', () => onBack());

    document.getElementById('broadcastSendBtn').addEventListener('click', async () => {
      const targetType = document.getElementById('broadcastTargetInput').value;
      const text = document.getElementById('broadcastTextInput').value.trim();
      const imageUrl = document.getElementById('broadcastImageInput').value.trim();
      const buttonText = document.getElementById('broadcastBtnTextInput').value.trim();
      const buttonUrl = document.getElementById('broadcastBtnUrlInput').value.trim();
      const msgEl = document.getElementById('broadcastMsg');
      if (!text) {
        msgEl.textContent = 'Xabar matnini kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      if (!confirm(`${BROADCAST_TARGET_LABELS[targetType]} toifasidagi BARCHA foydalanuvchilarga shu xabarni yuborishni tasdiqlaysizmi?`)) return;

      const btn = document.getElementById('broadcastSendBtn');
      btn.disabled = true;
      msgEl.textContent = 'Yuborilmoqda... (bu bir necha soniya vaqt olishi mumkin)';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/broadcast-send', { initData, targetType, text, imageUrl, buttonText, buttonUrl });
      btn.disabled = false;
      if (res.ok) {
        const r = res.result;
        msgEl.textContent = `Yuborildi: ✅ ${r.deliveredCount} ta yetdi${r.failedCount ? `, ❌ ${r.failedCount} ta yetmadi` : ''} (jami ${r.totalTargets}).`;
        msgEl.className = 'xabar ok';
        document.getElementById('broadcastTextInput').value = '';
        document.getElementById('broadcastImageInput').value = '';
        document.getElementById('broadcastBtnTextInput').value = '';
        document.getElementById('broadcastBtnUrlInput').value = '';
        loadBroadcastHistoryAndRender();
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    loadBroadcastHistoryAndRender();
  }

  // =========================================================================
  // Admin bo'limi: "Savatcha" (16-22-bosqich) — o'chirilgan do'kon egalari
  // 3 kun davomida shu yerda turadi, admin ularni tiklashi yoki muddatidan
  // oldin butunlay o'chirishi mumkin. Pastda — shu bilan bog'liq loglar.
  // =========================================================================
  function trashRowHtml(t) {
    return `
      <div class="owner-item">
        <div>
          <div class="owner-id">${escapeHtml(t.restaurantName || t.ownerLabel)}</div>
          <div class="owner-username">${escapeHtml(t.ownerLabel)} · ${t.daysLeft} kun qoldi
            ${t.restoreStatus === 'pending' ? ' · 🕓 tiklash so\'ralgan' : ''}
            ${t.restoreStatus === 'rejected' ? ' · ❌ so\'rov rad etilgan' : ''}
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
          <button class="row-action-btn brand" data-trash-restore="${escapeHtml(t.id)}">Tiklash</button>
          <button class="row-action-btn danger" data-trash-purge="${escapeHtml(t.id)}">Butunlay o'chirish</button>
        </div>
      </div>
    `;
  }

  async function renderTrashScreen(onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">${icon('trash', 'icon-sm')} Savatcha</div>
        <button class="btn ikkinchi" id="trashBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="bosh" style="margin-bottom:10px;">O'chirilgan do'kon egalari shu yerda 3 kun saqlanadi (menyu, xodimlar, sozlamalari bilan birga). 3 kundan keyin avtomatik, butunlay o'chiriladi.</div>
        <div class="kartochka">
          <h2>${icon('users', 'icon-xs')} Savatchadagilar</h2>
          <div class="owner-list" id="trashList"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        <div class="kartochka">
          <h2>${icon('clipboard', 'icon-xs')} Loglar</h2>
          <div id="trashLogList"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
      </div>
    `);
    document.getElementById('trashBackBtn').addEventListener('click', () => onBack());
    await loadTrashListAndRender(onBack);
    await loadTrashLogAndRender();
  }

  async function loadTrashListAndRender(onBack) {
    const listEl = document.getElementById('trashList');
    if (!listEl) return;
    const res = await apiPost('/api/trash-list', { initData });
    if (!res.ok) { listEl.innerHTML = `<div class="xabar err">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`; return; }
    if (!res.trash.length) { listEl.innerHTML = `<div class="bosh">Savatcha bo'sh.</div>`; return; }
    listEl.innerHTML = res.trash.map(trashRowHtml).join('');

    listEl.querySelectorAll('[data-trash-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm("Bu do'kon egasini tiklaysizmi? Barcha ma'lumotlari qaytariladi.")) return;
        btn.disabled = true;
        const r = await apiPost('/api/trash-restore', { initData, trashId: btn.getAttribute('data-trash-restore') });
        if (!r.ok) { alert(r.reason || 'Xatolik yuz berdi.'); btn.disabled = false; return; }
        await loadTrashListAndRender(onBack);
        await loadTrashLogAndRender();
      });
    });
    listEl.querySelectorAll('[data-trash-purge]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm("DIQQAT: bu do'kon egasi BUTUNLAY, qaytarib bo'lmaydigan tarzda o'chiriladi. Davom etasizmi?")) return;
        btn.disabled = true;
        const r = await apiPost('/api/trash-purge-now', { initData, trashId: btn.getAttribute('data-trash-purge') });
        if (!r.ok) { alert(r.reason || 'Xatolik yuz berdi.'); btn.disabled = false; return; }
        await loadTrashListAndRender(onBack);
        await loadTrashLogAndRender();
      });
    });
  }

  async function loadTrashLogAndRender() {
    const listEl = document.getElementById('trashLogList');
    if (!listEl) return;
    const res = await apiPost('/api/trash-log', { initData });
    if (!res.ok) { listEl.innerHTML = `<div class="bosh">Yuklab bo'lmadi.</div>`; return; }
    if (!res.log.length) { listEl.innerHTML = `<div class="bosh">Hali loglar yo'q.</div>`; return; }
    const actionLabels = {
      trashed: '🗑 Savatchaga ko\'chirildi',
      restore_requested: '🔄 Tiklash so\'ralgan',
      restored: '✅ Tiklandi',
      restore_rejected: '❌ Tiklash rad etildi',
      purged: '⛔ Butunlay o\'chirildi'
    };
    listEl.innerHTML = res.log.map(l => `
      <div class="owner-item">
        <div>
          <div class="owner-id">${escapeHtml(actionLabels[l.action] || l.action)}</div>
          <div class="owner-username">${escapeHtml(l.ownerLabel || l.ownerId || '—')} · ${new Date(l.at).toLocaleString('uz-UZ')}</div>
        </div>
      </div>
    `).join('');
  }

  // =========================================================================
  // Admin bo'limi: "Zaxira (Backup)" (52-54-bosqich) — butun bazani (barcha
  // oshxona egalari, to'lovlar, sozlamalar va h.k.) bitta JSON faylga jamlab
  // yuklab olish, va o'sha faylni yuklab bazani tiklash. Tiklash — juda xavfli
  // amal (butun bazani almashtiradi) bo'lgani uchun ikki bosqichli: avval
  // fayl tekshiriladi va xulosa ko'rsatiladi (preview), so'ng admin
  // "TASDIQLAYMAN" so'zini qo'lda kiritib, aniq shu fayl uchun yaratilgan
  // tasdiqlash kodi bilan tasdiqlaydi (server buni 10 daqiqa ichida talab qiladi).
  const BACKUP_SECTION_LABELS = {
    owners: "Do'kon egalari", admins: 'Adminlar', invites: 'Taklif havolalari',
    requests: "So'rovlar", profiles: 'Profillar', tariffs: 'Tariflar',
    payments: "To'lovlar", archived_orders: 'Arxivlangan buyurtmalar',
    subscription_plans: 'Obuna rejalari', settings: 'Sozlamalar',
    broadcasts: "E'lonlar tarixi", trash: 'Savatcha', trash_log: 'Savatcha loglari',
    awaiting: 'Kutilayotgan amallar'
  };

  function backupCountsHtml(counts) {
    if (!counts) return '';
    return `
      <div class="owner-list" style="margin-top:8px;">
        ${Object.keys(counts).map(k => `
          <div class="owner-item" style="padding:8px 10px;">
            <div class="owner-id" style="font-size:14px;">${escapeHtml(BACKUP_SECTION_LABELS[k] || k)}</div>
            <div class="owner-username">${counts[k]} ta</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  async function renderBackupScreen(onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">${icon('download', 'icon-sm')} Zaxira (Backup)</div>
        <button class="btn ikkinchi" id="backupBackBtn" style="margin-bottom:12px;">← Orqaga</button>

        <div class="kartochka">
          <h2>${icon('download', 'icon-xs')} Zaxira nusxa yuklab olish</h2>
          <div class="bosh" style="margin-bottom:10px;">Butun baza (barcha oshxona egalari, to'lovlar, sozlamalar va h.k.) bitta JSON faylga jamlanib, telefoningizga yuklab olinadi. Bu fayl kelajakda bazani tiklash uchun ishlatiladi.</div>
          <button class="btn" id="backupExportBtn">${icon('download', 'icon-xs')} Yuklab olish</button>
          <div class="xabar" id="backupExportMsg"></div>
        </div>

        <div class="kartochka">
          <h2>${icon('upload', 'icon-xs')} Bazani zaxiradan tiklash</h2>
          <div class="bosh" style="margin-bottom:10px; color: var(--danger, #e53e3e);">⚠️ DIQQAT: bu amal joriy bazadagi ma'lumotlarni tanlangan zaxiradagi ma'lumotlar bilan ALMASHTIRADI. Tiklashdan oldin joriy holat avtomatik saqlab qo'yiladi, lekin baribir ehtiyot bo'ling.</div>
          <input type="file" id="backupFileInput" accept="application/json,.json" style="margin-bottom:10px;">
          <div id="backupPreviewArea"></div>
          <div class="xabar" id="backupImportMsg"></div>
        </div>
      </div>
    `);
    document.getElementById('backupBackBtn').addEventListener('click', () => onBack());

    // ---- Yuklab olish (export) ----
    document.getElementById('backupExportBtn').addEventListener('click', async () => {
      const btn = document.getElementById('backupExportBtn');
      const msgEl = document.getElementById('backupExportMsg');
      btn.disabled = true;
      msgEl.className = 'xabar';
      msgEl.textContent = '';
      const res = await apiPost('/api/backup-export', { initData });
      btn.disabled = false;
      if (!res.ok) {
        msgEl.className = 'xabar err';
        msgEl.textContent = res.reason || 'Zaxira tayyorlanmadi. Qayta urinib ko\'ring.';
        return;
      }
      downloadFile(res.filename, res.mime, res.content, false);
      msgEl.className = 'xabar ok';
      msgEl.textContent = `✅ Zaxira yuklab olindi (${Object.values(res.counts || {}).reduce((a, b) => a + b, 0)} ta yozuv).`;
    });

    // ---- Fayl tanlanganda — avval faqat TEKSHIRUV (preview), hech narsa o'zgarmaydi ----
    let selectedBackupContent = null;
    let selectedConfirmToken = null;
    document.getElementById('backupFileInput').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      const previewArea = document.getElementById('backupPreviewArea');
      const msgEl = document.getElementById('backupImportMsg');
      msgEl.className = 'xabar';
      msgEl.textContent = '';
      previewArea.innerHTML = '';
      selectedBackupContent = null;
      selectedConfirmToken = null;
      if (!file) return;

      previewArea.innerHTML = `<div class="bosh">Fayl tekshirilmoqda...</div>`;
      const content = await file.text();
      const res = await apiPost('/api/backup-import-preview', { initData, content });
      if (!res.ok) {
        previewArea.innerHTML = '';
        msgEl.className = 'xabar err';
        msgEl.textContent = res.reason || 'Fayl tekshirib bo\'lmadi.';
        return;
      }

      selectedBackupContent = content;
      selectedConfirmToken = res.confirmToken;
      const exportedAtLabel = res.exportedAt ? new Date(res.exportedAt).toLocaleString('uz-UZ') : 'noma\'lum';

      previewArea.innerHTML = `
        <div class="kartochka" style="background: var(--bg-secondary, #f5f5f5); margin-top:4px;">
          <div class="owner-username">📅 Zaxira sanasi: ${escapeHtml(exportedAtLabel)}</div>
          ${backupCountsHtml(res.counts)}
        </div>
        <label class="field-label" style="margin-top:10px;">Tasdiqlash uchun "TASDIQLAYMAN" so'zini kiriting</label>
        <input type="text" id="backupConfirmTextInput" placeholder="TASDIQLAYMAN">
        <button class="btn xavfli" id="backupRestoreBtn" style="margin-top:10px;">${icon('upload', 'icon-xs')} Bazani tiklash</button>
      `;

      document.getElementById('backupRestoreBtn').addEventListener('click', async () => {
        const confirmText = document.getElementById('backupConfirmTextInput').value.trim();
        if (confirmText.toUpperCase() !== 'TASDIQLAYMAN') {
          msgEl.className = 'xabar err';
          msgEl.textContent = 'Iltimos, "TASDIQLAYMAN" so\'zini aniq kiriting.';
          return;
        }
        if (!confirm('SO\'NGGI OGOHLANTIRISH: joriy baza tanlangan zaxira bilan almashtiriladi. Davom etasizmi?')) return;

        const btn = document.getElementById('backupRestoreBtn');
        btn.disabled = true;
        msgEl.className = 'xabar';
        msgEl.textContent = 'Tiklanmoqda...';
        const r = await apiPost('/api/backup-import-confirm', {
          initData,
          confirmToken: selectedConfirmToken,
          confirmText,
          content: selectedBackupContent
        });
        btn.disabled = false;
        if (!r.ok) {
          msgEl.className = 'xabar err';
          msgEl.textContent = r.reason || 'Tiklashda xatolik yuz berdi.';
          return;
        }
        previewArea.innerHTML = '';
        document.getElementById('backupFileInput').value = '';
        msgEl.className = 'xabar ok';
        msgEl.textContent = `✅ Baza tiklandi (${(r.applied || []).length} ta bo'lim almashtirildi). Sahifani qayta oching.`;
      });
    });
  }

  async function renderTariffsScreen(onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Obuna tariflari</div>
        <button class="btn ikkinchi" id="tariffsBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka">
          <h2>${icon('plus', 'icon-xs')} Yangi tarif qo'shish</h2>
          <label class="field-label">Tarif nomi</label>
          <input type="text" id="tariffNameInput" placeholder="Masalan: Standart">
          <label class="field-label">Narx (so'm/oy)</label>
          <input type="text" id="tariffPriceInput" placeholder="Masalan: 150000" inputmode="numeric">
          <button class="btn" id="tariffAddBtn" style="margin-top:10px;">Qo'shish</button>
          <div class="xabar" id="tariffAddMsg"></div>
        </div>
        <div class="kartochka">
          <h2>${icon('star', 'icon-xs')} Mavjud tariflar</h2>
          <div id="tariffList"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        <div class="kartochka">
          <h2>${icon('clipboard', 'icon-xs')} Tizim funksiyalari</h2>
          <div class="owner-username" style="margin-bottom:8px;">Har bir tarifga qaysi funksiyalar kirishini belgilash keyingi bosqichda shu ro'yxat asosida qo'shiladi.</div>
          <div id="featureCatalogList"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
      </div>
    `);
    document.getElementById('tariffsBackBtn').addEventListener('click', () => onBack());
    document.getElementById('tariffAddBtn').addEventListener('click', async () => {
      const input = document.getElementById('tariffNameInput');
      const priceInput = document.getElementById('tariffPriceInput');
      const msgEl = document.getElementById('tariffAddMsg');
      const name = input.value.trim();
      const priceStr = priceInput.value.trim();
      if (!name) {
        msgEl.textContent = 'Iltimos, tarif nomini kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      if (priceStr && (!/^\d+$/.test(priceStr))) {
        msgEl.textContent = 'Narx musbat butun son bo\'lishi kerak, yoki bo\'sh qoldiring.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = '';
      const res = await apiPost('/api/tariff-add', { initData, name, price: priceStr || 0 });
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
        return;
      }
      input.value = '';
      priceInput.value = '';
      loadTariffList();
    });
    await loadTariffList();
    await loadFeatureCatalog();
  }

  // ---- Admin: tizim funksiyalari katalogi (53-bosqich) ----
  // Guruhlangan ro'yxatni bir marta yuklab keshlaydi — 54-bosqichdagi
  // har-tarif "Funksiyalar" modali ham shu keshdan foydalanadi (qayta
  // so'rov yubormaslik uchun).
  let featureCatalogCache = null;
  async function loadFeatureCatalog() {
    const el = document.getElementById('featureCatalogList');
    if (!el) return;
    const res = await apiPost('/api/feature-list', { initData });
    if (!res.ok) {
      el.innerHTML = `<div class="bosh">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
      return;
    }
    featureCatalogCache = res.groups;
    el.innerHTML = res.groups.map(g => `
      <div style="margin-bottom:10px;">
        <div class="field-label" style="margin-bottom:4px;">${escapeHtml(g.name)}</div>
        <div>${g.features.map(f => `<span class="badge neutral" style="margin:2px 4px 2px 0;">${escapeHtml(f.name)}</span>`).join('')}</div>
      </div>
    `).join('');
  }

  async function loadTariffList() {
    const el = document.getElementById('tariffList');
    if (!el) return;
    const res = await apiPost('/api/tariff-list', { initData });
    if (!res.ok) {
      el.innerHTML = `<div class="bosh">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
      return;
    }
    if (!res.tariffs.length) {
      el.innerHTML = `<div class="bosh">Hozircha tarif qo'shilmagan.</div>`;
      return;
    }
    el.innerHTML = res.tariffs.map(tariffItemHtml).join('');
    el.querySelectorAll('[data-tariff-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-tariff-edit');
        const current = res.tariffs.find(t => t.id === id);
        if (current) showTariffEditModal(current);
      });
    });
    el.querySelectorAll('[data-tariff-features]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-tariff-features');
        const current = res.tariffs.find(t => t.id === id);
        if (current) await showTariffFeaturesModal(current);
      });
    });
    el.querySelectorAll('[data-tariff-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-tariff-remove');
        const current = res.tariffs.find(t => t.id === id);
        if (!confirm(`"${current ? current.name : ''}" tarifini o'chirasizmi?`)) return;
        const r = await apiPost('/api/tariff-remove', { initData, id });
        if (!r.ok) {
          // 55-bosqich: agar tarifga do'kon egalari biriktirilgan bo'lsa,
          // admin buni bilib, xohlasa tasdiqlab (force) baribir o'chirishi mumkin.
          if (r.blockedCount) {
            const forceConfirm = confirm(`${r.reason}\n\nBaribir o'chirilsinmi? (${r.blockedCount} ta do'kon egasi tarifsiz qoladi)`);
            if (!forceConfirm) return;
            const r2 = await apiPost('/api/tariff-remove', { initData, id, force: true });
            if (!r2.ok) { alert(r2.reason || 'Xatolik yuz berdi.'); return; }
            loadTariffList();
            return;
          }
          alert(r.reason || 'Xatolik yuz berdi.');
          return;
        }
        loadTariffList();
      });
    });
  }

  // 52-bosqich: tarif nomi va narxini birgalikda tahrirlash oynasi.
  // 56-bosqich: shu oynadan to'g'ridan-to'g'ri "Ruxsatlar" (funksiyalar)
  // modaliga o'tish tugmasi ham qo'shildi — ikkalasi bir yaxlit
  // "tarifni tahrirlash" oqimi sifatida ishlaydi.
  function showTariffEditModal(tariff) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:340px;">
        <h3>Tarifni tahrirlash</h3>
        <label class="field-label">Tarif nomi</label>
        <input type="text" id="tariffEditNameInput" value="${escapeHtml(tariff.name)}">
        <label class="field-label">Narx (so'm/oy)</label>
        <input type="text" id="tariffEditPriceInput" value="${tariff.price || 0}" inputmode="numeric">
        <label class="field-label">Muddat tugashi eslatmasi (necha kun oldin)</label>
        <input type="text" id="tariffEditReminderInput" value="${tariff.reminderDays || 1}" inputmode="numeric">
        <div class="xabar" id="tariffEditMsg"></div>
        <button type="button" class="btn ikkinchi" id="tariffEditPermsBtn" style="margin-top:4px;">${icon('check-circle', 'icon-xs')}<span>Ruxsatlar (funksiyalar)</span></button>
        <div class="btn-row">
          <button class="btn ikkinchi" id="tariffEditCancelBtn">Bekor qilish</button>
          <button class="btn" id="tariffEditSaveBtn">Saqlash</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('tariffEditCancelBtn').onclick = () => overlay.remove();
    document.getElementById('tariffEditPermsBtn').onclick = async () => {
      overlay.remove();
      await showTariffFeaturesModal(tariff);
    };
    document.getElementById('tariffEditSaveBtn').onclick = async () => {
      const nameVal = document.getElementById('tariffEditNameInput').value.trim();
      const priceVal = document.getElementById('tariffEditPriceInput').value.trim();
      const reminderVal = document.getElementById('tariffEditReminderInput').value.trim();
      const msgEl = document.getElementById('tariffEditMsg');
      if (!nameVal) {
        msgEl.textContent = 'Iltimos, tarif nomini kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      if (priceVal && !/^\d+$/.test(priceVal)) {
        msgEl.textContent = 'Narx musbat butun son bo\'lishi kerak.';
        msgEl.className = 'xabar err';
        return;
      }
      if (reminderVal && (!/^\d+$/.test(reminderVal) || parseInt(reminderVal, 10) <= 0)) {
        msgEl.textContent = 'Eslatma kunlari musbat butun son bo\'lishi kerak.';
        msgEl.className = 'xabar err';
        return;
      }
      const res = await apiPost('/api/tariff-rename', { initData, id: tariff.id, name: nameVal, price: priceVal || 0, reminderDays: reminderVal || 1 });
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
        return;
      }
      overlay.remove();
      loadTariffList();
    };
  }

  // 54-bosqich: bitta tarif uchun "Funksiya × Tarif" jadvali — har bir
  // funksiya guruhlangan holda checkbox bilan ko'rsatiladi, admin
  // ✅/❌ belgilaydi. Saqlashda BUTUN xarita bir yo'la /api/tariff-set-features
  // ga yuboriladi (checkbox'lar shu modalda birga saqlanadi).
  async function showTariffFeaturesModal(tariff) {
    let groups = featureCatalogCache;
    if (!groups) {
      const res = await apiPost('/api/feature-list', { initData });
      if (!res.ok) { alert(res.reason || 'Xatolik yuz berdi.'); return; }
      groups = res.groups;
      featureCatalogCache = groups;
    }
    const current = tariff.features || {};
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px; max-height:80vh; overflow-y:auto;">
        <h3>"${escapeHtml(tariff.name)}" — funksiyalar</h3>
        <div class="owner-username" style="margin-bottom:10px;">Ushbu tarifga qaysi funksiyalar kirishini belgilang.</div>
        ${groups.map(g => `
          <div style="margin-bottom:12px;">
            <div class="field-label" style="margin-bottom:4px;">${escapeHtml(g.name)}</div>
            ${g.features.map(f => `
              <label style="display:flex; align-items:center; gap:8px; padding:6px 0; cursor:pointer;">
                <input type="checkbox" data-feature-id="${escapeHtml(f.id)}" ${current[f.id] ? 'checked' : ''} style="width:18px; height:18px; flex-shrink:0;">
                <span>${escapeHtml(f.name)}</span>
              </label>
            `).join('')}
          </div>
        `).join('')}
        <div class="xabar" id="tariffFeaturesMsg"></div>
        <div class="btn-row">
          <button class="btn ikkinchi" id="tariffFeaturesCancelBtn">Bekor qilish</button>
          <button class="btn" id="tariffFeaturesSaveBtn">Saqlash</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('tariffFeaturesCancelBtn').onclick = () => overlay.remove();
    document.getElementById('tariffFeaturesSaveBtn').onclick = async () => {
      const msgEl = document.getElementById('tariffFeaturesMsg');
      const features = {};
      overlay.querySelectorAll('[data-feature-id]').forEach(cb => {
        features[cb.getAttribute('data-feature-id')] = cb.checked;
      });
      const res = await apiPost('/api/tariff-set-features', { initData, id: tariff.id, features });
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
        return;
      }
      overlay.remove();
      loadTariffList();
    };
  }
  // =========================================================================
  // Admin bo'limi: "Obuna rejalari" (G-bo'lim, 73-bosqich) — owner "💳 Obuna"
  // bo'limida ko'radigan muddat/narx rejalarini (masalan "1 oy — 50 000 so'm")
  // admin to'liq boshqaradi: qo'shish, narx/muddatni tahrirlash, o'chirish.
  // Ilgari bu rejalar kod ichida qattiq yozilgan edi (admin o'zgartira
  // olmasdi) — endi "Tariflar" bo'limi bilan bir xil CRUD naqshi ishlatiladi.
  // Har bir rejaga ixtiyoriy ravishda F-bo'lim tarifi ham biriktirilishi
  // mumkin: owner shu rejani tanlab to'lasa, admin tasdiqlaganda muddat
  // bilan birga owner'ning funksiya-tarifi ham shu tarifga o'zgaradi.
  // =========================================================================
  function subscriptionPlanItemHtml(p) {
    return `
      <div class="owner-item" data-plan-id="${escapeHtml(p.id)}">
        <div>
          <div class="owner-id">${escapeHtml(p.label)}</div>
          <div class="owner-username">${cfFormatSum(p.price)} so'm · ${p.days} kun${p.discountNote ? ' · ' + escapeHtml(p.discountNote) : ''}</div>
          <div class="owner-username">${icon('star', 'icon-xs icon-muted')} ${p.tariffLabel ? escapeHtml(p.tariffLabel) : 'Tarif o\'zgarmaydi'}</div>
        </div>
        <div class="btn-row" style="margin-top:0;">
          <button class="btn ikkinchi" data-plan-edit="${escapeHtml(p.id)}" style="width:auto; min-height:36px; padding:6px 12px;">${icon('edit', 'icon-xs')}</button>
          <button class="btn xavfli" data-plan-remove="${escapeHtml(p.id)}" style="width:auto; min-height:36px; padding:6px 12px;">${icon('x', 'icon-xs')}</button>
        </div>
      </div>
    `;
  }

  async function renderSubscriptionPlansScreen(onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Obuna rejalari</div>
        <button class="btn ikkinchi" id="subPlansBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="bosh" style="margin-bottom:10px;">Do'kon egalari "💳 Obuna" bo'limida shu rejalardan birini tanlab, ko'rsatilgan narxni to'laydi. Har bir rejaga ixtiyoriy ravishda tarif ham biriktirishingiz mumkin — to'lov tasdiqlansa, egasining tarifi ham shu tarifga o'zgaradi.</div>
        <div class="kartochka">
          <h2>${icon('plus', 'icon-xs')} Yangi reja qo'shish</h2>
          <label class="field-label">Reja nomi</label>
          <input type="text" id="subPlanLabelInput" placeholder="Masalan: 1 oy">
          <label class="field-label">Muddat (kun)</label>
          <input type="text" id="subPlanDaysInput" placeholder="Masalan: 30" inputmode="numeric">
          <label class="field-label">Narx (so'm)</label>
          <input type="text" id="subPlanPriceInput" placeholder="Masalan: 100000" inputmode="numeric">
          <label class="field-label">Chegirma izohi (ixtiyoriy)</label>
          <input type="text" id="subPlanNoteInput" placeholder="Masalan: chegirmali">
          <label class="field-label">Tarif (ixtiyoriy)</label>
          <select id="subPlanTariffInput"><option value="">Tarif o'zgarmaydi</option></select>
          <button class="btn" id="subPlanAddBtn" style="margin-top:10px;">Qo'shish</button>
          <div class="xabar" id="subPlanAddMsg"></div>
        </div>
        <div class="kartochka">
          <h2>${icon('card', 'icon-xs')} Mavjud rejalar</h2>
          <div id="subPlanList"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
      </div>
    `);
    document.getElementById('subPlansBackBtn').addEventListener('click', () => onBack());
    document.getElementById('subPlanAddBtn').addEventListener('click', async () => {
      const labelInput = document.getElementById('subPlanLabelInput');
      const daysInput = document.getElementById('subPlanDaysInput');
      const priceInput = document.getElementById('subPlanPriceInput');
      const noteInput = document.getElementById('subPlanNoteInput');
      const tariffInput = document.getElementById('subPlanTariffInput');
      const msgEl = document.getElementById('subPlanAddMsg');
      const label = labelInput.value.trim();
      const days = daysInput.value.trim();
      const price = priceInput.value.trim();
      if (!label) { msgEl.textContent = 'Iltimos, reja nomini kiriting.'; msgEl.className = 'xabar err'; return; }
      if (!/^\d+$/.test(days) || parseInt(days, 10) <= 0) { msgEl.textContent = 'Muddat musbat butun son (kun) bo\'lishi kerak.'; msgEl.className = 'xabar err'; return; }
      if (!/^\d+$/.test(price)) { msgEl.textContent = 'Narx musbat butun son bo\'lishi kerak.'; msgEl.className = 'xabar err'; return; }
      msgEl.textContent = '';
      const res = await apiPost('/api/subscription-plan-add', {
        initData, label, days, price, discountNote: noteInput.value.trim(), tariffId: tariffInput.value || null
      });
      if (!res.ok) { msgEl.textContent = res.reason || 'Xatolik yuz berdi.'; msgEl.className = 'xabar err'; return; }
      labelInput.value = ''; daysInput.value = ''; priceInput.value = ''; noteInput.value = ''; tariffInput.value = '';
      loadSubscriptionPlanList();
    });
    await loadSubscriptionPlanList();
  }

  async function loadSubscriptionPlanList() {
    const el = document.getElementById('subPlanList');
    const tariffSelect = document.getElementById('subPlanTariffInput');
    if (!el) return;
    const res = await apiPost('/api/subscription-plan-list', { initData });
    if (!res.ok) { el.innerHTML = `<div class="bosh">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`; return; }

    if (tariffSelect) {
      tariffSelect.innerHTML = `<option value="">Tarif o'zgarmaydi</option>` +
        res.tariffs.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
    }

    if (!res.plans.length) { el.innerHTML = `<div class="bosh">Hozircha reja qo'shilmagan.</div>`; return; }
    el.innerHTML = res.plans.map(subscriptionPlanItemHtml).join('');
    el.querySelectorAll('[data-plan-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-plan-edit');
        const current = res.plans.find(p => p.id === id);
        if (current) showSubscriptionPlanEditModal(current, res.tariffs);
      });
    });
    el.querySelectorAll('[data-plan-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-plan-remove');
        const current = res.plans.find(p => p.id === id);
        if (!confirm(`"${current ? current.label : ''}" rejasini o'chirasizmi?`)) return;
        const r = await apiPost('/api/subscription-plan-remove', { initData, id });
        if (!r.ok) { alert(r.reason || 'Xatolik yuz berdi.'); return; }
        loadSubscriptionPlanList();
      });
    });
  }

  function showSubscriptionPlanEditModal(plan, tariffs) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:340px;">
        <h3>Rejani tahrirlash</h3>
        <label class="field-label">Reja nomi</label>
        <input type="text" id="subPlanEditLabelInput" value="${escapeHtml(plan.label)}">
        <label class="field-label">Muddat (kun)</label>
        <input type="text" id="subPlanEditDaysInput" value="${plan.days}" inputmode="numeric">
        <label class="field-label">Narx (so'm)</label>
        <input type="text" id="subPlanEditPriceInput" value="${plan.price}" inputmode="numeric">
        <label class="field-label">Chegirma izohi (ixtiyoriy)</label>
        <input type="text" id="subPlanEditNoteInput" value="${plan.discountNote ? escapeHtml(plan.discountNote) : ''}">
        <label class="field-label">Tarif (ixtiyoriy)</label>
        <select id="subPlanEditTariffInput">
          <option value="">Tarif o'zgarmaydi</option>
          ${tariffs.map(t => `<option value="${escapeHtml(t.id)}" ${t.id === plan.tariffId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
        </select>
        <div class="xabar" id="subPlanEditMsg"></div>
        <div class="btn-row">
          <button class="btn ikkinchi" id="subPlanEditCancelBtn">Bekor qilish</button>
          <button class="btn" id="subPlanEditSaveBtn">Saqlash</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('subPlanEditCancelBtn').onclick = () => overlay.remove();
    document.getElementById('subPlanEditSaveBtn').onclick = async () => {
      const msgEl = document.getElementById('subPlanEditMsg');
      const label = document.getElementById('subPlanEditLabelInput').value.trim();
      const days = document.getElementById('subPlanEditDaysInput').value.trim();
      const price = document.getElementById('subPlanEditPriceInput').value.trim();
      const note = document.getElementById('subPlanEditNoteInput').value.trim();
      const tariffId = document.getElementById('subPlanEditTariffInput').value || null;
      if (!label) { msgEl.textContent = 'Iltimos, reja nomini kiriting.'; msgEl.className = 'xabar err'; return; }
      if (!/^\d+$/.test(days) || parseInt(days, 10) <= 0) { msgEl.textContent = 'Muddat musbat butun son (kun) bo\'lishi kerak.'; msgEl.className = 'xabar err'; return; }
      if (!/^\d+$/.test(price)) { msgEl.textContent = 'Narx musbat butun son bo\'lishi kerak.'; msgEl.className = 'xabar err'; return; }
      const res = await apiPost('/api/subscription-plan-update', {
        initData, id: plan.id, label, days, price, discountNote: note, tariffId
      });
      if (!res.ok) { msgEl.textContent = res.reason || 'Xatolik yuz berdi.'; msgEl.className = 'xabar err'; return; }
      overlay.remove();
      loadSubscriptionPlanList();
    };
  }

  // =========================================================================
  // Bosiladigan (accordion) bo'lim komponenti — renderProfileForm() ichida
  // kamdan-kam o'zgartiriladigan bo'limlarni (kategoriyalar, aksiyalar,
  // bonus, dostavka/oshxona guruhlari, xavfsizlik) yig'ib turadi. Har bir
  // bo'lim boshida yopiq holda keladi, bosilganda ochiladi/yopiladi —
  // shu bilan sahifa cheksiz uzun bo'lib ko'rinmaydi.
  // =========================================================================
  function accSectionHtml(section) {
    return `
      <div class="acc-item" data-acc-key="${section.key}">
        <button type="button" class="acc-header" data-acc-toggle="${section.key}">
          <span class="acc-header-icon">${icon(section.icon)}</span>
          <span class="acc-header-text">
            <span class="acc-header-title">${escapeHtml(section.title)}</span>
            ${section.hint ? `<span class="acc-header-hint">${escapeHtml(section.hint)}</span>` : ''}
          </span>
          <span class="acc-chevron">${icon('chevron-down')}</span>
        </button>
        <div class="acc-body">${section.body}</div>
      </div>
    `;
  }

  function wireAccSections() {
    document.querySelectorAll('[data-acc-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.acc-item');
        if (item) item.classList.toggle('open');
      });
    });
  }

  function renderProfileForm(existing) {
    if (!existing) { renderProfileOnboarding(); return; }
    const p = existing;
    let pendingBrandColor = isValidHexColor(p.brandColor) ? p.brandColor : DEFAULT_BRAND_COLOR;
    let pendingLogo = p.logoUrl || '';
    let pendingBannerImg = ''; // 45-bosqich: yangi banner formasidagi tanlangan rasm (hali saqlanmagan)
    setAppHeader(existing.logoUrl, existing.name, 'Egasi');
    const accSections = [
      {
        key: 'categories', icon: 'restaurant', title: "Menyu bo'limlari",
        hint: 'Kategoriyalar tartibi',
        body: `
          <div class="kartochka">
            <div class="bosh">Menyuga taom qo'shish va mavjud taomlarni boshqarish endi <b>"Ombor"</b> bo'limiga ko'chirildi (chunki taomni sklad mahsulotiga bog'lash shu yerda qulayroq).</div>
          </div>
          <div class="kartochka">
            <h2>Bo'limlar (kategoriyalar)</h2>
            <div class="bosh">Taomlarni bo'limlarga ajratish uchun ro'yxat. Shu yerdagi tartib mijozlar va kassir menyusida ko'rinadigan tartibni belgilaydi.</div>
            <input type="text" id="categoryNameInput" placeholder="Bo'lim nomi (masalan: Issiq taomlar)" style="margin-top:10px;">
            <button class="btn" id="addCategoryBtn" style="margin-top:8px;">Bo'lim qo'shish</button>
            <div class="xabar" id="categoryMsg"></div>
            <div class="owner-list" id="categoryList" style="margin-top:12px;"><div class="bosh">Yuklanmoqda...</div></div>
          </div>
        `
      },
      {
        key: 'promos', icon: 'star', title: 'Aksiyalar va chegirmalar',
        hint: "Yangi aksiya qo'shish, ro'yxat",
        body: `
          <div class="kartochka">
            <h2>Aksiya/chegirma qo'shish</h2>
            <input type="text" id="promoTitleInput" placeholder="Aksiya nomi (masalan: Hafta oxiri aksiyasi)">
            <textarea id="promoDescInput" placeholder="Tavsif (ixtiyoriy)"></textarea>
            <input type="text" id="promoPercentInput" placeholder="Chegirma foizi (masalan: 10)" inputmode="numeric">
            <input type="text" id="promoMinInput" placeholder="Minimal buyurtma summasi (ixtiyoriy)" inputmode="numeric">
            <button class="btn" id="addPromoBtn">Aksiya qo'shish</button>
            <div class="xabar" id="promoMsg"></div>
          </div>
          <div class="kartochka">
            <h2>Aksiyalar ro'yxati</h2>
            <div class="owner-list" id="promoList"><div class="bosh">Yuklanmoqda...</div></div>
          </div>
        `
      },
      {
        key: 'banners', icon: 'image', title: 'Reklama bannerlari',
        hint: "Mijozlar ekraniga rasmli e'lon",
        body: `
          <div class="kartochka">
            <h2>Yangi banner qo'shish</h2>
            <div class="bosh">Banner mijozlar ilovasining menyu ekrani tepasida ko'rinadi. Ixtiyoriy ravishda havola qo'shsangiz, banner bosilganda o'sha sahifa ochiladi.</div>
            ${logoPickerHtml('bannerImg', '')}
            <input type="text" id="bannerTitleInput" placeholder="Sarlavha (ixtiyoriy)" style="margin-top:10px;">
            <input type="text" id="bannerLinkInput" placeholder="Havola (ixtiyoriy, https://...)">
            <label class="field-label">Boshlanish sanasi (ixtiyoriy)</label>
            <input type="date" id="bannerStartInput">
            <label class="field-label">Tugash sanasi (ixtiyoriy)</label>
            <input type="date" id="bannerEndInput">
            <button class="btn" id="addBannerBtn" style="margin-top:8px;">Banner qo'shish</button>
            <div class="xabar" id="bannerMsg"></div>
          </div>
          <div class="kartochka">
            <h2>Bannerlar ro'yxati</h2>
            <div class="owner-list" id="bannerList"><div class="bosh">Yuklanmoqda...</div></div>
          </div>
        `
      },
      {
        key: 'bonus', icon: 'trophy', title: 'Bonus tizimi',
        hint: "Mijozlarni rag'batlantirish",
        body: `
          <div class="kartochka">
            <div class="bosh">Qaytgan mijozlarga har bir buyurtmadan avtomatik bonus ball to'planadi (1 ball = 1 so'm, keyingi buyurtmada ishlatiladi).</div>
            <label class="check-label" style="margin-top:10px; font-size:var(--fs-body);">
              <input type="checkbox" id="bonusEnabledInput">
              Bonus tizimini yoqish
            </label>
            <input type="text" id="bonusPercentInput" placeholder="Bonus foizi (masalan: 5)" inputmode="numeric" style="margin-top:8px;">
            <button class="btn" id="saveBonusBtn">Saqlash</button>
            <div class="xabar" id="bonusMsg"></div>
          </div>
        `
      },
      {
        key: 'delivery', icon: 'scooter', title: 'Dostavka guruhi',
        hint: 'Kuryerlar guruhini biriktirish',
        body: `
          <div class="kartochka">
            <h2>Dostavka admin guruhi</h2>
            <div class="bosh">Mijoz istalgan turda (Stolga, Olib ketish yoki Dostavka) buyurtma bersa, "Qabul qilish" va "Tayyor" tugmali xabar shu guruhga boradi. Tugma bosilganda mijozga avtomatik xabar ketadi.</div>
            <div id="deliveryGroupStatus" class="bosh" style="margin-top:10px;">Tekshirilmoqda...</div>
            <div class="customer-link-hint">
              Ulash uchun: 1) Botni dostavka xodimlaringiz bo'lgan guruhga qo'shing (admin huquqi bilan). 2) O'zingiz (oshxona egasi) o'sha guruhda <b>/biriktir</b> buyrug'ini yuboring.<br>
              Bekor qilish uchun guruhda <b>/bekor_biriktir</b> yozing yoki pastdagi tugmani bosing.
            </div>
            <button class="btn ikkinchi xavfli hidden" id="removeDeliveryGroupBtn" style="margin-top:10px;">Guruhni bog'lanishdan chiqarish</button>
            <div class="xabar" id="deliveryGroupMsg"></div>
          </div>
        `
      },
      {
        key: 'kitchen', icon: 'chef-hat', title: 'Oshpazlar guruhi',
        hint: 'Oshxona buyurtma xabarlari',
        body: `
          <div class="kartochka">
            <h2>Oshpazlar guruhi</h2>
            <div class="bosh">Har bir yangi buyurtma haqida "Qabul qilish" va "Tayyor" tugmali xabar shu guruhga ham boradi — oshpazlar shaxsiy chatni ochmagan yoki bloklagan bo'lsa ham, buyurtma guruhda ko'rinadi. Dostavka admin guruhidan mustaqil — ikkalasini bir vaqtda biriktirish mumkin.</div>
            <div id="kitchenGroupStatus" class="bosh" style="margin-top:10px;">Tekshirilmoqda...</div>
            <div class="customer-link-hint">
              Ulash uchun: 1) Botni oshpazlaringiz bo'lgan guruhga qo'shing (admin huquqi bilan). 2) O'zingiz (oshxona egasi) o'sha guruhda <b>/oshpaz_biriktir</b> buyrug'ini yuboring.<br>
              Bekor qilish uchun guruhda <b>/oshpaz_bekor_biriktir</b> yozing yoki pastdagi tugmani bosing.
            </div>
            <button class="btn ikkinchi xavfli hidden" id="removeKitchenGroupBtn" style="margin-top:10px;">Guruhni bog'lanishdan chiqarish</button>
            <div class="xabar" id="kitchenGroupMsg"></div>
          </div>
        `
      },
      (usingOwnerSession || ownerHasTelegramLogin) ? {
        key: 'account', icon: 'lock', title: 'Hisob va xavfsizlik',
        hint: 'Parol, chiqish',
        body: `
          <div class="kartochka">
            <div class="bosh">${usingOwnerSession ? 'Siz login/parol orqali kirgansiz.' : 'Bu qurilmada parol eslab qolingan.'}</div>
            <button class="btn ikkinchi xavfli" id="ownerLogoutBtn" style="margin-top:10px;">Chiqish</button>

            <h2 style="margin-top:18px;">Xavfsizlik</h2>
            <button class="btn ikkinchi" id="togglePwChangeBtn">Parolni almashtirish</button>
            <div id="pwChangeForm" class="hidden" style="margin-top:10px;">
              <label class="field-label">Joriy parol</label>
              <input type="password" id="pwCurrentInput" autocomplete="current-password" placeholder="Joriy parol">
              <label class="field-label">Yangi parol</label>
              <input type="password" id="pwNewInput" autocomplete="new-password" placeholder="Kamida 6 belgi">
              <label class="field-label">Yangi parolni takrorlang</label>
              <input type="password" id="pwNewRepeatInput" autocomplete="new-password" placeholder="Yangi parolni qayta kiriting">
              <div class="btn-row">
                <button class="btn ikkinchi" id="pwChangeCancelBtn">Bekor qilish</button>
                <button class="btn" id="pwChangeSaveBtn">Saqlash</button>
              </div>
              <div class="xabar" id="pwChangeMsg"></div>
            </div>

            ${tg ? `
            <button class="btn ikkinchi xavfli" id="togglePwRemoveBtn" style="margin-top:14px;">Parolni o'chirish</button>
            <div id="pwRemoveForm" class="hidden" style="margin-top:10px;">
              <div class="bosh">Parol o'chirilsa, bundan buyon faqat Telegram orqali kirish imkoni qoladi. Tasdiqlash uchun joriy parolingizni kiriting.</div>
              <label class="field-label">Joriy parol</label>
              <input type="password" id="pwRemoveCurrentInput" autocomplete="current-password" placeholder="Joriy parol">
              <div class="btn-row">
                <button class="btn ikkinchi" id="pwRemoveCancelBtn">Bekor qilish</button>
                <button class="btn xavfli" id="pwRemoveConfirmBtn">Parolni o'chirish</button>
              </div>
              <div class="xabar" id="pwRemoveMsg"></div>
            </div>
            ` : ''}
          </div>
        `
      } : null
    ].filter(Boolean);

    ekran(`
      <div class="panel">
        <div class="salom">Profilni tahrirlash</div>
        <div class="bosh">Ma'lumotlaringizni yangilang.</div>

        <div class="profile-hero">
          <div class="profile-hero-avatar">${p.logoUrl ? `<img src="${escapeHtml(p.logoUrl)}" alt="">` : icon('restaurant')}</div>
          <div>
            <div class="profile-hero-title">${escapeHtml(p.name || "Oshxona nomi ko'rsatilmagan")}</div>
            <div class="profile-hero-subtitle">${escapeHtml(p.address || 'Manzil kiritilmagan')}</div>
          </div>
        </div>

        <div class="kartochka">
          <h2>${icon('star', 'icon-xs')} Joriy tarif</h2>
          <div id="profileTariffInfo" class="owner-username">Yuklanmoqda...</div>
        </div>
        <div class="kartochka">
          <label class="field-label">Oshxona nomi *</label>
          <input type="text" id="pName" placeholder="Masalan: Osh Markazi" value="${escapeHtml(p.name || '')}">
          <label class="field-label">Manzil *</label>
          <input type="text" id="pAddress" placeholder="Shahar, ko'cha, uy" value="${escapeHtml(p.address || '')}">
          <label class="field-label">Telefon *</label>
          <input type="text" id="pPhone" placeholder="+998901234567" value="${escapeHtml(p.phone || '')}">
          <label class="field-label">Ish vaqti</label>
          <input type="text" id="pWorkHours" placeholder="09:00 - 23:00" value="${escapeHtml(p.workHours || '')}">
          ${logoPickerHtml('pLogo', pendingLogo)}
          <label class="field-label">Brend rangi (mijozlar menyusi va ilova shu rangda ko'rinadi)</label>
          ${brandSwatchesHtml(pendingBrandColor, p.name)}
          <div class="btn-row" style="margin-top:14px;">
            <button class="btn ikkinchi" id="cancelProfileBtn">← Bekor qilish</button>
            <button class="btn" id="saveProfileBtn">Saqlash</button>
          </div>
          <div class="xabar" id="profileMsg"></div>
        </div>

        <div class="section-label">${icon('settings', 'icon-xs')} Qo'shimcha sozlamalar</div>
        <div class="acc-list">
          ${accSections.map(s => accSectionHtml(s)).join('')}
        </div>
      </div>
    `);

    wireAccSections();

    if (usingOwnerSession) {
      const logoutBtn = document.getElementById('ownerLogoutBtn');
      if (logoutBtn) logoutBtn.addEventListener('click', ownerLogout);
    } else if (ownerHasTelegramLogin) {
      const logoutBtn = document.getElementById('ownerLogoutBtn');
      if (logoutBtn) logoutBtn.addEventListener('click', ownerTelegramGateLogout);
    }

    if (usingOwnerSession || ownerHasTelegramLogin) {
      attachOwnerPasswordSecurityHandlers();
    }

    attachBrandSwatchHandlers((hex) => {
      pendingBrandColor = hex;
      applyBrandColor(hex);
    });
    attachLogoPickerHandlers('pLogo', (val) => { pendingLogo = val; });
    attachLogoPickerHandlers('bannerImg', (val) => { pendingBannerImg = val; });

    // Jonli ko'rish saqlashdan oldingi taxminiy holat — shu sababli bekor
    // qilinganda haqiqiy saqlangan rangga qaytarib, o'zgarishlarni tashlab
    // yuboradi (29-bosqich: preview har doim rad etib bo'lishi kerak).
    document.getElementById('cancelProfileBtn').addEventListener('click', () => {
      applyBrandColor(p.brandColor);
      renderOwnerHomeScreen(p);
    });

    document.getElementById('saveProfileBtn').addEventListener('click', async () => {
      const msgEl = document.getElementById('profileMsg');
      const body = {
        initData,
        name: document.getElementById('pName').value.trim(),
        address: document.getElementById('pAddress').value.trim(),
        phone: document.getElementById('pPhone').value.trim(),
        workHours: document.getElementById('pWorkHours').value.trim(),
        logoUrl: pendingLogo,
        brandColor: pendingBrandColor
      };
      msgEl.textContent = 'Saqlanmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/save-profile', body);
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
        applyBrandColor(p.brandColor);
        return;
      }
      renderOwnerHomeScreen(res.profile);
    });

    document.getElementById('addCategoryBtn').addEventListener('click', async () => {
      const name = document.getElementById('categoryNameInput').value.trim();
      const msgEl = document.getElementById('categoryMsg');
      if (!name) {
        msgEl.textContent = 'Bo\'lim nomini kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Qo\'shilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/category-add', { initData, name });
      if (res.ok) {
        msgEl.textContent = 'Qo\'shildi.';
        msgEl.className = 'xabar ok';
        document.getElementById('categoryNameInput').value = '';
        loadCategoriesAndRender();
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    document.getElementById('addPromoBtn').addEventListener('click', async () => {
      const title = document.getElementById('promoTitleInput').value.trim();
      const description = document.getElementById('promoDescInput').value.trim();
      const discountPercent = document.getElementById('promoPercentInput').value.trim();
      const minTotal = document.getElementById('promoMinInput').value.trim();
      const msgEl = document.getElementById('promoMsg');
      if (!title || !discountPercent || !/^\d+$/.test(discountPercent)) {
        msgEl.textContent = 'Aksiya nomi va chegirma foizini kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Qo\'shilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/promo-add', { initData, title, description, discountPercent, minTotal });
      if (res.ok) {
        msgEl.textContent = 'Aksiya qo\'shildi.';
        msgEl.className = 'xabar ok';
        document.getElementById('promoTitleInput').value = '';
        document.getElementById('promoDescInput').value = '';
        document.getElementById('promoPercentInput').value = '';
        document.getElementById('promoMinInput').value = '';
        loadPromoAndRender();
      } else {
        handleFeatureBlocked(res);
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    document.getElementById('promoList').addEventListener('click', async (e) => {
      const toggleId = e.target.getAttribute('data-toggle-promo-id');
      const removeId = e.target.getAttribute('data-remove-promo-id');
      if (toggleId) {
        e.target.disabled = true;
        await apiPost('/api/promo-toggle', { initData, id: toggleId });
        loadPromoAndRender();
      } else if (removeId) {
        e.target.disabled = true;
        await apiPost('/api/promo-remove', { initData, id: removeId });
        loadPromoAndRender();
      }
    });

    document.getElementById('addBannerBtn').addEventListener('click', async () => {
      const title = document.getElementById('bannerTitleInput').value.trim();
      const link = document.getElementById('bannerLinkInput').value.trim();
      const startAt = document.getElementById('bannerStartInput').value;
      const endAt = document.getElementById('bannerEndInput').value;
      const msgEl = document.getElementById('bannerMsg');
      if (!pendingBannerImg) {
        msgEl.textContent = 'Banner uchun rasm tanlang.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Qo\'shilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/banner-add', { initData, imageUrl: pendingBannerImg, title, link, startAt, endAt });
      if (res.ok) {
        msgEl.textContent = 'Banner qo\'shildi.';
        msgEl.className = 'xabar ok';
        pendingBannerImg = '';
        document.getElementById('bannerTitleInput').value = '';
        document.getElementById('bannerLinkInput').value = '';
        document.getElementById('bannerStartInput').value = '';
        document.getElementById('bannerEndInput').value = '';
        const preview = document.getElementById('bannerImgPreview');
        if (preview) preview.outerHTML = `<div id="bannerImgPreview" class="logo-picker-preview logo-picker-preview-empty">${icon('image', 'icon-md')}</div>`;
        const removeBtn = document.getElementById('bannerImgRemoveBtn');
        if (removeBtn) removeBtn.remove();
        loadBannerAndRender();
      } else {
        handleFeatureBlocked(res);
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    document.getElementById('bannerList').addEventListener('click', async (e) => {
      const toggleId = e.target.getAttribute('data-toggle-banner-id');
      const removeId = e.target.getAttribute('data-remove-banner-id');
      if (toggleId) {
        e.target.disabled = true;
        await apiPost('/api/banner-toggle', { initData, id: toggleId });
        loadBannerAndRender();
      } else if (removeId) {
        e.target.disabled = true;
        await apiPost('/api/banner-remove', { initData, id: removeId });
        loadBannerAndRender();
      }
    });

    document.getElementById('saveBonusBtn').addEventListener('click', async () => {
      const enabled = document.getElementById('bonusEnabledInput').checked;
      const earnPercent = document.getElementById('bonusPercentInput').value.trim();
      const msgEl = document.getElementById('bonusMsg');
      if (enabled && (!earnPercent || !/^\d+$/.test(earnPercent))) {
        msgEl.textContent = 'Bonus foizini kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Saqlanmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/bonus-settings-save', { initData, enabled, earnPercent: earnPercent || 0 });
      if (res.ok) {
        msgEl.textContent = 'Saqlandi.';
        msgEl.className = 'xabar ok';
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    document.getElementById('removeDeliveryGroupBtn').addEventListener('click', async () => {
      const msgEl = document.getElementById('deliveryGroupMsg');
      msgEl.textContent = 'Bekor qilinmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/delivery-group-remove', { initData });
      if (res.ok) {
        msgEl.textContent = 'Guruh bog\'lanishdan chiqarildi.';
        msgEl.className = 'xabar ok';
        loadDeliveryGroupStatus();
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    document.getElementById('removeKitchenGroupBtn').addEventListener('click', async () => {
      const msgEl = document.getElementById('kitchenGroupMsg');
      msgEl.textContent = 'Bekor qilinmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/kitchen-group-remove', { initData });
      if (res.ok) {
        msgEl.textContent = 'Guruh bog\'lanishdan chiqarildi.';
        msgEl.className = 'xabar ok';
        loadKitchenGroupStatus();
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    loadCategoriesAndRender();
    loadPromoAndRender();
    loadBannerAndRender();
    loadBonusSettingsAndRender();
    loadDeliveryGroupStatus();
    loadKitchenGroupStatus();
    loadOwnerTariffInfo();
  }

  // 58-bosqich: do'kon egasi o'z profilida joriy tarifini ko'rishi.
  async function loadOwnerTariffInfo() {
    const el = document.getElementById('profileTariffInfo');
    if (!el) return;
    const res = await apiPost('/api/my-profile', { initData });
    if (!res.ok) {
      el.textContent = 'Yuklab bo\'lmadi.';
      return;
    }
    el.textContent = res.tariff ? res.tariff.name : 'Tarif belgilanmagan';
  }

  // ---- Do'kon egasi: birinchi marta profil to'ldirish — bosqichma-bosqich
  // "onboarding" ustasi (18-bosqich). Tahrirlashdan farqli, bu yerda
  // ma'lumot 3 ta qadamga bo'lingan: (1) asosiy ma'lumot, (2) qo'shimcha
  // ma'lumot, (3) hammasini tekshirib chiqish va saqlash. Har bir qadamda
  // yuqorida progress-chiziq joriy holatni ko'rsatadi.
  const ONBOARDING_STEPS = [
    { title: "Asosiy ma'lumot" },
    { title: "Qo'shimcha ma'lumot" },
    { title: 'Tekshirib chiqish' }
  ];
  let onboardingState = null;

  function onboardingStepBodyHtml(s) {
    const d = s.data;
    if (s.step === 1) {
      return `
        <label class="field-label">Oshxona nomi *</label>
        <input type="text" id="obName" placeholder="Masalan: Osh Markazi" value="${escapeHtml(d.name)}">
        <label class="field-label">Manzil *</label>
        <input type="text" id="obAddress" placeholder="Shahar, ko'cha, uy" value="${escapeHtml(d.address)}">
        <label class="field-label">Telefon *</label>
        <input type="text" id="obPhone" placeholder="+998901234567" value="${escapeHtml(d.phone)}">
      `;
    }
    if (s.step === 2) {
      return `
        <label class="field-label">Ish vaqti</label>
        <input type="text" id="obWorkHours" placeholder="09:00 - 23:00" value="${escapeHtml(d.workHours)}">
        ${logoPickerHtml('obLogo', d.logoUrl)}
      `;
    }
    const reviewRow = (label, value, stepNum) => `
      <div class="onboarding-review-row">
        <div>
          <div class="review-label">${escapeHtml(label)}</div>
          <div class="review-value">${value ? escapeHtml(value) : '— kiritilmagan'}</div>
        </div>
        <span class="review-edit-link" data-onboard-edit-step="${stepNum}">O'zgartirish</span>
      </div>
    `;
    return `
      ${reviewRow('Oshxona nomi', d.name, 1)}
      ${reviewRow('Manzil', d.address, 1)}
      ${reviewRow('Telefon', d.phone, 1)}
      ${reviewRow('Ish vaqti', d.workHours, 2)}
      <div class="onboarding-review-row">
        <div>
          <div class="review-label">Logotip</div>
          ${d.logoUrl
            ? `<img class="logo-picker-preview logo-picker-preview-sm" src="${escapeHtml(d.logoUrl)}" onerror="this.style.display='none'">`
            : `<div class="review-value">— tanlanmagan</div>`}
        </div>
        <span class="review-edit-link" data-onboard-edit-step="2">O'zgartirish</span>
      </div>
    `;
  }

  function collectOnboardingStepInputs(s) {
    if (s.step === 1) {
      s.data.name = document.getElementById('obName').value.trim();
      s.data.address = document.getElementById('obAddress').value.trim();
      s.data.phone = document.getElementById('obPhone').value.trim();
    } else if (s.step === 2) {
      s.data.workHours = document.getElementById('obWorkHours').value.trim();
    }
  }

  function renderProfileOnboarding() {
    if (!onboardingState) {
      onboardingState = { step: 1, data: { name: '', address: '', phone: '', workHours: '', logoUrl: '' } };
    }
    clearAppHeader();
    const s = onboardingState;
    const total = ONBOARDING_STEPS.length;
    ekran(`
      <div class="panel">
        <div class="salom">Profilni to'ldiring</div>
        <div class="bosh">${s.step}-qadam / ${total} — ${escapeHtml(ONBOARDING_STEPS[s.step - 1].title)}</div>
        <div class="onboarding-steps">
          ${ONBOARDING_STEPS.map((_, i) => `<div class="step-seg ${i + 1 < s.step ? 'done' : ''} ${i + 1 === s.step ? 'active' : ''}"></div>`).join('')}
        </div>
        <div class="kartochka">
          ${onboardingStepBodyHtml(s)}
          <div class="xabar" id="onboardMsg"></div>
          <div class="btn-row" style="margin-top:10px;">
            ${s.step > 1 ? `<button class="btn ikkinchi" id="onboardBackBtn">← Orqaga</button>` : ''}
            <button class="btn" id="onboardNextBtn">${s.step < total ? 'Keyingi →' : 'Saqlash'}</button>
          </div>
        </div>
      </div>
    `);

    if (s.step > 1) {
      document.getElementById('onboardBackBtn').addEventListener('click', () => {
        collectOnboardingStepInputs(s);
        s.step -= 1;
        renderProfileOnboarding();
      });
    }

    if (s.step === 2) {
      attachLogoPickerHandlers('obLogo', (val) => { s.data.logoUrl = val; });
    }

    document.querySelectorAll('[data-onboard-edit-step]').forEach(el => {
      el.addEventListener('click', () => {
        s.step = parseInt(el.getAttribute('data-onboard-edit-step'), 10);
        renderProfileOnboarding();
      });
    });

    document.getElementById('onboardNextBtn').addEventListener('click', async () => {
      const msgEl = document.getElementById('onboardMsg');
      if (s.step === 1) {
        const name = document.getElementById('obName').value.trim();
        const address = document.getElementById('obAddress').value.trim();
        const phone = document.getElementById('obPhone').value.trim();
        if (!name || !address || !phone) {
          msgEl.textContent = "Yulduzcha (*) bilan belgilangan maydonlarni to'ldiring.";
          msgEl.className = 'xabar err';
          return;
        }
        s.data.name = name; s.data.address = address; s.data.phone = phone;
        s.step = 2;
        renderProfileOnboarding();
        return;
      }
      if (s.step === 2) {
        s.data.workHours = document.getElementById('obWorkHours').value.trim();
        s.step = 3;
        renderProfileOnboarding();
        return;
      }
      // 3-qadam — yakuniy saqlash
      const btn = document.getElementById('onboardNextBtn');
      btn.disabled = true;
      msgEl.textContent = 'Saqlanmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/save-profile', { initData, ...s.data });
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
        btn.disabled = false;
        return;
      }
      onboardingState = null;
      renderOwnerHomeScreen(res.profile);
    });
  }

  // ---- Do'kon egasi: to'ldirilgan profilni ko'rsatish ----
  const ROLE_LABELS = { kassir: 'Kassir', oshpaz: 'Oshpaz', sklad: 'Sklad mas\'uli', dostavka: 'Kuryer' };
  function rolesLabelClient(roles) {
    return (roles || []).map(r => ROLE_LABELS[r] || r).join(', ') || '—';
  }
  // Bir nechta vakolatli xodim uchun rol tanlash tugmalarida ishlatiladi (qarang: renderStaffRolePicker)
  const ROLE_ICONS = { kassir: 'wallet', oshpaz: 'chef-hat', sklad: 'box', dostavka: 'scooter' };

  function staffRoles(s) {
    if (Array.isArray(s.roles) && s.roles.length) return s.roles;
    return s.role ? [s.role] : [];
  }

  // Bir nechta vakolatli xodim TANLAGAN rol shu qurilmada (localStorage) eslab
  // qolinadi — Mini App qayta ochilganda har safar so'ralmaydi, faqat xodim
  // header'dagi "🔁 Rol almashtirish" tugmasini bossa (yoki admin uning
  // vakolatlaridan birini olib tashlasa) qayta so'raladi.
  function staffChosenRoleKey() {
    const tgUserId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
    return tgUserId ? `kitchenOsStaffRole:${tgUserId}` : null;
  }

  function staffListHtml(staff) {
    if (!staff || !staff.length) return `<div class="bosh">Hozircha xodimlar yo'q.</div>`;
    return staff.map(s => {
      const branch = branchState.branches.find(b => b.id === s.branchId);
      const roles = staffRoles(s);
      const roleBadges = roles.map(r => `<span class="role-badge">${escapeHtml(ROLE_LABELS[r] || r)}</span>`).join(' ');
      const roleCheckboxes = Object.entries(ROLE_LABELS).map(([key, label]) => `
        <label class="check-label" style="font-size:var(--fs-xs);">
          <input type="checkbox" data-staff-role-checkbox="${escapeHtml(s.id)}" value="${key}" ${roles.includes(key) ? 'checked' : ''}>
          ${escapeHtml(label)}
        </label>
      `).join('');
      return `
      <div class="owner-item">
        <div>
          <div class="owner-id">${escapeHtml(s.id)}</div>
          ${s.username ? `<div class="owner-username">@${escapeHtml(s.username)}</div>` : ''}
          <div class="owner-expiry">${roleBadges} · ${branch ? escapeHtml(branch.name) : 'Markaziy'}</div>
          <select data-staff-branch-id="${escapeHtml(s.id)}" style="margin-top:8px;">${branchOptionsHtml(s.branchId)}</select>
          <div class="staff-role-grid">${roleCheckboxes}</div>
        </div>
        <button data-remove-staff-id="${escapeHtml(s.id)}">O'chirish</button>
      </div>
    `;
    }).join('');
  }

  function branchListHtml(branches) {
    if (!branches || !branches.length) return `<div class="bosh">Hozircha filiallar yo'q.</div>`;
    return branches.map(b => `
      <div class="owner-item">
        <div>
          <div class="owner-id">${escapeHtml(b.name)}</div>
          <div class="owner-username">${escapeHtml(b.address)}</div>
          ${b.phone ? `<div class="owner-expiry">${escapeHtml(b.phone)}</div>` : ''}
        </div>
        <button data-remove-branch-id="${escapeHtml(b.id)}">O'chirish</button>
      </div>
    `).join('');
  }

  let branchState = { branches: [] };

  function branchOptionsHtml(selectedId) {
    const opts = [`<option value="">— Markaziy (filialsiz) —</option>`];
    for (const b of branchState.branches) {
      opts.push(`<option value="${escapeHtml(b.id)}" ${selectedId === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`);
    }
    return opts.join('');
  }

  async function loadBranchAndRender() {
    const listEl = document.getElementById('branchList');
    const res = await apiPost('/api/branch-list', { initData });
    if (res.networkError) { if (listEl) renderNetworkErrorInline(listEl, res.reason, loadBranchAndRender); return; }
    branchState.branches = res.ok ? res.branches : [];
    if (listEl) listEl.innerHTML = branchListHtml(branchState.branches);
    const staffBranchSelect = document.getElementById('staffBranchInput');
    if (staffBranchSelect) staffBranchSelect.innerHTML = branchOptionsHtml(null);
  }

  // 3-bosqich: KitchenOS bosh sahifa header'i — hamburger, logotip,
  // nom/taglayn, sana va bildirishnoma qo'ng'irog'i (badge bilan).
  // Hozircha faqat "Bosh" tabida sinov uchun ulangan — bildirishnomalar
  // sonini serverdan olish (18-bosqich) va hamburger menyusi (14-bosqich)
  // keyinroq ulanadi; hozircha ular placeholder ishlov beruvchiga ega.
  const KO_MONTH_NAMES = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
    'Iyul', 'Avgust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];

  function koTodayLabel() {
    const d = new Date();
    return `${d.getDate()} ${KO_MONTH_NAMES[d.getMonth()]}`;
  }

  function koHomeHeaderHtml(unreadCount, restaurantName) {
    const count = unreadCount || 0;
    return `
      <div class="ko-home-header">
        <div class="ko-home-header-left">
          <button type="button" class="ko-home-header-menu-btn" id="koHeaderMenuBtn" aria-label="Menyu">
            ${icon('menu', 'icon-lg')}
          </button>
          <div class="ko-home-header-logo">${icon('chef-hat', 'icon-md')}</div>
          <div class="ko-home-header-titles">
            <div class="ko-home-header-title">${escapeHtml(restaurantName || '')}</div>
            <div class="ko-home-header-subtitle">Oshxona Menejeri</div>
          </div>
        </div>
        <div class="ko-home-header-right">
          <div class="ko-home-header-date">${icon('calendar', 'icon-xs')}<span>${koTodayLabel()}</span></div>
          <button type="button" class="ko-home-header-bell-btn" id="koHeaderBellBtn" aria-label="Bildirishnomalar">
            ${icon('bell', 'icon-sm')}
            ${count > 0 ? `<span class="ko-home-header-bell-badge">${count}</span>` : ''}
          </button>
        </div>
      </div>
    `;
  }

  function wireKoHomeHeader(profile) {
    const menuBtn = document.getElementById('koHeaderMenuBtn');
    const bellBtn = document.getElementById('koHeaderBellBtn');
    if (menuBtn) menuBtn.addEventListener('click', () => openKoSidebar(profile));
    if (bellBtn) bellBtn.addEventListener('click', () => renderNotificationsScreen(profile, () => renderOwnerHomeScreen(profile)));
  }

  // =========================================================================
  // Bosh sahifa PASTKI navigatsiyasi — 5 band: Bosh sahifa, Savdo,
  // Yangi buyurtma (markazda FAB), Ombor, Profil. Bildirishnomalar bandi
  // olib tashlandi (header'dagi qo'ng'iroqcha bilan dublikat edi), o'rniga
  // Ombor ekrani (renderStockScreen) qo'yildi. Eski 4-tabli tab-bar
  // o'rnini shu egallaydi.
  //
  // 20-bosqich: "Menyu" (taom qo'shish / aksiya) paneli — rasmda unga aniq
  // joy yo'q edi, shu sababli Sozlamalar ekraniga (renderProfileForm)
  // ko'chirildi: do'kon egasi uchun eng yaqin mos joy shu, chunki menyu
  // tarkibi ham do'kon sozlamasi hisoblanadi.
  // =========================================================================
  function koBottomNavHtml(activeKey) {
    return `
      <div class="ko-bottom-nav" id="koBottomNav">
        <button type="button" class="ko-bottom-nav-item ${activeKey === 'bosh' ? 'active' : ''}" data-ko-nav="bosh">
          ${icon('home')}
          <span>Bosh sahifa</span>
        </button>
        <button type="button" class="ko-bottom-nav-item ${activeKey === 'savdo' ? 'active' : ''}" data-ko-nav="savdo">
          ${icon('bar-chart')}
          <span>Savdo</span>
        </button>
        <button type="button" class="ko-bottom-nav-item ko-bottom-nav-fab-item" data-ko-nav="yangiBuyurtma">
          <span class="ko-bottom-nav-fab">${icon('plus')}</span>
          <span>Yangi buyurtma</span>
        </button>
        <button type="button" class="ko-bottom-nav-item ${activeKey === 'ombor' ? 'active' : ''}" data-ko-nav="ombor">
          ${icon('box')}
          <span>Ombor</span>
        </button>
        <button type="button" class="ko-bottom-nav-item ${activeKey === 'profil' ? 'active' : ''}" data-ko-nav="profil">
          ${icon('user')}
          <span>Profil</span>
        </button>
      </div>
    `;
  }

  // Barcha beshtasi ulangan: Bosh sahifa (joriy ekranning o'zi), Savdo
  // (renderCashflowScreen), Ombor (renderStockScreen) va Profil (15-bosqichda
  // qurilgan ekranlar), va Yangi buyurtma — egasi uchun ham server
  // (/api/create-order) 'egasi' rolini qabul qiladi, shu sababli kassir
  // uchun tayyor bo'lgan renderCashierScreen shu yerda qayta ishlatiladi,
  // faqat "← Orqaga" tugmasi bilan (kassirning o'z ekranida bu tugma yo'q,
  // chunki u uning doimiy bosh sahifasi).
  function wireKoBottomNav(profile) {
    const nav = document.getElementById('koBottomNav');
    if (!nav) return;
    const goBack = () => renderOwnerHomeScreen(profile);
    nav.querySelectorAll('[data-ko-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-ko-nav');
        if (key === 'bosh') return;
        if (key === 'savdo') { renderCashflowScreen(profile, goBack); return; }
        if (key === 'yangiBuyurtma') {
          cashierState.tab = 'yaratish';
          renderCashierScreen(profile.name, goBack);
          return;
        }
        if (key === 'ombor') { renderStockScreen(profile.name, 'egasi', goBack); return; }
        if (key === 'profil') { renderOwnerProfileScreen(profile, goBack); return; }
        console.log(`KitchenOS: pastki nav "${key}" (hali ulanmagan)`);
      });
    });
  }

  // =========================================================================
  // 18-bosqich: bell-badge (header'da) va "Bildirishnomalar" band-badge
  // (pastki navda) sonini serverdan dinamik yangilaydi. Alohida
  // bildirishnoma-ma'lumotlar bazasi hali yo'q (15-bosqichdagi izohga
  // qarang), shu sababli /api/dashboard-alerts natijasining uzunligi
  // (alerts.length) badge soni sifatida ishlatiladi — bu manba
  // loadKoAlertsList() orqali baribir har safar bosh sahifa ochilganda
  // yuklanadi, shuning uchun bu yerda alohida so'rov yubormay, o'sha
  // natijadan foydalanamiz (pastga qarang). Butun header/nav qayta render
  // qilinmaydi — faqat badge <span> qo'shiladi/yangilanadi/olib tashlanadi,
  // shu bilan allaqachon ulangan click-handler'lar (wireKoHomeHeader,
  // wireKoBottomNav) buzilmaydi.
  // =========================================================================
  function updateKoNotifBadges(count) {
    const bellBtn = document.getElementById('koHeaderBellBtn');
    if (bellBtn) {
      const existing = bellBtn.querySelector('.ko-home-header-bell-badge');
      if (count > 0) {
        if (existing) existing.textContent = String(count);
        else bellBtn.insertAdjacentHTML('beforeend', `<span class="ko-home-header-bell-badge">${count}</span>`);
      } else if (existing) {
        existing.remove();
      }
    }
    // Pastki navda "Bildirishnomalar" bandi "Ombor"ga almashtirilgani sababli,
    // bu yerda endi faqat header'dagi bell-badge yangilanadi.
  }

  // =========================================================================
  // 7-bosqich: KitchenOS bosh sahifa KPI-kartochkasi (icon + katta raqam +
  // foiz-delta). Bu yerda faqat komponentning o'zi va uning skeleton holati
  // bor — 4 tasini 2x2 grid'ga joylashtirib /api/dashboard-summary'ga ulash
  // 8-bosqichda qilinadi.
  // =========================================================================

  // Katta summalarni mockupdagi kabi qisqa ko'rinishga o'tkazadi: 12 450 000
  // -> "12.45M", 35 000 -> "35K". Million/ming chegarasidan pastdagi
  // qiymatlar (masalan buyurtmalar soni "356") xom son sifatida qaytadi.
  function koFormatCompact(n) {
    const num = Number(n || 0);
    const abs = Math.abs(num);
    if (abs >= 1000000) return (num / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (abs >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(num));
  }

  // Bugungi va kechagi qiymatdan foiz-delta hisoblaydi. Kecha 0 bo'lsa (va
  // bugun ham 0 bo'lsa) taqqoslash mantiqiy emas — shu holatda null qaytadi
  // va chaqiruvchi joy delta'ni umuman ko'rsatmaydi.
  function koFormatDelta(todayVal, yesterdayVal) {
    const y = Number(yesterdayVal || 0);
    const t = Number(todayVal || 0);
    if (y === 0) {
      if (t === 0) return null;
      return { tone: 'up', text: '+100%' };
    }
    const pct = ((t - y) / Math.abs(y)) * 100;
    const tone = pct >= 0 ? 'up' : 'down';
    const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
    return { tone, text: (pct >= 0 ? '+' : '') + rounded + '%' };
  }

  // iconName — icon-sprite'dagi nom, label — kichik sarlavha (masalan
  // "BUGUNGI SAVDO"), value — allaqachon formatlangan matn (masalan "12.45M"),
  // delta — koFormatDelta() natijasi (yoki null, agar ko'rsatilmasa).
  // 3-bosqich: cardId berilsa, kartochka bosiladigan (clickable) qilib
  // belgilanadi — chaqiruvchi tomon shu id orqali click listener ulaydi.
  function koKpiCardHtml(iconName, label, value, delta, cardId) {
    return `
      <div class="ko-kpi-card${cardId ? ' ko-kpi-clickable' : ''}"${cardId ? ` id="${cardId}"` : ''}>
        <div class="ko-kpi-label">${escapeHtml(label)}</div>
        <div class="ko-kpi-icon">${icon(iconName)}</div>
        <div class="ko-kpi-value">${escapeHtml(value)}</div>
        ${delta ? `
          <div class="ko-kpi-delta ${delta.tone}">
            ${delta.tone === 'up' ? icon('trending-up', 'icon-xs') : ''}
            <span>${escapeHtml(delta.text)}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  function koKpiSkeletonCardHtml(label) {
    return `
      <div class="ko-kpi-card skeleton-tile">
        <div class="ko-kpi-label">${escapeHtml(label)}</div>
        <div class="ko-kpi-icon">${icon('wallet')}</div>
        <div class="ko-kpi-value skeleton"></div>
        <div class="ko-kpi-delta skeleton"></div>
      </div>
    `;
  }

  // 4 ta skeleton-kartochkani 2x2 grid ichida qaytaradi — sahifa birinchi
  // chizilganda shu ko'rinadi, keyin loadKoKpiGrid() natija bilan almashtiradi.
  // 2-bosqich: "O'rtacha chek" kartochkasi olib tashlandi — 3-bosqichda
  // o'rniga "Kuryer hisoboti" kartochkasi qo'shiladi.
  function koKpiGridSkeletonHtml() {
    const labels = ['Bugungi savdo', 'Sof foyda', 'Buyurtmalar', 'Kuryer hisoboti'];
    return `<div class="ko-kpi-grid" id="koKpiGrid">${labels.map(koKpiSkeletonCardHtml).join('')}</div>`;
  }

  // Buyurtmalar soni uchun delta foizda emas, xom sondagi farq sifatida
  // ko'rsatiladi (mockupda "+18 ta"), chunki kichik sonlarda foiz
  // o'qilishi qiyin va real ma'no bermaydi.
  function koFormatCountDelta(todayVal, yesterdayVal) {
    const t = Number(todayVal || 0);
    const y = Number(yesterdayVal || 0);
    const diff = t - y;
    if (diff === 0) return null;
    const tone = diff > 0 ? 'up' : 'down';
    return { tone, text: (diff > 0 ? '+' : '') + diff + ' ta' };
  }

  // 8-bosqich: 4 ta KPI-kartochkani /api/dashboard-summary natijasidan
  // yasab, 2x2 grid ichida qaytaradi.
  // 3-bosqich: "O'rtacha chek" o'rniga "Kuryer hisoboti" — bugun kuryerlar
  // yetkazib bergan buyurtmalar soni. Bosilsa (loadKoKpiGrid'da ulanadi)
  // to'liq kuryer hisoboti ekraniga (har bir kuryer bo'yicha qator, tarix) o'tadi.
  function koKpiGridHtml(summary) {
    const cards = [
      koKpiCardHtml('wallet', 'Bugungi savdo',
        koFormatCompact(summary.todaySales),
        koFormatDelta(summary.todaySales, summary.yesterdaySales)),
      koKpiCardHtml('trending-up', 'Sof foyda',
        koFormatCompact(summary.todayNetProfit),
        koFormatDelta(summary.todayNetProfit, summary.yesterdayNetProfit)),
      koKpiCardHtml('clipboard', 'Buyurtmalar',
        koFormatCompact(summary.todayOrderCount),
        koFormatCountDelta(summary.todayOrderCount, summary.yesterdayOrderCount)),
      koKpiCardHtml('scooter', 'Kuryer hisoboti',
        koFormatCompact(summary.todayCourierDeliveries),
        koFormatCountDelta(summary.todayCourierDeliveries, summary.yesterdayCourierDeliveries),
        'koCourierCard')
    ];
    return `<div class="ko-kpi-grid" id="koKpiGrid">${cards.join('')}</div>`;
  }

  async function loadKoKpiGrid(profile) {
    const el = document.getElementById('koKpiGrid');
    if (!el) return;
    const res = await apiPost('/api/dashboard-summary', { initData });
    const el2 = document.getElementById('koKpiGrid');
    if (!el2) return; // foydalanuvchi allaqachon boshqa ekranga o'tgan bo'lishi mumkin
    if (res.networkError) {
      // koKpiGrid CSS grid (2 ustunli) ekanligi sababli xatolik holatini
      // to'g'ridan-to'g'ri shu konteyner ichiga qo'ymaymiz (grid katakchasiga
      // siqilib, noto'g'ri ko'rinardi) — avval oddiy kartochkaga almashtirib,
      // keyin renderNetworkErrorInline() shu yangi elementga ulanadi.
      el2.outerHTML = `<div class="kartochka" id="koKpiGrid"></div>`;
      renderNetworkErrorInline(document.getElementById('koKpiGrid'), res.reason, () => loadKoKpiGrid(profile));
      return;
    }
    if (!res.ok) {
      el2.outerHTML = `<div class="ko-kpi-grid" id="koKpiGrid"><div class="bosh">KPI ma'lumotlari yuklanmadi.</div></div>`;
      return;
    }
    el2.outerHTML = koKpiGridHtml(res.summary);

    // 5-bosqich: "Kuryer hisoboti" kartochkasiga bosilganda batafsil oyna —
    // har bir kuryer bo'yicha alohida qator va kassaga qaytarish tarixini
    // ko'rsatadigan mavjud ekran (renderCourierReportScreen, ilgari faqat
    // Moliya ichidan ochilar edi).
    const courierCard = document.getElementById('koCourierCard');
    if (courierCard) {
      courierCard.addEventListener('click', () => {
        renderCourierReportScreen(profile, () => renderOwnerHomeScreen(profile));
      });
    }
  }

  // =========================================================================
  // 9-bosqich: KitchenOS bosh sahifa "Bugungi holat" banneri — qizil
  // sarlavha ("BUGUNGI HOLAT" + "Barchasi" havolasi) va pastida 4 ustun
  // (icon + katta son + label): Yangi / Tayyorlanmoqda / Tayyor /
  // Kechikayotgan. Bu yerda faqat komponentning o'zi va skeleton holati —
  // /api/order-status-counts'ga ulash 10-bosqichda qilinadi.
  // =========================================================================
  const KO_STATUS_COLUMNS = [
    { key: 'yangi', icon: 'file-plus', label: 'Yangi' },
    { key: 'tayyorlanmoqda', icon: 'chef-hat', label: 'Tayyorlanmoqda' },
    { key: 'tayyor', icon: 'cloche', label: 'Tayyor' },
    { key: 'kechikayotgan', icon: 'clock', label: 'Kechikayotgan' }
  ];

  function koStatusColumnHtml(col, count) {
    return `
      <div class="ko-status-col" data-status-key="${col.key}">
        <div class="ko-status-col-label">${escapeHtml(col.label)}</div>
        <div class="ko-status-col-icon">${icon(col.icon)}</div>
        <div class="ko-status-col-value${count === null ? ' skeleton' : ''}">${count === null ? '' : escapeHtml(String(count))}</div>
      </div>
    `;
  }

  function koStatusBannerHtml(counts) {
    return `
      <div class="ko-status-banner kartochka" id="koStatusBanner">
        <div class="ko-status-banner-header">
          <span>BUGUNGI HOLAT</span>
          <button type="button" class="ko-status-banner-all" id="koStatusAllBtn">Barchasi <span class="ko-status-banner-all-chevron">›</span></button>
        </div>
        <div class="ko-status-banner-body">
          ${KO_STATUS_COLUMNS.map(col => koStatusColumnHtml(col, counts[col.key])).join('')}
        </div>
      </div>
    `;
  }

  function koStatusBannerSkeletonHtml() {
    return koStatusBannerHtml({ yangi: null, tayyorlanmoqda: null, tayyor: null, kechikayotgan: null })
      .replace('id="koStatusBanner"', 'id="koStatusBanner" data-loading="1"');
  }

  // "Barchasi" tugmasini buyurtmalar ekraniga ulaydi. Skeleton va real
  // holatning ikkalasida ham chaqiriladi (data hali kelmagan bo'lsa ham
  // "Barchasi" ishlashi kerak), shuning uchun renderni har safar (ham
  // skeleton, ham real HTML bilan almashtirilgach) alohida chaqiramiz.
  function wireKoStatusBanner(profile) {
    const btn = document.getElementById('koStatusAllBtn');
    if (btn) btn.addEventListener('click', () => renderKitchenScreen(profile.name, () => renderOwnerHomeScreen(profile)));
  }

  // 10-bosqich: "Bugungi holat" bannerini /api/order-status-counts
  // natijasiga ulaydi — skeletonni real sonlar bilan almashtiradi.
  async function loadKoStatusBanner(profile) {
    const el = document.getElementById('koStatusBanner');
    if (!el) return;
    const res = await apiPost('/api/order-status-counts', { initData });
    const el2 = document.getElementById('koStatusBanner');
    if (!el2) return; // foydalanuvchi allaqachon boshqa ekranga o'tgan bo'lishi mumkin
    if (res.networkError) { renderNetworkErrorInline(el2, res.reason, () => loadKoStatusBanner(profile)); return; }
    if (!res.ok) {
      el2.outerHTML = `<div class="ko-status-banner kartochka" id="koStatusBanner"><div class="bosh">Bugungi holat yuklanmadi.</div></div>`;
      return;
    }
    el2.outerHTML = koStatusBannerHtml(res.counts);
    wireKoStatusBanner(profile);
  }

  // =========================================================================
  // 11-bosqich: KitchenOS bosh sahifa asosiy menyu-grid — 2 qator x 5 ustun,
  // 10 ta icon+label tugma. Bu yerda faqat komponentning o'zi: har bir
  // tugma data-menu-key bilan belgilanadi, lekin ularni mavjud ekranlarga
  // ulash (bosilganda nima ochilishi) 12-bosqichda qilinadi.
  // =========================================================================
  const KO_MENU_ITEMS = [
    { key: 'savdo', icon: 'bar-chart', label: 'Savdo' },
    { key: 'oshxona', icon: 'chef-hat', label: 'Oshxona' },
    { key: 'ombor', icon: 'box', label: 'Ombor' },
    { key: 'xodimlar', icon: 'users', label: 'Xodimlar' },
    { key: 'moliya', icon: 'wallet', label: 'Moliya' },
    { key: 'yetkazibBerish', icon: 'scooter', label: "Yetkazib berish" },
    { key: 'filiallar', icon: 'store', label: 'Filiallar' },
    { key: 'stollarQR', icon: 'clipboard', label: 'Stollar uchun QR' },
    { key: 'hisobotlar', icon: 'clipboard', label: 'Hisobotlar' },
    { key: 'yordam', icon: 'message-circle', label: "Yordam so'rovlari" },
    { key: 'aiTavsiyalar', icon: 'ai', label: 'AI Tavsiyalar' },
    { key: 'obuna', icon: 'card', label: 'Obuna' },
    { key: 'sozlamalar', icon: 'settings', label: 'Sozlamalar' }
  ];

  function koMenuItemHtml(item) {
    return `
      <button type="button" class="ko-menu-item" data-menu-key="${item.key}">
        <span class="ko-menu-item-icon">${icon(item.icon)}</span>
        <span class="ko-menu-item-label">${escapeHtml(item.label)}</span>
      </button>
    `;
  }

  function koMenuGridHtml() {
    return `<div class="ko-menu-grid">${KO_MENU_ITEMS.map(koMenuItemHtml).join('')}</div>`;
  }

  // 12-bosqich (14-bosqichda kengaytirildi): har bir grid tugmasi va hamburger
  // yon-menyusi bandi bir xil manzillarga borishi kerak, shu sababli
  // navigatsiya funksiyalari shu yerda BIR MARTA belgilanadi va ikkalasi
  // ham shu obyektni qayta ishlatadi.
  // Aniq mos ekrani bor bandlar rejadagidek ulanadi: Oshxona, Ombor,
  // Xodimlar (nazorat ekrani), Moliya, Yetkazib berish, AI Tavsiyalar,
  // Bildirishnomalar, Profil, Yangi buyurtma (kassir ekrani, "← Orqaga" bilan).
  // Qolganlar uchun qaror:
  //  - Savdo: alohida "savdo" ekrani yo'q — eng yaqin mos ekran Moliya bilan
  //    bir xil (renderCashflowScreen), chunki savdo dinamikasi grafigi va
  //    davr tanlash (Bugun/Hafta/Oy) allaqachon o'sha yerda.
  //  - Hisobotlar: kunlik yakuniy Z-hisobot ekrani (renderZReportScreen)
  //    "hisobot" ma'nosiga to'g'ridan-to'g'ri mos keladi.
  //  - Filiallar: alohida ekran kerak emas — "Bosh" tabining o'zida
  //    Filiallar bo'limi allaqachon bor, shu sababli faqat o'sha bo'limga
  //    scroll qilinadi (yangi ekran ochilmaydi).
  //  - Sozlamalar: do'kon profilini tahrirlash formasi (renderProfileForm)
  //    — mavjud "Profilni tahrirlash" tugmasi bilan bir xil maqsad.
  function koNavHandlers(profile) {
    const goBack = () => renderOwnerHomeScreen(profile);
    return {
      savdo: () => renderCashflowScreen(profile, goBack),
      yangiBuyurtma: () => {
        cashierState.tab = 'yaratish';
        renderCashierScreen(profile.name, goBack);
      },
      oshxona: () => renderKitchenScreen(profile.name, goBack),
      ombor: () => renderStockScreen(profile.name, 'egasi', goBack),
      xodimlar: () => renderStaffControlScreen(profile, goBack),
      moliya: () => renderCashflowScreen(profile, goBack),
      yetkazibBerish: () => renderDeliveryScreen(profile.name, goBack),
      filiallar: () => {
        const target = document.getElementById('koBranchesSectionLabel');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      stollarQR: () => renderTableQrScreen(profile, goBack),
      hisobotlar: () => renderZReportScreen(profile, goBack),
      yordam: () => renderSupportInboxScreen(profile, goBack),
      aiTavsiyalar: () => renderAiScreen(profile, goBack),
      bildirishnomalar: () => renderNotificationsScreen(profile, goBack),
      profil: () => renderOwnerProfileScreen(profile, goBack),
      obuna: () => renderOwnerSubscriptionScreen(profile, goBack),
      sozlamalar: () => renderProfileForm(profile)
    };
  }

  function wireKoMenuGrid(profile) {
    const grid = document.querySelector('.ko-menu-grid');
    if (!grid) return;
    const handlers = koNavHandlers(profile);
    grid.querySelectorAll('[data-menu-key]').forEach(btn => {
      const fn = handlers[btn.getAttribute('data-menu-key')];
      if (fn) btn.addEventListener('click', fn);
    });
  }

  // =========================================================================
  // 14-bosqich: hamburger yon-menyu (sidebar). koMenuGridHtml() bilan bir xil
  // manzillarga o'tadi (koNavHandlers orqali), ustiga "Bosh sahifa" va
  // "Yangi buyurtma" bandlari qo'shilgan — chunki sidebar istalgan ekrandan
  // ochilishi mumkin bo'lgan to'liq navigatsiya deb mo'ljallangan, faqat
  // Bosh sahifadagi katakchalar ro'yxati emas.
  //
  // #app'ning O'ZIDAN TASHQARIDA (document.body farzandi sifatida)
  // qo'shiladi — shu sababli ekran(html) #app ichini qayta chizsa ham
  // (masalan foydalanuvchi biror bandni bosib boshqa ekranga o'tsa) sidebar
  // avval closeKoSidebar() bilan olib tashlanadi, keyin navigatsiya sodir
  // bo'ladi — osilib qolgan overlay bo'lmaydi.
  // =========================================================================
  const KO_SIDEBAR_ITEMS = [
    { key: 'bosh', icon: 'home', label: 'Bosh sahifa' },
    { key: 'yangiBuyurtma', icon: 'plus', label: 'Yangi buyurtma' },
    { key: 'savdo', icon: 'bar-chart', label: 'Savdo' },
    { key: 'oshxona', icon: 'chef-hat', label: 'Oshxona' },
    { key: 'ombor', icon: 'box', label: 'Ombor' },
    { key: 'xodimlar', icon: 'users', label: 'Xodimlar' },
    { key: 'moliya', icon: 'wallet', label: 'Moliya' },
    { key: 'yetkazibBerish', icon: 'scooter', label: "Yetkazib berish" },
    { key: 'filiallar', icon: 'store', label: 'Filiallar' },
    { key: 'stollarQR', icon: 'clipboard', label: 'Stollar uchun QR' },
    { key: 'hisobotlar', icon: 'clipboard', label: 'Hisobotlar' },
    { key: 'yordam', icon: 'message-circle', label: "Yordam so'rovlari" },
    { key: 'aiTavsiyalar', icon: 'ai', label: 'AI Tavsiyalar' },
    { key: 'bildirishnomalar', icon: 'bell', label: 'Bildirishnomalar' },
    { key: 'profil', icon: 'user', label: 'Profil' },
    { key: 'obuna', icon: 'card', label: 'Obuna' },
    { key: 'sozlamalar', icon: 'settings', label: 'Sozlamalar' }
  ];

  function koSidebarItemHtml(item) {
    return `
      <button type="button" class="ko-sidebar-item" data-sidebar-key="${item.key}">
        <span class="ko-sidebar-item-icon">${icon(item.icon)}</span>
        <span>${escapeHtml(item.label)}</span>
      </button>
    `;
  }

  function koSidebarHtml(profile) {
    return `
      <div class="ko-sidebar-overlay" id="koSidebarOverlay">
        <div class="ko-sidebar" id="koSidebar" role="dialog" aria-label="Menyu">
          <div class="ko-sidebar-header">
            <div class="ko-sidebar-header-logo">${icon('chef-hat', 'icon-md')}</div>
            <div class="ko-sidebar-header-titles">
              <div class="ko-sidebar-header-title">${escapeHtml(profile.name || '')}</div>
              <div class="ko-sidebar-header-subtitle">Oshxona Menejeri</div>
            </div>
            <button type="button" class="ko-sidebar-close-btn" id="koSidebarCloseBtn" aria-label="Yopish">${icon('x')}</button>
          </div>
          <nav class="ko-sidebar-nav">${KO_SIDEBAR_ITEMS.map(koSidebarItemHtml).join('')}</nav>
        </div>
      </div>
    `;
  }

  function closeKoSidebar() {
    const overlay = document.getElementById('koSidebarOverlay');
    if (overlay) overlay.remove();
  }

  function openKoSidebar(profile) {
    if (document.getElementById('koSidebarOverlay')) return; // allaqachon ochiq
    document.body.insertAdjacentHTML('beforeend', koSidebarHtml(profile));
    const overlay = document.getElementById('koSidebarOverlay');
    const handlers = koNavHandlers(profile);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeKoSidebar(); });
    document.getElementById('koSidebarCloseBtn').addEventListener('click', closeKoSidebar);
    overlay.querySelectorAll('[data-sidebar-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sidebar-key');
        closeKoSidebar();
        if (key === 'bosh') { renderOwnerHomeScreen(profile); return; }
        const fn = handlers[key];
        if (fn) fn();
      });
    });
  }

  // =========================================================================
  // 13-bosqich: KitchenOS bosh sahifa "Muhim ogohlantirishlar" ro'yxati —
  // /api/dashboard-alerts natijasidagi har bir element uchun: turi bo'yicha
  // rangli icon (xato=qizil, ogohlantirish=sariq, info=ko'k), matn,
  // son-badge (agar count berilgan bo'lsa) va chevron. Bosilganda alert
  // o'zining `screen` maydoniga qarab tegishli ekranga o'tkazadi.
  // =========================================================================
  const KO_ALERT_LEVEL_ICON = { error: 'warning', warning: 'warning', info: 'info' };

  function koAlertItemHtml(alert, index) {
    return `
      <div class="ko-alert-item" data-alert-index="${index}">
        <span class="ko-alert-icon ${alert.level}">${icon(KO_ALERT_LEVEL_ICON[alert.level] || 'info')}</span>
        <span class="ko-alert-text">${escapeHtml(alert.text)}</span>
        ${alert.count !== null && alert.count !== undefined ? `<span class="ko-alert-count-badge">${escapeHtml(String(alert.count))}</span>` : ''}
        <span class="ko-alert-chevron">›</span>
      </div>
    `;
  }

  function koAlertsListHtml(alerts) {
    const body = (alerts && alerts.length)
      ? alerts.map((a, i) => koAlertItemHtml(a, i)).join('')
      : `<div class="ko-alert-empty">${icon('check-circle', 'icon-xs')} Hozircha muhim ogohlantirish yo'q.</div>`;
    return `
      <div class="ko-alerts-card kartochka" id="koAlertsList">
        <div class="section-label">Muhim ogohlantirishlar</div>
        ${body}
      </div>
    `;
  }

  function koAlertsListSkeletonHtml() {
    return `
      <div class="ko-alerts-card kartochka" id="koAlertsList" data-loading="1">
        <div class="section-label">Muhim ogohlantirishlar</div>
        <div class="ko-alert-item skeleton-row"><div class="skeleton-line w-60"></div></div>
        <div class="ko-alert-item skeleton-row"><div class="skeleton-line w-40"></div></div>
      </div>
    `;
  }

  // `screen` qiymatini haqiqiy navigatsiyaga aylantiradi (backend'dagi
  // /api/dashboard-alerts izohiga qarang: ombor / buyurtmalar_kechikkan / zreport).
  function koAlertScreenRoute(profile, screenKey) {
    const goBack = () => renderOwnerHomeScreen(profile);
    if (screenKey === 'ombor') return () => renderStockScreen(profile.name, 'egasi', goBack);
    if (screenKey === 'buyurtmalar_kechikkan') return () => renderKitchenScreen(profile.name, goBack);
    if (screenKey === 'zreport') return () => renderZReportScreen(profile, goBack);
    return null;
  }

  function wireKoAlertsList(profile, alerts) {
    const list = document.getElementById('koAlertsList');
    if (!list) return;
    list.querySelectorAll('[data-alert-index]').forEach(row => {
      const alert = alerts[Number(row.getAttribute('data-alert-index'))];
      const route = alert && koAlertScreenRoute(profile, alert.screen);
      if (route) row.addEventListener('click', route);
    });
  }

  async function loadKoAlertsList(profile) {
    const el = document.getElementById('koAlertsList');
    if (!el) return;
    const res = await apiPost('/api/dashboard-alerts', { initData });
    const el2 = document.getElementById('koAlertsList');
    if (!el2) return; // foydalanuvchi allaqachon boshqa ekranga o'tgan bo'lishi mumkin
    if (res.networkError) { renderNetworkErrorInline(el2, res.reason, () => loadKoAlertsList(profile)); return; }
    if (!res.ok) {
      el2.outerHTML = `<div class="ko-alerts-card kartochka" id="koAlertsList"><div class="section-label">Muhim ogohlantirishlar</div><div class="bosh">Yuklanmadi.</div></div>`;
      // Xatolik holatida badge sonini eskicha (yuklanmagan) holatda
      // qoldiramiz — noto'g'ri "0" ko'rsatib, bor ogohlantirishni
      // yashirib qo'ymaslik uchun bu yerda updateKoNotifBadges chaqirilmaydi.
      return;
    }
    el2.outerHTML = koAlertsListHtml(res.alerts);
    wireKoAlertsList(profile, res.alerts);
    updateKoNotifBadges(res.alerts.length);
  }

  // =========================================================================
  // 15-bosqich: "Bildirishnomalar" — to'liq ekranli ro'yxat. Alohida
  // bildirishnoma-ma'lumotlar bazasi hali yo'q, shu sababli 13-bosqichdagi
  // /api/dashboard-alerts'ning o'zi qayta ishlatiladi (bir xil ma'lumot,
  // header'dagi bell va bu ekran bir xil manbadan keladi — 18-bosqichda
  // badge soni ham shu yerdan olinadi). Har bir band bosilganda
  // koAlertScreenRoute() orqali tegishli ekranga o'tadi (12/13-bosqichdagi
  // bilan bir xil xaritalash).
  // =========================================================================
  function koNotificationsListHtml(alerts) {
    return (alerts && alerts.length)
      ? alerts.map((a, i) => koAlertItemHtml(a, i)).join('')
      : `<div class="ko-alert-empty">${icon('check-circle', 'icon-xs')} Hozircha bildirishnoma yo'q.</div>`;
  }

  function renderNotificationsScreen(profile, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Bildirishnomalar</div>
        <button class="btn ikkinchi" id="notifBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka" id="notifList"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);
    document.getElementById('notifBackBtn').addEventListener('click', () => onBack && onBack());
    loadNotificationsList(profile);
  }

  async function loadNotificationsList(profile) {
    const el = document.getElementById('notifList');
    if (!el) return;
    const res = await apiPost('/api/dashboard-alerts', { initData });
    const el2 = document.getElementById('notifList');
    if (!el2) return; // foydalanuvchi allaqachon boshqa ekranga o'tgan bo'lishi mumkin
    if (res.networkError) { renderNetworkErrorInline(el2, res.reason, () => loadNotificationsList(profile)); return; }
    if (!res.ok) {
      el2.innerHTML = `<div class="bosh">Bildirishnomalar yuklanmadi.</div>`;
      return;
    }
    el2.innerHTML = koNotificationsListHtml(res.alerts);
    el2.querySelectorAll('[data-alert-index]').forEach(row => {
      const alert = res.alerts[Number(row.getAttribute('data-alert-index'))];
      const route = alert && koAlertScreenRoute(profile, alert.screen);
      if (route) row.addEventListener('click', route);
    });
  }

  // =========================================================================
  // 15-bosqich: "Profil" ekrani — "Do'kon ma'lumotlari" bo'limi "bosh"
  // tabidan shu yerga ko'chirildi (endi u yerda ikki marta ko'rsatilmaydi).
  //
  // MA'LUM CHEKLOV: "Profilni tahrirlash" tugmasi mavjud renderProfileForm()
  // ekranini ochadi — u saqlagach doim renderOwnerHomeScreen(profile) (Bosh
  // sahifa)ga qaytaradi, Profil ekraniga emas, chunki forma ichidagi
  // navigatsiya shunday yozilgan (bu joyning o'zgarishi emas).
  // =========================================================================
  function renderOwnerProfileScreen(profile, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Profil</div>
        <button class="btn ikkinchi" id="profileBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="section-label">${icon('building', 'icon-xs')} Do'kon ma'lumotlari</div>
        <div class="kartochka">
          <div class="profile-view">
            ${profile.logoUrl ? `<img class="logo-preview" src="${escapeHtml(profile.logoUrl)}" onerror="this.style.display='none'">` : ''}
            <div class="info">
              <div class="profile-row"><b>Manzil:</b> ${escapeHtml(profile.address)}</div>
              <div class="profile-row"><b>Telefon:</b> ${escapeHtml(profile.phone)}</div>
              ${profile.workHours ? `<div class="profile-row"><b>Ish vaqti:</b> ${escapeHtml(profile.workHours)}</div>` : ''}
            </div>
          </div>
          <button class="btn ikkinchi" id="editProfileBtn" style="margin-top:14px;">Profilni tahrirlash</button>
        </div>
        <div class="section-label" style="margin-top:18px;">${icon('bell', 'icon-xs')} Push-bildirishnoma sozlamalari</div>
        <div class="kartochka" id="notifPrefsCard"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);
    document.getElementById('profileBackBtn').addEventListener('click', () => onBack && onBack());
    document.getElementById('editProfileBtn').addEventListener('click', () => renderProfileForm(profile));
    loadNotificationPrefs();
  }

  // ---- 59-bosqich: egasi qaysi toifadagi shaxsiy xabarlarni (yangi
  // buyurtma, kam qoldiq) botdan olishini o'zi yoqib/o'chira oladi. ----
  async function loadNotificationPrefs() {
    const card = document.getElementById('notifPrefsCard');
    if (!card) return;
    const res = await apiPost('/api/notification-prefs-get', { initData });
    const card2 = document.getElementById('notifPrefsCard');
    if (!card2) return;
    if (res.networkError) { renderNetworkErrorInline(card2, res.reason, loadNotificationPrefs); return; }
    if (!res.ok) { card2.innerHTML = `<div class="bosh">Sozlamalar yuklanmadi.</div>`; return; }
    card2.innerHTML = res.categories.map(c => `
      <label class="toggle-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;">
        <span>${escapeHtml(c.label)}</span>
        <input type="checkbox" data-notif-key="${c.key}" ${res.prefs[c.key] ? 'checked' : ''}>
      </label>
    `).join('');
    card2.querySelectorAll('[data-notif-key]').forEach(cb => {
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        const key = cb.getAttribute('data-notif-key');
        const saveRes = await apiPost('/api/notification-prefs-save', { initData, prefs: { [key]: cb.checked } });
        cb.disabled = false;
        if (!saveRes.ok) { cb.checked = !cb.checked; alert(saveRes.reason || 'Saqlanmadi, qayta urinib ko\'ring.'); }
      });
    });
  }

  // =========================================================================
  // 82-BOSQICH: "💳 Obuna" — egasi o'zi tarif tanlab, to'lov skrinshotini
  // botga yuboradi -> admin tasdiqlagach obuna muddati AVTOMATIK uzayadi.
  // Skrinshotning o'zi Mini App'dan emas, botning shaxsiy chatiga oddiy RASM
  // qilib yuboriladi (server.js'dagi photo-listener shuni kutib turadi) -
  // shu sababli bu ekran faqat "tarif tanlash" va "holatni kuzatish" qiladi.
  // =========================================================================
  function subStatusLabel(status, inGrace) {
    if (status === 'active') return inGrace ? "⏳ Muhlat davrida" : '✅ Faol';
    if (status === 'pending_trial') return "🕓 Tasdiqlanishi kutilmoqda";
    if (status === 'blocked') return '⛔ Bloklangan';
    return status || '—';
  }

  async function renderOwnerSubscriptionScreen(profile, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">💳 Obuna</div>
        <button class="btn ikkinchi" id="subBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka" id="subStatusCard"><div class="bosh">Yuklanmoqda...</div></div>
        <div class="kartochka" id="subRequisitesCard" style="display:none;"></div>
        <div class="kartochka" id="subPlansCard" style="display:none;"></div>
        <div class="kartochka" id="subHistoryCard">
          <h2>Obuna tarixi</h2>
          <div id="subHistoryList"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
      </div>
    `);
    document.getElementById('subBackBtn').addEventListener('click', () => onBack && onBack());
    await loadOwnerSubscriptionStatus(onBack);
    await loadOwnerSubscriptionHistory();
  }

  // 15-bosqich (B-bo'lim): egasi o'ziga tegishli barcha o'tgan obuna
  // to'lovlarini (tasdiqlangan, muddatni uzaytirgan) shu yerda ko'radi.
  async function loadOwnerSubscriptionHistory() {
    const listEl = document.getElementById('subHistoryList');
    if (!listEl) return;
    const res = await apiPost('/api/subscription-history', { initData });
    if (!res.ok) { listEl.innerHTML = `<div class="bosh">Yuklab bo'lmadi.</div>`; return; }
    if (!res.history || !res.history.length) {
      listEl.innerHTML = `<div class="bosh">Hali to'lov tarixi yo'q.</div>`;
      return;
    }
    listEl.innerHTML = res.history.map(h => `
      <div class="owner-item">
        <div>
          <div class="owner-id">${escapeHtml(h.planLabel || 'Obuna')}</div>
          <div class="owner-username">${new Date(h.at).toLocaleDateString('uz-UZ')}${h.days ? ` · ${h.days} kun` : ''}</div>
        </div>
        <div class="owner-id">${fmtNum(h.amount)} so'm</div>
      </div>
    `).join('');
  }

  // To'lov rekvizitlari (admin kartasi) kartochkasini chizadi va "Nusxalash"
  // tugmasini ulaydi. Ilgari bu markup to'g'ridan-to'g'ri
  // loadOwnerSubscriptionStatus() ichida, faqat "so'rov yo'q" holatida
  // chizilardi va boshqa holatlarda karta butunlay yashirilardi — endi
  // bitta joyda, har doim chaqiriladi.
  function renderPaymentRequisitesCard(requisitesCard, requisites) {
    if (!requisitesCard) return;
    requisitesCard.style.display = '';
    requisitesCard.innerHTML = `
      <div class="section-label">To'lov rekvizitlari</div>
      <div class="profile-row"><b>Ism-familya:</b> ${escapeHtml(requisites.cardHolder)}</div>
      <div class="profile-row" style="margin-bottom:0;"><b>Karta raqami:</b></div>
      <div class="link-box" style="margin-top:6px;">
        <span id="subCardNumberText">${escapeHtml(requisites.cardNumber)}</span>
        <button id="subCopyCardBtn" type="button">${icon('clipboard', 'icon-xs')}<span>Nusxalash</span></button>
      </div>
      <div class="xabar" id="subCopyCardMsg"></div>
    `;
    const copyBtn = document.getElementById('subCopyCardBtn');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const msgEl = document.getElementById('subCopyCardMsg');
      const rawNumber = (requisites.cardNumber || '').replace(/\s+/g, '');
      const showMsg = (text, ok) => { if (msgEl) { msgEl.textContent = text; msgEl.className = 'xabar ' + (ok ? 'ok' : 'err'); } };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(rawNumber).then(() => {
          showMsg('Karta raqami nusxalandi.', true);
        }).catch(() => {
          showMsg('Nusxalab bo\'lmadi, raqamni qo\'lda ko\'chiring.', false);
        });
      } else {
        showMsg('Nusxalab bo\'lmadi, raqamni qo\'lda ko\'chiring.', false);
      }
    });
  }

  async function loadOwnerSubscriptionStatus(onBack) {
    const statusCard = document.getElementById('subStatusCard');
    const requisitesCard = document.getElementById('subRequisitesCard');
    const plansCard = document.getElementById('subPlansCard');
    if (!statusCard) return;
    const res = await apiPost('/api/subscription-status', { initData });
    if (!res.ok) {
      statusCard.innerHTML = `<div class="xabar err">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
      return;
    }

    const untilText = res.subscriptionUntil ? new Date(res.subscriptionUntil).toLocaleDateString('uz-UZ') : 'Muddatsiz';
    statusCard.innerHTML = `
      <div class="section-label">Joriy holat</div>
      <div class="profile-row"><b>Holat:</b> ${subStatusLabel(res.status, res.inGrace)}</div>
      <div class="profile-row"><b>Muddat:</b> ${escapeHtml(untilText)}</div>
      ${(res.daysLeft !== null && res.daysLeft !== undefined) ? `<div class="profile-row"><b>Qolgan kun:</b> ${escapeHtml(String(res.daysLeft))}</div>` : ''}
    `;

    // MUHIM TUZATISH: ilgari tarif tanlangач (yoki skrinshot yuborilgach)
    // to'lov rekvizitlari (admin kartasi) BUTUNLAY yashirilardi
    // (requisitesCard.style.display = 'none') — natijada egasi to'lov
    // qilish jarayonida karta raqamini qayta ko'ra olmasdi. Endi bu karta
    // HAR DOIM ko'rinadi (pastda, "So'rov holati"dan keyin), va karta
    // raqamini bitta bosishda nusxalab olish mumkin.
    renderPaymentRequisitesCard(requisitesCard, res.requisites);

    const req = res.pendingRequest;

    // Tarif tanlangan, lekin skrinshot hali yuborilmagan - botga o'tishni eslatamiz.
    if (req && req.status === 'kutilmoqda_skrinshot') {
      plansCard.style.display = '';
      plansCard.innerHTML = `
        <div class="section-label">Tanlangan reja: ${escapeHtml(req.planLabel)} (${fmtNum(req.amount)} so'm)</div>
        ${req.tariffLabel ? `<div class="bosh">Tarif: ${escapeHtml(req.tariffLabel)}</div>` : ''}
        <div class="bosh">To'lov chekining (skrinshotning) RASMINI botning shaxsiy chatiga yuboring — administrator tekshirib tasdiqlagach, obunangiz avtomatik yangilanadi.</div>
        ${res.botUsername ? `<button class="btn ikkinchi" id="subOpenBotBtn" style="margin-top:10px;">Botni ochish</button>` : ''}
      `;
      const openBtn = document.getElementById('subOpenBotBtn');
      if (openBtn) openBtn.addEventListener('click', () => {
        if (window.Telegram && Telegram.WebApp && Telegram.WebApp.openTelegramLink) {
          Telegram.WebApp.openTelegramLink(`https://t.me/${res.botUsername}`);
        }
      });
      return;
    }

    // Skrinshot yuborilgan, admin tasdig'i kutilmoqda.
    if (req && req.status === 'kutilmoqda_tasdiq') {
      plansCard.style.display = '';
      plansCard.innerHTML = `
        <div class="section-label">🕓 Tasdiqlanishi kutilmoqda</div>
        <div class="bosh">Reja: ${escapeHtml(req.planLabel)} — ${fmtNum(req.amount)} so'm${req.tariffLabel ? ' · Tarif: ' + escapeHtml(req.tariffLabel) : ''}. Skrinshotingiz administratorga yuborildi, tasdiqlanishini kuting.</div>
      `;
      return;
    }

    // So'rov yo'q (yoki avvalgisi tasdiqlangan/rad etilgan) - yangi tarif tanlash imkoni.
    plansCard.style.display = '';
    const rejectedNote = (req && req.status === 'rad_etildi')
      ? `<div class="xabar err" style="margin-bottom:10px;">Oldingi so'rovingiz (${escapeHtml(req.planLabel)}) rad etilgan. Qaytadan tarif tanlang.</div>`
      : '';
    plansCard.innerHTML = `
      <div class="section-label">Tarif tanlang</div>
      ${rejectedNote}
      <div id="subPlansList">
        ${res.plans.map(p => `
          <div class="owner-item" data-plan-row="${escapeHtml(p.id)}">
            <div>
              <div class="owner-id">${escapeHtml(p.label)}</div>
              <div class="owner-username">${fmtNum(p.price)} so'm${p.discountNote ? ' · ' + escapeHtml(p.discountNote) : ''}</div>
              ${p.tariffLabel ? `<div class="owner-username">${icon('star', 'icon-xs icon-muted')} Tarif: ${escapeHtml(p.tariffLabel)}</div>` : ''}
            </div>
            <button class="btn" data-plan-id="${escapeHtml(p.id)}" style="width:auto; min-height:36px; padding:6px 14px;">Tanlash</button>
          </div>
        `).join('')}
      </div>
    `;
    const listEl = document.getElementById('subPlansList');
    if (listEl) listEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-plan-id]');
      if (!btn) return;
      const planId = btn.getAttribute('data-plan-id');
      btn.disabled = true;
      const selRes = await apiPost('/api/subscription-select-plan', { initData, planId });
      if (!selRes.ok) {
        alert(selRes.reason || 'Xatolik yuz berdi.');
        btn.disabled = false;
        return;
      }
      await loadOwnerSubscriptionStatus(onBack);
    });
  }

  // =========================================================================
  // 16-bosqich: "Bosh sahifa" — mustaqil ekran funksiyasi. Ilgari shu kontent
  // renderProfileView(profile) ichidagi "bosh" tabida yashar edi; endi u
  // yerdan olib tashlanib, shu funksiyaga ko'chirildi va navigatsiyaning
  // haqiqiy boshlang'ich nuqtasiga aylandi: login/onboarding tugagach hamda
  // barcha "bosh sahifaga qaytish" callback'lari (pastki nav, "Bugungi
  // holat → Barchasi", ogohlantirish bandlari, menyu-grid, header
  // qo'ng'irog'i) endi shu funksiyani chaqiradi — renderProfileView(profile)
  // emas.
  //
  // 20-bosqich: renderProfileView butunlay olib tashlandi (o'lik kod edi,
  // hech qayerdan chaqirilmasdi). Undagi 3 ta eski tab yangi joylarga
  // ko'chirildi: "menyu"/"moliya" tabidagi taom, aksiya, bonus va dostavka
  // guruhi bo'limlari renderProfileForm() (Sozlamalar) ichiga, "xodimlar"
  // tabidagi xodim qo'shish/ro'yxati esa renderStaffControlScreen()
  // (Xodimlar) ichiga.
  // =========================================================================
  function renderOwnerHomeScreen(profile) {
    // Rasmda faqat bitta (qizil, KitchenOS uslubidagi) header bor — shu
    // sababli umumiy app-shell header (setAppHeader, boshqa barcha
    // ekranlarda ishlatiladi) shu ekranda ko'rsatilmaydi, o'rniga faqat
    // koHomeHeaderHtml() qoladi.
    clearAppHeader();
    // 18-bosqich: bu yerdagi "0" — dastlabki (ma'lumot hali kelmagan) holat,
    // pastdagi loadKoAlertsList() natijasi kelgach updateKoNotifBadges()
    // orqali haqiqiy songa almashtiriladi (shu sababli boshida hech qanday
    // badge ko'rinmaydi, keyin kerak bo'lsa paydo bo'ladi).
    ekran(`
      <div class="panel has-ko-bottom-nav ko-home-panel">
        ${koHomeHeaderHtml(0, profile.name)}
        ${koKpiGridSkeletonHtml()}
        ${koStatusBannerSkeletonHtml()}
        ${koMenuGridHtml()}
        ${koAlertsListSkeletonHtml()}
        <div class="section-label" id="koBranchesSectionLabel">${icon('users', 'icon-xs')} Filiallar</div>
        <div class="kartochka">
          <h2>Filial qo'shish</h2>
          <input type="text" id="branchNameInput" placeholder="Filial nomi (masalan: Chilonzor filiali)">
          <input type="text" id="branchAddressInput" placeholder="Manzil">
          <input type="text" id="branchPhoneInput" placeholder="Telefon (ixtiyoriy)">
          <button class="btn" id="addBranchBtn">Filial qo'shish</button>
          <div class="xabar" id="branchMsg"></div>
        </div>
        <div class="kartochka">
          <h2>Filiallar</h2>
          <div class="owner-list" id="branchList"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        <div class="section-label">${icon('link', 'icon-xs')} Mijozlar bilan ishlash</div>
        <div class="kartochka">
          <h2>Mijozlar uchun menyu</h2>
          <div class="bosh">Mijozlar shu havola orqali chiroyli katalog-menyuni ochib, o'zlari buyurtma berishlari mumkin.</div>
          <button class="btn ikkinchi" id="getCustomerLinkBtn" style="margin-top:10px;">${icon('link', 'icon-xs')} Mijozlar havolasini olish</button>
          <div id="customerLinkWrap"></div>
          <div class="xabar" id="customerLinkMsg"></div>
        </div>
      </div>
      ${koBottomNavHtml('bosh')}
    `);

    loadKoKpiGrid(profile);
    wireKoStatusBanner(profile);
    loadKoStatusBanner(profile);
    wireKoMenuGrid(profile);
    loadKoAlertsList(profile);
    wireKoHomeHeader(profile);
    wireKoBottomNav(profile);

    document.getElementById('addBranchBtn').addEventListener('click', async () => {
      const name = document.getElementById('branchNameInput').value.trim();
      const address = document.getElementById('branchAddressInput').value.trim();
      const phone = document.getElementById('branchPhoneInput').value.trim();
      const msgEl = document.getElementById('branchMsg');
      if (!name || !address) {
        msgEl.textContent = 'Filial nomi va manzilini kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Qo\'shilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/branch-add', { initData, name, address, phone });
      if (res.ok) {
        msgEl.textContent = 'Filial qo\'shildi.';
        msgEl.className = 'xabar ok';
        document.getElementById('branchNameInput').value = '';
        document.getElementById('branchAddressInput').value = '';
        document.getElementById('branchPhoneInput').value = '';
        loadBranchAndRender();
      } else {
        handleFeatureBlocked(res);
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    document.getElementById('branchList').addEventListener('click', async (e) => {
      const id = e.target.getAttribute('data-remove-branch-id');
      if (!id) return;
      e.target.disabled = true;
      await apiPost('/api/branch-remove', { initData, id });
      loadBranchAndRender();
    });

    document.getElementById('getCustomerLinkBtn').addEventListener('click', async () => {
      const msgEl = document.getElementById('customerLinkMsg');
      const wrap = document.getElementById('customerLinkWrap');
      msgEl.textContent = 'Yaratilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/customer-link', { initData });
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
        wrap.innerHTML = '';
        return;
      }
      msgEl.textContent = '';
      wrap.innerHTML = `
        <div class="link-box">
          <span>${escapeHtml(res.link)}</span>
          <button id="copyCustomerLinkBtn">Nusxalash</button>
        </div>
        <div class="customer-link-hint">Bu havolani mijozlaringizga (masalan, ijtimoiy tarmoqlarda yoki stol ustida QR kod qilib) ulashing.</div>
      `;
      document.getElementById('copyCustomerLinkBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(res.link).then(() => {
          msgEl.textContent = 'Havola nusxalandi.';
          msgEl.className = 'xabar ok';
        }).catch(() => {
          msgEl.textContent = 'Nusxalab bo\'lmadi, havolani qo\'lda ko\'chiring.';
          msgEl.className = 'xabar err';
        });
      });
    });

    loadBranchAndRender();
  }

  async function loadDeliveryGroupStatus() {
    const statusEl = document.getElementById('deliveryGroupStatus');
    const removeBtn = document.getElementById('removeDeliveryGroupBtn');
    if (!statusEl) return;
    const res = await apiPost('/api/delivery-group-status', { initData });
    if (res.ok && res.bound) {
      statusEl.innerHTML = `${icon('check', 'icon-xs icon-success')} Biriktirilgan: <b>${escapeHtml(res.groupTitle || 'guruh')}</b>`;
      if (removeBtn) removeBtn.classList.remove('hidden');
    } else {
      statusEl.textContent = '— Hali admin guruhi biriktirilmagan.';
      if (removeBtn) removeBtn.classList.add('hidden');
    }
  }

  // 13-bosqich: Oshpazlar guruhi holatini yuklaydi — dostavka guruhidan
  // mustaqil, alohida biriktiriladigan guruh.
  async function loadKitchenGroupStatus() {
    const statusEl = document.getElementById('kitchenGroupStatus');
    const removeBtn = document.getElementById('removeKitchenGroupBtn');
    if (!statusEl) return;
    const res = await apiPost('/api/kitchen-group-status', { initData });
    if (res.ok && res.bound) {
      statusEl.innerHTML = `${icon('check', 'icon-xs icon-success')} Biriktirilgan: <b>${escapeHtml(res.groupTitle || 'guruh')}</b>`;
      if (removeBtn) removeBtn.classList.remove('hidden');
    } else {
      statusEl.textContent = '— Hali Oshpazlar guruhi biriktirilmagan.';
      if (removeBtn) removeBtn.classList.add('hidden');
    }
  }

  // ==================== F. Bo'lim (kategoriya) boshqaruvi (36-40-bosqich) ====================
  // Egasi panelidagi "Bo'limlar" kartochkasi shu yerda boshqariladi. Yuklab
  // olingan ro'yxat `ownerCategoriesCache`da saqlanadi — shu bilan bir
  // vaqtda "Menyuga taom qo'shish" formasidagi select ham to'ldiriladi
  // (39-bosqich), alohida so'rov yubormasdan.
  let ownerCategoriesCache = [];

  function categoryListHtml(categories) {
    if (!categories || !categories.length) return `<div class="bosh">Hali bo'lim qo'shilmagan.</div>`;
    return categories.map((c, i) => `
      <div class="owner-item">
        <div class="owner-id">${escapeHtml(c.name)}</div>
        <div class="owner-actions">
          <button data-cat-up="${escapeHtml(c.id)}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-cat-down="${escapeHtml(c.id)}" ${i === categories.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-remove-cat-id="${escapeHtml(c.id)}">O'chirish</button>
        </div>
      </div>
    `).join('');
  }

  async function moveCategory(id, direction) {
    const ids = ownerCategoriesCache.map(c => c.id);
    const idx = ids.indexOf(id);
    const swapWith = idx + direction;
    if (idx < 0 || swapWith < 0 || swapWith >= ids.length) return;
    const tmp = ids[idx];
    ids[idx] = ids[swapWith];
    ids[swapWith] = tmp;
    await apiPost('/api/category-reorder', { initData, orderedIds: ids });
    loadCategoriesAndRender();
  }

  async function loadCategoriesAndRender() {
    const listEl = document.getElementById('categoryList');
    const selectEl = document.getElementById('menuCategoryInput');
    if (!listEl && !selectEl) return;
    const res = await apiPost('/api/category-list', { initData });
    ownerCategoriesCache = (res.ok && Array.isArray(res.categories)) ? res.categories : [];

    if (listEl) {
      listEl.innerHTML = categoryListHtml(ownerCategoriesCache);
      listEl.querySelectorAll('[data-remove-cat-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          await apiPost('/api/category-remove', { initData, id: btn.getAttribute('data-remove-cat-id') });
          loadCategoriesAndRender();
        });
      });
      listEl.querySelectorAll('[data-cat-up]').forEach(btn => {
        btn.addEventListener('click', () => moveCategory(btn.getAttribute('data-cat-up'), -1));
      });
      listEl.querySelectorAll('[data-cat-down]').forEach(btn => {
        btn.addEventListener('click', () => moveCategory(btn.getAttribute('data-cat-down'), 1));
      });
    }

    if (selectEl) {
      const prevVal = selectEl.value;
      selectEl.innerHTML = '<option value="">— Bo\'lim tanlanmagan —</option>' +
        ownerCategoriesCache.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
      selectEl.value = prevVal;
    }
  }

  function promoListHtml(promotions) {
    if (!promotions || !promotions.length) return `<div class="bosh">Hali aksiya qo'shilmagan.</div>`;
    return promotions.map(p => `
      <div class="owner-item" style="align-items:flex-start;">
        <div>
          <div class="owner-id">${escapeHtml(p.title)} — ${p.discountPercent}%</div>
          ${p.description ? `<div class="owner-username">${escapeHtml(p.description)}</div>` : ''}
          ${p.minTotal ? `<div class="owner-username">Min: ${fmtNum(p.minTotal)} so'm</div>` : ''}
        </div>
        <div class="owner-actions">
          <span class="badge ${p.active ? 'paid' : 'unpaid'}">${p.active ? 'Faol' : 'Nofaol'}</span>
          <button data-toggle-promo-id="${escapeHtml(p.id)}">${p.active ? 'To\'xtatish' : 'Yoqish'}</button>
          <button data-remove-promo-id="${escapeHtml(p.id)}">O'chirish</button>
        </div>
      </div>
    `).join('');
  }

  async function loadPromoAndRender() {
    const listEl = document.getElementById('promoList');
    if (!listEl) return;
    const res = await apiPost('/api/promo-list', { initData });
    if (res.networkError) { renderNetworkErrorInline(listEl, res.reason, loadPromoAndRender); return; }
    listEl.innerHTML = promoListHtml(res.ok ? res.promotions : []);
  }

  // 46-bosqich: bannerlar ro'yxati (egasi boshqaruv paneli) — promoListHtml
  // bilan bir xil kartochka ko'rinishi, farqi: rasm kichik ko'rinishda chap
  // tomonda, va sana oynasi (bor bo'lsa) ko'rsatiladi.
  function bannerListHtml(banners) {
    if (!banners || !banners.length) return `<div class="bosh">Hali banner qo'shilmagan.</div>`;
    return banners.map(b => `
      <div class="owner-item" style="align-items:flex-start;">
        <img src="${escapeHtml(b.imageUrl)}" alt="" style="width:56px; height:56px; border-radius:10px; object-fit:cover; flex-shrink:0; margin-right:10px;" onerror="this.style.visibility='hidden'">
        <div style="flex:1; min-width:0;">
          <div class="owner-id">${escapeHtml(b.title || "(sarlavhasiz)")}</div>
          ${b.link ? `<div class="owner-username">${escapeHtml(b.link)}</div>` : ''}
          ${(b.startAt || b.endAt) ? `<div class="owner-username">${b.startAt ? new Date(b.startAt).toLocaleDateString('uz-UZ') : '...'} — ${b.endAt ? new Date(b.endAt).toLocaleDateString('uz-UZ') : '...'}</div>` : ''}
        </div>
        <div class="owner-actions">
          <span class="badge ${b.active ? 'paid' : 'unpaid'}">${b.active ? 'Faol' : 'Nofaol'}</span>
          <button data-toggle-banner-id="${escapeHtml(b.id)}">${b.active ? 'To\'xtatish' : 'Yoqish'}</button>
          <button data-remove-banner-id="${escapeHtml(b.id)}">O'chirish</button>
        </div>
      </div>
    `).join('');
  }

  async function loadBannerAndRender() {
    const listEl = document.getElementById('bannerList');
    if (!listEl) return;
    const res = await apiPost('/api/banner-list', { initData });
    if (res.networkError) { renderNetworkErrorInline(listEl, res.reason, loadBannerAndRender); return; }
    listEl.innerHTML = bannerListHtml(res.ok ? res.banners : []);
  }

  async function loadBonusSettingsAndRender() {
    const enabledEl = document.getElementById('bonusEnabledInput');
    if (!enabledEl) return;
    const res = await apiPost('/api/bonus-settings-get', { initData });
    const settings = res.ok ? res.settings : { enabled: false, earnPercent: 5 };
    enabledEl.checked = !!settings.enabled;
    document.getElementById('bonusPercentInput').value = settings.earnPercent || '';
  }

  async function loadStaffAndRender() {
    const listEl = document.getElementById('staffList');
    if (!listEl) return;
    const res = await apiPost('/api/staff-list', { initData });
    if (res.networkError) { renderNetworkErrorInline(listEl, res.reason, loadStaffAndRender); return; }
    listEl.innerHTML = staffListHtml(res.ok ? res.staff : []);
  }

  function ownerMenuListHtml(menu) {
    if (!menu || !menu.length) return `<div class="bosh">Menyu hali bo'sh.</div>`;
    return menu.map(m => `
      <div class="menu-item">
        <div>
          <div class="m-name">${escapeHtml(m.name)} ${m.available === false ? '<span class="badge unpaid">Nofaol</span>' : ''}</div>
          ${m.category ? `<div class="m-cat">${escapeHtml(m.category)}</div>` : ''}
          <div class="m-price">${fmtNum(m.price)} so'm${m.directStockId ? ` · to'g'ridan sklad ${icon('check', 'icon-xs icon-success')}` : (m.recipe && m.recipe.length ? ` · retsept ${icon('check', 'icon-xs icon-success')}` : '')}</div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
          <button data-edit-menu-id="${escapeHtml(m.id)}" class="row-action-btn brand">Tahrirlash</button>
          ${m.directStockId ? '' : `<button data-recipe-menu-id="${escapeHtml(m.id)}" class="row-action-btn brand">Retsept</button>`}
          <button data-toggle-avail-id="${escapeHtml(m.id)}" class="row-action-btn brand">${m.available === false ? 'Faollashtirish' : 'Yashirish'}</button>
          <button data-remove-menu-id="${escapeHtml(m.id)}" class="row-action-btn danger">O'chirish</button>
        </div>
      </div>
    `).join('');
  }

  // ---- Menyuga taom qo'shish bo'limi — qayta ishlatiladigan blok (avval
  // faqat Sklad ekranida edi, endi Oshxona ekranida ham egasiga ko'rinadi) ----
  function menuAddSectionHtml() {
    return `
      <div class="section-label">${icon('restaurant', 'icon-xs')} Menyu</div>
      <div class="kartochka">
        <h2>Menyuga taom qo'shish</h2>
        <input type="text" id="menuNameInput" placeholder="Taom nomi">
        <input type="text" id="menuPriceInput" placeholder="Narxi (so'm)" inputmode="numeric">
        <label class="field-label">Bo'lim (ixtiyoriy)</label>
        <select id="menuCategoryInput"><option value="">— Bo'lim tanlanmagan —</option></select>
        <textarea id="menuDescriptionInput" placeholder="Tavsif (ixtiyoriy, mijozlar menyusida ko'rinadi)"></textarea>
        <input type="file" id="menuImageFileInput" accept="image/*" style="margin-top:8px;">
        <div class="staff-hint" style="margin-top:4px;">Rasmni telefon galereyasidan tanlang (ixtiyoriy)</div>
        <img id="menuImagePreview" class="logo-preview" style="display:none; width:120px; height:120px; margin-top:8px;">
        <input type="hidden" id="menuImageInput">

        <label class="field-label" style="margin-top:10px;">Turi</label>
        <select id="menuTypeInput">
          <option value="recipe">Tayyorlanadigan (retsept keyinroq belgilanadi)</option>
          <option value="direct">To'g'ridan skladdan (masalan: shishada suv)</option>
        </select>
        <div id="menuDirectStockWrap" class="hidden" style="margin-top:8px;">
          <label class="field-label">Sklad mahsuloti</label>
          <select id="menuDirectStockInput"><option value="">Yuklanmoqda...</option></select>
        </div>

        <button class="btn" id="addMenuBtn" style="margin-top:10px;">Qo'shish</button>
        <div class="xabar" id="menuMsg"></div>
      </div>
      <div class="kartochka">
        <h2>Menyu</h2>
        <div id="menuList"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `;
  }

  function attachMenuAddSectionHandlers() {
    document.getElementById('menuImageFileInput').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      const msgEl = document.getElementById('menuMsg');
      const preview = document.getElementById('menuImagePreview');
      if (!file) return;
      try {
        const dataUrl = await readImageFileAsCompressedDataUrl(file);
        document.getElementById('menuImageInput').value = dataUrl || '';
        preview.src = dataUrl;
        preview.style.display = 'block';
      } catch (err) {
        msgEl.textContent = err.message || 'Rasmni yuklab bo\'lmadi.';
        msgEl.className = 'xabar err';
        e.target.value = '';
      }
    });

    // "Turi" tanlovi — "To'g'ridan skladdan" tanlansa, markaziy skladdagi
    // mahsulotlar ro'yxati (bir marta) yuklanib, select to'ldiriladi.
    document.getElementById('menuTypeInput').addEventListener('change', (e) => {
      const wrap = document.getElementById('menuDirectStockWrap');
      const isDirect = e.target.value === 'direct';
      wrap.classList.toggle('hidden', !isDirect);
      if (isDirect) loadMenuDirectStockOptions();
    });

    document.getElementById('addMenuBtn').addEventListener('click', async () => {
      const name = document.getElementById('menuNameInput').value.trim();
      const price = document.getElementById('menuPriceInput').value.trim();
      const category = document.getElementById('menuCategoryInput').value.trim();
      const description = document.getElementById('menuDescriptionInput').value.trim();
      const imageUrl = document.getElementById('menuImageInput').value.trim();
      const menuType = document.getElementById('menuTypeInput').value;
      const directStockId = menuType === 'direct' ? document.getElementById('menuDirectStockInput').value : '';
      const msgEl = document.getElementById('menuMsg');
      if (!name || !price || !/^\d+$/.test(price) || parseInt(price, 10) <= 0) {
        msgEl.textContent = 'Taom nomi va to\'g\'ri narx kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Qo\'shilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/menu-add', { initData, name, price, category, description, imageUrl, directStockId });
      if (res.ok) {
        msgEl.textContent = 'Qo\'shildi.';
        msgEl.className = 'xabar ok';
        document.getElementById('menuNameInput').value = '';
        document.getElementById('menuPriceInput').value = '';
        document.getElementById('menuCategoryInput').value = '';
        document.getElementById('menuDescriptionInput').value = '';
        document.getElementById('menuImageInput').value = '';
        document.getElementById('menuImageFileInput').value = '';
        document.getElementById('menuImagePreview').style.display = 'none';
        document.getElementById('menuTypeInput').value = 'recipe';
        document.getElementById('menuDirectStockWrap').classList.add('hidden');
        loadMenuAndRender();
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    loadCategoriesAndRender();
    loadMenuAndRender();
  }

  async function loadMenuAndRender() {
    const listEl = document.getElementById('menuList');
    if (!listEl) return;
    const res = await apiPost('/api/menu-list', { initData });
    if (res.networkError) { renderNetworkErrorInline(listEl, res.reason, loadMenuAndRender); return; }
    const menu = res.ok ? res.menu : [];
    listEl.innerHTML = ownerMenuListHtml(menu);
    listEl.querySelectorAll('[data-remove-menu-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await apiPost('/api/menu-remove', { initData, id: btn.getAttribute('data-remove-menu-id') });
        loadMenuAndRender();
      });
    });
    listEl.querySelectorAll('[data-edit-menu-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit-menu-id');
        const menuItem = menu.find(m => m.id === id);
        if (menuItem) renderMenuItemEditOverlay(menuItem);
      });
    });
    listEl.querySelectorAll('[data-recipe-menu-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-recipe-menu-id');
        const menuItem = menu.find(m => m.id === id);
        if (menuItem) openRecipeEditor(menuItem);
      });
    });
    listEl.querySelectorAll('[data-toggle-avail-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-toggle-avail-id');
        const menuItem = menu.find(m => m.id === id);
        btn.disabled = true;
        await apiPost('/api/menu-update', { initData, id, available: menuItem ? menuItem.available === false : true });
        loadMenuAndRender();
      });
    });
  }

  // ---- Xodim (kassir/oshpaz/sklad/dostavka): rolga qarab tegishli ekranni ko'rsatadi ----
  // YANGI: bir nechta vakolatli xodim uchun "qaysi bo'limda ishlaysiz?" ekrani -
  // oshxona logotipi va "Xush kelibsiz!" yozuvi bilan (oddiy "Tekshirilmoqda..."
  // o'rniga - shu ekran endi shuning o'rnini bosadi, chunki bu vaqtga kelib
  // /api/verify allaqachon javob qaytargan, oshxona ma'lumotlari ma'lum).
  function renderStaffRolePicker(data) {
    clearAppHeader();
    applyBrandColor(data.ownerBrandColor);
    const restaurantName = data.ownerRestaurantName || 'Oshxona';
    const logoHtml = data.ownerLogoUrl
      ? `<img src="${escapeHtml(data.ownerLogoUrl)}" alt="" style="width:72px; height:72px; border-radius:50%; object-fit:cover; margin:0 auto 14px; display:block;">`
      : `<div style="width:72px; height:72px; margin:0 auto 14px; border-radius:50%; background:var(--brand-primary-light); display:flex; align-items:center; justify-content:center;">${icon('restaurant', 'icon-lg')}</div>`;
    ekran(`
      <div class="panel" style="text-align:center;">
        ${logoHtml}
        <div class="salom">Xush kelibsiz!</div>
        <div class="bosh" style="text-align:center;">
          <b>${escapeHtml(restaurantName)}</b> jamoasidasiz. Sizga bir nechta vakolat berilgan — qaysi bo'limda ishlaysiz?
        </div>
        <div class="kartochka" style="text-align:left; margin-top:14px;">
          ${data.roles.map(r => `
            <button type="button" class="btn ikkinchi role-pick-btn" data-role="${escapeHtml(r)}" style="width:100%; margin-bottom:8px; justify-content:flex-start; gap:10px;">
              ${icon(ROLE_ICONS[r] || 'user', 'icon-xs')}<span>${escapeHtml(ROLE_LABELS[r] || r)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `);
    document.querySelectorAll('.role-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosenRole = btn.getAttribute('data-role');
        const key = staffChosenRoleKey();
        if (key) localStorage.setItem(key, chosenRole);
        renderStaffScreen(chosenRole, ROLE_LABELS[chosenRole] || chosenRole, data.ownerRestaurantName, data.ownerLogoUrl, data.ownerBrandColor, data.roles);
      });
    });
  }

  function renderStaffScreen(role, roleLabel, restaurantName, logoUrl, brandColor, roles) {
    applyBrandColor(brandColor);
    // Bir nechta vakolati bo'lgan xodimga header'da "🔁 Rol almashtirish"
    // tugmasi ko'rsatiladi - bosilsa, tanlovi shu qurilmadan o'chiriladi va
    // ilova qaytadan "qaysi bo'limda ishlaysiz?" ekranini so'raydi.
    const multiRole = Array.isArray(roles) && roles.length > 1;
    setAppHeader(logoUrl, restaurantName, roleLabel, multiRole ? staffRoleSwitchHandler : null);
    if (role === 'kassir') {
      renderCashierScreen(restaurantName);
      return;
    }
    if (role === 'oshpaz') {
      renderKitchenScreen(restaurantName);
      return;
    }
    if (role === 'sklad') {
      currentStockRole = 'sklad';
      renderStockScreen(restaurantName, 'sklad', null);
      return;
    }
    if (role === 'dostavka') {
      renderDeliveryScreen(restaurantName);
      return;
    }
    ekran(`
      <div class="panel" style="text-align:center;">
        <div class="salom">Salom!</div>
        <div class="kartochka">
          <div class="bosh" style="text-align:center; font-size:15px;">
            Siz <b>${escapeHtml(restaurantName || 'oshxona')}</b> jamoasida
          </div>
          <div style="text-align:center; margin-top:10px;">
            <span class="role-badge" style="font-size:14px; padding:8px 16px;">${escapeHtml(roleLabel)}</span>
          </div>
          <div class="bosh" style="text-align:center; margin-top:14px;">
            Sizning ish bo'limingiz tez orada shu yerga qo'shiladi.
          </div>
        </div>
      </div>
    `);
  }

  // "🔁" tugmasi bosilganda: shu qurilmadagi tanlovni tozalab, /api/verify'ni
  // qaytadan chaqiradi (bootstrapApp) — shu bilan rol ro'yxati ham yangilanadi
  // (masalan admin bu orada bitta vakolatini olib tashlagan bo'lishi mumkin).
  function staffRoleSwitchHandler() {
    const key = staffChosenRoleKey();
    if (key) localStorage.removeItem(key);
    bootstrapApp();
  }

  // ---- Xodim: shaxsiy kunlik/haftalik/oylik statistika (45-bosqich) ----
  let myStatsState = { period: 'today' };

  function myStatsPeriodLabel(period) {
    return { today: 'Bugun', week: 'Bu hafta', month: 'Bu oy', all: 'Hammasi' }[period] || period;
  }

  function myStatsBodyHtml(stats) {
    const blocks = [];
    if (stats.kassir) {
      blocks.push(`
        <div class="kartochka">
          <h2>Yaratgan buyurtmalarim</h2>
          <div class="profile-row"><b>Soni:</b> ${stats.kassir.orderCount} ta</div>
          <div class="profile-row"><b>Jami summa:</b> ${cfFormatSum(stats.kassir.totalAmount)}</div>
        </div>
      `);
    }
    if (stats.oshpaz) {
      blocks.push(`
        <div class="kartochka">
          <h2>Tayyorlagan buyurtmalarim</h2>
          <div class="profile-row"><b>Soni:</b> ${stats.oshpaz.orderCount} ta</div>
        </div>
      `);
    }
    if (stats.dostavka) {
      blocks.push(`
        <div class="kartochka">
          <h2>Yetkazgan buyurtmalarim</h2>
          <div class="profile-row"><b>Soni:</b> ${stats.dostavka.orderCount} ta</div>
          <div class="profile-row"><b>Jami pul:</b> ${cfFormatSum(stats.dostavka.totalAmount)}</div>
          <div class="profile-row"><b>Komissiyam:</b> ${cfFormatSum(stats.dostavka.commission)}</div>
        </div>
      `);
    }
    if (stats.sklad) {
      blocks.push(`
        <div class="kartochka">
          <h2>Sklad harakatlarim</h2>
          <div class="profile-row"><b>Jami:</b> ${stats.sklad.movementCount} ta</div>
          <div class="profile-row"><b>Kirim:</b> ${stats.sklad.kirimCount} ta</div>
          <div class="profile-row"><b>Chiqim:</b> ${stats.sklad.chiqimCount} ta</div>
        </div>
      `);
    }
    if (!blocks.length) return `<div class="bosh">Hozircha statistika yo'q.</div>`;
    return blocks.join('');
  }

  function renderMyStatsScreen(onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Statistikam</div>
        <button class="btn ikkinchi" id="msBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="tab-row">
          <div class="tab-opt ${myStatsState.period === 'today' ? 'selected' : ''}" data-ms-period="today">Bugun</div>
          <div class="tab-opt ${myStatsState.period === 'week' ? 'selected' : ''}" data-ms-period="week">Hafta</div>
          <div class="tab-opt ${myStatsState.period === 'month' ? 'selected' : ''}" data-ms-period="month">Oy</div>
        </div>
        <div id="msBody"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);

    document.getElementById('msBackBtn').addEventListener('click', () => { stopOrdersPolling(); onBack && onBack(); });
    document.querySelector('.tab-row').addEventListener('click', (e) => {
      const p = e.target.getAttribute('data-ms-period');
      if (!p || p === myStatsState.period) return;
      myStatsState.period = p;
      renderMyStatsScreen(onBack);
    });

    loadMyStats();
  }

  async function loadMyStats() {
    const bodyEl = document.getElementById('msBody');
    if (!bodyEl) return;
    const res = await apiPost('/api/my-stats', { initData, period: myStatsState.period });
    if (res.networkError) { renderNetworkErrorInline(bodyEl, res.reason, () => loadMyStats()); return; }
    if (!res.ok) {
      bodyEl.innerHTML = `<div class="xabar err">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
      return;
    }
    bodyEl.innerHTML = myStatsBodyHtml(res.stats);
  }

  // ---- Kassir: buyurtma ekrani (menyu → savat → tur/to'lov → yuborish) ----
  const ORDER_TYPE_LABELS = { stol: 'Stolga', olib_ketish: 'Olib ketish', dostavka: 'Dostavka' };
  const PAYMENT_TYPE_LABELS = { naqd: 'Naqd', karta: 'Karta', dostavka_orqali: "Dostavka orqali" };

  // 19/20-bosqich: "Stolga" va "Olib ketish" buyurtmalarida faqat "Naqd" va
  // "Karta" to'lov usullari ko'rsatiladi. 21/22/23-bosqich: "Dostavka
  // orqali" varianti (matni) FAQAT haqiqiy Dostavka buyurtmalarida
  // ko'rinadi — ilgari bu variant barcha buyurtma turlarida (Stolga, Olib
  // ketishda ham) chiqib, mijozlarni chalkashtirib yuborardi. Dostavka
  // buyurtmasida esa "Naqd" ko'rsatilmaydi — kuryer naqd pulni mijozdan
  // olishi aynan "Dostavka orqali" varianti bilan ifodalanadi, ikkalasi bir
  // vaqtda kerak emas (chalkashlikni oldini olish).
  function visiblePaymentTypeEntries(orderType) {
    return Object.entries(PAYMENT_TYPE_LABELS).filter(([k]) => {
      if (k === 'dostavka_orqali' && customerState.cardOnlyRestricted) return false;
      if (orderType === 'dostavka') return k !== 'naqd';
      return k !== 'dostavka_orqali';
    });
  }
  // orderType o'zgarganda, agar hozirgi tanlov endi ko'rinmaydigan variant
  // bo'lib qolsa (masalan "dostavka"dan "stol"ga o'tilganda "dostavka_orqali"
  // tanlangan bo'lsa, yoki "stol"dan "dostavka"ga o'tilganda "naqd" tanlangan
  // bo'lsa) — variant "karta"ga almashtiriladi, aks holda ko'rinmaydigan
  // tanlov "yopishib" qolib, mijoz buni sezmasdan yuborib yuborishi mumkin edi.
  function ensureValidPaymentType(state) {
    const visibleKeys = visiblePaymentTypeEntries(state.orderType).map(([k]) => k);
    if (!visibleKeys.includes(state.paymentType)) {
      state.paymentType = 'karta';
    }
  }

  let cashierState = { menu: [], cart: {}, orderType: 'stol', paymentType: 'naqd', tableNumber: '', tab: 'yaratish', lastOrderRequestId: null };

  function cashierCartTotal() {
    return cashierState.menu.reduce((sum, m) => sum + (cashierState.cart[m.id] || 0) * m.price, 0);
  }

  function cashierTabRowHtml() {
    return `
      <div class="tab-row">
        <div class="tab-opt ${cashierState.tab === 'yaratish' ? 'selected' : ''}" data-cashier-tab="yaratish">Yangi buyurtma</div>
        <div class="tab-opt ${cashierState.tab === 'holat' ? 'selected' : ''}" data-cashier-tab="holat">Buyurtmalar holati</div>
        <div class="tab-opt ${cashierState.tab === 'statistika' ? 'selected' : ''}" data-cashier-tab="statistika">Statistikam</div>
      </div>
    `;
  }

  function renderCashierScreen(restaurantName, onBack) {
    stopOrdersPolling();
    disconnectSectionedMenuObserver('cashierCatRow');
    if (cashierState.tab === 'holat') {
      renderCashierOrdersTab(restaurantName, onBack);
      return;
    }
    if (cashierState.tab === 'statistika') {
      renderMyStatsScreen(() => { cashierState.tab = 'yaratish'; renderCashierScreen(restaurantName, onBack); });
      return;
    }
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">${escapeHtml(restaurantName || 'Kassir')}</div>
        ${onBack ? `<button class="btn ikkinchi" id="cashierBackBtn" style="margin-bottom:12px;">← Orqaga</button>` : ''}
        ${cashierTabRowHtml()}
        ${shiftWidgetHtml()}
        <div class="bosh">Taomni bosib savatga qo'shing.</div>
        <div id="cashierMenu" style="margin-top:14px;"><div class="bosh">Yuklanmoqda...</div></div>
        <div class="cart-bar">
          <div class="type-row" id="orderTypeRow">
            ${Object.entries(ORDER_TYPE_LABELS).map(([k, label]) => `
              <div class="type-opt ${cashierState.orderType === k ? 'selected' : ''}" data-order-type="${k}">${label}</div>
            `).join('')}
          </div>
          <div id="tableNumberWrap" class="${cashierState.orderType === 'stol' ? '' : 'hidden'}">
            <input type="text" id="tableNumberInput" placeholder="Stol raqami" value="${escapeHtml(cashierState.tableNumber)}" inputmode="numeric">
          </div>
          <div class="type-row" id="paymentTypeRow">
            ${visiblePaymentTypeEntries(cashierState.orderType).map(([k, label]) => `
              <div class="type-opt ${cashierState.paymentType === k ? 'selected' : ''}" data-payment-type="${k}">${label}</div>
            `).join('')}
          </div>
          <div class="cart-total"><span>Jami:</span><span id="cartTotalVal">${fmtNum(cashierCartTotal())} so'm</span></div>
          <button class="btn" id="sendOrderBtn">Oshxonaga yuborish</button>
          <div class="xabar" id="orderMsg"></div>
        </div>
      </div>
    `);

    if (onBack) {
      document.getElementById('cashierBackBtn').addEventListener('click', () => onBack());
    }
    document.querySelector('.tab-row').addEventListener('click', (e) => {
      const t = e.target.getAttribute('data-cashier-tab');
      if (!t || t === cashierState.tab) return;
      cashierState.tab = t;
      renderCashierScreen(restaurantName, onBack);
    });

    document.getElementById('orderTypeRow').addEventListener('click', (e) => {
      const t = e.target.getAttribute('data-order-type');
      if (!t) return;
      cashierState.orderType = t;
      ensureValidPaymentType(cashierState);
      renderCashierScreen(restaurantName, onBack);
    });
    document.getElementById('paymentTypeRow').addEventListener('click', (e) => {
      const t = e.target.getAttribute('data-payment-type');
      if (!t) return;
      cashierState.paymentType = t;
      renderCashierScreen(restaurantName, onBack);
    });
    const tableInput = document.getElementById('tableNumberInput');
    if (tableInput) tableInput.addEventListener('input', (e) => { cashierState.tableNumber = e.target.value; });

    document.getElementById('sendOrderBtn').addEventListener('click', () => sendCashierOrder(restaurantName, onBack));

    attachShiftWidgetHandler();
    loadShiftWidget();
    loadCashierMenu(restaurantName);
  }

  // ---- Kassir: "Buyurtmalar holati" tabi — real-vaqtda ro'yxat, faqat "Tayyor" tugmasi bilan ----
  function renderCashierOrdersTab(restaurantName, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">${escapeHtml(restaurantName || 'Kassir')}</div>
        ${onBack ? `<button class="btn ikkinchi" id="cashierBackBtn" style="margin-bottom:12px;">← Orqaga</button>` : ''}
        ${cashierTabRowHtml()}
        ${shiftWidgetHtml()}
        ${soundToggleBtnHtml()}
        ${cashierStatusChipsHtml()}
        <div id="ordersBoard"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);
    if (onBack) {
      document.getElementById('cashierBackBtn').addEventListener('click', () => onBack());
    }
    document.querySelector('.tab-row').addEventListener('click', (e) => {
      const t = e.target.getAttribute('data-cashier-tab');
      if (!t || t === cashierState.tab) return;
      cashierState.tab = t;
      renderCashierScreen(restaurantName, onBack);
    });
    document.getElementById('cashierStatusChips').addEventListener('click', (e) => {
      const key = e.target.getAttribute('data-status-chip');
      if (!key || key === cashierStatusFilter) return;
      cashierStatusFilter = key;
      document.querySelectorAll('#cashierStatusChips [data-status-chip]').forEach(el => {
        el.classList.toggle('selected', el.getAttribute('data-status-chip') === key);
      });
      lastOrdersSnapshot = null; // filtr o'zgardi — taxtani majburiy qayta chizamiz
      refreshOrdersBoard('kassir');
    });
    attachSoundToggleHandler();
    attachShiftWidgetHandler();
    loadShiftWidget();
    startOrdersPolling('kassir');
  }

  // ==================== K. Umumiy: bo'limlarga bo'lingan menyu (29-30-bosqich) ====================
  // Mijoz va kassir menyusi bir xil "bo'lim + sticky tab-bar + scrollspy"
  // mantig'iga muhtoj edi — shu komponent ikkalasida ham qayta ishlatiladi,
  // faqat karta ko'rinishi (renderItem) va konteyner id'lari (opts) farq qiladi.

  // categories (ixtiyoriy) — owner.categories ro'yxati (F-bo'lim, 36-40-bosqich).
  // Berilsa, bo'limlar shu yerdagi tartib (order) bo'yicha chiqadi; ro'yxatda
  // yo'q kategoriyalar (masalan, bo'lim keyinchalik o'chirilgan bo'lsa yoki
  // taomda umuman kategoriya belgilanmagan bo'lsa — "Boshqa") oxiriga,
  // taomlarda uchragan tartibda qo'shiladi.
  function groupMenuItems(items, categories) {
    const orderIndex = {};
    (categories || []).forEach((c, i) => { orderIndex[c.name] = i; });
    const order = [];
    const groups = {};
    items.forEach(m => {
      const cat = m.category || 'Boshqa';
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(m);
    });
    order.sort((a, b) => {
      const ai = Object.prototype.hasOwnProperty.call(orderIndex, a) ? orderIndex[a] : Infinity;
      const bi = Object.prototype.hasOwnProperty.call(orderIndex, b) ? orderIndex[b] : Infinity;
      return ai - bi;
    });
    return { order, groups };
  }

  // opts: { sectionIdPrefix, itemsWrapperClass, renderItem, emptyText, categories }
  function renderSectionedMenu(items, opts) {
    if (!items.length) return `<div class="bosh">${opts.emptyText}</div>`;
    const { order, groups } = groupMenuItems(items, opts.categories);
    return order.map((cat, i) => `
      <div class="menu-section" id="${opts.sectionIdPrefix}-${i}">
        <div class="cat-heading">${escapeHtml(cat)}</div>
        <div class="${opts.itemsWrapperClass || ''}">${groups[cat].map(opts.renderItem).join('')}</div>
      </div>
    `).join('');
  }

  // opts: { tabRowId, sectionIdPrefix, listElId, categories }
  function sectionedMenuTabsHtml(items, opts) {
    const { order } = groupMenuItems(items, opts.categories);
    if (order.length <= 1) return '';
    return `
      <div class="cat-row sectioned-menu-tabs" id="${opts.tabRowId}">
        <div class="cat-opt" data-section-id="${opts.listElId}">Hammasi</div>
        ${order.map((c, i) => `<div class="cat-opt" data-section-id="${opts.sectionIdPrefix}-${i}">${escapeHtml(c)}</div>`).join('')}
      </div>
    `;
  }

  // tabRowId bo'yicha kalitlangan IntersectionObserver'lar — mijoz va
  // kassir ekranlari bir vaqtda alohida ishlaydi, biri ikkinchisiga
  // xalaqit bermaydi.
  const sectionedMenuObservers = {};

  function disconnectSectionedMenuObserver(tabRowId) {
    if (sectionedMenuObservers[tabRowId]) {
      sectionedMenuObservers[tabRowId].disconnect();
      delete sectionedMenuObservers[tabRowId];
    }
  }

  function attachSectionedMenuTabHandlers(tabRowId) {
    const tabRow = document.getElementById(tabRowId);
    if (!tabRow) return;
    tabRow.addEventListener('click', (e) => {
      const opt = e.target.closest('[data-section-id]');
      if (!opt) return;
      const targetEl = document.getElementById(opt.getAttribute('data-section-id'));
      if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function attachSectionedMenuScrollSpy(tabRowId, listElId) {
    disconnectSectionedMenuObserver(tabRowId);
    const tabRow = document.getElementById(tabRowId);
    if (!tabRow) return;
    const sections = Array.from(document.querySelectorAll('#' + listElId + ' .menu-section'));
    if (!sections.length) return;

    const setActiveTab = (sectionId) => {
      tabRow.querySelectorAll('[data-section-id]').forEach(opt => {
        const isActive = opt.getAttribute('data-section-id') === sectionId;
        opt.classList.toggle('selected', isActive);
        if (isActive) opt.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      });
    };
    setActiveTab(sections[0].id);

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => { if (entry.isIntersecting) setActiveTab(entry.target.id); });
    }, { rootMargin: '-96px 0px -70% 0px', threshold: 0 });
    sections.forEach(sec => observer.observe(sec));
    sectionedMenuObservers[tabRowId] = observer;
  }

  function cashierItemRowHtml(m) {
    const qty = cashierState.cart[m.id] || 0;
    const thumbHtml = m.imageUrl
      ? `<img class="menu-item-thumb" src="${escapeHtml(m.imageUrl)}" onerror="this.style.display='none'">`
      : `<div class="menu-item-thumb-empty"></div>`;
    // 47-bosqich: sklad tugagan taom avtomatik "Tugagan" deb belgilanadi —
    // savatga qo'shib bo'lmaydi (miqdor tugmalari o'chiriladi).
    if (m.outOfStock) {
      return `
        <div class="menu-item" style="opacity:0.55;">
          <div class="menu-item-info">
            ${thumbHtml}
            <div>
              <div class="m-name">${escapeHtml(m.name)} <span class="badge warning">Tugagan</span></div>
              <div class="m-price">${fmtNum(m.price)} so'm</div>
            </div>
          </div>
          <div class="qty-controls">
            <button disabled>-</button>
            <span class="qty-val">0</span>
            <button disabled>+</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="menu-item">
        <div class="menu-item-info">
          ${thumbHtml}
          <div>
            <div class="m-name">${escapeHtml(m.name)}</div>
            <div class="m-price">${fmtNum(m.price)} so'm</div>
          </div>
        </div>
        <div class="qty-controls">
          <button data-qty-minus="${escapeHtml(m.id)}">-</button>
          <span class="qty-val">${qty}</span>
          <button data-qty-plus="${escapeHtml(m.id)}">+</button>
        </div>
      </div>
    `;
  }

  // 29-bosqich: kassirning "Yangi buyurtma" menyusi ham mijoznikiga
  // o'xshab bo'limlarga ajratildi (umumiy komponent — 30-bosqich).
  function cashierMenuHtml() {
    return `
      ${sectionedMenuTabsHtml(cashierState.menu, { tabRowId: 'cashierCatRow', sectionIdPrefix: 'menu-section-cashier', listElId: 'cashierMenuList', categories: cashierState.categories })}
      <div id="cashierMenuList">${renderSectionedMenu(cashierState.menu, {
        sectionIdPrefix: 'menu-section-cashier',
        itemsWrapperClass: '',
        renderItem: cashierItemRowHtml,
        emptyText: "Menyu hali bo'sh. Egadan menyuga taom qo'shishni so'rang.",
        categories: cashierState.categories
      })}</div>
    `;
  }

  async function loadCashierMenu(restaurantName) {
    const el = document.getElementById('cashierMenu');
    const res = await apiPost('/api/menu-list', { initData });
    if (res.networkError) { renderNetworkErrorInline(el, res.reason, () => loadCashierMenu(restaurantName)); return; }
    cashierState.menu = res.ok ? res.menu : [];
    cashierState.categories = res.ok ? (res.categories || []) : [];
    el.innerHTML = cashierMenuHtml();
    attachQtyHandlers(restaurantName);
    attachSectionedMenuTabHandlers('cashierCatRow');
    attachSectionedMenuScrollSpy('cashierCatRow', 'cashierMenuList');
  }

  function attachQtyHandlers(restaurantName) {
    const el = document.getElementById('cashierMenu');
    el.querySelectorAll('[data-qty-plus]').forEach(btn => btn.onclick = () => {
      const id = btn.getAttribute('data-qty-plus');
      cashierState.cart[id] = (cashierState.cart[id] || 0) + 1;
      el.innerHTML = cashierMenuHtml();
      attachQtyHandlers(restaurantName);
      attachSectionedMenuTabHandlers('cashierCatRow');
      attachSectionedMenuScrollSpy('cashierCatRow', 'cashierMenuList');
      updateCartTotal();
    });
    el.querySelectorAll('[data-qty-minus]').forEach(btn => btn.onclick = () => {
      const id = btn.getAttribute('data-qty-minus');
      cashierState.cart[id] = Math.max(0, (cashierState.cart[id] || 0) - 1);
      el.innerHTML = cashierMenuHtml();
      attachQtyHandlers(restaurantName);
      attachSectionedMenuTabHandlers('cashierCatRow');
      attachSectionedMenuScrollSpy('cashierCatRow', 'cashierMenuList');
      updateCartTotal();
    });
  }

  function updateCartTotal() {
    const el = document.getElementById('cartTotalVal');
    if (el) el.textContent = fmtNum(cashierCartTotal()) + " so'm";
  }

  async function sendCashierOrder(restaurantName, onBack) {
    const msgEl = document.getElementById('orderMsg');
    const sendBtn = document.getElementById('sendOrderBtn');
    const items = Object.entries(cashierState.cart)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ id, qty }));

    if (!items.length) {
      msgEl.textContent = 'Savat bo\'sh. Kamida bitta taom tanlang.';
      msgEl.className = 'xabar err';
      return;
    }
    if (cashierState.orderType === 'stol' && !cashierState.tableNumber.trim()) {
      msgEl.textContent = 'Stol raqamini kiriting.';
      msgEl.className = 'xabar err';
      return;
    }

    // Tugmani darhol o'chiramiz — foydalanuvchi tez-tez bossa ham,
    // ikkinchi so'rov ketmaydi (qo'sh buyurtma/qo'sh sklad chiqimining oldini oladi)
    if (sendBtn) sendBtn.disabled = true;
    // Bitta chek-aut urinishi uchun bitta requestId — server shu orqali
    // takroriy so'rovni aniqlab, bir xil natijani qaytaradi
    if (!cashierState.lastOrderRequestId) {
      cashierState.lastOrderRequestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    msgEl.textContent = 'Yuborilmoqda...';
    msgEl.className = 'xabar';
    const res = await apiPost('/api/create-order', {
      initData,
      items,
      orderType: cashierState.orderType,
      tableNumber: cashierState.tableNumber,
      paymentType: cashierState.paymentType,
      requestId: cashierState.lastOrderRequestId
    });

    if (res.ok) {
      cashierState.cart = {};
      cashierState.lastOrderRequestId = null; // keyingi buyurtma uchun yangi requestId kerak bo'ladi
      msgEl.textContent = '';
      renderCashierScreen(restaurantName, onBack);
      const topMsg = document.createElement('div');
      topMsg.className = 'xabar ok';
      topMsg.innerHTML = `${icon('check-circle', 'icon-xs icon-success')} Buyurtma yuborildi (${fmtNum(res.total)} so'm)`;
      document.querySelector('.panel').prepend(topMsg);
    } else {
      if (sendBtn) sendBtn.disabled = false; // xato bo'lsa — qayta urinib ko'rish uchun tugma yoqiladi
      msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
      msgEl.className = 'xabar err';
    }
  }


  // ---- Oshpaz va kassir uchun umumiy: buyurtmalar taxtasi (real-vaqtda) ----
  const ORDER_STATUS_LABELS = { yangi: 'Yangi', tayyorlanmoqda: 'Tayyorlanmoqda', tayyor: 'Tayyor', bekor_qilindi: 'Bekor qilindi' };
  let ordersPollTimer = null;
  let lastOrdersSnapshot = null;
  let knownOrderIds = null; // 46-bosqich: yangi buyurtmani aniqlash uchun oldingi ID'lar to'plami

  // 19-bosqich: kassir uchun "Buyurtmalar holati" ekranida chip-filtr —
  // faqat kassir roli uchun (oshpaz/kuryer ekranlariga tegmaydi),
  // mavjud .cat-row/.cat-opt chip komponentidan (24-bosqichdagi mijoz
  // menyu filtri bilan bir xil) qayta foydalanadi.
  let cashierStatusFilter = 'hammasi';
  const CASHIER_STATUS_CHIPS = [
    { key: 'hammasi', label: 'Hammasi' },
    { key: 'yangi', label: 'Yangi' },
    { key: 'tayyorlanmoqda', label: 'Tayyorlanmoqda' },
    { key: 'tayyor', label: 'Tayyor' }
  ];
  function cashierStatusChipsHtml() {
    return `
      <div class="cat-row" id="cashierStatusChips">
        ${CASHIER_STATUS_CHIPS.map(c => `<div class="cat-opt ${cashierStatusFilter === c.key ? 'selected' : ''}" data-status-chip="${c.key}">${escapeHtml(c.label)}</div>`).join('')}
      </div>
    `;
  }

  function stopOrdersPolling() {
    if (ordersPollTimer) { clearInterval(ordersPollTimer); ordersPollTimer = null; }
    lastOrdersSnapshot = null;
    knownOrderIds = null; // keyingi safar ochilganda mavjud buyurtmalar "eski" deb hisoblansin
  }

  // ---- Yangi buyurtma kelganda ovozli bildirishnoma (46-bosqich) ----
  // Har bir xodim (shu qurilmada) ovozni o'chirib/yoqib qo'ya oladi —
  // localStorage'da saqlanadi, standart holat: yoqilgan.
  const SOUND_NOTIF_STORAGE_KEY = 'kitchenOsSoundNotif';
  function soundNotifEnabled() {
    return localStorage.getItem(SOUND_NOTIF_STORAGE_KEY) !== 'off';
  }
  function setSoundNotifEnabled(on) {
    localStorage.setItem(SOUND_NOTIF_STORAGE_KEY, on ? 'on' : 'off');
  }
  let sharedAudioCtx = null;
  function playNewOrderBeep() {
    if (!soundNotifEnabled()) return;
    try {
      if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = sharedAudioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      // Ikkita qisqa "bip" — e'tiborni tortish uchun yetarli, lekin bezovta qilmaydigan darajada
      [0, 0.22].forEach(delay => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.2);
      });
    } catch (e) {
      // Audio ishlamasa (masalan brauzer bloklagan bo'lsa) — jim o'tkazib yuboriladi, ilova buzilmaydi
    }
  }
  // ---- Kassir/oshpaz: smena boshlash/tugatish (49-bosqich) ----
  // Ish kunini boshlaganda/tugatganda bosadigan tugma. Holat serverda
  // saqlanadi (/api/shift-status, /api/shift-toggle) — shu bois qaysi
  // qurilmadan ochilsa ham bir xil ko'rinadi. shiftState — shu klient
  // sessiyasidagi keshlangan nusxa: ekran darhol (eski ma'lumot bilan)
  // chizilib, so'ng loadShiftWidget() serverdan yangi holatni olib keladi.
  let shiftState = { active: false, startedAt: null };
  let shiftTickTimer = null;

  function shiftDurationText(startedAt) {
    if (!startedAt) return '';
    const ms = Date.now() - new Date(startedAt).getTime();
    const totalMin = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h} soat ${m} daqiqa` : `${m} daqiqa`;
  }

  function stopShiftTicker() {
    if (shiftTickTimer) { clearInterval(shiftTickTimer); shiftTickTimer = null; }
  }

  // Smena faol bo'lsa, "necha vaqtdan beri" matnini har 30 soniyada yangilaydi.
  // Ekran o'sha vaqtda boshqa joyga o'tib ketgan bo'lsa (element yo'q) —
  // interval o'zi to'xtatiladi.
  function startShiftTickerIfNeeded() {
    stopShiftTicker();
    if (!shiftState.active) return;
    shiftTickTimer = setInterval(() => {
      const el = document.getElementById('shiftElapsedText');
      if (!el) { stopShiftTicker(); return; }
      el.textContent = shiftDurationText(shiftState.startedAt);
    }, 30000);
  }

  function shiftWidgetInnerHtml() {
    if (shiftState.active) {
      return `
        <div class="kartochka shift-widget shift-widget-active">
          <div class="shift-widget-row">
            <div class="shift-widget-info">
              ${icon('clock', 'icon-xs')}
              <div>
                <b>Smena boshlangan</b>
                <div class="shift-widget-time" id="shiftElapsedText">${escapeHtml(shiftDurationText(shiftState.startedAt))}</div>
              </div>
            </div>
            <button type="button" class="btn xavfli shift-widget-btn" id="shiftToggleBtn">Tugatish</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="kartochka shift-widget">
        <div class="shift-widget-row">
          <div class="shift-widget-info">${icon('clock', 'icon-xs')}<b>Smena boshlanmagan</b></div>
          <button type="button" class="btn shift-widget-btn" id="shiftToggleBtn">Smenani boshlash</button>
        </div>
      </div>
    `;
  }

  // Placeholder — o'zining "wrap" idsi bilan, keyinroq DOM'ning shu qismi
  // (butun ekranni qayta chizmasdan) yangilanadi.
  function shiftWidgetHtml() {
    return `<div id="shiftWidgetWrap" style="margin-bottom:12px;">${shiftWidgetInnerHtml()}</div>`;
  }

  function attachShiftWidgetHandler() {
    const btn = document.getElementById('shiftToggleBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const res = await apiPost('/api/shift-toggle', { initData });
      if (res.ok) {
        shiftState.active = res.active;
        shiftState.startedAt = res.startedAt;
        const wrap = document.getElementById('shiftWidgetWrap');
        if (wrap) wrap.innerHTML = shiftWidgetInnerHtml();
        attachShiftWidgetHandler();
        startShiftTickerIfNeeded();
      } else {
        btn.disabled = false;
        alert(res.reason || 'Xatolik yuz berdi.');
      }
    });
  }

  async function loadShiftWidget() {
    const res = await apiPost('/api/shift-status', { initData });
    if (!res.ok) return; // jim o'tkazib yuboriladi — tugma keshlangan holat bilan ham ishlayveradi
    shiftState.active = res.active;
    shiftState.startedAt = res.startedAt;
    const wrap = document.getElementById('shiftWidgetWrap');
    if (wrap) wrap.innerHTML = shiftWidgetInnerHtml();
    attachShiftWidgetHandler();
    startShiftTickerIfNeeded();
  }

  function soundToggleBtnHtml() {
    const on = soundNotifEnabled();
    return `<button class="btn ikkinchi" id="soundNotifToggleBtn" style="margin-bottom:12px;">${on ? '🔔 Ovoz: Yoqilgan' : '🔕 Ovoz: O\'chirilgan'}</button>`;
  }
  function attachSoundToggleHandler() {
    const btn = document.getElementById('soundNotifToggleBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      setSoundNotifEnabled(!soundNotifEnabled());
      btn.textContent = soundNotifEnabled() ? '🔔 Ovoz: Yoqilgan' : '🔕 Ovoz: O\'chirilgan';
      // Yoqishda o'zi bosgan tugma bosilishi (user gesture) AudioContext'ni
      // ba'zi brauzerlarda "qulflab" ochib beradi — shu bois kichik sinov bipi.
      if (soundNotifEnabled()) playNewOrderBeep();
    });
  }

  function timeAgo(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'hozirgina';
    if (min < 60) return `${min} daqiqa oldin`;
    const soat = Math.floor(min / 60);
    return `${soat} soat oldin`;
  }

  function orderCardHtml(order, role) {
    const orderLabel = `${ORDER_TYPE_LABELS[order.orderType] || order.orderType}${order.tableNumber ? ' — stol ' + escapeHtml(order.tableNumber) : ''}`;
    const itemsHtml = order.items.map(it => `${escapeHtml(it.name)} x${it.qty}`).join('<br>');

    // 15-bosqich: buyurtmadagi BARCHA taomlar skladdan to'g'ridan sotiladigan
    // (retseptsiz, directStockId orqali) bo'lsa - oshpaz tayyorlashi shart emas,
    // shuning uchun "Boshlash" bosqichisiz to'g'ridan "Tayyor" tugmasi chiqadi.
    const allDirectStock = Array.isArray(order.items) && order.items.length > 0 &&
      order.items.every(it => it.directStockId);

    let actionBtn = '';
    if (order.status === 'yangi') {
      if (allDirectStock && (role === 'oshpaz' || role === 'kassir')) {
        actionBtn = `<button class="order-action-btn ready" data-order-id="${escapeHtml(order.id)}" data-set-status="tayyor">Tayyor</button>`;
      } else if (role === 'oshpaz') {
        actionBtn = `<button class="order-action-btn start" data-order-id="${escapeHtml(order.id)}" data-set-status="tayyorlanmoqda">Boshlash</button>`;
      } else if (role === 'egasi') {
        // Egasi tuzatish/favqulodda holat uchun bosqichni chetlab o'tishi mumkin (server ham shunga ruxsat beradi)
        actionBtn = `<button class="order-action-btn ready" data-order-id="${escapeHtml(order.id)}" data-set-status="tayyor">Tayyor (majburiy)</button>`;
      }
      // kassir uchun (allDirectStock bo'lmasa) bu yerda hech qanday tugma chiqmaydi — buyurtma
      // hali oshpaz tomonidan "Boshlash" bosilmagan, shuning uchun kassir uni to'g'ridan-to'g'ri
      // "Tayyor" qila olmaydi.
    } else if (order.status === 'tayyorlanmoqda') {
      actionBtn = `<button class="order-action-btn ready" data-order-id="${escapeHtml(order.id)}" data-set-status="tayyor">Tayyor</button>`;
    } else if (role === 'egasi' && order.orderType === 'dostavka' && order.deliveredBy) {
      // Kuryer xato bosib yuborgan bo'lishi mumkin — egasi shu belgini bekor qila oladi
      actionBtn = `<button class="order-action-btn ikkinchi" data-undo-deliver-id="${escapeHtml(order.id)}">Yetkazildi belgisini bekor qilish</button>`;
    }
    const deliveredNote = (order.orderType === 'dostavka' && order.deliveredBy)
      ? `<div class="order-time">✅ Yetkazib berilgan (${timeAgo(order.deliveredAt)})</div>`
      : '';

    return `
      <div class="order-card">
        <div class="order-top">
          <div>
            <div class="order-type">${orderLabel}</div>
            <div class="order-time">${timeAgo(order.createdAt)}</div>
          </div>
          <span class="status-badge ${order.status}">${ORDER_STATUS_LABELS[order.status] || order.status}</span>
        </div>
        ${order.customerName ? `<div class="order-time">👤 ${escapeHtml(order.customerName)}${order.customerPhone ? ` · <button type="button" class="call-link" data-call-phone="${escapeHtml(order.customerPhone)}" data-call-tgid="${escapeHtml(String(order.customerId || ''))}">📞 ${escapeHtml(order.customerPhone)}</button>` : ''}</div>` : ''}
        ${order.orderType === 'dostavka' && order.extraPhone ? `<div class="order-time"><button type="button" class="call-link" data-call-phone="${escapeHtml(order.extraPhone)}">📞 ${escapeHtml(order.extraPhone)}</button></div>` : ''}
        <div class="order-items">${itemsHtml}</div>
        ${deliveredNote}
        <div class="order-bottom">
          <span class="order-total">${fmtNum(order.total)} so'm</span>
          ${actionBtn}
        </div>
      </div>
    `;
  }

  function ordersBoardHtml(orders, role) {
    let list = orders || [];
    if (role === 'kassir' && cashierStatusFilter !== 'hammasi') {
      list = list.filter(o => o.status === cashierStatusFilter);
    }
    if (!list.length) {
      return `<div class="bosh">${role === 'kassir' && cashierStatusFilter !== 'hammasi' ? "Bu holatda buyurtma yo'q." : "Hozircha buyurtmalar yo'q."}</div>`;
    }
    return list.map(o => orderCardHtml(o, role)).join('');
  }

  function attachOrdersBoardHandlers(role) {
    const board = document.getElementById('ordersBoard');
    if (!board) return;
    board.querySelectorAll('[data-set-status]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const orderId = btn.getAttribute('data-order-id');
        const status = btn.getAttribute('data-set-status');
        const res = await apiPost('/api/update-order-status', { initData, orderId, status });
        if (!res.ok) {
          alert(res.reason || 'Xatolik yuz berdi.');
        }
        lastOrdersSnapshot = null; // majburiy qayta chizish
        await refreshOrdersBoard(role);
      });
    });
    board.querySelectorAll('[data-undo-deliver-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu buyurtmaning "Yetkazildi" belgisini bekor qilmoqchimisiz?')) return;
        btn.disabled = true;
        const orderId = btn.getAttribute('data-undo-deliver-id');
        const res = await apiPost('/api/undo-deliver-order', { initData, orderId });
        if (!res.ok) {
          alert(res.reason || 'Xatolik yuz berdi.');
        }
        lastOrdersSnapshot = null;
        await refreshOrdersBoard(role);
      });
    });
  }

  async function refreshOrdersBoard(role) {
    const board = document.getElementById('ordersBoard');
    if (!board) { stopOrdersPolling(); return; }
    const res = await apiPost('/api/orders-list', { initData });
    if (!res.ok) {
      // Faqat hali hech qanday ma'lumot yuklanmagan bo'lsa (birinchi urinish)
      // to'liq "aloqa yo'q" holatini ko'rsatamiz — aks holda oshpaz ekranidagi
      // mavjud buyurtmalar ro'yxatini vaqtinchalik uzilish tufayli tozalamaymiz.
      if (res.networkError && lastOrdersSnapshot === null) {
        renderNetworkErrorInline(board, res.reason, () => refreshOrdersBoard(role));
      }
      return;
    }

    // 46-bosqich: yangi ("yangi" holatidagi) buyurtma paydo bo'lsa — ovozli
    // bildirishnoma. Birinchi yuklanishda (knownOrderIds hali yo'q) beep
    // chalinmaydi — aks holda ekran ochilgan zahoti barcha mavjud
    // buyurtmalar uchun bir vaqtda ovoz chiqib ketardi.
    const currentIds = new Set((res.orders || []).map(o => o.id));
    if (knownOrderIds && (role === 'oshpaz' || role === 'kassir')) {
      const hasNew = (res.orders || []).some(o => o.status === 'yangi' && !knownOrderIds.has(o.id));
      if (hasNew) playNewOrderBeep();
    }
    knownOrderIds = currentIds;

    const snapshot = JSON.stringify(res.orders);
    if (snapshot === lastOrdersSnapshot) return; // o'zgarish yo'q — qayta chizmaymiz
    lastOrdersSnapshot = snapshot;
    board.innerHTML = ordersBoardHtml(res.orders, role);
    attachOrdersBoardHandlers(role);
  }

  function startOrdersPolling(role) {
    stopOrdersPolling();
    refreshOrdersBoard(role);
    ordersPollTimer = setInterval(() => refreshOrdersBoard(role), 4000);
  }

  // ---- Oshpaz: kelgan buyurtmalar ro'yxati real-vaqtda, holatni bosqichma-bosqich o'zgartirish ----
  // onBack ixtiyoriy: xodim sifatida kirilganda berilmaydi (orqaga qaytish
  // yo'q, bu yagona vazifali ekran); egasi "Bugungi holat" bannerdan yoki
  // menyudan kirganda beriladi (10-bosqich).
  function renderKitchenScreen(restaurantName, onBack) {
    // 13-bosqich: bitta vazifali rol — restoran nomi allaqachon doimiy
    // header'da (11-bosqich) ko'rinadi, shuning uchun bu yerda takrorlanmaydi;
    // ekran to'g'ridan-to'g'ri yagona vazifaga — buyurtmalarga — qaratiladi.
    // 62-bosqich: egasi bu ekranga menyudan kirganda (onBack mavjud bo'lganda)
    // "Menyuga taom qo'shish" bo'limi ham shu yerda ko'rinadi — oshpazning
    // o'z ish ekranida (onBack yo'q) bu bo'lim chiqmaydi.
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Kelgan buyurtmalar</div>
        ${onBack ? `<button class="btn ikkinchi" id="kitchenBackBtn" style="margin-bottom:12px;">← Orqaga</button>` : ''}
        <button class="btn ikkinchi" id="kitchenStatsBtn" style="margin-bottom:12px;">📊 Statistikam</button>
        ${shiftWidgetHtml()}
        ${soundToggleBtnHtml()}
        <div class="bosh">Pastdagi tugmalar bilan holatini o'zgartiring.</div>
        <div id="ordersBoard" class="orders-board-large" style="margin-top:14px;"><div class="bosh">Yuklanmoqda...</div></div>
        ${onBack ? menuAddSectionHtml() : ''}
      </div>
    `);
    if (onBack) document.getElementById('kitchenBackBtn').addEventListener('click', () => { stopOrdersPolling(); onBack(); });
    document.getElementById('kitchenStatsBtn').addEventListener('click', () => {
      stopOrdersPolling();
      renderMyStatsScreen(() => renderKitchenScreen(restaurantName, onBack));
    });
    attachSoundToggleHandler();
    attachShiftWidgetHandler();
    loadShiftWidget();
    startOrdersPolling('oshpaz');
    if (onBack) attachMenuAddSectionHandlers();
  }


  // ---- Kuryer: yetkazib berish uchun tayyor bo'lgan dostavka buyurtmalari, real-vaqtda ----
  // ---- Kuryer: bitta tugma bilan Google Maps marshruti (48-bosqich) ----
  // Mijoz buyurtma berayotganda joylashuvini (location: {lat,lng}) yuborgan
  // bo'lsa — to'g'ridan-to'g'ri o'sha nuqtagacha navigatsiya (marshrut)
  // ochiladi. Joylashuv bo'lmasa, mijoz yozgan manzil izohi (addressNote)
  // bo'yicha Google Maps qidiruvi ochiladi — hech biri bo'lmasa tugma umuman
  // ko'rsatilmaydi.
  function deliveryRouteUrl(order) {
    const loc = order.location;
    if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
      return `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}&travelmode=driving`;
    }
    if (order.addressNote && order.addressNote.trim()) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.addressNote.trim())}`;
    }
    return null;
  }
  function openExternalLink(url) {
    if (tg && typeof tg.openLink === 'function') {
      tg.openLink(url);
    } else {
      window.open(url, '_blank');
    }
  }

  function deliveryCardHtml(order) {
    const itemsHtml = order.items.map(it => `${escapeHtml(it.name)} x${it.qty}`).join('<br>');
    // 20-bosqich: yetkazib bo'lingan buyurtmaning holati (status) hali ham
    // "tayyor" bo'lib qoladi (faqat deliveredBy/deliveredAt qo'yiladi) —
    // shuning uchun bu yerda ko'rinadigan yorliq shu belgiga qarab
    // "Tayyor" o'rniga "Yetkazildi" deb yoziladi, tugma esa endi bosilmaydigan
    // holatga o'tadi (qayta bosilib xato chiqarmasligi uchun).
    const isDelivered = !!order.deliveredBy;
    const routeUrl = deliveryRouteUrl(order);
    return `
      <div class="order-card">
        <div class="order-top">
          <div>
            <div class="order-type">Dostavka</div>
            <div class="order-time">${timeAgo(order.createdAt)}</div>
          </div>
          <span class="status-badge tayyor">${isDelivered ? 'Yetkazildi' : ORDER_STATUS_LABELS.tayyor}</span>
        </div>
        ${order.customerName ? `<div class="order-time">👤 ${escapeHtml(order.customerName)}${order.customerPhone ? ` · <button type="button" class="call-link" data-call-phone="${escapeHtml(order.customerPhone)}" data-call-tgid="${escapeHtml(String(order.customerId || ''))}">📞 ${escapeHtml(order.customerPhone)}</button>` : ''}</div>` : ''}
        ${order.addressNote ? `<div class="order-time">📝 ${escapeHtml(order.addressNote)}</div>` : ''}
        ${order.extraPhone ? `<div class="order-time"><button type="button" class="call-link" data-call-phone="${escapeHtml(order.extraPhone)}">📞 ${escapeHtml(order.extraPhone)}</button> (qo'shimcha)</div>` : ''}
        ${routeUrl ? `<button type="button" class="btn ikkinchi" data-route-order-id="${escapeHtml(order.id)}" style="margin:8px 0; width:100%;">🗺️ Marshrut (Google Maps)</button>` : ''}
        <div class="order-items">${itemsHtml}</div>
        <div class="order-bottom">
          <span class="order-total">${fmtNum(order.total)} so'm (${PAYMENT_TYPE_LABELS[order.paymentType] || order.paymentType})</span>
          ${isDelivered
            ? `<span class="order-time">✅ Yetkazib berildi (${timeAgo(order.deliveredAt)})</span>`
            : `<button class="order-action-btn ready" data-deliver-order-id="${escapeHtml(order.id)}">Yetkazildi</button>`}
        </div>
        ${isDelivered ? '' : `<button type="button" class="btn ikkinchi" data-reject-order-id="${escapeHtml(order.id)}" style="width:100%; margin-top:8px; color:var(--danger); border-color:var(--danger);">Mijoz qabul qilmadi</button>`}
      </div>
    `;
  }

  let lastDeliveryOrdersById = new Map();
  function deliveryBoardHtml(orders) {
    // 20-bosqich: bu taxta FAQAT dostavka turidagi va "tayyor" holatidagi
    // buyurtmalarni ko'rsatishi kerak — avval bu yerda hech qanday filtr
    // yo'q edi, shuning uchun stol/olib ketish buyurtmalari ham xato
    // ravishda "Dostavka"/"Tayyor" deb chiqib, tugmasi doim yoniq ko'rinardi.
    const relevant = (orders || []).filter(o => o.orderType === 'dostavka' && o.status === 'tayyor');
    lastDeliveryOrdersById = new Map(relevant.map(o => [o.id, o]));
    if (!relevant.length) return `<div class="bosh">Hozircha yetkazib berish uchun buyurtma yo'q.</div>`;
    return relevant.map(o => deliveryCardHtml(o)).join('');
  }

  function attachDeliveryBoardHandlers() {
    const board = document.getElementById('ordersBoard');
    if (!board) return;
    board.querySelectorAll('[data-deliver-order-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const orderId = btn.getAttribute('data-deliver-order-id');
        const res = await apiPost('/api/deliver-order', { initData, orderId });
        if (!res.ok) alert(res.reason || 'Xatolik yuz berdi.');
        lastOrdersSnapshot = null;
        await refreshDeliveryBoard();
      });
    });
    board.querySelectorAll('[data-route-order-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const orderId = btn.getAttribute('data-route-order-id');
        const order = lastDeliveryOrdersById.get(orderId);
        const url = order ? deliveryRouteUrl(order) : null;
        if (url) openExternalLink(url);
      });
    });
    board.querySelectorAll('[data-reject-order-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        let reason = '';
        while (true) {
          reason = prompt('Buyurtma bekor qilinadi. Sababini yozing (majburiy):', reason || '');
          if (reason === null) return; // foydalanuvchi bekor qildi
          reason = reason.trim();
          if (reason) break;
          alert('Bekor qilish sababini yozish majburiy.');
        }
        btn.disabled = true;
        const orderId = btn.getAttribute('data-reject-order-id');
        const res = await apiPost('/api/reject-delivery-order', { initData, orderId, reason });
        if (!res.ok) { alert(res.reason || 'Xatolik yuz berdi.'); btn.disabled = false; return; }
        lastOrdersSnapshot = null;
        await refreshDeliveryBoard();
      });
    });
  }

  async function refreshDeliveryBoard() {
    const board = document.getElementById('ordersBoard');
    if (!board) { stopOrdersPolling(); return; }
    const res = await apiPost('/api/orders-list', { initData });
    if (!res.ok) {
      if (res.networkError && lastOrdersSnapshot === null) {
        renderNetworkErrorInline(board, res.reason, () => refreshDeliveryBoard());
      }
      return;
    }

    // 46-bosqich: kuryerga yetkazish uchun yangi tayyor buyurtma chiqsa — ovozli bildirishnoma
    const relevant = (res.orders || []).filter(o => o.orderType === 'dostavka' && o.status === 'tayyor' && !o.deliveredBy);
    const currentIds = new Set(relevant.map(o => o.id));
    if (knownOrderIds) {
      const hasNew = relevant.some(o => !knownOrderIds.has(o.id));
      if (hasNew) playNewOrderBeep();
    }
    knownOrderIds = currentIds;

    const snapshot = JSON.stringify(res.orders);
    if (snapshot === lastOrdersSnapshot) return;
    lastOrdersSnapshot = snapshot;
    board.innerHTML = deliveryBoardHtml(res.orders);
    attachDeliveryBoardHandlers();
  }

  function startDeliveryPolling() {
    stopOrdersPolling();
    refreshDeliveryBoard();
    ordersPollTimer = setInterval(refreshDeliveryBoard, 4000);
  }

  // onBack ixtiyoriy: kuryer xodim sifatida kirilganda berilmaydi;
  // egasi menyu-griddan ("Yetkazib berish") kirganda beriladi (12-bosqich).
  function renderDeliveryScreen(restaurantName, onBack) {
    // 13-bosqich: bitta vazifali rol — restoran nomi header'da (11-bosqich)
    // ko'rinadi, shu sabab bu yerda sarlavha bevosita vazifani nomlaydi.
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Yetkazib berish</div>
        ${onBack ? `<button class="btn ikkinchi" id="deliveryBackBtn" style="margin-bottom:12px;">← Orqaga</button>` : ''}
        <button class="btn ikkinchi" id="deliveryStatsBtn" style="margin-bottom:12px;">📊 Statistikam</button>
        ${onBack ? `<button class="btn ikkinchi" id="restrictedCustomersBtn" style="margin-bottom:12px;">🚫 Cheklangan mijozlar</button>` : ''}
        ${onBack ? `<button class="btn ikkinchi" id="ownerReviewsBtn" style="margin-bottom:12px;">⭐ Mijoz sharhlari</button>` : ''}
        ${soundToggleBtnHtml()}
        <div class="bosh">Tayyor bo'lgan dostavka buyurtmalari — yetkazib bergach "Yetkazildi" tugmasini bosing.</div>
        <div id="ordersBoard" class="orders-board-large" style="margin-top:14px;"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);
    if (onBack) document.getElementById('deliveryBackBtn').addEventListener('click', () => { stopOrdersPolling(); onBack(); });
    document.getElementById('deliveryStatsBtn').addEventListener('click', () => {
      stopOrdersPolling();
      renderMyStatsScreen(() => renderDeliveryScreen(restaurantName, onBack));
    });
    // 60-bosqich: bu tugma faqat egasi bu ekranga "Yetkazib berish" menyusi
    // orqali kirganda (onBack mavjud bo'lganda) ko'rinadi — kuryerning o'zi
    // (o'z asosiy ekrani, onBack yo'q) mijozlarni boshqara olmasligi kerak.
    const restrictedBtn = document.getElementById('restrictedCustomersBtn');
    if (restrictedBtn) {
      restrictedBtn.addEventListener('click', () => {
        stopOrdersPolling();
        renderRestrictedCustomersScreen(() => renderDeliveryScreen(restaurantName, onBack));
      });
    }
    const ownerReviewsBtn = document.getElementById('ownerReviewsBtn');
    if (ownerReviewsBtn) {
      ownerReviewsBtn.addEventListener('click', () => {
        stopOrdersPolling();
        renderReviewsScreen(null, 'Mijoz sharhlari', () => renderDeliveryScreen(restaurantName, onBack));
      });
    }
    attachSoundToggleHandler();
    startDeliveryPolling();
  }

  // ---- Egasi: "Faqat karta" bilan cheklangan mijozlar ro'yxati (60-bosqich) ----
  // Ketma-ket bir necha marta dostavkani bekor qildirgan mijozlarga tizim
  // avtomatik "naqd/dostavka orqali" to'lovni yopib qo'yadi. Bu ekranda
  // egasi kimlar shu holatda ekanini, nima sababdan bekor qilinganini
  // ko'radi va kerak bo'lsa cheklovni qo'lda olib tashlaydi/qaytaradi.
  function restrictedCustomerCardHtml(c) {
    const cancelsHtml = (c.recentCancellations || []).map(rc => `
      <div class="order-time" style="margin-top:4px;">
        ${timeAgo(rc.cancelledAt)} — ${fmtNum(rc.total)} so'm${rc.reason ? ' · ' + escapeHtml(rc.reason) : ''}
      </div>
    `).join('');
    return `
      <div class="order-card">
        <div class="order-top">
          <div>
            <div class="order-type">${escapeHtml(c.name)}${c.username ? ' · @' + escapeHtml(c.username) : ''}</div>
            <div class="order-time">Bekor qilingan dostavkalar: ${c.cancelledCount} ta</div>
          </div>
          <span class="status-badge ${c.restricted ? 'yangi' : 'tayyor'}">${c.restricted ? 'Cheklangan' : 'Cheklov olib tashlangan'}</span>
        </div>
        ${cancelsHtml}
        <button type="button" class="btn ikkinchi" style="width:100%; margin-top:10px;"
          data-toggle-restriction-id="${escapeHtml(String(c.id))}"
          data-toggle-restriction-action="${c.restricted ? 'clear' : 'restore'}">
          ${c.restricted ? '✅ Cheklovni olib tashlash' : '🚫 Cheklovni qayta tiklash'}
        </button>
      </div>
    `;
  }

  // ---- Mijoz sharhlari (65-bosqich) — egasi o'zi (targetOwnerId=null,
  // "Yetkazib berish" ekranidagi tugmadan) yoki admin istalgan do'kon uchun
  // (targetOwnerId bilan, "Do'kon egalari" ro'yxatidagi "⭐ Sharhlar"
  // tugmasidan) ochadi. Ikkalasi ham bir xil ma'lumotni ko'radi. ----
  async function renderReviewsScreen(targetOwnerId, title, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">${escapeHtml(title)}</div>
        <button class="btn ikkinchi" id="reviewsBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div id="reviewsSummary" class="bosh">Yuklanmoqda...</div>
        <div id="reviewsList" style="margin-top:14px;"></div>
      </div>
    `);
    document.getElementById('reviewsBackBtn').addEventListener('click', onBack);

    const summaryEl = document.getElementById('reviewsSummary');
    const listEl = document.getElementById('reviewsList');
    const body = targetOwnerId ? { initData, targetOwnerId } : { initData };
    const res = await apiPost('/api/owner-reviews', body);
    if (!res.ok) {
      if (res.networkError) { renderNetworkErrorInline(summaryEl, res.reason, () => renderReviewsScreen(targetOwnerId, title, onBack)); return; }
      summaryEl.textContent = res.reason || 'Xatolik yuz berdi.';
      return;
    }
    summaryEl.innerHTML = res.avgRating !== null
      ? `⭐ O'rtacha baho: <b>${escapeHtml(String(res.avgRating))}</b> (${res.ratingCount} ta baho)`
      : `Hozircha baho yo'q.`;
    if (!res.reviews.length) {
      listEl.innerHTML = `<div class="bosh">Hozircha sharhlar yo'q.</div>`;
      return;
    }
    listEl.innerHTML = res.reviews.map(r => `
      <div class="order-card">
        <div class="order-top">
          <div class="order-type">${'⭐️'.repeat(r.stars)}</div>
          <div class="order-time">${timeAgo(r.ratedAt)}</div>
        </div>
        ${r.comment ? `<div class="order-time" style="margin-top:6px;">"${escapeHtml(r.comment)}"</div>` : ''}
        ${r.customerName ? `<div class="order-time" style="margin-top:4px;">— ${escapeHtml(r.customerName)}</div>` : ''}
      </div>
    `).join('');
  }

  function renderAdminOwnerReviewsScreen(ownerId, ownerName, onBack) {
    renderReviewsScreen(ownerId, `${ownerName} — sharhlar`, onBack);
  }

  async function renderRestrictedCustomersScreen(onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Cheklangan mijozlar</div>
        <button class="btn ikkinchi" id="restrictedBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="bosh">Ketma-ket 2 marta yoki ko'proq dostavkani bekor qildirgan mijozlarga tizim avtomatik ravishda faqat "Karta" bilan to'lashni taklif qiladi. Sabab asosli bo'lsa, cheklovni bu yerdan olib tashlashingiz mumkin.</div>
        <div id="restrictedList" style="margin-top:14px;"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);
    document.getElementById('restrictedBackBtn').addEventListener('click', onBack);

    const listEl = document.getElementById('restrictedList');
    const res = await apiPost('/api/restricted-customers', { initData });
    if (!res.ok) {
      if (res.networkError) { renderNetworkErrorInline(listEl, res.reason, () => renderRestrictedCustomersScreen(onBack)); return; }
      listEl.innerHTML = `<div class="bosh">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
      return;
    }
    if (!res.customers.length) {
      listEl.innerHTML = `<div class="bosh">Hozircha cheklangan mijozlar yo'q.</div>`;
      return;
    }
    listEl.innerHTML = res.customers.map(restrictedCustomerCardHtml).join('');
    listEl.querySelectorAll('[data-toggle-restriction-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const customerId = btn.getAttribute('data-toggle-restriction-id');
        const action = btn.getAttribute('data-toggle-restriction-action');
        const res2 = await apiPost('/api/toggle-customer-restriction', { initData, customerId, action });
        if (!res2.ok) { alert(res2.reason || 'Xatolik yuz berdi.'); btn.disabled = false; return; }
        renderRestrictedCustomersScreen(onBack);
      });
    });
  }

  // ---- Sklad: birliklar, ro'yxat, kirim formasi, harakatlar tarixi, kunlik audit ----
  const STOCK_UNIT_LABELS = { kg: 'kg', g: 'g', l: 'l', ml: 'ml', dona: 'dona' };
  let stockState = { stock: [] };
  let currentStockRole = null;
  let currentStockBranchId = null;

  function stockListHtml(stock, canRemove, canTransfer) {
    if (!stock || !stock.length) return `<div class="bosh">Sklad hali bo'sh.</div>`;
    // Kam qolgan mahsulotlar ro'yxat boshida ko'rinsin — birinchi navbatda e'tibor talab qiladi.
    const sorted = stock.slice().sort((a, b) => {
      const lowA = a.minQty != null && a.qty <= a.minQty;
      const lowB = b.minQty != null && b.qty <= b.minQty;
      if (lowA !== lowB) return lowA ? -1 : 1;
      return 0;
    });
    return sorted.map(s => {
      const low = s.minQty !== null && s.minQty !== undefined && s.qty <= s.minQty;
      // Darajani vizual ko'rsatish uchun chegaraning ikki barobarini "to'liq" deb olamiz;
      // chegara qo'yilmagan bo'lsa — chiziq ko'rsatilmaydi (nisbiy solishtirish uchun asos yo'q).
      const levelPct = s.minQty != null && s.minQty > 0
        ? Math.max(4, Math.min(100, Math.round(s.qty / (s.minQty * 2) * 100)))
        : null;
      return `
        <div class="menu-item ${low ? 'low-stock' : ''}">
          <div style="flex:1;">
            <div class="m-name">${escapeHtml(s.name)}${low ? ' <span class="badge warning">Kam qoldi</span>' : ''}</div>
            <div class="m-price">${s.qty} ${escapeHtml(s.unit)}${s.minQty != null ? ' · chegara: ' + s.minQty + ' ' + escapeHtml(s.unit) : ''}</div>
            ${levelPct !== null ? `<div class="stock-level-track"><div class="stock-level-fill ${low ? 'low' : ''}" style="width:${levelPct}%;"></div></div>` : ''}
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
            ${canTransfer ? `<button data-transfer-stock-id="${escapeHtml(s.id)}" class="row-action-btn brand">Filialga o'tkazish</button>` : ''}
            ${canRemove ? `<button data-remove-stock-id="${escapeHtml(s.id)}" class="row-action-btn danger">O'chirish</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function movementTypeLabel(type) {
    return { kirim: 'Kirim', chiqim: 'Chiqim', audit_tuzatish: 'Audit tuzatish' }[type] || type;
  }

  function movementsListHtml(movements) {
    if (!movements || !movements.length) return `<div class="bosh">Hozircha harakatlar yo'q.</div>`;
    return movements.map(mv => `
      <div class="menu-item">
        <div>
          <div class="m-name">${escapeHtml(mv.stockName)} — ${movementTypeLabel(mv.type)}</div>
          ${mv.note ? `<div class="m-cat">${escapeHtml(mv.note)}</div>` : ''}
          <div class="m-price">${mv.qty > 0 ? '+' : ''}${mv.qty} ${escapeHtml(mv.unit)} · ${timeAgo(mv.createdAt)}</div>
        </div>
      </div>
    `).join('');
  }

  function renderStockScreen(restaurantName, role, onBack) {
    currentStockRole = role;
    currentStockBranchId = null;
    ekran(`
      <div class="panel">
        ${onBack ? `<button class="btn ikkinchi" id="stockBackBtn" style="margin-bottom:12px;">← Orqaga</button>` : ''}
        <div class="salom" style="font-size:20px;">Sklad</div>
        ${role !== 'egasi' ? `<button class="btn ikkinchi" id="stockStatsBtn" style="margin-bottom:12px;">📊 Statistikam</button>` : ''}
        ${role === 'egasi' ? `
        <div class="kartochka">
          <h2>Joylashuv</h2>
          <select id="stockBranchSelect">${branchOptionsHtml(null).replace('— Markaziy (filialsiz) —', 'Markaziy sklad')}</select>
        </div>` : ''}
        <div class="kartochka">
          <h2>Mahsulot kiritish (kirim)</h2>
          <input type="text" id="stockNameInput" placeholder="Mahsulot nomi">
          <input type="text" id="stockQtyInput" placeholder="Miqdor" inputmode="decimal">
          <select id="stockUnitInput">
            ${Object.entries(STOCK_UNIT_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
          </select>
          <input type="text" id="stockPriceInput" placeholder="Narxi, so'm *" inputmode="numeric">
          <input type="text" id="stockMinInput" placeholder="Kam qolish chegarasi (ixtiyoriy)" inputmode="decimal">
          <button class="btn" id="stockAddBtn">Qo'shish</button>
          <div class="xabar" id="stockAddMsg"></div>
        </div>
        <div class="kartochka">
          <h2>${icon('box', 'icon-xs')} Sklad qoldig'i</h2>
          <div id="stockList"><div class="bosh">Yuklanmoqda...</div></div>
          <button class="btn ikkinchi" id="openAuditBtn" style="margin-top:10px;">${icon('clipboard', 'icon-xs')} Kunlik audit qilish</button>
        </div>
        <div class="kartochka">
          <h2>${icon('trending-up', 'icon-xs')} Harakatlar tarixi</h2>
          <div id="stockMovements"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        ${role === 'egasi' ? menuAddSectionHtml() : ''}
      </div>
    `);

    if (onBack) document.getElementById('stockBackBtn').addEventListener('click', onBack);
    if (role !== 'egasi') {
      document.getElementById('stockStatsBtn').addEventListener('click', () => {
        renderMyStatsScreen(() => renderStockScreen(restaurantName, role, onBack));
      });
    }

    if (role === 'egasi') {
      document.getElementById('stockBranchSelect').addEventListener('change', (e) => {
        currentStockBranchId = e.target.value || null;
        loadStockAndRender();
        loadMovementsAndRender();
      });
      // Admin boshqa egasi nomidan kirganda (adminTargetOwnerId), eski
      // keshlangan branchState o'sha egasiga tegishli bo'lmasligi mumkin —
      // shu sababli ekran ochilganda filiallar ro'yxati har doim qayta
      // so'raladi va select yangilanadi.
      apiPost('/api/branch-list', { initData }).then(res => {
        branchState.branches = res.ok ? res.branches : [];
        const sel = document.getElementById('stockBranchSelect');
        if (sel) {
          const current = sel.value;
          sel.innerHTML = branchOptionsHtml(current).replace('— Markaziy (filialsiz) —', 'Markaziy sklad');
        }
      });
    }

    document.getElementById('stockAddBtn').addEventListener('click', async () => {
      const msgEl = document.getElementById('stockAddMsg');
      const name = document.getElementById('stockNameInput').value.trim();
      const qty = document.getElementById('stockQtyInput').value.trim();
      const unit = document.getElementById('stockUnitInput').value;
      const price = document.getElementById('stockPriceInput').value.trim();
      const minQty = document.getElementById('stockMinInput').value.trim();
      if (!name || !qty || !Number.isFinite(Number(qty)) || Number(qty) <= 0) {
        msgEl.textContent = 'Nomi va to\'g\'ri miqdorni kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      // 5-bosqich: narx endi majburiy — har bir kirim uchun avtomatik
      // xarajat yozuvi (Moliya) shu narxdan hisoblanadi.
      if (!price || !Number.isFinite(Number(price)) || Number(price) <= 0) {
        msgEl.textContent = 'Narxni kiriting — u avtomatik xarajat yozish uchun kerak.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Qo\'shilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/stock-add', { initData, name, qty, unit, price, minQty, branchId: currentStockBranchId });
      if (res.ok) {
        msgEl.textContent = 'Qo\'shildi. Xarajat Moliyaga avtomatik yozildi.';
        msgEl.className = 'xabar ok';
        document.getElementById('stockNameInput').value = '';
        document.getElementById('stockQtyInput').value = '';
        document.getElementById('stockPriceInput').value = '';
        document.getElementById('stockMinInput').value = '';
        loadStockAndRender();
        loadMovementsAndRender();
      } else {
        handleFeatureBlocked(res);
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    document.getElementById('openAuditBtn').addEventListener('click', () => openAuditForm());

    if (role === 'egasi') {
      attachMenuAddSectionHandlers();
    }

    loadStockAndRender();
    loadMovementsAndRender();
  }

  async function loadStockAndRender() {
    const el = document.getElementById('stockList');
    if (!el) return;
    const res = await apiPost('/api/stock-list', { initData, branchId: currentStockBranchId });
    if (res.networkError) { renderNetworkErrorInline(el, res.reason, loadStockAndRender); return; }
    stockState.stock = res.ok ? res.stock : [];
    const canTransfer = currentStockRole === 'egasi' && !currentStockBranchId && branchState.branches.length > 0;
    el.innerHTML = stockListHtml(stockState.stock, currentStockRole === 'egasi', canTransfer);
    el.querySelectorAll('[data-remove-stock-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await apiPost('/api/stock-remove', { initData, id: btn.getAttribute('data-remove-stock-id'), branchId: currentStockBranchId });
        loadStockAndRender();
      });
    });
    el.querySelectorAll('[data-transfer-stock-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-transfer-stock-id');
        const item = stockState.stock.find(s => s.id === id);
        if (item) openTransferForm(item);
      });
    });
  }

  // ---- Markaziy skladdan filialga o'tkazish (transfer) oynasi ----
  function openTransferForm(item) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px;">
        <h3>Filialga o'tkazish</h3>
        <p>${escapeHtml(item.name)} — omborda: ${item.qty} ${escapeHtml(item.unit)}</p>
        <select id="transferBranchSelect">${branchOptionsHtml(null).replace('<option value="">— Markaziy (filialsiz) —</option>', '')}</select>
        <input type="text" id="transferQtyInput" placeholder="Miqdor (${escapeHtml(item.unit)})" inputmode="decimal">
        <div class="xabar" id="transferMsg"></div>
        <div class="btn-row">
          <button class="btn ikkinchi" id="transferCancelBtn">Bekor qilish</button>
          <button class="btn" id="transferSubmitBtn">O'tkazish</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('transferCancelBtn').onclick = () => overlay.remove();
    document.getElementById('transferSubmitBtn').onclick = async () => {
      const branchId = document.getElementById('transferBranchSelect').value;
      const qty = document.getElementById('transferQtyInput').value.trim();
      const msgEl = document.getElementById('transferMsg');
      if (!branchId) {
        msgEl.textContent = 'Filialni tanlang.';
        msgEl.className = 'xabar err';
        return;
      }
      if (!qty || !Number.isFinite(Number(qty)) || Number(qty) <= 0) {
        msgEl.textContent = 'To\'g\'ri miqdor kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'O\'tkazilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/stock-transfer', { initData, stockId: item.id, branchId, qty });
      if (res.ok) {
        overlay.remove();
        loadStockAndRender();
        loadMovementsAndRender();
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    };
  }

  async function loadMovementsAndRender() {
    const el = document.getElementById('stockMovements');
    if (!el) return;
    const res = await apiPost('/api/stock-movements', { initData, branchId: currentStockBranchId });
    if (res.networkError) { renderNetworkErrorInline(el, res.reason, loadMovementsAndRender); return; }
    el.innerHTML = movementsListHtml(res.ok ? res.movements : []);
  }

  // ---- Kunlik audit: haqiqiy qoldiqni kiritish oynasi ----
  function openAuditForm() {
    const stock = stockState.stock;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const rowsHtml = stock.length ? stock.map(s => `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <div style="flex:1; font-size:14px;">${escapeHtml(s.name)} <span style="opacity:.6;">(tizimda: ${s.qty} ${escapeHtml(s.unit)})</span></div>
        <input type="text" inputmode="decimal" data-audit-qty="${escapeHtml(s.id)}" placeholder="${s.qty}" style="width:80px; margin:0;">
      </div>
    `).join('') : `<div class="bosh">Sklad bo'sh.</div>`;

    overlay.innerHTML = `
      <div class="modal" style="max-width:380px; max-height:80vh; overflow:auto;">
        <h3>Kunlik audit</h3>
        <p>Har bir mahsulotning haqiqiy (ko'zdan kechirilgan) qoldig'ini kiriting. Bo'sh qoldirilsa — o'zgarmaydi.</p>
        <div>${rowsHtml}</div>
        <div class="xabar" id="auditMsg"></div>
        <div class="btn-row">
          <button class="btn ikkinchi" id="auditCancelBtn">Bekor qilish</button>
          <button class="btn" id="auditSubmitBtn">Yuborish</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('auditCancelBtn').onclick = () => overlay.remove();
    document.getElementById('auditSubmitBtn').onclick = async () => {
      const entries = [];
      overlay.querySelectorAll('[data-audit-qty]').forEach(inp => {
        const val = inp.value.trim();
        if (val === '') return;
        const num = Number(val);
        if (Number.isFinite(num) && num >= 0) {
          entries.push({ stockId: inp.getAttribute('data-audit-qty'), actualQty: num });
        }
      });
      const msgEl = document.getElementById('auditMsg');
      if (!entries.length) {
        msgEl.textContent = 'Kamida bitta mahsulot uchun qoldiq kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Yuborilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/audit-submit', { initData, entries, branchId: currentStockBranchId });
      if (res.ok) {
        overlay.remove();
        showAuditReport(res.audit);
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    };
  }

  // ---- Umumiy mini-grafik yordamchilari (21-bosqich): Z-hisobot va Moliya trendlari uchun ----
  // Sanani qisqa "kun.oy" ko'rinishida chiqaradi (masalan "2026-07-21" → "21.07")
  function shortDateLabel(dateKey) {
    const parts = String(dateKey || '').split('-');
    if (parts.length !== 3) return dateKey || '';
    return `${parts[2]}.${parts[1]}`;
  }

  // Bitta qatorli ustunli grafik: har bir kun uchun bitta ustun (musbat — success, manfiy — danger).
  // points: [{ label, value }] — eng ko'pi bilan oxirgi ~14 nuqta chiroyli sig'adi.
  function trendBarChartSvg(points) {
    if (!points || !points.length) return `<div class="bosh">Hali ma'lumot yo'q.</div>`;
    const W = 300, H = 120, padTop = 10, padBottom = 20, padSide = 6;
    const chartH = H - padTop - padBottom;
    const maxAbs = Math.max(1, ...points.map(p => Math.abs(p.value)));
    const n = points.length;
    const slot = (W - padSide * 2) / n;
    const barW = Math.max(4, Math.min(22, slot * 0.55));
    const zeroY = padTop + chartH / 2;
    const bars = points.map((p, i) => {
      const cx = padSide + slot * i + slot / 2;
      const h = Math.abs(p.value) / maxAbs * (chartH / 2 - 4);
      const y = p.value >= 0 ? zeroY - h : zeroY;
      const cls = p.value >= 0 ? 'trend-bar-pos' : 'trend-bar-neg';
      return `<rect class="${cls}" x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2"></rect>
        <text class="trend-label" x="${cx.toFixed(1)}" y="${H - 4}" text-anchor="middle">${escapeHtml(p.label)}</text>`;
    }).join('');
    return `
      <svg class="trend-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sof foyda dinamikasi">
        <line class="trend-axis" x1="0" y1="${zeroY.toFixed(1)}" x2="${W}" y2="${zeroY.toFixed(1)}"></line>
        ${bars}
      </svg>
    `;
  }

  // Ikki qatorli (kirim/chiqim) taqqoslash grafigi — har bir kun uchun ikkita yonma-yon ustun.
  // points: [{ label, income, expense }]
  function incomeExpenseChartSvg(points) {
    if (!points || !points.length) return `<div class="bosh">Hali ma'lumot yo'q.</div>`;
    const W = 300, H = 130, padTop = 10, padBottom = 20, padSide = 6;
    const chartH = H - padTop - padBottom;
    const maxVal = Math.max(1, ...points.map(p => Math.max(p.income, p.expense)));
    const n = points.length;
    const slot = (W - padSide * 2) / n;
    const barW = Math.max(3, Math.min(11, slot * 0.32));
    const gap = 2;
    const baseY = padTop + chartH;
    const bars = points.map((p, i) => {
      const cx = padSide + slot * i + slot / 2;
      const hIncome = p.income / maxVal * chartH;
      const hExpense = p.expense / maxVal * chartH;
      const xIncome = cx - barW - gap / 2;
      const xExpense = cx + gap / 2;
      return `
        <rect class="trend-bar-income" x="${xIncome.toFixed(1)}" y="${(baseY - hIncome).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, hIncome).toFixed(1)}" rx="2"></rect>
        <rect class="trend-bar-expense" x="${xExpense.toFixed(1)}" y="${(baseY - hExpense).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, hExpense).toFixed(1)}" rx="2"></rect>
        <text class="trend-label" x="${cx.toFixed(1)}" y="${H - 4}" text-anchor="middle">${escapeHtml(p.label)}</text>
      `;
    }).join('');
    return `
      <svg class="trend-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Savdo va xarajat dinamikasi">
        <line class="trend-axis" x1="0" y1="${baseY.toFixed(1)}" x2="${W}" y2="${baseY.toFixed(1)}"></line>
        ${bars}
      </svg>
      <div class="chart-legend">
        <div class="chart-legend-item"><span class="chart-legend-dot income"></span>Kirim</div>
        <div class="chart-legend-item"><span class="chart-legend-dot expense"></span>Chiqim</div>
      </div>
    `;
  }

  // Kategoriya taqsimotini gorizontal ustunlar (bar) ko'rinishida chiqaradi — eng kattasi 100%.
  // rows: [{ name, sum }]
  function categoryBarChartHtml(rows) {
    if (!rows || !rows.length) return '';
    const maxSum = Math.max(1, ...rows.map(r => r.sum));
    return rows.map(r => `
      <div class="cat-bar-row">
        <div class="cat-bar-top"><span class="cat-bar-name">${escapeHtml(r.name)}</span><span class="cat-bar-sum">${cfFormatSum(r.sum)}</span></div>
        <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${Math.max(3, Math.round(r.sum / maxSum * 100))}%;"></div></div>
      </div>
    `).join('');
  }

  // ---- Egasi: Moliya (Cashflow) — kirim (savdo) / chiqim (xarajat), kunlik/haftalik/oylik ----
  let cashflowState = { period: 'today' };
  let cashflowCategories = { ijara: 'Ijara', maosh: 'Maosh', kommunal: 'Kommunal', mahsulot: 'Mahsulot xaridi', boshqa: 'Boshqa' };

  function cfFormatSum(n) {
    return fmtNum(n) + " so'm";
  }

  function cfCategoryOptionsHtml() {
    return Object.entries(cashflowCategories).map(([k, label]) => `<option value="${escapeHtml(k)}">${escapeHtml(label)}</option>`).join('');
  }

  function cashflowStatsHtml(cf) {
    const bucket = cf[cashflowState.period];
    const netClass = bucket.net >= 0 ? 'positive' : 'negative';
    return `
      <div class="cf-stats">
        <div class="cf-stat income">
          <div class="cf-label">Kirim (savdo)</div>
          <div class="cf-val">${cfFormatSum(bucket.income)}</div>
        </div>
        <div class="cf-stat expense">
          <div class="cf-label">Chiqim (xarajat)</div>
          <div class="cf-val">${cfFormatSum(bucket.expense)}</div>
        </div>
        <div class="cf-stat net ${netClass}" style="grid-column: 1 / -1;">
          <div class="cf-label">Sof foyda</div>
          <div class="cf-val">${cfFormatSum(bucket.net)}</div>
        </div>
      </div>
      <div class="kartochka" style="margin-top:10px;">
        <h2>Kassa va dostavka (alohida)</h2>
        <div class="profile-row"><b>Kassadagi pul</b> (stolga/olib ketish): ${cfFormatSum(bucket.kassaIncome)}</div>
        <div class="profile-row"><b>Kuryer qo'lidagi pul:</b> ${cfFormatSum(bucket.dostavkaIncome)} (${bucket.dostavkaOrderCount} ta buyurtma)</div>
      </div>
      <div class="bosh" style="margin-top:8px;">Buyurtmalar soni: ${bucket.orderCount}</div>
      ${cfCategoryBreakdownHtml(bucket.byCategory)}
    `;
  }

  function cfCategoryBreakdownHtml(byCategory) {
    if (!byCategory) return '';
    const rows = Object.entries(byCategory)
      .filter(([, sum]) => sum > 0)
      .map(([key, sum]) => ({ name: cashflowCategories[key] || key, sum }))
      .sort((a, b) => b.sum - a.sum);
    if (!rows.length) return '';
    return `
      <div class="kartochka" style="margin-top:10px;">
        <h2>Xarajat kategoriyalari</h2>
        ${categoryBarChartHtml(rows)}
      </div>
    `;
  }

  function cashflowExpensesHtml(expenses) {
    if (!expenses.length) return `<div class="bosh">Xarajat kiritilmagan.</div>`;
    return expenses.map(e => `
      <div class="cf-expense-item">
        <div>
          <div class="cf-e-amount">-${cfFormatSum(e.amount)}</div>
          <div class="cf-e-note">${escapeHtml(cashflowCategories[e.category] || 'Boshqa')}${e.note ? ' — ' + escapeHtml(e.note) : ''}</div>
          <div class="cf-e-date">${new Date(e.createdAt).toLocaleString('uz-UZ')}</div>
        </div>
        <button data-remove-expense="${escapeHtml(e.id)}">O'chirish</button>
      </div>
    `).join('');
  }

  function renderCashflowScreen(profile, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Moliya</div>
        <button class="btn ikkinchi" id="cfBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <button class="btn ikkinchi" id="cfCourierReportBtn" style="margin-bottom:12px;">${icon('scooter', 'icon-xs')} Kuryerlar hisoboti</button>
        <button class="btn ikkinchi" id="cfZReportBtn" style="margin-bottom:12px;">${icon('clipboard', 'icon-xs')} Kunlik Z-hisobot</button>
        <button class="btn ikkinchi" id="cfOrderHistoryBtn" style="margin-bottom:12px;">${icon('clipboard', 'icon-xs')} Buyurtmalar tarixi</button>
        <div class="tab-row">
          <div class="tab-opt ${cashflowState.period === 'today' ? 'selected' : ''}" data-cf-period="today">Bugun</div>
          <div class="tab-opt ${cashflowState.period === 'week' ? 'selected' : ''}" data-cf-period="week">Hafta</div>
          <div class="tab-opt ${cashflowState.period === 'month' ? 'selected' : ''}" data-cf-period="month">Oy</div>
        </div>
        <div id="cfStats"><div class="bosh">Yuklanmoqda...</div></div>
        <div class="kartochka chart-card">
          <h2>${icon('trending-up', 'icon-xs')} Savdo va xarajat dinamikasi</h2>
          <div class="bosh">Oxirgi yopilgan kunlar bo'yicha (Z-hisobot asosida).</div>
          <div id="cfTrendChart"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        ${branchState.branches.length ? `
        <div class="kartochka">
          <h2>Filiallar solishtiruvi</h2>
          <div id="cfBranchReport"><div class="bosh">Yuklanmoqda...</div></div>
        </div>` : ''}
        <div class="kartochka">
          <h2>Xarajat qo'shish</h2>
          <input type="text" id="cfAmountInput" placeholder="Summa (so'm)" inputmode="numeric">
          <select id="cfCategoryInput">${cfCategoryOptionsHtml()}</select>
          <input type="text" id="cfNoteInput" placeholder="Izoh (ixtiyoriy)">
          <button class="btn" id="cfAddExpenseBtn">Qo'shish</button>
          <div class="xabar" id="cfExpenseMsg"></div>
        </div>
        <div class="kartochka">
          <h2>So'nggi xarajatlar</h2>
          <div id="cfExpenseList"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
      </div>
    `);

    document.getElementById('cfBackBtn').addEventListener('click', () => onBack && onBack());
    document.getElementById('cfCourierReportBtn').addEventListener('click', () => {
      renderCourierReportScreen(profile, () => renderCashflowScreen(profile, onBack));
    });
    document.getElementById('cfZReportBtn').addEventListener('click', () => {
      renderZReportScreen(profile, () => renderCashflowScreen(profile, onBack));
    });
    document.getElementById('cfOrderHistoryBtn').addEventListener('click', () => {
      renderOrderHistoryScreen(profile, () => renderCashflowScreen(profile, onBack));
    });

    document.querySelector('.tab-row').addEventListener('click', (e) => {
      const p = e.target.getAttribute('data-cf-period');
      if (!p || p === cashflowState.period) return;
      cashflowState.period = p;
      renderCashflowScreen(profile, onBack);
    });

    document.getElementById('cfAddExpenseBtn').addEventListener('click', async () => {
      const amount = document.getElementById('cfAmountInput').value.trim();
      const category = document.getElementById('cfCategoryInput').value;
      const note = document.getElementById('cfNoteInput').value.trim();
      const msgEl = document.getElementById('cfExpenseMsg');
      if (!amount || !/^\d+$/.test(amount) || parseInt(amount, 10) <= 0) {
        msgEl.textContent = 'To\'g\'ri summa kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Qo\'shilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/expense-add', { initData, amount, category, note });
      if (res.ok) {
        document.getElementById('cfAmountInput').value = '';
        document.getElementById('cfNoteInput').value = '';
        loadCashflowData();
      } else {
        handleFeatureBlocked(res);
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    loadCashflowData();
    loadCfTrendChart();
    if (branchState.branches.length) loadBranchReportAndRender();
  }

  // Moliya ekranidagi "Savdo va xarajat dinamikasi" grafigi — saqlangan Z-hisobotlar (oxirgi kunlar)ga asoslanadi.
  async function loadCfTrendChart() {
    const el = document.getElementById('cfTrendChart');
    if (!el) return;
    const res = await apiPost('/api/z-report-list', { initData });
    if (res.networkError) { renderNetworkErrorInline(el, res.reason, loadCfTrendChart); return; }
    if (!res.ok || !res.reports || !res.reports.length) {
      el.innerHTML = `<div class="bosh">Grafik uchun hali yopilgan kun yo'q. "Kunlik Z-hisobot" bo'limidan kunni yoping.</div>`;
      return;
    }
    const points = res.reports.slice(0, 7).slice().reverse().map(z => ({
      label: shortDateLabel(z.date), income: z.income, expense: z.expense
    }));
    el.innerHTML = incomeExpenseChartSvg(points);
  }

  function branchReportHtml(report) {
    if (!report || !report.length) return `<div class="bosh">Ma'lumot yo'q.</div>`;
    const maxIncome = Math.max(1, ...report.map(r => r.income));
    return report.map(r => `
      <div class="menu-item">
        <div style="flex:1;">
          <div class="m-name">${escapeHtml(r.branchName)}</div>
          <div class="m-price">${cfFormatSum(r.income)} · ${r.orderCount} buyurtma · o'rtacha chek: ${cfFormatSum(r.avgCheck)}</div>
          <div style="background:rgba(120,120,120,.2); border-radius:4px; height:6px; margin-top:6px; overflow:hidden;">
            <div style="background:var(--tg-theme-button-color,#2ea6ff); height:100%; width:${Math.round(r.income / maxIncome * 100)}%;"></div>
          </div>
        </div>
      </div>
    `).join('');
  }

  async function loadBranchReportAndRender() {
    const el = document.getElementById('cfBranchReport');
    if (!el) return;
    const res = await apiPost('/api/branch-report', { initData, period: cashflowState.period });
    if (res.networkError) { renderNetworkErrorInline(el, res.reason, loadBranchReportAndRender); return; }
    el.innerHTML = branchReportHtml(res.ok ? res.report : []);
  }

  async function loadCashflowData() {
    const statsEl = document.getElementById('cfStats');
    const listEl = document.getElementById('cfExpenseList');
    const msgEl = document.getElementById('cfExpenseMsg');
    if (!statsEl || !listEl) return;
    const res = await apiPost('/api/cashflow', { initData });
    if (res.networkError) {
      renderNetworkErrorInline(statsEl, res.reason, loadCashflowData);
      listEl.innerHTML = '';
      return;
    }
    if (!res.ok) {
      statsEl.innerHTML = `<div class="xabar err">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
      return;
    }
    if (msgEl) { msgEl.textContent = ''; msgEl.className = 'xabar'; }
    if (res.categories) cashflowCategories = res.categories;
    statsEl.innerHTML = cashflowStatsHtml(res.cashflow);
    listEl.innerHTML = cashflowExpensesHtml(res.expenses);

    listEl.querySelectorAll('[data-remove-expense]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await apiPost('/api/expense-remove', { initData, id: btn.getAttribute('data-remove-expense') });
        loadCashflowData();
      });
    });
  }

  // ---- Egasi: H. AI analitika (32-34-bosqich) — top taomlar, pik vaqtlar, ertangi sklad ehtiyoji, AI savol-javob ----
  let aiState = { period: 'week' };
  // Chat tarixi shu sessiya davomida saqlanadi (sahifa yangilansa tozalanadi) — { role: 'user'|'bot', text, isError }
  let aiChatState = { messages: [], sending: false };
  const AI_SUGGESTIONS = [
    "Bugun foyda qancha bo'ldi?",
    'Eng ko\'p sotilgan taom qaysi?',
    "Ertaga sklad kerakmi?",
    'Bu hafta qanday o\'tdi?'
  ];

  function aiTopItemsHtml(topItems) {
    if (!topItems || !topItems.length) return `<div class="bosh">Bu davrda buyurtma bo'lmagan.</div>`;
    const maxQty = Math.max(1, ...topItems.map(it => it.qty));
    return topItems.map((it, i) => `
      <div class="menu-item">
        <div style="flex:1;">
          <div class="m-name">${i + 1}. ${escapeHtml(it.name)}</div>
          <div class="m-price">${it.qty} dona · ${cfFormatSum(it.revenue)}</div>
          <div style="background:rgba(120,120,120,.2); border-radius:4px; height:6px; margin-top:6px; overflow:hidden;">
            <div style="background:var(--tg-theme-button-color,#2ea6ff); height:100%; width:${Math.round(it.qty / maxQty * 100)}%;"></div>
          </div>
        </div>
      </div>
    `).join('');
  }

  function aiPeakHtml(topHours, topDays) {
    const hoursText = (topHours && topHours.length)
      ? topHours.map(h => `${h.hour}:00 (${h.count} ta)`).join(', ')
      : 'Ma\'lumot yo\'q';
    const daysText = (topDays && topDays.length)
      ? topDays.map(d => `${d.dayLabel} (${d.count} ta)`).join(', ')
      : 'Ma\'lumot yo\'q';
    return `
      <div class="profile-row"><b>Eng band soatlar:</b> ${escapeHtml(hoursText)}</div>
      <div class="profile-row"><b>Eng band kunlar:</b> ${escapeHtml(daysText)}</div>
    `;
  }

  function aiForecastHtml(forecast) {
    if (!forecast || !forecast.length) return `<div class="bosh">Prognoz uchun yetarli sklad harakati tarixi yo'q (oxirgi 7 kun).</div>`;
    const urgentCount = forecast.filter(f => f.urgent).length;
    const urgentNote = urgentCount
      ? `<div class="xabar err" style="margin-bottom:8px;">⚠️ ${urgentCount} ta mahsulot 3 kun ichida tugashi mumkin.</div>`
      : '';
    return urgentNote + forecast.slice(0, 10).map(f => `
      <div class="menu-item">
        <div style="flex:1;">
          <div class="m-name">${escapeHtml(f.name)}${f.urgent ? ' ' + icon('warning', 'icon-xs icon-warning') : ''}</div>
          <div class="m-price">Bor: ${f.currentQty} ${escapeHtml(f.unit)} · Kunlik o'rtacha sarf: ${f.avgDailyUsage} ${escapeHtml(f.unit)}</div>
          <div class="m-price">${f.daysLeft === null ? 'Muddatni hisoblab bo\'lmadi' : (f.daysLeft < 1 ? 'Bugun-erta tugashi mumkin' : `Taxminan ${f.daysLeft} kunga yetadi`)}</div>
        </div>
      </div>
    `).join('');
  }

  // ---- AI chat: xabarlar ro'yxati, so'rov jo'natish va avtomatik pastga skroll ----
  function aiChatMessagesHtml() {
    if (!aiChatState.messages.length) {
      return `<div class="ai-msg-empty">Savolingizni yozing yoki quyidagi takliflardan birini tanlang.</div>`;
    }
    const bubbles = aiChatState.messages.map(m => `
      <div class="ai-msg ${m.role}">
        <div class="ai-msg-bubble${m.isError ? ' err' : ''}">${escapeHtml(m.text)}</div>
      </div>
    `).join('');
    const typing = aiChatState.sending ? `
      <div class="ai-msg bot">
        <div class="ai-msg-bubble">
          <div class="ai-typing-bubble"><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span></div>
        </div>
      </div>
    ` : '';
    return bubbles + typing;
  }

  function aiScrollChatToBottom() {
    const el = document.getElementById('aiChatMessages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function aiRenderChat() {
    const el = document.getElementById('aiChatMessages');
    if (!el) return;
    el.innerHTML = aiChatMessagesHtml();
    aiScrollChatToBottom();
  }

  async function aiSendQuestion(question) {
    const qTrim = (question || '').trim();
    if (!qTrim || aiChatState.sending) return;
    aiChatState.messages.push({ role: 'user', text: qTrim });
    aiChatState.sending = true;
    aiRenderChat();

    const input = document.getElementById('aiQuestionInput');
    const sendBtn = document.getElementById('aiSendBtn');
    if (input) input.value = '';
    if (sendBtn) sendBtn.disabled = true;

    const res = await apiPost('/api/ai-ask', { initData, question: qTrim });
    aiChatState.sending = false;
    if (res.ok) {
      aiChatState.messages.push({ role: 'bot', text: res.answer });
    } else {
      aiChatState.messages.push({ role: 'bot', text: res.reason || 'Xatolik yuz berdi.', isError: true });
    }
    aiRenderChat();
    if (sendBtn) sendBtn.disabled = false;
    if (input) input.focus();
  }

  function renderAiScreen(profile, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">AI tahlil</div>
        <button class="btn ikkinchi" id="aiBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="tab-row">
          <div class="tab-opt ${aiState.period === 'week' ? 'selected' : ''}" data-ai-period="week">Hafta</div>
          <div class="tab-opt ${aiState.period === 'month' ? 'selected' : ''}" data-ai-period="month">Oy</div>
          <div class="tab-opt ${aiState.period === 'all' ? 'selected' : ''}" data-ai-period="all">Hammasi</div>
        </div>
        <div class="kartochka">
          <h2>Eng ko'p sotilgan taomlar</h2>
          <div id="aiTopItems"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        <div class="kartochka">
          <h2>Pik vaqtlar</h2>
          <div id="aiPeak"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        <div class="kartochka">
          <h2>Ertangi sklad ehtiyoji (prognoz)</h2>
          <div id="aiForecast"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        <div class="kartochka">
          <h2>🤖 AI Direktor — kunlik hisobot</h2>
          <div class="bosh" style="margin-bottom:8px;">Har kuni soat 08:00 (Toshkent) shu hisobot avtomatik Telegram'ga yuboriladi.</div>
          <label class="check-label" style="font-size:var(--fs-body);">
            <input type="checkbox" id="aiDirDailyToggle">
            Avtomatik kunlik hisobotni yoqish
          </label>
          <div id="aiDirDailyText" class="bosh" style="margin-top:8px;">Yuklanmoqda...</div>
          <button class="btn ikkinchi" id="aiDirDailySendBtn" style="margin-top:10px;">Hozir yubor</button>
          <div class="xabar" id="aiDirDailyMsg"></div>
        </div>
        <div class="kartochka">
          <h2>📅 AI Direktor — haftalik hisobot</h2>
          <div class="bosh" style="margin-bottom:8px;">Har Dushanba soat 08:00 (Toshkent) haftalik yig'ma hisobot avtomatik Telegram'ga yuboriladi.</div>
          <label class="check-label" style="font-size:var(--fs-body);">
            <input type="checkbox" id="aiDirWeeklyToggle">
            Avtomatik haftalik hisobotni yoqish
          </label>
          <div id="aiDirWeeklyText" class="bosh" style="margin-top:8px;">Yuklanmoqda...</div>
          <button class="btn ikkinchi" id="aiDirWeeklySendBtn" style="margin-top:10px;">Hozir yubor</button>
          <div class="xabar" id="aiDirWeeklyMsg"></div>
        </div>
        <div class="kartochka ai-chat-card">
          <h2>${icon('ai', 'icon-xs')} AI-yordamchi</h2>
          <div class="ai-chat-messages" id="aiChatMessages">${aiChatMessagesHtml()}</div>
          <div class="ai-suggest-row" id="aiSuggestRow">
            ${AI_SUGGESTIONS.map(s => `<button type="button" class="ai-suggest-chip" data-ai-suggest="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
          </div>
          <div class="ai-chat-input-row">
            <input type="text" id="aiQuestionInput" placeholder="Savolingizni yozing...">
            <button class="btn ai-send-btn" id="aiSendBtn" aria-label="Yuborish">${icon('send')}</button>
          </div>
        </div>
      </div>
    `);

    document.getElementById('aiBackBtn').addEventListener('click', () => onBack && onBack());

    document.querySelector('.tab-row').addEventListener('click', (e) => {
      const p = e.target.getAttribute('data-ai-period');
      if (!p || p === aiState.period) return;
      aiState.period = p;
      renderAiScreen(profile, onBack);
    });

    const questionInput = document.getElementById('aiQuestionInput');
    document.getElementById('aiSendBtn').addEventListener('click', () => aiSendQuestion(questionInput.value));
    questionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); aiSendQuestion(questionInput.value); }
    });
    document.getElementById('aiSuggestRow').addEventListener('click', (e) => {
      const q = e.target.getAttribute('data-ai-suggest');
      if (q) aiSendQuestion(q);
    });

    document.getElementById('aiDirDailyToggle').addEventListener('change', async (e) => {
      const checked = e.target.checked;
      e.target.disabled = true;
      const res = await apiPost('/api/ai-director-toggle', { initData, enabled: checked });
      e.target.disabled = false;
      if (!res.ok) { e.target.checked = !checked; alert(res.reason || 'Xatolik yuz berdi.'); }
    });
    document.getElementById('aiDirDailySendBtn').addEventListener('click', async () => {
      const btn = document.getElementById('aiDirDailySendBtn');
      const msgEl = document.getElementById('aiDirDailyMsg');
      btn.disabled = true;
      const res = await apiPost('/api/ai-director-send-now', { initData });
      btn.disabled = false;
      if (!res.ok) { msgEl.textContent = res.reason || 'Xatolik yuz berdi.'; msgEl.className = 'xabar err'; return; }
      msgEl.textContent = 'Yuborildi — Telegram\'dagi bot xabarini tekshiring.';
      msgEl.className = 'xabar ok';
    });

    document.getElementById('aiDirWeeklyToggle').addEventListener('change', async (e) => {
      const checked = e.target.checked;
      e.target.disabled = true;
      const res = await apiPost('/api/ai-director-weekly-toggle', { initData, enabled: checked });
      e.target.disabled = false;
      if (!res.ok) { e.target.checked = !checked; alert(res.reason || 'Xatolik yuz berdi.'); }
    });
    document.getElementById('aiDirWeeklySendBtn').addEventListener('click', async () => {
      const btn = document.getElementById('aiDirWeeklySendBtn');
      const msgEl = document.getElementById('aiDirWeeklyMsg');
      btn.disabled = true;
      const res = await apiPost('/api/ai-director-weekly-send-now', { initData });
      btn.disabled = false;
      if (!res.ok) { msgEl.textContent = res.reason || 'Xatolik yuz berdi.'; msgEl.className = 'xabar err'; return; }
      msgEl.textContent = 'Yuborildi — Telegram\'dagi bot xabarini tekshiring.';
      msgEl.className = 'xabar ok';
    });

    aiRenderChat();
    loadAiData();
    loadAiDirectorPreviews();
  }

  // AI Direktor kunlik va haftalik hisobot preview matnini, yoqilgan/
  // o'chirilganligini va joriy davrda allaqachon yuborilganmi-yo'qmi
  // holatini yuklab, kartochkalarga chiqaradi.
  async function loadAiDirectorPreviews() {
    const dailyTextEl = document.getElementById('aiDirDailyText');
    const dailyToggle = document.getElementById('aiDirDailyToggle');
    if (dailyTextEl) {
      const res = await apiPost('/api/ai-director-preview', { initData });
      if (res.ok) {
        dailyTextEl.innerHTML = `<div style="white-space:pre-line;">${res.text}</div>` +
          (res.sentToday ? `<div class="bosh" style="margin-top:6px;">✅ Bugun allaqachon yuborilgan.</div>` : '');
        dailyToggle.checked = res.enabled;
      } else if (res.blockedFeature) {
        renderFeatureBlockedInline(dailyTextEl, res.reason);
      } else {
        dailyTextEl.textContent = res.reason || 'Yuklab bo\'lmadi.';
      }
    }

    const weeklyTextEl = document.getElementById('aiDirWeeklyText');
    const weeklyToggle = document.getElementById('aiDirWeeklyToggle');
    if (weeklyTextEl) {
      const res = await apiPost('/api/ai-director-weekly-preview', { initData });
      if (res.ok) {
        weeklyTextEl.innerHTML = `<div style="white-space:pre-line;">${res.text}</div>` +
          (res.sentThisWeek ? `<div class="bosh" style="margin-top:6px;">✅ Shu hafta allaqachon yuborilgan.</div>` : '');
        weeklyToggle.checked = res.enabled;
      } else if (res.blockedFeature) {
        renderFeatureBlockedInline(weeklyTextEl, res.reason);
      } else {
        weeklyTextEl.textContent = res.reason || 'Yuklab bo\'lmadi.';
      }
    }
  }

  async function loadAiData() {
    const topEl = document.getElementById('aiTopItems');
    const peakEl = document.getElementById('aiPeak');
    const forecastEl = document.getElementById('aiForecast');
    if (!topEl) return;
    const res = await apiPost('/api/ai-analytics', { initData, period: aiState.period });
    if (res.networkError) {
      renderNetworkErrorInline(topEl, res.reason, loadAiData);
      peakEl.innerHTML = '';
      forecastEl.innerHTML = '';
      return;
    }
    if (!res.ok) {
      if (res.blockedFeature) {
        renderFeatureBlockedInline(topEl, res.reason);
      } else {
        topEl.innerHTML = `<div class="xabar err">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
      }
      peakEl.innerHTML = '';
      forecastEl.innerHTML = '';
      return;
    }
    topEl.innerHTML = aiTopItemsHtml(res.topItems);
    peakEl.innerHTML = aiPeakHtml(res.topHours, res.topDays);
    forecastEl.innerHTML = aiForecastHtml(res.forecast);
  }

  // ---- Egasi: I. Xodimlar nazorati (35-37-bosqich) — amallar jurnali, 30 kunlik hisobot, reyting ----
  let staffControlState = { period: 'month' };
  const STAFF_ACTION_LABELS = {
    buyurtma_yaratdi: 'Buyurtma yaratdi',
    holat_tayyorlanmoqda: 'Tayyorlanmoqda deb belgiladi',
    holat_tayyor: 'Tayyor deb belgiladi',
    yetkazdi: 'Yetkazib berdi',
    sklad_kirim: 'Skladga kirim qildi',
    audit_topshirdi: 'Audit topshirdi',
    smena_boshladi: 'Smenani boshladi',
    smena_tugatdi: 'Smenani tugatdi'
  };

  function staffPerformanceHtml(report) {
    if (!report || !report.length) return `<div class="bosh">Hali xodim qo'shilmagan.</div>`;
    return report.map((s, i) => `
      <div class="owner-item">
        <div>
          <div class="owner-id">${i + 1}. ${escapeHtml(s.fullName || (s.username ? '@' + s.username : 'ID: ' + s.id))}${s.isTop ? ' ' + icon('trophy', 'icon-xs icon-warning') : ''}</div>
          <div class="owner-username">${escapeHtml(s.roleLabel)}${(s.fullName && s.username) ? ` · @${escapeHtml(s.username)}` : ''}</div>
          <div class="owner-expiry">Amallar: ${s.actionCount} ta${s.errorCount ? ` · Kamomad: ${s.errorCount} ta` : ''}</div>
        </div>
        <div class="rating-badge">${s.score}<div class="rating-unit">ball</div></div>
      </div>
    `).join('');
  }

  // 17-bosqich: Telegramga yetib bormagan bildirishnomalar ro'yxati.
  function notificationErrorLogHtml(entries) {
    if (!entries || !entries.length) return `<div class="bosh">Hammasi joyida — yaqinda yetkazilmagan bildirishnoma yo'q.</div>`;
    return entries.map(e => `
      <div class="owner-item">
        <div>
          <div class="owner-id">${escapeHtml(e.targetName || ('ID: ' + e.targetId))}</div>
          <div class="owner-username">${escapeHtml(e.context || '')}</div>
          <div class="owner-expiry" style="color:var(--danger);">${escapeHtml(e.reason)} · ${timeAgo(e.createdAt)}</div>
        </div>
      </div>
    `).join('');
  }

  function staffActivityLogHtml(entries) {
    if (!entries || !entries.length) return `<div class="bosh">Hali amal qayd etilmagan.</div>`;
    return entries.map(e => `
      <div class="cf-expense-item">
        <div>
          <div class="cf-e-note"><b>${escapeHtml(e.displayName)}</b> (${escapeHtml(e.roleLabel)}) — ${escapeHtml(STAFF_ACTION_LABELS[e.action] || e.action)}</div>
          ${e.note ? `<div class="cf-e-note">${escapeHtml(e.note)}</div>` : ''}
          <div class="cf-e-date">${new Date(e.createdAt).toLocaleString('uz-UZ')}</div>
        </div>
      </div>
    `).join('');
  }

  function renderStaffControlScreen(profile, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Xodimlar</div>
        <button class="btn ikkinchi" id="scBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka">
          <h2>Xodim qo'shish</h2>
          <input type="text" id="staffInput" placeholder="Telegram ID, @username yoki t.me havolasi">
          <div class="staff-hint" style="margin-top:8px;">Lavozim(lar) — bir nechtasini belgilash mumkin:</div>
          <div class="staff-role-grid">
            <label class="check-label"><input type="checkbox" class="staffRoleAddCheckbox" value="kassir"> Kassir</label>
            <label class="check-label"><input type="checkbox" class="staffRoleAddCheckbox" value="oshpaz"> Oshpaz</label>
            <label class="check-label"><input type="checkbox" class="staffRoleAddCheckbox" value="sklad"> Sklad mas'uli</label>
            <label class="check-label"><input type="checkbox" class="staffRoleAddCheckbox" value="dostavka"> Kuryer</label>
          </div>
          <select id="staffBranchInput">
            <option value="">— Markaziy (filialsiz) —</option>
          </select>
          <button class="btn" id="addStaffBtn">Xodim qo'shish</button>
          <div class="xabar" id="staffMsg"></div>
          <div class="staff-hint" style="margin-top:14px; border-top:1px solid var(--border-color); padding-top:12px;">
            Yoki xodimning ID/username'ini bilmasangiz — yuqorida lavozim(lar)ni belgilab, bir martalik havola yarating. Xodim shu havolani bosib botni ochsa, avtomatik shu lavozim(lar) bilan qo'shiladi.
          </div>
          <button class="btn ikkinchi" id="createStaffInviteBtn" style="margin-top:8px;">${icon('link', 'icon-xs')} Bir martalik havola yaratish</button>
          <div id="staffInviteLinkWrap"></div>
          <div class="xabar" id="staffInviteMsg"></div>
        </div>
        <div class="kartochka">
          <h2>Xodimlar ro'yxati</h2>
          <div class="owner-list" id="staffList"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        <div class="section-label">${icon('bar-chart', 'icon-xs')} Nazorat</div>
        <div class="tab-row">
          <div class="tab-opt ${staffControlState.period === 'week' ? 'selected' : ''}" data-sc-period="week">Hafta</div>
          <div class="tab-opt ${staffControlState.period === 'month' ? 'selected' : ''}" data-sc-period="month">30 kun</div>
          <div class="tab-opt ${staffControlState.period === 'all' ? 'selected' : ''}" data-sc-period="all">Hammasi</div>
        </div>
        <div class="kartochka">
          <h2>Xodimlar reytingi</h2>
          <div id="scRating"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        <div class="kartochka">
          <h2>So'nggi amallar (jurnal)</h2>
          <div id="scLog"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        <div class="kartochka">
          <h2>Bildirishnoma xatolari</h2>
          <div class="staff-hint">Xodimga Telegram orqali xabar yetib bormagan holatlar (odatda xodim botga hali <code>/start</code> bosmagan yoki uni block qilgan bo'lsa yuz beradi).</div>
          <div id="scNotifErrors" style="margin-top:8px;"><div class="bosh">Yuklanmoqda...</div></div>
          <button class="btn ikkinchi" id="clearNotifErrorsBtn" style="margin-top:8px;">Jurnalni tozalash</button>
        </div>
      </div>
    `);

    document.getElementById('scBackBtn').addEventListener('click', () => onBack && onBack());
    document.querySelector('.tab-row').addEventListener('click', (e) => {
      const p = e.target.getAttribute('data-sc-period');
      if (!p || p === staffControlState.period) return;
      staffControlState.period = p;
      renderStaffControlScreen(profile, onBack);
    });

    document.getElementById('addStaffBtn').addEventListener('click', async () => {
      const val = document.getElementById('staffInput').value.trim();
      const roles = Array.from(document.querySelectorAll('.staffRoleAddCheckbox:checked')).map(cb => cb.value);
      const branchId = document.getElementById('staffBranchInput').value;
      const msgEl = document.getElementById('staffMsg');
      if (!val) {
        msgEl.textContent = 'Iltimos, ID yoki username kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      if (!roles.length) {
        msgEl.textContent = 'Kamida bitta lavozim belgilang.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Qo\'shilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/add-staff', { initData, input: val, roles, branchId });
      if (res.ok) {
        msgEl.textContent = 'Xodim qo\'shildi.';
        msgEl.className = 'xabar ok';
        document.getElementById('staffInput').value = '';
        document.querySelectorAll('.staffRoleAddCheckbox').forEach(cb => cb.checked = false);
        loadStaffAndRender();
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    document.getElementById('createStaffInviteBtn').addEventListener('click', async () => {
      const roles = Array.from(document.querySelectorAll('.staffRoleAddCheckbox:checked')).map(cb => cb.value);
      const branchId = document.getElementById('staffBranchInput').value;
      const msgEl = document.getElementById('staffInviteMsg');
      const wrap = document.getElementById('staffInviteLinkWrap');
      if (!roles.length) {
        msgEl.textContent = 'Kamida bitta lavozim belgilang.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Yaratilmoqda...';
      msgEl.className = 'xabar';
      wrap.innerHTML = '';
      const res = await apiPost('/api/create-staff-invite', { initData, roles, branchId });
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = '';
      wrap.innerHTML = `
        <div class="link-box">
          <span>${escapeHtml(res.link)}</span>
          <button id="copyStaffInviteLinkBtn">Nusxalash</button>
        </div>
        <div class="customer-link-hint">Havola bir marta ishlatiladi va 24 soatdan keyin muddati tugaydi (${escapeHtml(rolesLabelClient(res.roles))}).</div>
      `;
      document.getElementById('copyStaffInviteLinkBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(res.link).then(() => {
          msgEl.textContent = 'Havola nusxalandi.';
          msgEl.className = 'xabar ok';
        }).catch(() => {
          msgEl.textContent = 'Nusxalab bo\'lmadi, havolani qo\'lda ko\'chiring.';
          msgEl.className = 'xabar err';
        });
      });
    });

    document.getElementById('staffList').addEventListener('click', async (e) => {
      const id = e.target.getAttribute('data-remove-staff-id');
      if (!id) return;
      e.target.disabled = true;
      await apiPost('/api/remove-staff', { initData, id });
      loadStaffAndRender();
    });

    document.getElementById('staffList').addEventListener('change', async (e) => {
      const branchStaffId = e.target.getAttribute('data-staff-branch-id');
      if (branchStaffId) {
        e.target.disabled = true;
        await apiPost('/api/set-staff-branch', { initData, id: branchStaffId, branchId: e.target.value });
        loadStaffAndRender();
        return;
      }
      const roleStaffId = e.target.getAttribute('data-staff-role-checkbox');
      if (roleStaffId) {
        const checkboxes = document.querySelectorAll(`[data-staff-role-checkbox="${roleStaffId}"]`);
        const roles = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
        if (!roles.length) {
          e.target.checked = true; // kamida bitta lavozim qolishi shart
          alert('Xodimda kamida bitta lavozim qolishi kerak.');
          return;
        }
        checkboxes.forEach(cb => cb.disabled = true);
        await apiPost('/api/set-staff-roles', { initData, id: roleStaffId, roles });
        loadStaffAndRender();
      }
    });

    document.getElementById('clearNotifErrorsBtn').addEventListener('click', async () => {
      if (!confirm('Bildirishnoma xatolari jurnalini tozalamoqchimisiz?')) return;
      await apiPost('/api/notification-error-log-clear', { initData });
      loadStaffControlData();
    });

    loadBranchAndRender().then(loadStaffAndRender);
    loadStaffControlData();
  }

  async function loadStaffControlData() {
    const ratingEl = document.getElementById('scRating');
    const logEl = document.getElementById('scLog');
    if (!ratingEl) return;

    const perfRes = await apiPost('/api/staff-performance-report', { initData, period: staffControlState.period });
    if (perfRes.networkError) {
      renderNetworkErrorInline(ratingEl, perfRes.reason, loadStaffControlData);
      return;
    }
    ratingEl.innerHTML = perfRes.ok
      ? staffPerformanceHtml(perfRes.report)
      : `<div class="xabar err">${escapeHtml(perfRes.reason || 'Xatolik yuz berdi.')}</div>`;

    const logRes = await apiPost('/api/staff-activity-log', { initData, limit: 50 });
    if (logRes.networkError) {
      renderNetworkErrorInline(logEl, logRes.reason, loadStaffControlData);
      return;
    }
    logEl.innerHTML = logRes.ok
      ? staffActivityLogHtml(logRes.entries)
      : `<div class="xabar err">${escapeHtml(logRes.reason || 'Xatolik yuz berdi.')}</div>`;

    const notifErrEl = document.getElementById('scNotifErrors');
    if (notifErrEl) {
      const notifRes = await apiPost('/api/notification-error-log', { initData });
      notifErrEl.innerHTML = notifRes.ok
        ? notificationErrorLogHtml(notifRes.entries)
        : `<div class="xabar err">${escapeHtml((notifRes.reason) || 'Xatolik yuz berdi.')}</div>`;
    }
  }

  // ---- Egasi: Kuryerlar bo'yicha hisobot — nechta buyurtma, qancha pul, komissiya ----
  let courierReportState = { period: 'today' };

  function courierReportRowsHtml(report) {
    if (!report.length) return `<div class="bosh">Kuryerlar hali qo'shilmagan.</div>`;
    return report.map(c => `
      <div class="owner-item">
        <div>
          <div class="owner-id">${escapeHtml(c.id)}</div>
          ${c.username ? `<div class="owner-username">@${escapeHtml(c.username)}</div>` : ''}
          <div class="owner-expiry">Buyurtmalar: ${c.orderCount} ta</div>
          <div class="owner-price">Jami pul: ${cfFormatSum(c.totalAmount)}</div>
          ${c.pendingAmount > 0 ? `
            <div class="owner-expiry" style="color:var(--rang-xato,#e04b4b);">Kuryer qo'lida (kassaga qaytarilmagan): ${cfFormatSum(c.pendingAmount)}</div>
            <button class="btn ikkinchi" style="margin-top:6px; padding:6px 10px; font-size:13px;" data-cr-collect="${escapeHtml(c.id)}">Kassaga qaytarildi</button>
          ` : ''}
        </div>
        <div class="rating-badge">${cfFormatSum(c.commission)}<div class="rating-unit">komissiya</div></div>
      </div>
    `).join('');
  }

  function courierCashHistoryHtml(movements) {
    if (!movements || !movements.length) return `<div class="bosh">Hali kassaga qaytarilgan pul yo'q.</div>`;
    return movements.map(m => {
      const d = new Date(m.createdAt);
      const sana = d.toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      return `
        <div class="owner-item">
          <div>
            <div class="owner-id">${m.courierUsername ? '@' + escapeHtml(m.courierUsername) : escapeHtml(m.courierId)}</div>
            <div class="owner-expiry">${m.orderCount} ta buyurtma · ${sana}</div>
          </div>
          <div class="rating-badge" style="color:var(--rang-ok,#2ecc71);">${cfFormatSum(m.amount)}<div class="rating-unit">kassaga qaytdi</div></div>
        </div>
      `;
    }).join('');
  }

  function renderCourierReportScreen(profile, onBack, isOwnerView = true) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Kuryerlar hisoboti</div>
        ${onBack ? `<button class="btn ikkinchi" id="crBackBtn" style="margin-bottom:12px;">← Orqaga</button>` : ''}
        <div class="tab-row">
          <div class="tab-opt ${courierReportState.period === 'today' ? 'selected' : ''}" data-cr-period="today">Bugun</div>
          <div class="tab-opt ${courierReportState.period === 'week' ? 'selected' : ''}" data-cr-period="week">Hafta</div>
          <div class="tab-opt ${courierReportState.period === 'month' ? 'selected' : ''}" data-cr-period="month">Oy</div>
          <div class="tab-opt ${courierReportState.period === 'all' ? 'selected' : ''}" data-cr-period="all">Hammasi</div>
        </div>
        ${isOwnerView ? `
        <div class="kartochka">
          <h2>Komissiya foizi</h2>
          <input type="text" id="crCommissionInput" placeholder="Masalan: 10" inputmode="numeric">
          <button class="btn ikkinchi" id="crSaveCommissionBtn">Saqlash</button>
          <div class="xabar" id="crCommissionMsg"></div>
        </div>
        ` : ''}
        <div class="kartochka">
          <h2>Kuryerlar</h2>
          <div id="crList" class="owner-list"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        <div class="kartochka">
          <h2>Kassaga qaytarish tarixi</h2>
          <div id="crHistory" class="owner-list"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
      </div>
    `);

    if (onBack) document.getElementById('crBackBtn').addEventListener('click', () => onBack());

    document.querySelector('.tab-row').addEventListener('click', (e) => {
      const p = e.target.getAttribute('data-cr-period');
      if (!p || p === courierReportState.period) return;
      courierReportState.period = p;
      renderCourierReportScreen(profile, onBack, isOwnerView);
    });

    if (isOwnerView) {
      document.getElementById('crSaveCommissionBtn').addEventListener('click', async () => {
        const percent = document.getElementById('crCommissionInput').value.trim();
        const msgEl = document.getElementById('crCommissionMsg');
        if (!/^\d+(\.\d+)?$/.test(percent)) {
          msgEl.textContent = 'To\'g\'ri foiz kiriting (0-100).';
          msgEl.className = 'xabar err';
          return;
        }
        msgEl.textContent = 'Saqlanmoqda...';
        msgEl.className = 'xabar';
        const res = await apiPost('/api/set-courier-commission', { initData, percent });
        if (res.ok) {
          msgEl.textContent = 'Saqlandi.';
          msgEl.className = 'xabar ok';
          loadCourierReport(isOwnerView);
        } else {
          msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
          msgEl.className = 'xabar err';
        }
      });
    }

    loadCourierReport(isOwnerView);
  }

  async function loadCourierReport(isOwnerView = true) {
    const listEl = document.getElementById('crList');
    const commissionInput = document.getElementById('crCommissionInput');
    if (!listEl) return;
    const res = await apiPost('/api/courier-report', { initData, period: courierReportState.period });
    if (res.networkError) { renderNetworkErrorInline(listEl, res.reason, () => loadCourierReport(isOwnerView)); return; }
    if (!res.ok) {
      listEl.innerHTML = `<div class="xabar err">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
      const historyElOnErr = document.getElementById('crHistory');
      if (historyElOnErr) historyElOnErr.innerHTML = '';
      return;
    }
    if (commissionInput && document.activeElement !== commissionInput) {
      commissionInput.value = res.commissionPercent;
    }
    listEl.innerHTML = courierReportRowsHtml(res.report);

    const historyEl = document.getElementById('crHistory');
    if (historyEl) historyEl.innerHTML = courierCashHistoryHtml(res.recentMovements);

    listEl.querySelectorAll('[data-cr-collect]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const courierId = btn.getAttribute('data-cr-collect');
        btn.disabled = true;
        btn.textContent = 'Yuklanmoqda...';
        const cRes = await apiPost('/api/courier-collect-cash', { initData, courierId });
        if (cRes.ok) {
          loadCourierReport(isOwnerView);
        } else {
          btn.disabled = false;
          btn.textContent = 'Kassaga qaytarildi';
          alert(cRes.reason || 'Xatolik yuz berdi.');
        }
      });
    });
  }

  // ---- Egasi: Buyurtmalar tarixini filtrlash — sana/xodim/to'lov turi (44-bosqich) ----
  let orderHistoryState = { dateFrom: '', dateTo: '', employeeId: '', paymentType: '', orderType: '', page: 1 };
  let orderHistoryEmployeesCache = null;

  function orderHistoryStatusLabel(status) {
    return ORDER_STATUS_LABELS[status] || status;
  }

  function orderHistoryRowsHtml(orders) {
    if (!orders.length) return `<div class="bosh">Bu filtrga mos buyurtma topilmadi.</div>`;
    return orders.map(o => {
      const d = new Date(o.createdAt);
      const sana = d.toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const itemsText = (o.items || []).map(it => `${escapeHtml(it.name)} x${it.qty}`).join(', ');
      return `
        <div class="owner-item">
          <div>
            <div class="owner-id">${sana}${o.tableNumber ? ' · stol ' + escapeHtml(o.tableNumber) : ''}</div>
            <div class="owner-username">${escapeHtml(ORDER_TYPE_LABELS[o.orderType] || o.orderType)} · ${escapeHtml(PAYMENT_TYPE_LABELS[o.paymentType] || o.paymentType)} · ${escapeHtml(orderHistoryStatusLabel(o.status))}</div>
            <div class="owner-expiry">${itemsText}</div>
            <div class="owner-expiry">Xodim: ${escapeHtml(o.createdByName || '—')}</div>
          </div>
          <div class="rating-badge">${cfFormatSum(o.total)}</div>
        </div>
      `;
    }).join('');
  }

  function orderHistoryEmployeeOptionsHtml(employees) {
    const opts = ['<option value="">Barcha xodimlar</option>']
      .concat((employees || []).map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`));
    return opts.join('');
  }

  function renderOrderHistoryScreen(profile, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Buyurtmalar tarixi</div>
        <button class="btn ikkinchi" id="ohBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka">
          <h2>Filtr</h2>
          <div class="profile-row"><b>Sana (dan)</b></div>
          <input type="date" id="ohDateFrom" value="${escapeHtml(orderHistoryState.dateFrom)}">
          <div class="profile-row"><b>Sana (gacha)</b></div>
          <input type="date" id="ohDateTo" value="${escapeHtml(orderHistoryState.dateTo)}">
          <div class="profile-row"><b>Xodim</b></div>
          <select id="ohEmployee"><option value="">Yuklanmoqda...</option></select>
          <div class="profile-row"><b>To'lov turi</b></div>
          <select id="ohPaymentType">
            <option value="">Barcha to'lov turlari</option>
            <option value="naqd">Naqd</option>
            <option value="karta">Karta</option>
            <option value="dostavka_orqali">Dostavka orqali</option>
          </select>
          <div class="profile-row"><b>Buyurtma turi</b></div>
          <select id="ohOrderType">
            <option value="">Barcha turlar</option>
            <option value="stol">Stolga</option>
            <option value="olib_ketish">Olib ketish</option>
            <option value="dostavka">Dostavka</option>
          </select>
          <button class="btn" id="ohApplyBtn" style="margin-top:10px;">Filtrlash</button>
          <button class="btn ikkinchi" id="ohResetBtn" style="margin-top:8px;">Tozalash</button>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button class="btn ikkinchi" id="ohExportCsvBtn" style="flex:1;">${icon('file-plus', 'icon-xs')} Excel</button>
            <button class="btn ikkinchi" id="ohExportPdfBtn" style="flex:1;">${icon('file-plus', 'icon-xs')} PDF</button>
          </div>
        </div>
        <div class="kartochka">
          <div id="ohSummary" class="bosh">Yuklanmoqda...</div>
        </div>
        <div class="kartochka">
          <h2>Buyurtmalar</h2>
          <div id="ohList" class="owner-list"><div class="bosh">Yuklanmoqda...</div></div>
          <div id="ohPagination" style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;"></div>
        </div>
      </div>
    `);

    document.getElementById('ohBackBtn').addEventListener('click', () => onBack && onBack());

    document.getElementById('ohApplyBtn').addEventListener('click', () => {
      orderHistoryState.dateFrom = document.getElementById('ohDateFrom').value;
      orderHistoryState.dateTo = document.getElementById('ohDateTo').value;
      orderHistoryState.employeeId = document.getElementById('ohEmployee').value;
      orderHistoryState.paymentType = document.getElementById('ohPaymentType').value;
      orderHistoryState.orderType = document.getElementById('ohOrderType').value;
      orderHistoryState.page = 1;
      loadOrderHistory();
    });

    document.getElementById('ohResetBtn').addEventListener('click', () => {
      orderHistoryState = { dateFrom: '', dateTo: '', employeeId: '', paymentType: '', orderType: '', page: 1 };
      renderOrderHistoryScreen(profile, onBack);
    });

    // 44-bosqich: joriy filtrga mos BARCHA (sahifalashsiz) buyurtmalarni
    // Excel (CSV) yoki PDF sifatida yuklab olish.
    document.getElementById('ohExportCsvBtn').addEventListener('click', (e) => exportOrderHistory('csv', e.target));
    document.getElementById('ohExportPdfBtn').addEventListener('click', (e) => exportOrderHistory('pdf', e.target));

    fillOrderHistoryEmployeeSelect();
    loadOrderHistory();
  }

  async function fillOrderHistoryEmployeeSelect() {
    const selectEl = document.getElementById('ohEmployee');
    if (!selectEl) return;
    if (orderHistoryEmployeesCache) {
      selectEl.innerHTML = orderHistoryEmployeeOptionsHtml(orderHistoryEmployeesCache);
      selectEl.value = orderHistoryState.employeeId;
    }
  }

  // 44-bosqich: fayl (CSV yoki PDF) mazmunini brauzerda "yuklab olish"
  // sifatida saqlaydi — hech qanday tashqi kutubxonasiz, oddiy Blob + vaqtinchalik
  // <a download> havolasi orqali. base64 — true bo'lsa content base64 deb hisoblanadi.
  function downloadFile(filename, mime, content, isBase64) {
    let blob;
    if (isBase64) {
      const binary = atob(content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      blob = new Blob([bytes], { type: mime });
    } else {
      blob = new Blob([content], { type: mime });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function exportOrderHistory(format, btnEl) {
    if (btnEl) btnEl.disabled = true;
    const res = await apiPost('/api/order-history-export', {
      initData,
      format,
      dateFrom: orderHistoryState.dateFrom || undefined,
      dateTo: orderHistoryState.dateTo || undefined,
      employeeId: orderHistoryState.employeeId || undefined,
      paymentType: orderHistoryState.paymentType || undefined,
      orderType: orderHistoryState.orderType || undefined
    });
    if (btnEl) btnEl.disabled = false;
    if (res.networkError || !res.ok) {
      const alertFn = (tg && tg.showAlert) ? (msg) => tg.showAlert(msg) : (msg) => alert(msg);
      alertFn(res.reason || "Fayl tayyorlanmadi. Qayta urinib ko'ring.");
      return;
    }
    if (res.format === 'csv') downloadFile(res.filename, res.mime, res.content, false);
    else downloadFile(res.filename, res.mime, res.contentBase64, true);
  }

  async function loadOrderHistory() {
    const listEl = document.getElementById('ohList');
    const summaryEl = document.getElementById('ohSummary');
    const pagEl = document.getElementById('ohPagination');
    if (!listEl) return;
    const res = await apiPost('/api/order-history', {
      initData,
      dateFrom: orderHistoryState.dateFrom || undefined,
      dateTo: orderHistoryState.dateTo || undefined,
      employeeId: orderHistoryState.employeeId || undefined,
      paymentType: orderHistoryState.paymentType || undefined,
      orderType: orderHistoryState.orderType || undefined,
      page: orderHistoryState.page
    });
    if (res.networkError) { renderNetworkErrorInline(listEl, res.reason, () => loadOrderHistory()); return; }
    if (!res.ok) {
      listEl.innerHTML = `<div class="xabar err">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
      if (summaryEl) summaryEl.innerHTML = '';
      if (pagEl) pagEl.innerHTML = '';
      return;
    }

    orderHistoryEmployeesCache = res.employees || [];
    const selectEl = document.getElementById('ohEmployee');
    if (selectEl) {
      selectEl.innerHTML = orderHistoryEmployeeOptionsHtml(orderHistoryEmployeesCache);
      selectEl.value = orderHistoryState.employeeId;
    }

    if (summaryEl) {
      summaryEl.innerHTML = `Topildi: <b>${res.totalCount}</b> ta buyurtma · Jami summa: <b>${cfFormatSum(res.totalSum)}</b>`;
    }

    listEl.innerHTML = orderHistoryRowsHtml(res.orders);

    if (pagEl) {
      if (res.totalPages > 1) {
        pagEl.innerHTML = `
          <button class="btn ikkinchi" id="ohPrevBtn" ${res.page <= 1 ? 'disabled' : ''} style="flex:1; margin-right:6px;">← Oldingi</button>
          <span class="bosh" style="white-space:nowrap; padding:0 8px;">${res.page} / ${res.totalPages}</span>
          <button class="btn ikkinchi" id="ohNextBtn" ${res.page >= res.totalPages ? 'disabled' : ''} style="flex:1; margin-left:6px;">Keyingi →</button>
        `;
        const prevBtn = document.getElementById('ohPrevBtn');
        const nextBtn = document.getElementById('ohNextBtn');
        if (prevBtn) prevBtn.addEventListener('click', () => { orderHistoryState.page = Math.max(1, res.page - 1); loadOrderHistory(); });
        if (nextBtn) nextBtn.addEventListener('click', () => { orderHistoryState.page = Math.min(res.totalPages, res.page + 1); loadOrderHistory(); });
      } else {
        pagEl.innerHTML = '';
      }
    }
  }

  // ---- Egasi: Kunlik yakuniy hisobot (Z-hisobot) — savdo, xarajat, sof foyda ----
  function zReportCardHtml(z) {
    const netClass = z.net >= 0 ? 'positive' : 'negative';
    const paymentRows = Object.entries(z.paymentBreakdown || {})
      .filter(([, sum]) => sum > 0)
      .map(([key, sum]) => `<div class="profile-row"><b>${escapeHtml(PAYMENT_TYPE_LABELS[key] || key)}:</b> ${cfFormatSum(sum)}</div>`)
      .join('');
    return `
      <div class="kartochka">
        <h2>${escapeHtml(z.date)}</h2>
        <div class="cf-stats">
          <div class="cf-stat income">
            <div class="cf-label">Savdo</div>
            <div class="cf-val">${cfFormatSum(z.income)}</div>
          </div>
          <div class="cf-stat expense">
            <div class="cf-label">Xarajat</div>
            <div class="cf-val">${cfFormatSum(z.expense)}</div>
          </div>
          <div class="cf-stat net ${netClass}" style="grid-column: 1 / -1;">
            <div class="cf-label">Sof foyda</div>
            <div class="cf-val">${cfFormatSum(z.net)}</div>
          </div>
        </div>
        <div class="bosh" style="margin-top:8px;">Buyurtmalar soni: ${z.orderCount} | Kassa: ${cfFormatSum(z.kassaIncome)} | Dostavka: ${cfFormatSum(z.dostavkaIncome)}</div>
        ${paymentRows ? `<div style="margin-top:8px;">${paymentRows}</div>` : ''}
      </div>
    `;
  }

  function zReportListHtml(reports) {
    if (!reports.length) return `<div class="bosh">Hali Z-hisobot yopilmagan.</div>`;
    return reports.map(z => zReportCardHtml(z)).join('');
  }

  // =========================================================================
  // 57-bosqich: stollar uchun QR-kod — egasi stol raqamini kiritadi,
  // shu stol uchun maxsus bot-havola (/api/table-qr-link) va shu havoladan
  // yasalgan QR-rasm ko'rsatiladi. Mijoz QR-ni skanerlasa, Mini App
  // to'g'ridan-to'g'ri "Stolga" buyurtma turi va stol raqami oldindan
  // to'ldirilgan holda ochiladi (qarang: server.js — menu_..._table_...
  // /start payload, va bu faylda renderCustomerApp'dagi ?table= o'qish).
  // QR-rasm tashqi (offline'da ishlamaydigan) xizmat orqali yasaladi —
  // shuning uchun rasm yuklanmasa ham havolaning o'zi ko'rinadi va
  // nusxalab bo'ladi.
  // =========================================================================
  function tableQrImageUrl(link) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(link)}`;
  }

  function renderTableQrScreen(profile, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Stollar uchun QR</div>
        <button class="btn ikkinchi" id="tqrBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka">
          <div class="bosh">Stol raqamini kiriting — shu stol uchun QR-kod yasaladi. Mijoz uni skanerlasa, Mini App to'g'ridan-to'g'ri o'sha stol tanlangan holda ochiladi (stol raqamini qo'lda kiritish shart bo'lmaydi).</div>
          <input type="text" id="tqrTableInput" placeholder="Stol raqami (masalan: 5)" style="margin-top:10px;">
          <button type="button" class="btn" id="tqrGenBtn" style="margin-top:10px;">QR-kod yaratish</button>
          <div class="xabar" id="tqrMsg"></div>
        </div>
        <div id="tqrResultWrap"></div>
      </div>
    `);
    document.getElementById('tqrBackBtn').addEventListener('click', () => onBack && onBack());

    document.getElementById('tqrGenBtn').addEventListener('click', async () => {
      const msgEl = document.getElementById('tqrMsg');
      const input = document.getElementById('tqrTableInput');
      const tableNumber = input.value.trim();
      if (!tableNumber) {
        msgEl.textContent = 'Stol raqamini kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Yaratilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/table-qr-link', { initData, tableNumber });
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = '';
      msgEl.className = 'xabar';
      const wrap = document.getElementById('tqrResultWrap');
      const card = document.createElement('div');
      card.className = 'kartochka tqr-card';
      card.innerHTML = `
        <div class="tqr-title">Stol ${escapeHtml(res.tableNumber)}</div>
        <img class="tqr-img" src="${tableQrImageUrl(res.link)}" alt="QR" onerror="this.style.display='none'">
        <div class="tqr-link-row">
          <input type="text" class="tqr-link-input" value="${escapeHtml(res.link)}" readonly>
          <button type="button" class="btn ikkinchi tqr-copy-btn">Nusxalash</button>
        </div>
      `;
      card.querySelector('.tqr-copy-btn').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(res.link);
          const btn = card.querySelector('.tqr-copy-btn');
          const old = btn.textContent;
          btn.textContent = 'Nusxalandi!';
          setTimeout(() => { btn.textContent = old; }, 1500);
        } catch (e) { /* clipboard mavjud bo'lmasa — jim o'tkaziladi, matn qo'lda tanlanadi */ }
      });
      wrap.prepend(card);
      input.value = '';
    });
  }

  // ==================== H63-bosqich: Tezkor qo'llab-quvvatlash chat (xodim/egasi tomoni) ====================
  let supportStaffPollTimer = null;

  function supportStaffMsgTime(iso) {
    return new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
  }

  function renderSupportInboxScreen(profile, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Yordam so'rovlari</div>
        <button class="btn ikkinchi" id="supBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div id="supInboxList"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);
    document.getElementById('supBackBtn').addEventListener('click', () => {
      if (supportStaffPollTimer) { clearInterval(supportStaffPollTimer); supportStaffPollTimer = null; }
      onBack && onBack();
    });
    loadSupportInbox(profile, onBack);
    supportStaffPollTimer = setInterval(() => loadSupportInbox(profile, onBack, true), 5000);
  }

  async function loadSupportInbox(profile, onBack, isBackgroundRefresh) {
    const listEl = document.getElementById('supInboxList');
    if (!listEl) { if (supportStaffPollTimer) { clearInterval(supportStaffPollTimer); supportStaffPollTimer = null; } return; }
    const res = await apiPost('/api/support-inbox', { initData });
    if (res.networkError) { if (!isBackgroundRefresh) renderNetworkErrorInline(listEl, res.reason, () => loadSupportInbox(profile, onBack)); return; }
    if (!res.ok) {
      if (!isBackgroundRefresh) { handleFeatureBlocked(res); renderFeatureBlockedInline(listEl, res.reason); }
      return;
    }
    if (!res.threads.length) {
      listEl.innerHTML = `<div class="bosh">Hozircha yordam so'rovlari yo'q.</div>`;
      return;
    }
    listEl.innerHTML = res.threads.map(t => `
      <div class="kartochka" data-thread-customer="${escapeHtml(t.customerId)}" style="cursor:pointer; display:flex; align-items:center; gap:10px;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:700; display:flex; align-items:center; gap:6px;">
            ${escapeHtml(t.customerName)}
            ${t.unreadCount > 0 ? `<span class="badge danger">${t.unreadCount}</span>` : ''}
          </div>
          <div class="owner-username" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.lastFrom === 'staff' ? "Siz: " : ''}${escapeHtml(t.lastText)}</div>
        </div>
        <div style="font-size:var(--fs-xs); color:var(--text-secondary); flex-shrink:0;">${supportStaffMsgTime(t.lastAt)}</div>
      </div>
    `).join('');
    listEl.querySelectorAll('[data-thread-customer]').forEach(el => {
      el.addEventListener('click', () => {
        if (supportStaffPollTimer) { clearInterval(supportStaffPollTimer); supportStaffPollTimer = null; }
        renderSupportThreadScreen(profile, el.getAttribute('data-thread-customer'), () => renderSupportInboxScreen(profile, onBack));
      });
    });
  }

  function renderSupportThreadScreen(profile, customerId, onBack) {
    ekran(`
      <div class="panel" style="display:flex; flex-direction:column; height:calc(100vh - 32px);">
        <div class="salom" style="font-size:20px;">Suhbat</div>
        <button class="btn ikkinchi" id="supThreadBackBtn" style="margin-bottom:12px;">← Ro'yxatga</button>
        <div id="supThreadMsgs" style="flex:1; overflow-y:auto; margin-bottom:10px;">
          <div class="bosh">Yuklanmoqda...</div>
        </div>
        <div style="display:flex; gap:8px;">
          <input type="text" id="supThreadInput" placeholder="Javob yozing..." style="margin-bottom:0; flex:1;">
          <button type="button" class="btn" id="supThreadSendBtn" style="width:auto; padding:0 18px;">${icon('send', 'icon-sm')}</button>
        </div>
      </div>
    `);
    document.getElementById('supThreadBackBtn').addEventListener('click', () => {
      if (supportStaffPollTimer) { clearInterval(supportStaffPollTimer); supportStaffPollTimer = null; }
      onBack && onBack();
    });

    const msgsEl = document.getElementById('supThreadMsgs');
    const scrollToBottom = () => { msgsEl.scrollTop = msgsEl.scrollHeight; };
    const loadThread = async (isFirstLoad) => {
      const res = await apiPost('/api/support-thread-staff', { initData, customerId });
      if (!document.getElementById('supThreadMsgs')) { if (supportStaffPollTimer) { clearInterval(supportStaffPollTimer); supportStaffPollTimer = null; } return; }
      if (!res.ok) { msgsEl.innerHTML = `<div class="bosh">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`; return; }
      msgsEl.innerHTML = customerSupportMessagesHtml(res.messages || []);
      if (isFirstLoad) scrollToBottom();
    };
    loadThread(true);
    supportStaffPollTimer = setInterval(() => loadThread(false), 4000);

    const input = document.getElementById('supThreadInput');
    const sendBtn = document.getElementById('supThreadSendBtn');
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      const res = await apiPost('/api/support-reply', { initData, customerId, text });
      sendBtn.disabled = false;
      if (!res.ok) { alert(res.reason || 'Xabar yuborilmadi.'); return; }
      input.value = '';
      msgsEl.innerHTML = customerSupportMessagesHtml(res.messages || []);
      scrollToBottom();
    };
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  }

  function renderZReportScreen(profile, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Kunlik Z-hisobot</div>
        <button class="btn ikkinchi" id="zrBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka">
          <div class="bosh">Kunni yopib, bugungi savdo/xarajat/sof foydani rasmiy hisobot sifatida saqlaydi.</div>
          <button class="btn" id="zrCreateBtn" style="margin-top:10px;">Bugungi kunni yopish</button>
          <div class="xabar" id="zrMsg"></div>
        </div>
        <div class="kartochka chart-card">
          <h2>${icon('trending-up', 'icon-xs')} Sof foyda dinamikasi</h2>
          <div id="zrChart"><div class="bosh">Yuklanmoqda...</div></div>
        </div>
        <div id="zrList"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);

    document.getElementById('zrBackBtn').addEventListener('click', () => onBack && onBack());

    document.getElementById('zrCreateBtn').addEventListener('click', async () => {
      const msgEl = document.getElementById('zrMsg');
      msgEl.textContent = 'Yopilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/z-report-create', { initData });
      if (res.ok) {
        msgEl.textContent = res.wasUpdate ? 'Bugungi hisobot yangilandi.' : 'Bugungi kun yopildi.';
        msgEl.className = 'xabar ok';
        loadZReportList();
      } else {
        handleFeatureBlocked(res);
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    loadZReportList();
  }

  async function loadZReportList() {
    const listEl = document.getElementById('zrList');
    const chartEl = document.getElementById('zrChart');
    if (!listEl) return;
    const res = await apiPost('/api/z-report-list', { initData });
    if (res.networkError) {
      renderNetworkErrorInline(listEl, res.reason, loadZReportList);
      if (chartEl) chartEl.innerHTML = '';
      return;
    }
    if (!res.ok) {
      listEl.innerHTML = `<div class="xabar err">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
      return;
    }
    listEl.innerHTML = zReportListHtml(res.reports);
    if (chartEl) {
      const points = res.reports.slice(0, 14).slice().reverse().map(z => ({ label: shortDateLabel(z.date), value: z.net }));
      chartEl.innerHTML = trendBarChartSvg(points);
    }
  }

  function showAuditReport(audit) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const rows = audit.entries.map(e => `
      <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;">
        <span>${escapeHtml(e.name)}</span>
        <span style="font-weight:700; color:${e.diff === 0 ? '#2fa84f' : (e.diff > 0 ? '#2fa84f' : '#d33')};">
          ${e.diff > 0 ? '+' : ''}${e.diff} ${escapeHtml(e.unit)}
        </span>
      </div>
    `).join('');
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px;">
        <h3>Audit natijasi</h3>
        <p>Farqlar (haqiqiy − tizimdagi):</p>
        <div>${rows}</div>
        <div class="btn-row">
          <button class="btn" id="auditReportOkBtn">Yopish</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('auditReportOkBtn').onclick = () => {
      overlay.remove();
      loadStockAndRender();
      loadMovementsAndRender();
    };
  }

  // ---- Egasi: taom uchun retsept (ingredientlar) tahrirlash oynasi ----
  let recipeEditorMenuId = null;
  let recipeEditorStock = [];

  // 13-bosqich: "Menyuga taom qo'shish" formasidagi "To'g'ridan skladdan"
  // selectini markaziy sklad ro'yxati bilan to'ldiradi. Faqat "direct" turi
  // tanlanganda (birinchi marta) chaqiriladi — har safar qayta yuklamaslik
  // uchun oddiy keshlash shart emas, chunki bu kamdan-kam bosiladigan tugma.
  async function loadMenuDirectStockOptions() {
    const select = document.getElementById('menuDirectStockInput');
    if (!select) return;
    select.innerHTML = '<option value="">Yuklanmoqda...</option>';
    const res = await apiPost('/api/stock-list', { initData });
    if (!select.isConnected) return; // foydalanuvchi allaqachon boshqa ekranga o'tgan bo'lishi mumkin
    const stock = (res.ok && Array.isArray(res.stock)) ? res.stock : [];
    if (!stock.length) {
      select.innerHTML = '<option value="">Avval skladga mahsulot qo\'shing</option>';
      return;
    }
    select.innerHTML = '<option value="">— Tanlang —</option>' +
      stock.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(STOCK_UNIT_LABELS[s.unit] || s.unit)})</option>`).join('');
  }

  async function openRecipeEditor(menuItem) {
    recipeEditorMenuId = menuItem.id;
    const res = await apiPost('/api/stock-list', { initData });
    recipeEditorStock = res.ok ? res.stock : [];
    renderRecipeEditorOverlay(menuItem);
  }

  function renderRecipeEditorOverlay(menuItem) {
    const existingMap = {};
    (menuItem.recipe || []).forEach(r => { existingMap[r.stockId] = r.qty; });
    const rowsHtml = recipeEditorStock.length
      ? recipeEditorStock.map(s => `
          <div class="recipe-row">
            <div class="recipe-name">${escapeHtml(s.name)} <span class="recipe-unit">(${escapeHtml(s.unit)})</span></div>
            <input type="text" inputmode="decimal" data-recipe-qty="${escapeHtml(s.id)}" placeholder="0" value="${existingMap[s.id] != null ? existingMap[s.id] : ''}">
          </div>
        `).join('')
      : `<div class="bosh">Avval skladga mahsulot qo'shing.</div>`;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px; max-height:80vh; overflow:auto;">
        <h3>Retsept: ${escapeHtml(menuItem.name)}</h3>
        <p>Har bir taom uchun sarflanadigan miqdorni kiriting (bo'sh = ishlatilmaydi).</p>
        <div>${rowsHtml}</div>
        <div class="xabar" id="recipeMsg"></div>
        <div class="btn-row">
          <button class="btn ikkinchi" id="recipeCancelBtn">Bekor qilish</button>
          <button class="btn" id="recipeSaveBtn">Saqlash</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('recipeCancelBtn').onclick = () => overlay.remove();
    document.getElementById('recipeSaveBtn').onclick = async () => {
      const recipe = [];
      overlay.querySelectorAll('[data-recipe-qty]').forEach(inp => {
        const val = inp.value.trim();
        if (!val) return;
        const num = Number(val);
        if (Number.isFinite(num) && num > 0) {
          recipe.push({ stockId: inp.getAttribute('data-recipe-qty'), qty: num });
        }
      });
      const msgEl = document.getElementById('recipeMsg');
      msgEl.textContent = 'Saqlanmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/menu-set-recipe', { initData, menuId: recipeEditorMenuId, recipe });
      if (res.ok) {
        overlay.remove();
        loadMenuAndRender();
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    };
  }

  async function renderMenuItemEditOverlay(menuItem) {
    let pendingImage = menuItem.imageUrl || '';
    const isDirectInitially = !!menuItem.directStockId;
    // 17-bosqich: "To'g'ridan skladdan" turini tanlash uchun markaziy sklad
    // ro'yxati oldindan yuklab qo'yiladi (select tayyor tursin).
    const stockRes = await apiPost('/api/stock-list', { initData });
    const stockList = (stockRes.ok && Array.isArray(stockRes.stock)) ? stockRes.stock : [];
    const stockOptionsHtml = stockList.length
      ? stockList.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === menuItem.directStockId ? 'selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(STOCK_UNIT_LABELS[s.unit] || s.unit)})</option>`).join('')
      : '';
    // 39-bosqich: bo'limlar ro'yxatini yuklab, select uchun tayyorlaymiz.
    // Agar taomning joriy kategoriyasi biror sababdan ro'yxatda bo'lmasa
    // (masalan, o'sha bo'lim keyinchalik o'chirilgan bo'lsa), uni saqlashda
    // sezdirmasdan yo'qotib qo'ymaslik uchun alohida belgi bilan qo'shamiz.
    const catRes = await apiPost('/api/category-list', { initData });
    const categoriesList = (catRes.ok && Array.isArray(catRes.categories)) ? catRes.categories : [];
    let categoryOptionsHtml = '<option value="">— Bo\'lim tanlanmagan —</option>';
    if (menuItem.category && !categoriesList.some(c => c.name === menuItem.category)) {
      categoryOptionsHtml += `<option value="${escapeHtml(menuItem.category)}" selected>${escapeHtml(menuItem.category)} (ro'yxatda yo'q)</option>`;
    }
    categoryOptionsHtml += categoriesList.map(c => `<option value="${escapeHtml(c.name)}" ${c.name === (menuItem.category || '') ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px; max-height:85vh; overflow:auto;">
        <h3>Taomni tahrirlash</h3>
        <input type="text" id="editMenuNameInput" placeholder="Taom nomi" value="${escapeHtml(menuItem.name || '')}">
        <input type="text" id="editMenuPriceInput" placeholder="Narxi (so'm)" inputmode="numeric" value="${escapeHtml(String(menuItem.price || ''))}">
        <label class="field-label">Bo'lim (ixtiyoriy)</label>
        <select id="editMenuCategoryInput">${categoryOptionsHtml}</select>
        <textarea id="editMenuDescriptionInput" placeholder="Tavsif (ixtiyoriy)">${escapeHtml(menuItem.description || '')}</textarea>
        <div class="staff-hint" style="margin-top:8px;">Rasm (galereyadan yangisini tanlash ixtiyoriy):</div>
        <img id="editMenuImagePreview" src="${escapeHtml(pendingImage)}" class="logo-preview" style="${pendingImage ? '' : 'display:none;'} width:120px; height:120px; display:block;">
        <input type="file" id="editMenuImageFileInput" accept="image/*">

        <label class="field-label" style="margin-top:10px;">Turi</label>
        <select id="editMenuTypeInput">
          <option value="recipe" ${isDirectInitially ? '' : 'selected'}>Tayyorlanadigan (retsept)</option>
          <option value="direct" ${isDirectInitially ? 'selected' : ''}>To'g'ridan skladdan (masalan: shishada suv)</option>
        </select>
        <div id="editMenuDirectStockWrap" class="${isDirectInitially ? '' : 'hidden'}" style="margin-top:8px;">
          <label class="field-label">Sklad mahsuloti</label>
          <select id="editMenuDirectStockInput">${stockOptionsHtml || '<option value="">Avval skladga mahsulot qo\'shing</option>'}</select>
        </div>

        <div class="xabar" id="editMenuMsg"></div>
        <div class="btn-row">
          <button class="btn ikkinchi" id="editMenuCancelBtn">Bekor qilish</button>
          <button class="btn" id="editMenuSaveBtn">Saqlash</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('editMenuCancelBtn').onclick = () => overlay.remove();

    document.getElementById('editMenuTypeInput').addEventListener('change', (e) => {
      document.getElementById('editMenuDirectStockWrap').classList.toggle('hidden', e.target.value !== 'direct');
    });

    document.getElementById('editMenuImageFileInput').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      const msgEl = document.getElementById('editMenuMsg');
      if (!file) return;
      try {
        const dataUrl = await readImageFileAsCompressedDataUrl(file);
        pendingImage = dataUrl || '';
        const preview = document.getElementById('editMenuImagePreview');
        preview.src = pendingImage;
        preview.style.display = pendingImage ? 'block' : 'none';
      } catch (err) {
        msgEl.textContent = err.message || 'Rasmni yuklab bo\'lmadi.';
        msgEl.className = 'xabar err';
        e.target.value = '';
      }
    });

    document.getElementById('editMenuSaveBtn').onclick = async () => {
      const name = document.getElementById('editMenuNameInput').value.trim();
      const price = document.getElementById('editMenuPriceInput').value.trim();
      const category = document.getElementById('editMenuCategoryInput').value.trim();
      const description = document.getElementById('editMenuDescriptionInput').value.trim();
      const menuType = document.getElementById('editMenuTypeInput').value;
      const directStockId = menuType === 'direct' ? document.getElementById('editMenuDirectStockInput').value : '';
      const msgEl = document.getElementById('editMenuMsg');
      if (!name || !price || !/^\d+$/.test(price) || parseInt(price, 10) <= 0) {
        msgEl.textContent = 'Taom nomi va to\'g\'ri narx kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Saqlanmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/menu-update', {
        initData, id: menuItem.id, name, price, category, description, imageUrl: pendingImage, directStockId
      });
      if (res.ok) {
        overlay.remove();
        loadMenuAndRender();
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    };
  }

  async function loadOwnProfileAndRender() {
    const res = await apiPost('/api/my-profile', { initData });
    if (res.networkError) { renderNetworkErrorScreen(res.reason, loadOwnProfileAndRender); return; }
    if (res.ok && res.profile) { applyBrandColor(res.profile.brandColor); renderOwnerHomeScreen(res.profile); }
    else { resetBrandColor(); renderProfileForm(res.ok ? res.profile : null); }
  }

  async function loadOwnersAndRender() {
    resetBrandColor();
    const res = await apiPost('/api/owners', { initData });
    if (res.networkError) { renderNetworkErrorScreen(res.reason, loadOwnersAndRender); return; }
    renderAdminPanel(res.ok ? res.owners : [], res.ok ? res.revenue : null);
  }

  // ==================== J. Mijozlar uchun menyu (38-40-bosqich) ====================
  // Mijoz "Mijozlar havolasi" orqali kirganda bot ?customer=<ownerId> bilan Mini App'ni ochadi
  let customerState = {
    ownerId: null,
    restaurant: null,
    menu: [],
    categories: [],
    promotions: [],
    banners: [],
    favorites: [],
    addresses: [],
    bonusPoints: 0,
    bonusEnabled: false,
    cart: {},
    orderType: 'stol',
    paymentType: 'naqd',
    tableNumber: '',
    location: null,
    addressNote: '',
    extraPhone: '',
    tab: 'menyu',
    category: 'hammasi',
    promoId: '',
    usePoints: false,
    cardOnlyRestricted: false,
    lastOrderRequestId: null,
    searchQuery: '',
    sortBy: 'default',
    notifUnseenCount: 0,
    aiRecommendations: null
  };

  // ---- 39-bosqich: mijoz uchun bildirishnomalar markazi ----
  // Alohida bildirishnoma-bazasi kerak emas — /api/customer-notifications
  // mijozning o'z buyurtmalari (holat o'zgarishlari) va faol aksiyalar
  // asosida ro'yxatni serverda hisoblab qaytaradi (owner tomonidagi
  // "Bildirishnomalar" ekrani bilan bir xil yondashuv). "Ko'rilgan" belgisi
  // faqat shu qurilmada (localStorage) saqlanadi — oshxona tanlanganiga
  // qarab kalit ajratiladi.
  function customerNotifSeenKey() {
    return `kitchenOsCustNotifSeen_${customerState.ownerId}`;
  }
  function getCustomerNotifSeenTime() {
    try { return localStorage.getItem(customerNotifSeenKey()) || null; } catch (e) { return null; }
  }
  function setCustomerNotifSeenNow() {
    try { localStorage.setItem(customerNotifSeenKey(), new Date().toISOString()); } catch (e) { /* ignore */ }
  }
  function updateCustomerNotifBellBadge() {
    const btn = document.getElementById('custNotifBellBtn');
    if (!btn) return;
    const existing = btn.querySelector('.cust-notif-bell-badge');
    if (existing) existing.remove();
    if (customerState.notifUnseenCount > 0) {
      const span = document.createElement('span');
      span.className = 'cust-notif-bell-badge';
      span.textContent = customerState.notifUnseenCount > 9 ? '9+' : String(customerState.notifUnseenCount);
      btn.appendChild(span);
    }
  }
  async function refreshCustomerNotifBadge() {
    if (!customerState.ownerId) return;
    const res = await apiPost('/api/customer-notifications', { initData, ownerId: customerState.ownerId });
    if (!res || !res.ok) return;
    const seen = getCustomerNotifSeenTime();
    customerState.notifUnseenCount = seen
      ? res.notifications.filter(n => new Date(n.time) > new Date(seen)).length
      : res.notifications.length;
    updateCustomerNotifBellBadge();
  }

  function customerCartTotal() {
    return customerState.menu.reduce((sum, m) => sum + (customerState.cart[m.id] || 0) * m.price, 0);
  }

  function customerCartQty() {
    return Object.values(customerState.cart).reduce((sum, q) => sum + (q || 0), 0);
  }

  function customerTabRowHtml() {
    return `
      <div class="tab-row">
        <div class="tab-opt ${customerState.tab === 'menyu' ? 'selected' : ''}" data-customer-tab="menyu">Menyu</div>
        <div class="tab-opt ${customerState.tab === 'sevimli' ? 'selected' : ''}" data-customer-tab="sevimli">Sevimlilar</div>
        <div class="tab-opt ${customerState.tab === 'tarix' ? 'selected' : ''}" data-customer-tab="tarix">Buyurtmalarim</div>
      </div>
    `;
  }

  function customerHeaderHtml() {
    const r = customerState.restaurant || {};
    return `
      <div class="profile-view" style="margin-bottom:12px;">
        ${r.logoUrl ? `<img class="logo-preview" src="${escapeHtml(r.logoUrl)}" onerror="this.style.display='none'">` : ''}
        <div class="info">
          <div class="salom" style="font-size:20px; margin-bottom:2px;">${escapeHtml(r.name || 'Oshxona')}</div>
          ${r.address ? `<div class="profile-row" style="margin-top:0;">${escapeHtml(r.address)}</div>` : ''}
          ${customerState.bonusEnabled ? `<div class="badge paid" style="margin-top:6px;">${icon('star', 'icon-xs')} Bonus: ${customerState.bonusPoints} ball</div>` : ''}
        </div>
        <button type="button" class="cust-notif-bell-btn" id="custAddrBookBtn" title="Manzillarim" aria-label="Manzillarim" style="margin-right:6px;">
          ${icon('pin', 'icon-sm')}
        </button>
        <button type="button" class="cust-notif-bell-btn" id="custSupportBtn" title="Yordam" aria-label="Yordam" style="margin-right:6px;">
          ${icon('message-circle', 'icon-sm')}
        </button>
        <button type="button" class="cust-notif-bell-btn" id="custNotifBellBtn" title="Bildirishnomalar" aria-label="Bildirishnomalar">
          ${icon('bell', 'icon-sm')}
          ${customerState.notifUnseenCount > 0 ? `<span class="cust-notif-bell-badge">${customerState.notifUnseenCount > 9 ? '9+' : customerState.notifUnseenCount}</span>` : ''}
        </button>
      </div>
    `;
  }

  // 30-bosqich: mijoz uchun ham xuddi shu umumiy komponent (K-bo'lim,
  // yuqorida) ishlatiladi — alohida customerMenuGroups/customerSectionId
  // endi kerak emas.
  // 36-37-bosqich: qidiruv+saralash — filtrlangan/saralangan ro'yxatni
  // hisoblaydi. Qidiruv matni bo'lsa, kategoriya bo'linishi (tab/sections)
  // ma'nosiz bo'lib qoladi (natijalar bir nechta kategoriyadan bo'lishi
  // mumkin), shuning uchun bunday holatda customerCategoriesHtml/
  // customerMenuListHtml TEKIS (flat) ro'yxat ko'rsatadi.
  function customerVisibleMenu() {
    let items = customerState.menu.slice();
    const q = (customerState.searchQuery || '').trim().toLowerCase();
    if (q) {
      items = items.filter(m =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q)
      );
    }
    if (customerState.sortBy === 'price_asc') items.sort((a, b) => a.price - b.price);
    else if (customerState.sortBy === 'price_desc') items.sort((a, b) => b.price - a.price);
    else if (customerState.sortBy === 'name_asc') items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uz'));
    return items;
  }

  function customerSearchSortBarHtml() {
    return `
      <div class="cust-search-row">
        <div class="admin-search-wrap">
          ${icon('search', 'icon-xs icon-muted admin-search-icon')}
          <input type="text" id="cMenuSearchInput" placeholder="Taom qidirish..." value="${escapeHtml(customerState.searchQuery)}" autocomplete="off">
        </div>
        <select id="cMenuSortSelect" class="cust-sort-select">
          <option value="default" ${customerState.sortBy === 'default' ? 'selected' : ''}>Tartib</option>
          <option value="price_asc" ${customerState.sortBy === 'price_asc' ? 'selected' : ''}>Arzon → Qimmat</option>
          <option value="price_desc" ${customerState.sortBy === 'price_desc' ? 'selected' : ''}>Qimmat → Arzon</option>
          <option value="name_asc" ${customerState.sortBy === 'name_asc' ? 'selected' : ''}>Nomi (A-Ya)</option>
        </select>
      </div>
    `;
  }

  function customerCategoriesHtml() {
    if ((customerState.searchQuery || '').trim()) return '';
    return sectionedMenuTabsHtml(customerVisibleMenu(), {
      tabRowId: 'customerCatRow', sectionIdPrefix: 'menu-section-cust', listElId: 'customerMenuList', categories: customerState.categories
    });
  }

  function customerItemCardHtml(m) {
    const qty = customerState.cart[m.id] || 0;
    const isFav = customerState.favorites.includes(m.id);
    // 47-bosqich: sklad tugagan taom mijoz menyusida "Tugagan" deb
    // ko'rinadi, savatga qo'shish tugmasi o'chiriladi.
    if (m.outOfStock) {
      return `
        <div class="catalog-item" style="opacity:0.55;">
          <div class="catalog-img-wrap">
            ${m.imageUrl ? `<img class="catalog-img" src="${escapeHtml(m.imageUrl)}" onerror="this.style.display='none'">` : `<div class="catalog-img-empty"></div>`}
          </div>
          <div class="catalog-body">
            <div class="m-name">${escapeHtml(m.name)} <span class="badge warning">Tugagan</span></div>
            ${m.description ? `<div class="catalog-desc">${escapeHtml(m.description)}</div>` : ''}
            <div class="catalog-bottom-row">
              <div class="m-price">${fmtNum(m.price)} so'm</div>
            </div>
          </div>
        </div>
      `;
    }
    return `
      <div class="catalog-item">
        <div class="catalog-img-wrap">
          ${m.imageUrl ? `<img class="catalog-img" src="${escapeHtml(m.imageUrl)}" onerror="this.style.display='none'">` : `<div class="catalog-img-empty"></div>`}
          <button class="fav-btn" data-fav-id="${escapeHtml(m.id)}">${icon('heart', isFav ? 'icon-danger icon-filled' : 'icon-muted')}</button>
        </div>
        <div class="catalog-body">
          <div class="m-name">${escapeHtml(m.name)}</div>
          ${m.description ? `<div class="catalog-desc">${escapeHtml(m.description)}</div>` : ''}
          <div class="catalog-bottom-row">
            <div class="m-price">${fmtNum(m.price)} so'm</div>
            ${qty > 0 ? `
              <div class="qty-controls">
                <button data-cqty-minus="${escapeHtml(m.id)}">-</button>
                <span class="qty-val">${qty}</span>
                <button data-cqty-plus="${escapeHtml(m.id)}">+</button>
              </div>
            ` : `
              <button type="button" class="qty-add-btn" data-cqty-plus="${escapeHtml(m.id)}">+</button>
            `}
          </div>
        </div>
      </div>
    `;
  }

  function customerMenuListHtml() {
    const items = customerVisibleMenu();
    const q = (customerState.searchQuery || '').trim();
    if (q) {
      return `<div class="catalog-grid">${
        items.length ? items.map(customerItemCardHtml).join('')
          : `<div class="bosh">"${escapeHtml(q)}" bo'yicha hech narsa topilmadi.</div>`
      }</div>`;
    }
    return renderSectionedMenu(items, {
      sectionIdPrefix: 'menu-section-cust',
      itemsWrapperClass: 'catalog-grid',
      renderItem: customerItemCardHtml,
      emptyText: "Menyu hali bo'sh.",
      categories: customerState.categories
    });
  }

  // 45-bosqich: mijoz ekranidagi rasmli reklama/e'lon karuseli — egasi
  // "Reklama bannerlari" bo'limida qo'shgan, hozir faol bannerlar
  // (customerState.banners — /api/customer-menu-list orqali keladi, faqat
  // active=true va startAt/endAt oynasi ichidagilar, qarang: activeOwnerBanners
  // server.js'da). Bittadan ko'p bo'lsa gorizontal surilib turadi.
  function customerAdBannerHtml() {
    if (!customerState.banners || !customerState.banners.length) return '';
    return `
      <div class="ad-banner-row">
        ${customerState.banners.map(b => `
          <div class="ad-banner-card" data-ad-banner-id="${escapeHtml(b.id)}" ${b.link ? 'style="cursor:pointer;"' : ''}>
            <img src="${escapeHtml(b.imageUrl)}" alt="${escapeHtml(b.title || '')}" onerror="this.closest('.ad-banner-card').style.display='none'">
            ${b.title ? `<div class="ad-banner-title">${escapeHtml(b.title)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  // Banner bosilganda (agar havola berilgan bo'lsa) — mavjud
  // openExternalLink() yordamchisi orqali ochiladi (Telegram ichida
  // tg.openLink, aks holda yangi tab).
  function attachCustomerAdBannerHandlers() {
    document.querySelectorAll('[data-ad-banner-id]').forEach(el => {
      const banner = (customerState.banners || []).find(b => b.id === el.getAttribute('data-ad-banner-id'));
      if (banner && banner.link) {
        el.addEventListener('click', () => openExternalLink(banner.link));
      }
    });
  }

  function customerPromoBannerHtml() {
    if (!customerState.promotions.length) return '';
    return customerState.promotions.map(p => `
      <div class="promo-banner ${customerState.promoId === p.id ? 'selected' : ''}" data-promo-id="${escapeHtml(p.id)}">
        <div style="font-weight:700;">🎁 ${escapeHtml(p.title)} — ${p.discountPercent}% chegirma</div>
        ${p.description ? `<div style="font-size:12px; opacity:0.8; margin-top:2px;">${escapeHtml(p.description)}</div>` : ''}
        ${p.minTotal ? `<div style="font-size:12px; opacity:0.7; margin-top:2px;">Minimal buyurtma: ${escapeHtml(String(p.minTotal))} so'm</div>` : ''}
      </div>
    `).join('');
  }

  function attachCustomerCatalogHandlers() {
    const listEl = document.getElementById('customerMenuList');
    if (!listEl) return;
    listEl.querySelectorAll('[data-cqty-plus]').forEach(btn => btn.onclick = () => {
      const id = btn.getAttribute('data-cqty-plus');
      customerState.cart[id] = (customerState.cart[id] || 0) + 1;
      listEl.innerHTML = customerState.tab === 'sevimli'
        ? customerState.menu.filter(m => customerState.favorites.includes(m.id)).map(customerItemCardHtml).join('')
        : customerMenuListHtml();
      attachCustomerCatalogHandlers();
      if (customerState.tab !== 'sevimli') attachSectionedMenuScrollSpy('customerCatRow', 'customerMenuList');
      updateCustomerCartFab();
    });
    listEl.querySelectorAll('[data-cqty-minus]').forEach(btn => btn.onclick = () => {
      const id = btn.getAttribute('data-cqty-minus');
      customerState.cart[id] = Math.max(0, (customerState.cart[id] || 0) - 1);
      listEl.innerHTML = customerState.tab === 'sevimli'
        ? customerState.menu.filter(m => customerState.favorites.includes(m.id)).map(customerItemCardHtml).join('')
        : customerMenuListHtml();
      attachCustomerCatalogHandlers();
      if (customerState.tab !== 'sevimli') attachSectionedMenuScrollSpy('customerCatRow', 'customerMenuList');
      updateCustomerCartFab();
    });
    listEl.querySelectorAll('[data-fav-id]').forEach(btn => btn.onclick = async () => {
      const id = btn.getAttribute('data-fav-id');
      btn.disabled = true;
      const res = await apiPost('/api/customer-favorite-toggle', { initData, ownerId: customerState.ownerId, itemId: id });
      if (res.ok) customerState.favorites = res.favorites;
      if (customerState.tab === 'sevimli') renderCustomerFavoritesTab();
      else {
        listEl.innerHTML = customerMenuListHtml();
        attachCustomerCatalogHandlers();
        attachSectionedMenuScrollSpy('customerCatRow', 'customerMenuList');
      }
    });
  }

  // ---- Savat cho'ntak paneli (pastda mahkam turadigan kichik panel) ----
  // 15-bosqich: checkout formasi endi shu yerda emas — faqat "N ta
  // mahsulot / summa" va bitta tugma. Tugma bosilganda checkout ALOHIDA
  // oynada (overlay/modal) ochiladi, ya'ni menyu ustiga xunuk chiqib
  // qolmaydi.
  function cartFabBarHtml() {
    const qty = customerCartQty();
    return `
      <div class="cart-fab-bar ${qty ? '' : 'hidden'}" id="cCartFab">
        <div class="cart-fab-info">
          <span class="cart-fab-count" id="cCartFabCount">${qty} ta mahsulot</span>
          <span class="cart-fab-total" id="cCartFabTotal">${fmtNum(customerCartTotal())} so'm</span>
        </div>
        <button type="button" class="btn" id="cOpenCheckoutBtn">Buyurtma berish</button>
      </div>
    `;
  }

  function attachCartFabHandler() {
    const btn = document.getElementById('cOpenCheckoutBtn');
    if (btn) btn.onclick = openCustomerCheckoutModal;
  }

  function updateCustomerCartFab() {
    const qty = customerCartQty();
    const bar = document.getElementById('cCartFab');
    if (bar) bar.classList.toggle('hidden', !qty);
    const panelEl = document.querySelector('.panel');
    if (panelEl) panelEl.classList.toggle('has-cart-fab', !!qty);
    const countEl = document.getElementById('cCartFabCount');
    if (countEl) countEl.textContent = qty + ' ta mahsulot';
    const totalEl = document.getElementById('cCartFabTotal');
    if (totalEl) totalEl.textContent = fmtNum(customerCartTotal()) + " so'm";
    // Agar checkout oynasi hozir ochiq bo'lsa, undagi summani ham yangilaymiz.
    const modalTotalEl = document.getElementById('cCartTotalVal');
    if (modalTotalEl) modalTotalEl.textContent = fmtNum(customerCartTotal()) + " so'm";
  }

  // ---- H64-bosqich: "AI ofitsiant" — mijozni tanigan holda uning doim
  // yoqtiradigan taomlarini va shularga o'xshash (bir toifadagi, hali
  // sinamagan) taomlarni yuqorida alohida qator qilib ko'rsatadi.
  // customerState.aiRecommendations — /api/customer-menu-list orqali keladi
  // (qarang: buildAiWaiterRecommendations() server.js'da).
  function customerAiRecommendationsHtml() {
    const reco = customerState.aiRecommendations;
    if (!reco || (!reco.favorites.length && !reco.similar.length)) return '';
    const block = (title, items) => !items.length ? '' : `
      <div class="ai-reco-block">
        <div class="ai-reco-title">🤖 ${escapeHtml(title)}</div>
        <div class="ai-reco-row">${items.map(customerItemCardHtml).join('')}</div>
      </div>
    `;
    return `
      <div class="ai-reco-wrap" id="aiRecoSection">
        ${block('Sizga tavsiya — doim yoqtiradiganlaringiz', reco.favorites)}
        ${block('Bular ham sizga yoqishi mumkin', reco.similar)}
      </div>
    `;
  }

  function attachAiRecoHandlers() {
    const wrap = document.getElementById('aiRecoSection');
    if (!wrap) return;
    wrap.querySelectorAll('[data-cqty-plus]').forEach(btn => btn.onclick = () => {
      const id = btn.getAttribute('data-cqty-plus');
      customerState.cart[id] = (customerState.cart[id] || 0) + 1;
      renderCustomerMenuTab();
    });
    wrap.querySelectorAll('[data-cqty-minus]').forEach(btn => btn.onclick = () => {
      const id = btn.getAttribute('data-cqty-minus');
      customerState.cart[id] = Math.max(0, (customerState.cart[id] || 0) - 1);
      renderCustomerMenuTab();
    });
    wrap.querySelectorAll('[data-fav-id]').forEach(btn => btn.onclick = async () => {
      const id = btn.getAttribute('data-fav-id');
      btn.disabled = true;
      const res = await apiPost('/api/customer-favorite-toggle', { initData, ownerId: customerState.ownerId, itemId: id });
      if (res.ok) customerState.favorites = res.favorites;
      renderCustomerMenuTab();
    });
  }

  function renderCustomerMenuTab() {
    ekran(`
      <div class="panel ${customerCartQty() ? 'has-cart-fab' : ''}">
        ${customerHeaderHtml()}
        ${customerAdBannerHtml()}
        ${customerTabRowHtml()}
        ${customerAiRecommendationsHtml()}
        ${customerPromoBannerHtml()}
        ${customerSearchSortBarHtml()}
        <div id="customerCatRowWrap">${customerCategoriesHtml()}</div>
        <div id="customerMenuList" style="margin-top:8px;">${customerMenuListHtml()}</div>
      </div>
      ${cartFabBarHtml()}
    `);

    attachCustomerCatalogHandlers();
    attachCustomerTabHandlers();
    attachCartFabHandler();
    attachCustomerSearchSortHandlers();
    attachCustomerAdBannerHandlers();
    attachAiRecoHandlers();
    if (!(customerState.searchQuery || '').trim()) {
      attachSectionedMenuTabHandlers('customerCatRow');
      attachSectionedMenuScrollSpy('customerCatRow', 'customerMenuList');
    }

    document.querySelectorAll('[data-promo-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-promo-id');
        customerState.promoId = customerState.promoId === id ? '' : id;
        renderCustomerMenuTab();
      });
    });
  }

  // 36-37-bosqich: qidiruv/saralash o'zgarganda BUTUN ekran emas, faqat
  // kategoriya-tab qatori va taomlar ro'yxati qayta chiziladi — shu bilan
  // qidiruv maydonidagi fokus (klaviatura) yo'qolmaydi.
  function attachCustomerSearchSortHandlers() {
    const searchInput = document.getElementById('cMenuSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        customerState.searchQuery = searchInput.value;
        updateCustomerMenuListAndTabs();
      });
    }
    const sortSelect = document.getElementById('cMenuSortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        customerState.sortBy = sortSelect.value;
        updateCustomerMenuListAndTabs();
      });
    }
  }

  function updateCustomerMenuListAndTabs() {
    const tabWrap = document.getElementById('customerCatRowWrap');
    if (tabWrap) tabWrap.innerHTML = customerCategoriesHtml();
    const listEl = document.getElementById('customerMenuList');
    if (listEl) listEl.innerHTML = customerMenuListHtml();
    attachCustomerCatalogHandlers();
    if (!(customerState.searchQuery || '').trim()) {
      attachSectionedMenuTabHandlers('customerCatRow');
      attachSectionedMenuScrollSpy('customerCatRow', 'customerMenuList');
    } else {
      disconnectSectionedMenuObserver('customerCatRow');
    }
  }

  // ---- Checkout — ALOHIDA oynada (overlay/modal) ----
  // Buyurtma turi, stol/dostavka, to'lov turi, bonus va "Buyurtma
  // berish" shu yerda. Har bir tanlov o'zgarganda faqat shu modal ichi
  // qayta chiziladi (butun sahifa emas), shuning uchun modal ochiq
  // qolaveradi.
  function customerCheckoutModalBodyHtml() {
    return `
      <h3>Buyurtmani rasmiylashtirish</h3>
      <div class="type-row" id="cOrderTypeRow">
        ${Object.entries(ORDER_TYPE_LABELS).map(([k, label]) => `
          <div class="type-opt ${customerState.orderType === k ? 'selected' : ''}" data-corder-type="${k}">${label}</div>
        `).join('')}
      </div>
      <div id="cTableWrap" class="${customerState.orderType === 'stol' ? '' : 'hidden'}">
        <input type="text" id="cTableInput" placeholder="Stol raqami" value="${escapeHtml(customerState.tableNumber)}" inputmode="numeric">
      </div>
      <div id="cDeliveryWrap" class="${customerState.orderType === 'dostavka' ? '' : 'hidden'}">
        ${customerState.addresses.length ? `
          <div class="cust-addr-chip-row" id="cAddrChipRow">
            ${customerState.addresses.map(a => `<div class="cust-addr-chip" data-addr-chip="${escapeHtml(a.id)}">${icon('pin', 'icon-xs')} ${escapeHtml(a.label)}</div>`).join('')}
          </div>
        ` : ''}
        <button type="button" class="btn ikkinchi" id="cLocationBtn" style="width:100%; margin-bottom:6px;">
          ${customerState.location ? icon('check-circle', 'icon-xs icon-success') + ' Joylashuv aniqlandi (qayta aniqlash)' : icon('pin', 'icon-xs') + ' Joylashuvni aniqlash'}
        </button>
        <div id="cLocationStatus" class="xabar" style="margin-bottom:6px;"></div>
        <textarea id="cAddressNoteInput" placeholder="Manzilni tushuntiring (mo'ljal, qavat, kod va h.k.) - kuryer oson topishi uchun" rows="2">${escapeHtml(customerState.addressNote)}</textarea>
        <input type="tel" id="cExtraPhoneInput" class="phone-input-lg" placeholder="Qo'shimcha tel. raqam (majburiy)" value="${escapeHtml(customerState.extraPhone)}" inputmode="tel">
      </div>
      <div class="type-row" id="cPaymentTypeRow">
        ${visiblePaymentTypeEntries(customerState.orderType).map(([k, label]) => `
          <div class="type-opt ${customerState.paymentType === k ? 'selected' : ''}" data-cpayment-type="${k}">${label}</div>
        `).join('')}
      </div>
      ${customerState.orderType === 'dostavka' && customerState.cardOnlyRestricted ? `
        <div class="xabar err" style="margin-bottom:10px;">Avvalgi buyurtma(lar)ingizda kuryer sizga bog'lana olmagani sababli, hozircha faqat Karta orqali oldindan to'lov mavjud.</div>
      ` : ''}
      ${customerState.bonusEnabled && customerState.bonusPoints > 0 ? `
        <label style="display:flex; align-items:center; gap:8px; font-size:var(--fs-body); margin-bottom:10px;">
          <input type="checkbox" id="cUsePoints" ${customerState.usePoints ? 'checked' : ''}>
          Bonus ballaridan foydalanish (${customerState.bonusPoints} ball mavjud)
        </label>
      ` : ''}
      <div class="cart-total"><span>Jami:</span><span id="cCartTotalVal">${fmtNum(customerCartTotal())} so'm</span></div>
      <div class="xabar" id="cOrderMsg"></div>
      <div class="btn-row">
        <button type="button" class="btn ikkinchi" id="cCloseCheckoutBtn">Bekor qilish</button>
        <button type="button" class="btn" id="cSendOrderBtn">Buyurtma berish</button>
      </div>
    `;
  }

  // ==================== H63-bosqich: Tezkor qo'llab-quvvatlash chat (mijoz tomoni) ====================
  let customerSupportPollTimer = null;

  function customerSupportMsgTime(iso) {
    return new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
  }

  function customerSupportMessagesHtml(messages) {
    if (!messages.length) {
      return `<div class="bosh" style="padding:24px 8px;">Hali xabar yo'q. Savolingiz yoki muammoingiz bo'lsa, pastdan yozing — oshxona tez orada javob beradi.</div>`;
    }
    return messages.map(m => `
      <div class="support-msg ${m.from === 'customer' ? 'mine' : 'staff'}">
        <div class="support-msg-bubble">${escapeHtml(m.text)}</div>
        <div class="support-msg-time">${customerSupportMsgTime(m.at)}</div>
      </div>
    `).join('');
  }

  function openCustomerSupportChat() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px; max-height:85vh; display:flex; flex-direction:column; padding:0; overflow:hidden;">
        <div style="padding:16px 16px 10px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:8px;">
          ${icon('message-circle', 'icon-sm')}
          <div style="font-weight:700; flex:1;">Tezkor yordam</div>
          <button type="button" id="custSupportCloseBtn" style="background:none; border:none; cursor:pointer; padding:4px; display:flex;">${icon('x', 'icon-sm')}</button>
        </div>
        <div id="custSupportMsgs" style="flex:1; overflow-y:auto; padding:14px 16px; min-height:200px; max-height:50vh;">
          <div class="bosh">Yuklanmoqda...</div>
        </div>
        <div style="display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--border-color);">
          <input type="text" id="custSupportInput" placeholder="Xabar yozing..." style="margin-bottom:0; flex:1;">
          <button type="button" class="btn" id="custSupportSendBtn" style="width:auto; padding:0 18px;">${icon('send', 'icon-sm')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCustomerSupportChat(overlay); });
    overlay.querySelector('#custSupportCloseBtn').addEventListener('click', () => closeCustomerSupportChat(overlay));

    const msgsEl = overlay.querySelector('#custSupportMsgs');
    const scrollToBottom = () => { msgsEl.scrollTop = msgsEl.scrollHeight; };

    const loadThread = async (isFirstLoad) => {
      const res = await apiPost('/api/support-thread', { initData, ownerId: customerState.ownerId });
      if (handleFeatureBlocked(res)) { closeCustomerSupportChat(overlay); return; }
      if (!res.ok) { msgsEl.innerHTML = `<div class="bosh">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`; return; }
      msgsEl.innerHTML = customerSupportMessagesHtml(res.messages || []);
      if (isFirstLoad) scrollToBottom();
    };

    loadThread(true);
    customerSupportPollTimer = setInterval(() => loadThread(false), 4000);

    const input = overlay.querySelector('#custSupportInput');
    const sendBtn = overlay.querySelector('#custSupportSendBtn');
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      const res = await apiPost('/api/support-send', { initData, ownerId: customerState.ownerId, text });
      sendBtn.disabled = false;
      if (handleFeatureBlocked(res)) { closeCustomerSupportChat(overlay); return; }
      if (!res.ok) { alert(res.reason || 'Xabar yuborilmadi.'); return; }
      input.value = '';
      msgsEl.innerHTML = customerSupportMessagesHtml(res.messages || []);
      scrollToBottom();
    };
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  }

  function closeCustomerSupportChat(overlay) {
    if (customerSupportPollTimer) { clearInterval(customerSupportPollTimer); customerSupportPollTimer = null; }
    overlay.remove();
  }

  function openCustomerCheckoutModal() {
    if (!customerCartQty()) return;
    const fabBar = document.getElementById('cCartFab');
    if (fabBar) fabBar.classList.add('hidden');
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:380px; max-height:85vh; overflow:auto;"></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); updateCustomerCartFab(); } });
    renderCheckoutModalBody(overlay);
  }

  function renderCheckoutModalBody(overlay) {
    const modalEl = overlay.querySelector('.modal');
    modalEl.innerHTML = customerCheckoutModalBodyHtml();
    wireCheckoutModal(overlay);
  }

  function wireCheckoutModal(overlay) {
    const modalEl = overlay.querySelector('.modal');

    modalEl.querySelector('#cCloseCheckoutBtn').addEventListener('click', () => { overlay.remove(); updateCustomerCartFab(); });

    modalEl.querySelector('#cOrderTypeRow').addEventListener('click', (e) => {
      const t = e.target.getAttribute('data-corder-type');
      if (!t) return;
      customerState.orderType = t;
      ensureValidPaymentType(customerState);
      renderCheckoutModalBody(overlay);
    });
    modalEl.querySelector('#cPaymentTypeRow').addEventListener('click', (e) => {
      const t = e.target.getAttribute('data-cpayment-type');
      if (!t) return;
      customerState.paymentType = t;
      renderCheckoutModalBody(overlay);
    });
    const tableInput = modalEl.querySelector('#cTableInput');
    if (tableInput) tableInput.addEventListener('input', (e) => { customerState.tableNumber = e.target.value; });

    // Dostavka - joylashuvni aniqlash (brauzer/Telegram webview
    // Geolocation API orqali) va manzil izohi.
    const locationBtn = modalEl.querySelector('#cLocationBtn');
    const locationStatusEl = modalEl.querySelector('#cLocationStatus');
    if (locationBtn) locationBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        locationStatusEl.textContent = 'Bu qurilma/brauzer joylashuvni aniqlay olmaydi. Joylashuv (GPS) sozlamalarini tekshiring yoki manzilni pastga yozib qoldiring.';
        locationStatusEl.className = 'xabar err';
        return;
      }
      locationStatusEl.textContent = 'Aniqlanmoqda...';
      locationStatusEl.className = 'xabar';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          customerState.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          locationStatusEl.innerHTML = `${icon('check-circle', 'icon-xs icon-success')} Joylashuv aniqlandi.`;
          locationStatusEl.className = 'xabar ok';
          locationBtn.innerHTML = `${icon('check-circle', 'icon-xs icon-success')} Joylashuv aniqlandi (qayta aniqlash)`;
        },
        (geoErr) => {
          let hint = 'Iltimos, telefoningizda joylashuv (GPS/geolokatsiya) yoqilganini va brauzerga ruxsat berilganini tekshiring, so\'ng qayta urinib ko\'ring — yoki manzilni pastga yozib qoldiring.';
          if (geoErr && geoErr.code === 3) {
            hint = 'Joylashuvni aniqlash vaqti tugadi. Telefoningizda joylashuv (GPS) yoqilganini tekshirib, qayta urinib ko\'ring — yoki manzilni pastga yozib qoldiring.';
          }
          locationStatusEl.innerHTML = `${icon('x-circle', 'icon-xs icon-danger')} Joylashuvni aniqlab bo'lmadi. ${hint}`;
          locationStatusEl.className = 'xabar err';
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
    const addressNoteInput = modalEl.querySelector('#cAddressNoteInput');
    if (addressNoteInput) addressNoteInput.addEventListener('input', (e) => { customerState.addressNote = e.target.value; });

    // 56-bosqich: saqlangan manzil chip'i bosilsa — joylashuv/manzil izohi/
    // qo'shimcha telefon shu manzildan avtomatik to'ldiriladi.
    const addrChipRow = modalEl.querySelector('#cAddrChipRow');
    if (addrChipRow) {
      addrChipRow.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-addr-chip]');
        if (!chip) return;
        const id = chip.getAttribute('data-addr-chip');
        const addr = customerState.addresses.find(a => a.id === id);
        if (!addr) return;
        customerState.location = addr.location || null;
        customerState.addressNote = addr.addressNote || '';
        if (addr.extraPhone) customerState.extraPhone = addr.extraPhone;
        renderCheckoutModalBody(overlay);
      });
    }

    const extraPhoneInput = modalEl.querySelector('#cExtraPhoneInput');
    if (extraPhoneInput) extraPhoneInput.addEventListener('input', (e) => { customerState.extraPhone = e.target.value; });

    const pointsCheckbox = modalEl.querySelector('#cUsePoints');
    if (pointsCheckbox) pointsCheckbox.addEventListener('change', (e) => { customerState.usePoints = e.target.checked; });

    modalEl.querySelector('#cSendOrderBtn').addEventListener('click', () => sendCustomerOrder(overlay));
  }


  function attachCustomerTabHandlers() {
    const tabRow = document.querySelector('.tab-row');
    if (tabRow) {
      tabRow.addEventListener('click', (e) => {
        const t = e.target.getAttribute('data-customer-tab');
        if (!t || t === customerState.tab) return;
        customerState.tab = t;
        disconnectSectionedMenuObserver('customerCatRow');
        if (t !== 'tarix') stopCustomerHistoryPolling();
        if (t === 'sevimli') renderCustomerFavoritesTab();
        else if (t === 'tarix') renderCustomerHistoryTab();
        else renderCustomerMenuTab();
      });
    }
    const bellBtn = document.getElementById('custNotifBellBtn');
    if (bellBtn) {
      bellBtn.addEventListener('click', () => {
        stopCustomerHistoryPolling();
        renderCustomerNotificationsScreen(() => {
          if (customerState.tab === 'sevimli') renderCustomerFavoritesTab();
          else if (customerState.tab === 'tarix') renderCustomerHistoryTab();
          else renderCustomerMenuTab();
        });
      });
    }
    const addrBookBtn = document.getElementById('custAddrBookBtn');
    if (addrBookBtn) {
      addrBookBtn.addEventListener('click', () => {
        stopCustomerHistoryPolling();
        renderCustomerAddressesScreen(() => {
          if (customerState.tab === 'sevimli') renderCustomerFavoritesTab();
          else if (customerState.tab === 'tarix') renderCustomerHistoryTab();
          else renderCustomerMenuTab();
        });
      });
    }
    const supportBtn = document.getElementById('custSupportBtn');
    if (supportBtn) {
      supportBtn.addEventListener('click', () => openCustomerSupportChat());
    }
  }

  // =========================================================================
  // 56-bosqich: mijoz uchun manzillar kitobi — dostavka buyurtmasi berishda
  // har safar qaytadan yozmasligi uchun, bir necha manzilni ("Uy", "Ish"
  // kabi nomlar bilan) saqlab qo'yish va checkout'da tanlash imkoniyati.
  // =========================================================================
  function customerAddressItemHtml(a) {
    const parts = [];
    if (a.location) parts.push(`${icon('pin', 'icon-xs icon-muted')} Joylashuv aniqlangan`);
    if (a.addressNote) parts.push(escapeHtml(a.addressNote));
    if (a.extraPhone) parts.push(`${icon('send', 'icon-xs icon-muted')} ${escapeHtml(a.extraPhone)}`);
    return `
      <div class="owner-item" data-addr-id="${escapeHtml(a.id)}">
        <div class="owner-item-heading">
          <div class="owner-item-top"><span class="owner-id">${escapeHtml(a.label)}</span></div>
          <div class="owner-username">${parts.join(' · ') || 'Manzil ma\'lumoti yo\'q'}</div>
        </div>
        <button type="button" class="owner-remove-btn" data-addr-remove="${escapeHtml(a.id)}" title="O'chirish" aria-label="O'chirish">${icon('trash', 'icon-xs')}</button>
      </div>
    `;
  }

  function renderCustomerAddressesScreen(onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Manzillarim</div>
        <button class="btn ikkinchi" id="custAddrBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka" id="custAddrList"><div class="bosh">Yuklanmoqda...</div></div>
        <button type="button" class="btn" id="custAddrAddBtn" style="margin-top:12px;">${icon('plus', 'icon-xs')} Yangi manzil qo'shish</button>
      </div>
    `);
    document.getElementById('custAddrBackBtn').addEventListener('click', () => onBack && onBack());
    document.getElementById('custAddrAddBtn').addEventListener('click', () => renderCustomerAddressFormScreen(null, () => renderCustomerAddressesScreen(onBack)));
    loadCustomerAddressList(onBack);
  }

  async function loadCustomerAddressList(onBack) {
    const el = document.getElementById('custAddrList');
    if (!el) return;
    const res = await apiPost('/api/customer-address-list', { initData, ownerId: customerState.ownerId });
    const el2 = document.getElementById('custAddrList');
    if (!el2) return;
    if (res.networkError) { renderNetworkErrorInline(el2, res.reason, () => loadCustomerAddressList(onBack)); return; }
    if (!res.ok) { el2.innerHTML = `<div class="bosh">Manzillar yuklanmadi.</div>`; return; }
    customerState.addresses = res.addresses || [];
    el2.innerHTML = customerState.addresses.length
      ? customerState.addresses.map(customerAddressItemHtml).join('')
      : `<div class="bosh">Hali saqlangan manzil yo'q.</div>`;
    el2.querySelectorAll('[data-addr-remove]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        const id = btn.getAttribute('data-addr-remove');
        const res2 = await apiPost('/api/customer-address-remove', { initData, ownerId: customerState.ownerId, addressId: id });
        if (res2.ok) { customerState.addresses = res2.addresses || []; loadCustomerAddressList(onBack); }
        else btn.disabled = false;
      });
    });
    el2.querySelectorAll('[data-addr-id]').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-addr-id');
        const addr = customerState.addresses.find(a => a.id === id);
        if (addr) renderCustomerAddressFormScreen(addr, () => renderCustomerAddressesScreen(onBack));
      });
    });
  }

  function renderCustomerAddressFormScreen(existing, onDone) {
    const formLoc = { current: existing ? existing.location : null };
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">${existing ? 'Manzilni tahrirlash' : 'Yangi manzil'}</div>
        <button class="btn ikkinchi" id="custAddrFormBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <input type="text" id="custAddrLabelInput" placeholder="Nomi (masalan: Uy, Ish)" value="${escapeHtml(existing ? existing.label : '')}" style="margin-bottom:8px;">
        <button type="button" class="btn ikkinchi" id="custAddrLocBtn" style="width:100%; margin-bottom:6px;">
          ${formLoc.current ? icon('check-circle', 'icon-xs icon-success') + ' Joylashuv aniqlandi (qayta aniqlash)' : icon('pin', 'icon-xs') + ' Joylashuvni aniqlash'}
        </button>
        <div id="custAddrLocStatus" class="xabar" style="margin-bottom:6px;"></div>
        <textarea id="custAddrNoteInput" placeholder="Manzilni tushuntiring (mo'ljal, qavat, kod va h.k.)" rows="2" style="margin-bottom:8px;">${escapeHtml(existing ? (existing.addressNote || '') : '')}</textarea>
        <input type="tel" id="custAddrPhoneInput" class="phone-input-lg" placeholder="Qo'shimcha tel. raqam" value="${escapeHtml(existing ? (existing.extraPhone || '') : '')}" inputmode="tel" style="margin-bottom:8px;">
        <div class="xabar" id="custAddrFormMsg"></div>
        <div class="btn-row">
          <button type="button" class="btn" id="custAddrSaveBtn">Saqlash</button>
        </div>
      </div>
    `);
    document.getElementById('custAddrFormBackBtn').addEventListener('click', () => onDone && onDone());
    const locBtn = document.getElementById('custAddrLocBtn');
    const locStatusEl = document.getElementById('custAddrLocStatus');
    locBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        locStatusEl.textContent = 'Bu qurilma/brauzer joylashuvni aniqlay olmaydi. Manzilni pastga yozib qoldiring.';
        locStatusEl.className = 'xabar err';
        return;
      }
      locStatusEl.textContent = 'Aniqlanmoqda...';
      locStatusEl.className = 'xabar';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          formLoc.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          locStatusEl.innerHTML = `${icon('check-circle', 'icon-xs icon-success')} Joylashuv aniqlandi.`;
          locStatusEl.className = 'xabar ok';
          locBtn.innerHTML = `${icon('check-circle', 'icon-xs icon-success')} Joylashuv aniqlandi (qayta aniqlash)`;
        },
        () => {
          locStatusEl.textContent = 'Joylashuvni aniqlab bo\'lmadi. Manzilni pastga yozib qoldiring.';
          locStatusEl.className = 'xabar err';
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
    document.getElementById('custAddrSaveBtn').addEventListener('click', async () => {
      const msgEl = document.getElementById('custAddrFormMsg');
      const label = document.getElementById('custAddrLabelInput').value;
      const addressNote = document.getElementById('custAddrNoteInput').value;
      const extraPhone = document.getElementById('custAddrPhoneInput').value;
      if (!label.trim()) {
        msgEl.textContent = 'Manzil nomini kiriting (masalan: Uy, Ish).';
        msgEl.className = 'xabar err';
        return;
      }
      if (!formLoc.current && !addressNote.trim()) {
        msgEl.textContent = 'Joylashuvni aniqlang yoki manzilni yozib qoldiring.';
        msgEl.className = 'xabar err';
        return;
      }
      msgEl.textContent = 'Saqlanmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/customer-address-save', {
        initData, ownerId: customerState.ownerId,
        addressId: existing ? existing.id : null,
        label, addressNote, extraPhone,
        location: formLoc.current
      });
      if (res.ok) {
        customerState.addresses = res.addresses || [];
        onDone && onDone();
      } else {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });
  }

  // 39-bosqich: bildirishnoma bandi ikonkasi va matni turiga qarab.
  function customerNotifItemHtml(n) {
    return `
      <div class="cust-notif-item">
        <span class="cust-notif-icon ${n.type === 'promo' ? 'promo' : 'order'}">${icon(n.icon || 'bell', 'icon-xs')}</span>
        <div class="cust-notif-body">
          <div class="cust-notif-title">${escapeHtml(n.title)}</div>
          ${n.text ? `<div class="cust-notif-text">${escapeHtml(n.text)}</div>` : ''}
          <div class="cust-notif-time">${timeAgo(n.time)}</div>
        </div>
      </div>
    `;
  }

  function customerNotifListHtml(notifications) {
    return (notifications && notifications.length)
      ? notifications.map(customerNotifItemHtml).join('')
      : `<div class="bosh">Hozircha bildirishnoma yo'q.</div>`;
  }

  function renderCustomerNotificationsScreen(onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Bildirishnomalar</div>
        <button class="btn ikkinchi" id="custNotifBackBtn" style="margin-bottom:12px;">← Orqaga</button>
        <div class="kartochka" id="custNotifList"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);
    document.getElementById('custNotifBackBtn').addEventListener('click', () => {
      // Ekrandan chiqqanda barchasi "ko'rilgan" deb belgilanadi — qo'ng'iroqcha
      // ustidagi son yo'qoladi, orqaga qaytilgan tabda darhol yangilanadi.
      customerState.notifUnseenCount = 0;
      onBack && onBack();
    });
    loadCustomerNotifList();
  }

  async function loadCustomerNotifList() {
    const el = document.getElementById('custNotifList');
    if (!el) return;
    const res = await apiPost('/api/customer-notifications', { initData, ownerId: customerState.ownerId });
    const el2 = document.getElementById('custNotifList');
    if (!el2) return; // foydalanuvchi allaqachon boshqa ekranga o'tgan bo'lishi mumkin
    if (res.networkError) { renderNetworkErrorInline(el2, res.reason, () => loadCustomerNotifList()); return; }
    if (!res.ok) {
      el2.innerHTML = `<div class="bosh">Bildirishnomalar yuklanmadi.</div>`;
      return;
    }
    el2.innerHTML = customerNotifListHtml(res.notifications);
    setCustomerNotifSeenNow();
    customerState.notifUnseenCount = 0;
  }

  function renderCustomerFavoritesTab() {
    const favItems = customerState.menu.filter(m => customerState.favorites.includes(m.id));
    ekran(`
      <div class="panel ${customerCartQty() ? 'has-cart-fab' : ''}">
        ${customerHeaderHtml()}
        ${customerTabRowHtml()}
        <div id="customerMenuList" class="catalog-grid" style="margin-top:10px;">
          ${favItems.length ? favItems.map(customerItemCardHtml).join('') : `<div class="bosh">Hali sevimli taomlar yo'q. Menyuda ${icon('heart', 'icon-xs icon-muted')} tugmasini bosing.</div>`}
        </div>
      </div>
      ${cartFabBarHtml()}
    `);
    attachCustomerCatalogHandlers();
    attachCustomerTabHandlers();
    attachCartFabHandler();
  }

  // ---- 55-bosqich: buyurtma holatini real vaqtda kuzatish uchun bosqichli
  // yo'l (stepper). Dostavka buyurtmalarida 4 bosqich (+ "Yetkazildi"),
  // qolganlarida 3 bosqich. "Bekor qilindi" holatida stepper o'rniga hech
  // narsa ko'rsatilmaydi — yuqoridagi status-badge yetarli.
  function customerOrderTrackHtml(o) {
    if (o.status === 'bekor_qilindi') return '';
    const isDelivery = o.orderType === 'dostavka';
    const steps = [
      { key: 'yangi', label: 'Qabul qilindi' },
      { key: 'tayyorlanmoqda', label: 'Tayyorlanmoqda' },
      { key: 'tayyor', label: isDelivery ? "Tayyor bo'ldi" : 'Tayyor' }
    ];
    if (isDelivery) steps.push({ key: 'yetkazildi', label: 'Yetkazildi' });

    // Joriy bosqich indeksi: status + (dostavka uchun) deliveredAt maydoniga qarab.
    let activeIdx = 0;
    if (o.status === 'tayyorlanmoqda') activeIdx = 1;
    else if (o.status === 'tayyor') activeIdx = isDelivery ? (o.deliveredAt ? 3 : 2) : 2;

    return `
      <div class="order-track" data-order-track="${escapeHtml(o.id)}">
        ${steps.map((s, i) => `
          <div class="order-track-step ${i < activeIdx ? 'done' : ''} ${i === activeIdx ? 'active' : ''}">
            <div class="order-track-dot"></div>
            <div class="order-track-label">${escapeHtml(s.label)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function customerOrderHistoryCardHtml(o) {
    const itemsText = o.items.map(it => `${escapeHtml(it.name)} x${it.qty}`).join(', ');
    return `
      <div class="order-card" data-order-card-id="${escapeHtml(o.id)}">
        <div class="order-top">
          <div>
            <div class="order-type">${ORDER_TYPE_LABELS[o.orderType] || o.orderType}${o.tableNumber ? ' — stol ' + escapeHtml(o.tableNumber) : ''}</div>
            <div class="order-time">${timeAgo(o.createdAt)}</div>
          </div>
          <span class="status-badge ${o.status}">${o.status === 'tayyor' && o.deliveredAt ? 'Yetkazildi' : (ORDER_STATUS_LABELS[o.status] || o.status)}</span>
        </div>
        ${customerOrderTrackHtml(o)}
        <div class="order-items">${itemsText}</div>
        <div class="order-bottom">
          <div class="order-total">${fmtNum(o.total)} so'm${o.discountAmount ? ` <span style="opacity:0.6; font-weight:400;">(-${fmtNum(o.discountAmount)})</span>` : ''}</div>
          ${o.pointsEarned ? `<span style="font-size:12px; color:#2fa84f;">+${o.pointsEarned} ball</span>` : ''}
        </div>
        <button type="button" class="order-reorder-btn" data-reorder-id="${escapeHtml(o.id)}">${icon('repeat', 'icon-xs')} Yana buyurtma berish</button>
      </div>
    `;
  }

  // ---- 55-bosqich: mijoz "Buyurtmalarim" ekrani real vaqtda (pollingda)
  // yangilanadi — xuddi xodimlar taxtasidagi ordersPollTimer kabi, lekin
  // alohida o'zgaruvchilar bilan (bir vaqtning o'zida ikkalasi ham
  // ishlamaydi, lekin nom to'qnashmasligi uchun alohida saqlanadi).
  let customerHistoryPollTimer = null;
  let lastCustomerHistorySnapshot = null;
  let knownCustomerOrderStates = null; // orderId -> "status|deliveredAt" — holat o'zgarishini payqash uchun

  function stopCustomerHistoryPolling() {
    if (customerHistoryPollTimer) { clearInterval(customerHistoryPollTimer); customerHistoryPollTimer = null; }
    lastCustomerHistorySnapshot = null;
    knownCustomerOrderStates = null;
  }

  // 40-bosqich: tezkor takroriy buyurtma — bosilganda o'sha buyurtmadagi
  // taomlarni (hozir ham menyuda mavjud bo'lganlarini) savatga solib,
  // to'g'ridan-to'g'ri Menyu bo'limiga o'tkazadi. Ro'yxat har safar poll
  // orqali yangilanganda ham qayta ulanishi kerak bo'lgani uchun alohida
  // funksiyaga chiqarilgan.
  function attachCustomerHistoryHandlers(listEl, orders) {
    listEl.querySelectorAll('[data-reorder-id]').forEach(btn => btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-reorder-id');
      const order = orders.find(o => o.id === orderId);
      if (!order) return;
      btn.disabled = true;
      const newCart = {};
      let skipped = 0;
      order.items.forEach(it => {
        if (it.isCombo) { skipped++; return; }
        const stillOnMenu = customerState.menu.find(m => m.id === it.id && !m.outOfStock);
        if (stillOnMenu) newCart[it.id] = (newCart[it.id] || 0) + it.qty;
        else skipped++;
      });
      if (!Object.keys(newCart).length) {
        btn.disabled = false;
        const alertFn = (tg && tg.showAlert) ? (msg) => tg.showAlert(msg) : (msg) => alert(msg);
        alertFn("Afsuski, bu buyurtmadagi taomlar hozir menyuda mavjud emas.");
        return;
      }
      customerState.cart = newCart;
      customerState.tab = 'menyu';
      customerState.searchQuery = '';
      stopCustomerHistoryPolling();
      renderCustomerMenuTab();
      if (skipped > 0) {
        const alertFn = (tg && tg.showAlert) ? (msg) => tg.showAlert(msg) : (msg) => alert(msg);
        alertFn(`Savatga qo'shildi. ${skipped} ta taom hozir mavjud emasligi sababli o'tkazib yuborildi.`);
      }
    }));
  }

  // Har 5 soniyada chaqiriladi: agar ekran hali "Buyurtmalarim"da bo'lsa
  // va tarkib avvalgisidan farq qilsa, faqat o'zgargan qismini qayta chizadi
  // (butun ekranni emas — foydalanuvchi scroll holatini yo'qotmasin uchun).
  // Yangi holatga o'tgan buyurtma bo'lsa, o'sha kartochka bir lahza
  // (.order-track-flash) yorqinroq ko'rinadi va yengil tebranish beriladi.
  async function refreshCustomerHistoryList() {
    const listEl = document.getElementById('customerHistoryList');
    if (!listEl) { stopCustomerHistoryPolling(); return; }
    const res = await apiPost('/api/customer-orders-history', { initData, ownerId: customerState.ownerId });
    const listEl2 = document.getElementById('customerHistoryList');
    if (!listEl2) return; // shu orada foydalanuvchi boshqa ekranga o'tgan bo'lishi mumkin
    if (!res.ok) {
      if (lastCustomerHistorySnapshot === null) {
        listEl2.innerHTML = `<div class="bosh">Yuklab bo'lmadi.</div>`;
      }
      return; // vaqtinchalik uzilish — mavjud ro'yxatni saqlab qolamiz
    }
    const orders = res.orders || [];

    const snapshot = JSON.stringify(orders);
    if (snapshot === lastCustomerHistorySnapshot) return; // o'zgarish yo'q

    const newStates = new Map(orders.map(o => [o.id, `${o.status}|${o.deliveredAt || ''}`]));
    const changedIds = [];
    if (knownCustomerOrderStates) {
      newStates.forEach((state, id) => {
        if (knownCustomerOrderStates.get(id) && knownCustomerOrderStates.get(id) !== state) changedIds.push(id);
      });
    }
    lastCustomerHistorySnapshot = snapshot;
    knownCustomerOrderStates = newStates;

    listEl2.innerHTML = orders.length ? orders.map(customerOrderHistoryCardHtml).join('') : `<div class="bosh">Hali buyurtmalar yo'q.</div>`;
    attachCustomerHistoryHandlers(listEl2, orders);

    // Holati yangi o'zgargan buyurtmalarni ko'zga tashlanadigan qilib beramiz.
    if (changedIds.length) {
      if (tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred) {
        try { tg.HapticFeedback.notificationOccurred('success'); } catch (e) {}
      }
      changedIds.forEach(id => {
        const card = listEl2.querySelector(`[data-order-card-id="${CSS && CSS.escape ? CSS.escape(id) : id}"]`);
        if (card) card.classList.add('order-track-flash');
      });
    }
  }

  function startCustomerHistoryPolling() {
    stopCustomerHistoryPolling();
    refreshCustomerHistoryList();
    customerHistoryPollTimer = setInterval(refreshCustomerHistoryList, 5000);
  }

  async function renderCustomerHistoryTab() {
    ekran(`
      <div class="panel">
        ${customerHeaderHtml()}
        ${customerTabRowHtml()}
        <div id="customerHistoryList"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);
    attachCustomerTabHandlers();
    startCustomerHistoryPolling();
  }

  async function sendCustomerOrder(overlay) {
    const msgEl = document.getElementById('cOrderMsg');
    const sendBtn = overlay ? overlay.querySelector('#cSendOrderBtn') : document.getElementById('cSendOrderBtn');
    const items = Object.entries(customerState.cart)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ id, qty }));

    if (!items.length) {
      msgEl.textContent = 'Savat bo\'sh. Kamida bitta taom tanlang.';
      msgEl.className = 'xabar err';
      return;
    }
    if (customerState.orderType === 'stol' && !customerState.tableNumber.trim()) {
      msgEl.textContent = 'Stol raqamini kiriting.';
      msgEl.className = 'xabar err';
      return;
    }
    if (customerState.orderType === 'dostavka' && !customerState.location && !customerState.addressNote.trim()) {
      msgEl.textContent = 'Dostavka uchun joylashuvni aniqlang yoki manzilni yozib qoldiring.';
      msgEl.className = 'xabar err';
      return;
    }
    if (customerState.orderType === 'dostavka' && customerState.extraPhone.trim().replace(/\D/g, '').length < 7) {
      msgEl.textContent = 'Qo\'shimcha telefon raqamingizni kiriting.';
      msgEl.className = 'xabar err';
      return;
    }

    // Tugmani darhol o'chiramiz — foydalanuvchi tez-tez bossa ham,
    // ikkinchi so'rov ketmaydi (qo'sh buyurtma/qo'sh sklad chiqimining oldini oladi)
    if (sendBtn) sendBtn.disabled = true;
    // Bitta chek-aut urinishi uchun bitta requestId — server shu orqali
    // takroriy so'rovni aniqlab, bir xil natijani qaytaradi
    if (!customerState.lastOrderRequestId) {
      customerState.lastOrderRequestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    msgEl.textContent = 'Yuborilmoqda...';
    msgEl.className = 'xabar';
    const res = await apiPost('/api/customer-order', {
      initData,
      ownerId: customerState.ownerId,
      items,
      orderType: customerState.orderType,
      tableNumber: customerState.tableNumber,
      paymentType: customerState.paymentType,
      promoId: customerState.promoId || null,
      usePoints: customerState.usePoints ? customerState.bonusPoints : 0,
      location: customerState.orderType === 'dostavka' ? customerState.location : null,
      addressNote: customerState.orderType === 'dostavka' ? customerState.addressNote : '',
      extraPhone: customerState.orderType === 'dostavka' ? customerState.extraPhone : '',
      requestId: customerState.lastOrderRequestId
    });

    if (res.ok) {
      customerState.cart = {};
      customerState.usePoints = false;
      customerState.bonusPoints = res.bonusBalance;
      customerState.location = null;
      customerState.addressNote = '';
      customerState.extraPhone = '';
      customerState.lastOrderRequestId = null; // keyingi buyurtma uchun yangi requestId kerak bo'ladi
      if (overlay) overlay.remove();
      if (customerState.tab === 'sevimli') renderCustomerFavoritesTab();
      else renderCustomerMenuTab();
      const topMsg = document.createElement('div');
      topMsg.className = 'xabar ok';
      if (res.paymentPending) {
        if (res.paymentConfirmMethod === 'naqd_kassa') {
          topMsg.innerHTML = `${icon('restaurant', 'icon-xs icon-success')} Buyurtma qabul qilindi (${fmtNum(res.total)} so'm).<br>` +
            `Iltimos, kassaga borib to'lovni amalga oshiring - to'lov qabul qilingach, taomingiz tayyorlanishni boshlaydi.`;
        } else {
          // 24-bosqich: ilgari shu joyda faqat kichik, page tepasida
          // ko'rinadigan xabar (topMsg) bo'lgan — ayniqsa Dostavka+Karta
          // holatida (boshqa joylashuv/manzil xabarlari orasida) mijoz
          // buni ko'rmay qolib, skrinshot yubormasdan qolib ketishi mumkin
          // edi. 25/26-bosqich: endi bu ALOHIDA, undov belgili, qizil
          // ramkali modal sifatida ochiladi — mijoz uni yopmaguncha davom
          // eta olmaydi.
          topMsg.innerHTML = `${icon('card', 'icon-xs icon-success')} Buyurtma qabul qilindi (${fmtNum(res.total)} so'm) — <b>tasdiqlash kutilmoqda</b>.`;
          showPaymentProofModal();
        }
      } else {
        topMsg.innerHTML = `${icon('check-circle', 'icon-xs icon-success')} Buyurtma qabul qilindi (${fmtNum(res.total)} so'm)${res.pointsEarned ? ` · +${res.pointsEarned} bonus ball` : ''}`;
      }
      document.querySelector('.panel').prepend(topMsg);
    } else {
      if (sendBtn) sendBtn.disabled = false; // xato bo'lsa — qayta urinib ko'rish uchun tugma yoqiladi
      msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
      msgEl.className = 'xabar err';
    }
  }

  // 25/26-bosqich: karta bilan to'lagan mijozga - to'lov skrinshotini
  // yuborish shartligi haqida ALOHIDA, aniq ko'rinadigan (⚠️, qizil ramkali)
  // modal oyna. Mijoz "Tushundim" tugmasini bosmaguncha (yoki fonga
  // bosmaguncha) yopilmaydi - shu bilan e'tiborsiz qoldirib ketish
  // ehtimoli kamayadi. Buyurtma turi qanday bo'lishidan (Stolga, Olib
  // ketish, Dostavka) qat'iy nazar bir xil ishlaydi.
  function showPaymentProofModal() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal payment-proof-modal">
        <h3>${icon('warning', 'icon-sm modal-warn-icon')} Chek rasmini yuboring</h3>
        <p>Buyurtma hali <b>tasdiqlanmagan</b>.<br>To'lov chekining rasmini botning shaxsiy chatiga yuboring.</p>
        <div class="btn-row">
          <button type="button" class="btn xavfli" id="paymentProofOkBtn" style="width:100%;">Tushundim</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#paymentProofOkBtn').addEventListener('click', () => overlay.remove());
  }

  // ---- Ism, familiya, telefon raqam bilan ro'yxatdan o'tish (Mini App ichida,
  // botning shaxsiy chatiga chiqmasdan). onDone — muvaffaqiyatli yuborilgandan
  // keyin chaqiriladigan callback (odatda joriy ekranni qayta yuklaydigan funksiya). ----
  async function renderPersonRegistrationScreen(onDone) {
    const canRequestContact = tg && typeof tg.requestContact === 'function';
    ekran(`
      <div class="panel">
        <div class="salom">Tanishuv</div>
        <div class="bosh">Davom etishdan oldin ismingiz, familiyangiz va telefon raqamingizni kiriting.</div>
        <div class="kartochka">
          <label class="field-label">Ism</label>
          <input type="text" id="regFirstName" placeholder="Ism" autocomplete="given-name">
          <label class="field-label" style="margin-top:10px;">Familiya</label>
          <input type="text" id="regLastName" placeholder="Familiya" autocomplete="family-name">
          <label class="field-label" style="margin-top:10px;">Telefon raqam</label>
          <input type="tel" id="regPhone" placeholder="+998901234567" autocomplete="tel">
          ${canRequestContact ? `<button type="button" class="btn" id="regContactBtn" style="margin-top:8px;">${icon('user', 'icon-xs')}<span>Raqamni Telegram orqali yuborish</span></button>` : ''}
          <button class="btn" id="regSubmitBtn" style="margin-top:14px;">${icon('check-circle', 'icon-xs')}<span>Davom etish</span></button>
          <div class="xabar" id="regMsg"></div>
        </div>
      </div>
    `);

    const contactBtn = document.getElementById('regContactBtn');
    if (contactBtn) {
      contactBtn.addEventListener('click', () => {
        try {
          tg.requestContact((granted, contactData) => {
            if (!granted) return;
            const c = (contactData && (contactData.responseUnsafe || contactData)) || {};
            const contact = c.contact || c;
            if (contact && contact.phone_number) {
              document.getElementById('regPhone').value = contact.phone_number;
            }
            if (contact && contact.first_name && !document.getElementById('regFirstName').value) {
              document.getElementById('regFirstName').value = contact.first_name;
            }
            if (contact && contact.last_name && !document.getElementById('regLastName').value) {
              document.getElementById('regLastName').value = contact.last_name;
            }
          });
        } catch (e) { /* eski Telegram versiyalarida requestContact bo'lmasligi mumkin */ }
      });
    }

    const doSubmit = async () => {
      const msgEl = document.getElementById('regMsg');
      const btn = document.getElementById('regSubmitBtn');
      const firstName = document.getElementById('regFirstName').value.trim();
      const lastName = document.getElementById('regLastName').value.trim();
      const phone = document.getElementById('regPhone').value.trim();
      if (!firstName || !lastName || !phone) {
        msgEl.textContent = 'Barcha maydonlarni to\'ldiring.';
        msgEl.className = 'xabar err';
        return;
      }
      btn.disabled = true;
      msgEl.textContent = 'Yuborilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/profile-register', { initData, firstName, lastName, phone });
      if (res.networkError) {
        msgEl.textContent = res.reason;
        msgEl.className = 'xabar err';
        btn.disabled = false;
        return;
      }
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
        btn.disabled = false;
        return;
      }
      onDone();
    };
    document.getElementById('regSubmitBtn').addEventListener('click', doSubmit);
  }

  // Mijoz ilovasi ochilganda ko'rsatiladigan "Xush kelibsiz" yuklanish ekrani —
  // oshxonaning logotipi orqa fonda (xira/qorong'ilashtirilgan), ustida
  // "Xush kelibsiz!" va oshxona nomi. brand — /api/restaurant-brand natijasi
  // ({name, logoUrl}) yoki null (topilmasa/hali kelmagan bo'lsa umumiy ko'rinish).
  function customerWelcomeLoadingHtml(brand) {
    const name = (brand && brand.name) || 'Oshxona';
    const logoUrl = brand && brand.logoUrl;
    return `
      <div class="customer-welcome-loading"${logoUrl ? ` style="background-image:url('${escapeHtml(logoUrl)}')"` : ''}>
        <div class="customer-welcome-overlay">
          ${logoUrl
            ? `<img class="customer-welcome-logo" src="${escapeHtml(logoUrl)}" alt="">`
            : `<div class="customer-welcome-logo customer-welcome-logo-fallback">${icon('restaurant', 'icon-lg')}</div>`}
          <div class="customer-welcome-title">Xush kelibsiz!</div>
          <div class="customer-welcome-sub">${escapeHtml(name)}</div>
          <div class="customer-welcome-loading-text">Yuklanmoqda...</div>
        </div>
      </div>
    `;
  }

  async function renderCustomerApp(ownerId) {
    clearAppHeader();
    ekran(customerWelcomeLoadingHtml(null));
    // Brend (logo/nom) va to'liq tekshiruv PARALLEL yuboriladi — logo tezroq
    // qaytsa, ekran darhol yangilanadi. `stillLoading` — brend so'rovi
    // tekshiruvdan KECHROQ qaytib qolsa (ekran allaqachon menyuga o'tgan
    // bo'lsa), uni qayta "Xush kelibsiz" ekrani bilan bosib qo'ymasligi uchun.
    let stillLoading = true;
    apiPost('/api/restaurant-brand', { ownerId }).then(r => {
      if (stillLoading && r && r.ok) ekran(customerWelcomeLoadingHtml(r));
    }).catch(() => {});
    const verifyRes = await apiPost('/api/customer-verify', { initData, ownerId });
    stillLoading = false;
    if (verifyRes.networkError) {
      renderNetworkErrorScreen(verifyRes.reason, () => renderCustomerApp(ownerId));
      return;
    }
    if (!verifyRes.ok) {
      ekran(`<div class="xato">Kirish rad etildi.<br>${escapeHtml(verifyRes.reason || 'Bu menyu hozircha mavjud emas.')}</div>`);
      return;
    }
    applyBrandColor(verifyRes.restaurant.brandColor);
    setAppHeader(verifyRes.restaurant.logoUrl, verifyRes.restaurant.name);
    if (!verifyRes.personRegistered) {
      renderPersonRegistrationScreen(() => renderCustomerApp(ownerId));
      return;
    }
    customerState.ownerId = ownerId;
    customerState.restaurant = verifyRes.restaurant;
    customerState.favorites = verifyRes.customer.favorites || [];
    customerState.addresses = verifyRes.customer.addresses || [];
    customerState.bonusPoints = verifyRes.customer.bonusPoints || 0;
    customerState.bonusEnabled = !!verifyRes.bonusEnabled;
    customerState.cardOnlyRestricted = !!verifyRes.customer.cardOnlyRestricted;

    // 57-bosqich: QR-kod orqali kirilgan bo'lsa (?table=<raqam>) — buyurtma
    // turi va stol raqami oldindan avtomatik to'ldiriladi, mijoz stol
    // raqamini qo'lda kiritmasligi kerak.
    const qrTableNumber = urlParams.get('table');
    if (qrTableNumber) {
      customerState.orderType = 'stol';
      customerState.tableNumber = qrTableNumber;
    }

    const menuRes = await apiPost('/api/customer-menu-list', { initData, ownerId });
    customerState.menu = menuRes.ok ? menuRes.menu : [];
    customerState.categories = menuRes.ok ? (menuRes.categories || []) : [];
    customerState.promotions = menuRes.ok ? menuRes.promotions : [];
    customerState.banners = menuRes.ok ? (menuRes.banners || []) : [];
    customerState.aiRecommendations = menuRes.ok ? (menuRes.recommendations || null) : null;

    renderCustomerMenuTab();
    // 39-bosqich: qo'ng'iroqcha ustidagi son ekran chizilgach fonda yuklanadi
    // (butun ilova ochilishini sekinlashtirmaslik uchun).
    refreshCustomerNotifBadge();
  }

  function customerRestaurantPickerHtml(restaurants) {
    return restaurants.map(r => `
      <div class="owner-item" data-pick-restaurant-id="${escapeHtml(r.id)}" style="cursor:pointer;">
        <div>
          <div class="owner-id">${escapeHtml(r.name)}</div>
          ${r.address ? `<div class="owner-username">${escapeHtml(r.address)}</div>` : ''}
        </div>
        <div style="font-size:20px;">›</div>
      </div>
    `).join('');
  }

  async function renderCustomerEntry() {
    clearAppHeader();
    resetBrandColor();
    ekran(customerWelcomeLoadingHtml(readCachedBrand()));
    const res = await apiPost('/api/customer-restaurants-list', { initData });
    if (res.networkError) {
      renderNetworkErrorScreen(res.reason, renderCustomerEntry);
      return;
    }
    const restaurants = res.ok ? res.restaurants : [];

    if (!restaurants.length) {
      ekran('<div class="xato">Hozircha faol oshxona topilmadi.<br>Iltimos, keyinroq urinib ko\'ring.</div>');
      return;
    }
    if (restaurants.length === 1) {
      renderCustomerApp(restaurants[0].id);
      return;
    }
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Oshxonani tanlang</div>
        <div class="owner-list" style="margin-top:14px;">${customerRestaurantPickerHtml(restaurants)}</div>
      </div>
    `);
    document.querySelectorAll('[data-pick-restaurant-id]').forEach(el => {
      el.addEventListener('click', () => renderCustomerApp(el.getAttribute('data-pick-restaurant-id')));
    });
  }

  // ==================== Bosh oynani ochish ====================
  const urlParams = new URLSearchParams(location.search);
  const customerOwnerId = urlParams.get('customer');

  if (!tg && !customerOwnerId) {
    // Oddiy brauzerdan (Telegram tashqarisidan) ochilsa — oshxona egasi
    // login/parol bilan kirishi mumkin (admin bergan login/parol orqali).
    if (initData) {
      bootstrapApp();
    } else {
      renderOwnerLoginScreen();
    }
  } else if (!tg) {
    ekran('<div class="xato">Kirish rad etildi.<br>Bu havola faqat Telegram orqali ishlaydi.</div>');
  } else {
    tg.ready();
    tg.expand();

    if (customerOwnerId) {
      renderCustomerApp(customerOwnerId);
    } else {
      bootstrapApp();
    }
  }

  // ---- Login/parol orqali kirish ekrani (Telegram tashqarisida) ----
  function renderOwnerLoginScreen(errorText) {
    clearAppHeader();
    resetBrandColor();
    ekran(`
      <div class="panel">
        <div class="salom">Oshxona egasi kirishi</div>
        <div class="bosh">Administrator sizga bergan login va parolni kiriting.</div>
        <div class="kartochka">
          <label class="field-label">Login</label>
          <input type="text" id="ownerLoginInput" autocomplete="username" placeholder="Login">
          <label class="field-label">Parol</label>
          <input type="password" id="ownerPasswordInput" autocomplete="current-password" placeholder="Parol">
          <button class="btn" id="ownerLoginBtn" style="margin-top:10px;">${icon('user', 'icon-xs')}<span>Kirish</span></button>
          <div class="xabar ${errorText ? 'err' : ''}" id="ownerLoginMsg">${errorText ? escapeHtml(errorText) : ''}</div>
        </div>
      </div>
    `);

    const doLogin = async () => {
      const login = document.getElementById('ownerLoginInput').value.trim();
      const password = document.getElementById('ownerPasswordInput').value;
      const msgEl = document.getElementById('ownerLoginMsg');
      const btn = document.getElementById('ownerLoginBtn');
      if (!login || !password) {
        msgEl.textContent = 'Login va parolni kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      btn.disabled = true;
      msgEl.textContent = 'Tekshirilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/owner-login', { login, password });
      btn.disabled = false;
      if (res.networkError) {
        msgEl.textContent = res.reason;
        msgEl.className = 'xabar err';
        return;
      }
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Login yoki parol noto\'g\'ri.';
        msgEl.className = 'xabar err';
        return;
      }
      initData = res.sessionToken;
      usingOwnerSession = true;
      localStorage.setItem(OWNER_SESSION_STORAGE_KEY, res.sessionToken);
      bootstrapApp();
    };

    document.getElementById('ownerLoginBtn').addEventListener('click', doLogin);
    document.getElementById('ownerPasswordInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
  }

  // 3-4-bosqich: renderProfileForm() ichidagi "Xavfsizlik" bo'limi uchun
  // event handlerlar — egasi (admin emas, o'zi) o'z parolini almashtiradi
  // yoki butunlay o'chiradi. Parol o'zgarganda/o'chirilganda server barcha
  // sess_ sessiyalarni bekor qiladi — shu sababli usingOwnerSession bo'lsa,
  // muvaffaqiyatli almashtirishdan so'ng mahalliy sessiya ham tozalanib,
  // qayta login ekraniga qaytariladi. Parolni o'chirish tugmasi faqat
  // Telegram orqali kirilganda (tg mavjud bo'lganda) ko'rsatiladi — aks
  // holda egasi (usingOwnerSession, Telegramsiz brauzer sessiyasi) parolni
  // o'chirib, hech qanday kirish usulisiz qolib ketishi mumkin edi.
  function attachOwnerPasswordSecurityHandlers() {
    const toggleChangeBtn = document.getElementById('togglePwChangeBtn');
    const changeForm = document.getElementById('pwChangeForm');
    if (toggleChangeBtn && changeForm) {
      toggleChangeBtn.addEventListener('click', () => changeForm.classList.toggle('hidden'));
    }

    const changeCancelBtn = document.getElementById('pwChangeCancelBtn');
    if (changeCancelBtn) {
      changeCancelBtn.addEventListener('click', () => {
        document.getElementById('pwCurrentInput').value = '';
        document.getElementById('pwNewInput').value = '';
        document.getElementById('pwNewRepeatInput').value = '';
        const msgEl = document.getElementById('pwChangeMsg');
        msgEl.textContent = '';
        msgEl.className = 'xabar';
        changeForm.classList.add('hidden');
      });
    }

    const changeSaveBtn = document.getElementById('pwChangeSaveBtn');
    if (changeSaveBtn) {
      changeSaveBtn.addEventListener('click', async () => {
        const currentPassword = document.getElementById('pwCurrentInput').value;
        const newPassword = document.getElementById('pwNewInput').value;
        const newPasswordRepeat = document.getElementById('pwNewRepeatInput').value;
        const msgEl = document.getElementById('pwChangeMsg');
        if (!currentPassword || !newPassword) {
          msgEl.textContent = 'Barcha maydonlarni to\'ldiring.';
          msgEl.className = 'xabar err';
          return;
        }
        if (newPassword.length < 6) {
          msgEl.textContent = 'Yangi parol kamida 6 belgidan iborat bo\'lishi kerak.';
          msgEl.className = 'xabar err';
          return;
        }
        if (newPassword !== newPasswordRepeat) {
          msgEl.textContent = 'Yangi parollar mos kelmadi.';
          msgEl.className = 'xabar err';
          return;
        }
        changeSaveBtn.disabled = true;
        msgEl.textContent = 'Saqlanmoqda...';
        msgEl.className = 'xabar';
        const res = await apiPost('/api/owner-change-password', { initData, currentPassword, newPassword });
        changeSaveBtn.disabled = false;
        if (res.networkError) {
          msgEl.textContent = res.reason;
          msgEl.className = 'xabar err';
          return;
        }
        if (!res.ok) {
          msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
          msgEl.className = 'xabar err';
          return;
        }
        if (usingOwnerSession) {
          // Server bu sessiyani ham bekor qildi — qayta login qildiramiz
          localStorage.removeItem(OWNER_SESSION_STORAGE_KEY);
          initData = null;
          renderOwnerLoginScreen('Parol muvaffaqiyatli o\'zgartirildi. Yangi parol bilan qayta kiring.');
          return;
        }
        msgEl.textContent = 'Parol muvaffaqiyatli o\'zgartirildi.';
        msgEl.className = 'xabar ok';
        document.getElementById('pwCurrentInput').value = '';
        document.getElementById('pwNewInput').value = '';
        document.getElementById('pwNewRepeatInput').value = '';
      });
    }

    const toggleRemoveBtn = document.getElementById('togglePwRemoveBtn');
    const removeForm = document.getElementById('pwRemoveForm');
    if (toggleRemoveBtn && removeForm) {
      toggleRemoveBtn.addEventListener('click', () => removeForm.classList.toggle('hidden'));
    }

    const removeCancelBtn = document.getElementById('pwRemoveCancelBtn');
    if (removeCancelBtn) {
      removeCancelBtn.addEventListener('click', () => {
        document.getElementById('pwRemoveCurrentInput').value = '';
        const msgEl = document.getElementById('pwRemoveMsg');
        msgEl.textContent = '';
        msgEl.className = 'xabar';
        removeForm.classList.add('hidden');
      });
    }

    const removeConfirmBtn = document.getElementById('pwRemoveConfirmBtn');
    if (removeConfirmBtn) {
      removeConfirmBtn.addEventListener('click', async () => {
        const currentPassword = document.getElementById('pwRemoveCurrentInput').value;
        const msgEl = document.getElementById('pwRemoveMsg');
        if (!currentPassword) {
          msgEl.textContent = 'Joriy parolni kiriting.';
          msgEl.className = 'xabar err';
          return;
        }
        removeConfirmBtn.disabled = true;
        msgEl.textContent = 'Bajarilmoqda...';
        msgEl.className = 'xabar';
        const res = await apiPost('/api/owner-remove-password', { initData, currentPassword });
        removeConfirmBtn.disabled = false;
        if (res.networkError) {
          msgEl.textContent = res.reason;
          msgEl.className = 'xabar err';
          return;
        }
        if (!res.ok) {
          msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
          msgEl.className = 'xabar err';
          return;
        }
        // Parol o'chirilgach faqat Telegram orqali kirish qoladi — gate
        // eslatmasi ham tozalanadi, shunda keyingi safar parol so'ralmaydi.
        const gateKey = ownerTelegramGateKey();
        if (gateKey) localStorage.removeItem(gateKey);
        ownerHasTelegramLogin = false;
        location.reload();
      });
    }
  }

  // Login/parol orqali kirilgan sessiyani tugatadi (owner profil ekranidagi "Chiqish" tugmasi)
  async function ownerLogout() {
    await apiPost('/api/owner-logout', { initData });
    localStorage.removeItem(OWNER_SESSION_STORAGE_KEY);
    location.reload();
  }

  const LAST_BRAND_STORAGE_KEY = 'kitchenOsLastBrand';
  function readCachedBrand() {
    try {
      const raw = localStorage.getItem(LAST_BRAND_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeCachedBrand(name, logoUrl) {
    if (!name && !logoUrl) return;
    try { localStorage.setItem(LAST_BRAND_STORAGE_KEY, JSON.stringify({ name, logoUrl })); } catch (e) { /* joy yetmasa e'tiborsiz qoldiramiz */ }
  }

  async function bootstrapApp() {
    // Ilova oldin ochilgan bo'lsa, o'sha oshxonaning nomi/logotipi shu qurilmada
    // eslab qolingan (localStorage) — shuning uchun /api/verify javob berishini
    // kutmasdan ham darhol tanish "Xush kelibsiz" ekranini ko'rsatish mumkin.
    ekran(customerWelcomeLoadingHtml(readCachedBrand()));
    const data = await apiPost('/api/verify', { initData });
    if (data.networkError) {
      renderNetworkErrorScreen(data.reason, bootstrapApp);
      return;
    }
    if (data.ok && data.ownerRestaurantName) {
      writeCachedBrand(data.ownerRestaurantName, data.ownerLogoUrl);
    }
    if (!data.ok) {
      if (usingOwnerSession) {
        // Login/parol orqali kirilgan sessiya yaroqsiz/eskirgan — qaytadan kirishni so'raymiz
        localStorage.removeItem(OWNER_SESSION_STORAGE_KEY);
        initData = null;
        renderOwnerLoginScreen(data.reason);
        return;
      }
      // Admin/egasi/xodim emas — asosiy "Ochish" tugmasi bilan kirgan oddiy mijoz deb hisoblanadi
      renderCustomerEntry();
      return;
    }
    if (!data.personRegistered) {
      renderPersonRegistrationScreen(() => bootstrapApp());
      return;
    }
    if (data.isAdmin) {
      loadOwnersAndRender();
    } else if (data.isOwner) {
      maybeGateOwnerWithPassword(data);
    } else if (data.role) {
      // YANGI: bir nechta vakolatli xodim - avval qaysi bo'limda ishlashini
      // so'raymiz (bu qurilmada avval tanlagan bo'lsa, localStorage'dan
      // o'qib to'g'ridan-to'g'ri o'sha ekranga kiradi - qarang: staffChosenRoleKey).
      if (Array.isArray(data.roles) && data.roles.length > 1) {
        const key = staffChosenRoleKey();
        const savedRole = key ? localStorage.getItem(key) : null;
        if (savedRole && data.roles.includes(savedRole)) {
          renderStaffScreen(savedRole, ROLE_LABELS[savedRole] || data.roleLabel, data.ownerRestaurantName, data.ownerLogoUrl, data.ownerBrandColor, data.roles);
        } else {
          renderStaffRolePicker(data);
        }
      } else {
        renderStaffScreen(data.role, data.roleLabel, data.ownerRestaurantName, data.ownerLogoUrl, data.ownerBrandColor, data.roles);
      }
    } else {
      renderCustomerEntry();
    }
  }

  // ---- Telegram orqali kirgan egasi uchun bir martalik parol darvozasi ----
  // Admin shu egasiga login/parol o'rnatgan bo'lsa (data.hasOwnerLogin), birinchi
  // marta parol so'raladi. To'g'ri kiritilsa, shu qurilmada (localStorage'da)
  // eslab qolinadi — Telegram ilovasi yopilib qayta ochilsa ham qayta so'ralmaydi,
  // faqat foydalanuvchi "Chiqish" tugmasini bossa yoki brauzer ma'lumotlari
  // tozalansa, keyingi safar yana parol so'raladi.
  function ownerTelegramGateKey() {
    const tgUserId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
    return tgUserId ? `kitchenOsOwnerPwOk:${tgUserId}` : null;
  }

  function maybeGateOwnerWithPassword(data) {
    ownerHasTelegramLogin = !!data.hasOwnerLogin;
    if (!data.hasOwnerLogin) { loadOwnProfileAndRender(); return; }
    const gateKey = ownerTelegramGateKey();
    if (gateKey && localStorage.getItem(gateKey) === '1') { loadOwnProfileAndRender(); return; }
    renderOwnerTelegramPasswordGate(gateKey);
  }

  function renderOwnerTelegramPasswordGate(gateKey, errorText) {
    clearAppHeader();
    resetBrandColor();
    ekran(`
      <div class="panel">
        <div class="salom">Parolni kiriting</div>
        <div class="bosh">Xavfsizlik uchun administrator o'rnatgan parolni kiriting. Bu faqat shu qurilmada bir marta so'raladi.</div>
        <div class="kartochka">
          <label class="field-label">Parol</label>
          <input type="password" id="ownerGatePasswordInput" autocomplete="current-password" placeholder="Parol">
          <button class="btn" id="ownerGateBtn" style="margin-top:10px;">${icon('user', 'icon-xs')}<span>Tasdiqlash</span></button>
          <div class="xabar ${errorText ? 'err' : ''}" id="ownerGateMsg">${errorText ? escapeHtml(errorText) : ''}</div>
        </div>
      </div>
    `);

    const doConfirm = async () => {
      const password = document.getElementById('ownerGatePasswordInput').value;
      const msgEl = document.getElementById('ownerGateMsg');
      const btn = document.getElementById('ownerGateBtn');
      if (!password) {
        msgEl.textContent = 'Parolni kiriting.';
        msgEl.className = 'xabar err';
        return;
      }
      btn.disabled = true;
      msgEl.textContent = 'Tekshirilmoqda...';
      msgEl.className = 'xabar';
      const res = await apiPost('/api/owner-confirm-password', { initData, password });
      btn.disabled = false;
      if (res.networkError) {
        msgEl.textContent = res.reason;
        msgEl.className = 'xabar err';
        return;
      }
      if (!res.ok) {
        msgEl.textContent = res.reason || 'Parol noto\'g\'ri.';
        msgEl.className = 'xabar err';
        return;
      }
      if (gateKey) localStorage.setItem(gateKey, '1');
      loadOwnProfileAndRender();
    };

    document.getElementById('ownerGateBtn').addEventListener('click', doConfirm);
    document.getElementById('ownerGatePasswordInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doConfirm();
    });
  }

  // Telegram-gate eslatmasini shu qurilmadan o'chiradi — keyingi ochishda yana parol so'raladi
  function ownerTelegramGateLogout() {
    const gateKey = ownerTelegramGateKey();
    if (gateKey) localStorage.removeItem(gateKey);
    location.reload();
  }
