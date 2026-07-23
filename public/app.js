const tg = window.Telegram && window.Telegram.WebApp;
  const appEl = document.getElementById('app');
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

  // 16-bosqich: tarmoq xatosi holati. apiPost endi ikki turdagi muvaffaqiyatsizlikni
  // ajratadi — (1) server javob berdi, lekin so'rov mantiqan rad etildi (masalan
  // "ruxsat yo'q") — bu {ok:false, reason} bo'lib qoladi, chaqiruvchi joy o'zi
  // matn ko'rsatadi; (2) so'rov umuman serverga yetib bormadi yoki javob
  // o'qib bo'lmadi (internet yo'q / server ishlamayapti) — bu holda
  // {ok:false, networkError:true, reason} qaytadi, shunda chaqiruvchi joy
  // "Qayta urinish" tugmali maxsus holatni ko'rsatishi mumkin.
  async function apiPost(url, body) {
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
    `;
    appHeaderEl.classList.remove('hidden');
    if (onRoleSwitch) {
      const btn = document.getElementById('appHeaderRoleSwitchBtn');
      if (btn) btn.addEventListener('click', onRoleSwitch);
    }
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

  function ownerItemHtml(o) {
    return `
      <div class="owner-item" data-search-key="${escapeHtml(ownerSearchKey(o))}">
        <div class="owner-avatar">${escapeHtml((((o.profile && o.profile.name) || o.username || String(o.id) || '#').trim().charAt(0) || '#').toUpperCase())}</div>
        <div class="owner-item-main">
          <div class="owner-item-top">
            <span class="owner-id">${escapeHtml(o.id)}</span>
            <span class="badge ${o.paid ? 'paid' : 'unpaid'}" data-toggle-paid="${escapeHtml(o.id)}" data-paid="${o.paid ? '1' : '0'}">
              ${o.paid ? icon('check', 'icon-xs') + " To'langan" : icon('x', 'icon-xs') + ' Qarzdor'}
            </span>
          </div>
          ${o.username ? `<div class="owner-username">@${escapeHtml(o.username)}</div>` : ''}
          ${o.profile && o.profile.name ? `<div class="owner-username">${icon('restaurant', 'icon-xs icon-muted')} ${escapeHtml(o.profile.name)}</div>` : `<div class="owner-username owner-username-empty">${icon('warning', 'icon-xs')} Profil to'ldirilmagan</div>`}
          <div class="owner-expiry">${icon('clock', 'icon-xs icon-muted')} ${escapeHtml(expiryText(o))}</div>
          ${subscriptionProgressHtml(o)}
          <div class="owner-price" data-edit-price="${escapeHtml(o.id)}">
            ${icon('card', 'icon-xs icon-muted')} ${o.price ? escapeHtml(String(o.price)) + " so'm/oy" : 'Narx kiritilmagan'} ${icon('edit', 'icon-xs icon-muted')}
          </div>
          <div class="owner-price" data-edit-credentials="${escapeHtml(o.id)}">
            ${icon('user', 'icon-xs icon-muted')} ${o.hasLogin ? `Login: ${escapeHtml(o.login)}` : 'Login/parol o\'rnatilmagan'} ${icon('edit', 'icon-xs icon-muted')}
          </div>
        </div>
        <button class="owner-remove-btn" data-remove-id="${escapeHtml(o.id)}" aria-label="O'chirish" title="O'chirish">${icon('x', 'icon-xs')}</button>
      </div>
    `;
  }

  function renderAdminPanel(owners) {
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

    const statsHtml = `
      <div class="ko-kpi-grid admin-stats-grid">
        ${koKpiCardHtml('users', 'Jami egalar', String(totalCount), null)}
        ${koKpiCardHtml('check-circle', 'Faol', String(activeCount), null)}
        ${koKpiCardHtml('clock', 'Muddati yaqin', String(expiringSoonCount), null)}
        ${koKpiCardHtml('wallet', "Qarzdor", String(unpaidCount), null)}
      </div>
    `;

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
        <div class="salom">Salom, admin</div>
        <div class="bosh admin-subtitle">Do'kon egalarini shu yerdan boshqarasiz — havola yarating, qo'lda qo'shing yoki mavjudlarini tahrirlang.</div>

        ${statsHtml}

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
      const narxMatn = priceVal ? `, obuna narxi ${priceVal} so'm/oy` : '';
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
          loadOwnersAndRender();
        } else {
          msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
          msgEl.className = 'xabar err';
        }
      };
    });

    document.getElementById('ownerList').addEventListener('click', async (e) => {
      const removeBtn = e.target.closest('[data-remove-id]');
      if (removeBtn) {
        removeBtn.disabled = true;
        await apiPost('/api/remove-owner', { initData, id: removeBtn.getAttribute('data-remove-id') });
        loadOwnersAndRender();
        return;
      }

      const toggleEl = e.target.closest('[data-toggle-paid]');
      if (toggleEl) {
        const current = toggleEl.getAttribute('data-paid') === '1';
        await apiPost('/api/update-owner-billing', { initData, id: toggleEl.getAttribute('data-toggle-paid'), paid: !current });
        loadOwnersAndRender();
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
        loadOwnersAndRender();
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
        loadOwnersAndRender();
        return;
      }

      const removeCredId = e.target.getAttribute('data-remove-credentials');
      if (removeCredId) {
        await apiPost('/api/remove-owner-credentials', { initData, id: removeCredId });
        loadOwnersAndRender();
        return;
      }
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

  // ---- Do'kon egasi: profilni to'ldirish formasi ----
  function renderProfileForm(existing) {
    if (!existing) { renderProfileOnboarding(); return; }
    const p = existing;
    let pendingBrandColor = isValidHexColor(p.brandColor) ? p.brandColor : DEFAULT_BRAND_COLOR;
    let pendingLogo = p.logoUrl || '';
    setAppHeader(existing.logoUrl, existing.name, 'Egasi');
    ekran(`
      <div class="panel">
        <div class="salom">Profilni tahrirlash</div>
        <div class="bosh">Ma'lumotlaringizni yangilang.</div>
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

        <div class="section-label">${icon('restaurant', 'icon-xs')} Menyu</div>
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

        <div class="section-label">${icon('star', 'icon-xs')} Mijozlarni rag'batlantirish</div>
        <div class="kartochka">
          <h2>Bonus tizimi</h2>
          <div class="bosh">Qaytgan mijozlarga har bir buyurtmadan avtomatik bonus ball to'planadi (1 ball = 1 so'm, keyingi buyurtmada ishlatiladi).</div>
          <label class="check-label" style="margin-top:10px; font-size:var(--fs-body);">
            <input type="checkbox" id="bonusEnabledInput">
            Bonus tizimini yoqish
          </label>
          <input type="text" id="bonusPercentInput" placeholder="Bonus foizi (masalan: 5)" inputmode="numeric" style="margin-top:8px;">
          <button class="btn" id="saveBonusBtn">Saqlash</button>
          <div class="xabar" id="bonusMsg"></div>
        </div>

        <div class="section-label">${icon('link', 'icon-xs')} Dostavka</div>
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

        <div class="section-label">${icon('link', 'icon-xs')} Oshxona</div>
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

        ${(usingOwnerSession || ownerHasTelegramLogin) ? `
        <div class="section-label">${icon('user', 'icon-xs')} Hisob</div>
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
        ` : ''}
      </div>
    `);

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
    loadBonusSettingsAndRender();
    loadDeliveryGroupStatus();
    loadKitchenGroupStatus();
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
  const ROLE_LABELS = { kassir: 'Kassir', oshpaz: 'Oshpaz', sklad: 'Sklad mas\'uli', dostavka: 'Kuryer', manager: 'Menejer' };
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
  // Bosh sahifa PASTKI navigatsiyasi — rasmdagi kabi 5 band: Bosh sahifa,
  // Savdo, Yangi buyurtma (markazda FAB), Bildirishnomalar, Profil. Eski
  // 4-tabli tab-bar o'rnini shu egallaydi.
  //
  // 20-bosqich: "Menyu" (taom qo'shish / aksiya) paneli — rasmda unga aniq
  // joy yo'q edi, shu sababli Sozlamalar ekraniga (renderProfileForm)
  // ko'chirildi: do'kon egasi uchun eng yaqin mos joy shu, chunki menyu
  // tarkibi ham do'kon sozlamasi hisoblanadi.
  // =========================================================================
  function koBottomNavHtml(activeKey, notifCount) {
    const count = notifCount || 0;
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
        <button type="button" class="ko-bottom-nav-item ${activeKey === 'bildirishnomalar' ? 'active' : ''}" data-ko-nav="bildirishnomalar">
          ${icon('bell')}
          ${count > 0 ? `<span class="ko-bottom-nav-badge">${count}</span>` : ''}
          <span>Bildirishnomalar</span>
        </button>
        <button type="button" class="ko-bottom-nav-item ${activeKey === 'profil' ? 'active' : ''}" data-ko-nav="profil">
          ${icon('user')}
          <span>Profil</span>
        </button>
      </div>
    `;
  }

  // Barcha beshtasi ulangan: Bosh sahifa (joriy ekranning o'zi), Savdo
  // (renderCashflowScreen), Bildirishnomalar va Profil (15-bosqichda
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
        if (key === 'bildirishnomalar') { renderNotificationsScreen(profile, goBack); return; }
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
    const navBtn = document.querySelector('.ko-bottom-nav-item[data-ko-nav="bildirishnomalar"]');
    if (navBtn) {
      const existing = navBtn.querySelector('.ko-bottom-nav-badge');
      if (count > 0) {
        if (existing) {
          existing.textContent = String(count);
        } else {
          const labelEl = navBtn.querySelector('span:last-child');
          const badgeHtml = `<span class="ko-bottom-nav-badge">${count}</span>`;
          if (labelEl) labelEl.insertAdjacentHTML('beforebegin', badgeHtml);
          else navBtn.insertAdjacentHTML('beforeend', badgeHtml);
        }
      } else if (existing) {
        existing.remove();
      }
    }
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
    { key: 'hisobotlar', icon: 'clipboard', label: 'Hisobotlar' },
    { key: 'aiTavsiyalar', icon: 'ai', label: 'AI Tavsiyalar' },
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
      hisobotlar: () => renderZReportScreen(profile, goBack),
      aiTavsiyalar: () => renderAiScreen(profile, goBack),
      bildirishnomalar: () => renderNotificationsScreen(profile, goBack),
      profil: () => renderOwnerProfileScreen(profile, goBack),
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
    { key: 'hisobotlar', icon: 'clipboard', label: 'Hisobotlar' },
    { key: 'aiTavsiyalar', icon: 'ai', label: 'AI Tavsiyalar' },
    { key: 'bildirishnomalar', icon: 'bell', label: 'Bildirishnomalar' },
    { key: 'profil', icon: 'user', label: 'Profil' },
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
      </div>
    `);
    document.getElementById('profileBackBtn').addEventListener('click', () => onBack && onBack());
    document.getElementById('editProfileBtn').addEventListener('click', () => renderProfileForm(profile));
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
      ${koBottomNavHtml('bosh', 0)}
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
          ${p.minTotal ? `<div class="owner-username">Min: ${escapeHtml(String(p.minTotal))} so'm</div>` : ''}
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
          <div class="m-price">${escapeHtml(String(m.price))} so'm${m.directStockId ? ` · to'g'ridan sklad ${icon('check', 'icon-xs icon-success')}` : (m.recipe && m.recipe.length ? ` · retsept ${icon('check', 'icon-xs icon-success')}` : '')}</div>
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
    if (role === 'manager') {
      renderManagerHomeScreen({ name: restaurantName });
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
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">${escapeHtml(restaurantName || 'Kassir')}</div>
        ${onBack ? `<button class="btn ikkinchi" id="cashierBackBtn" style="margin-bottom:12px;">← Orqaga</button>` : ''}
        ${cashierTabRowHtml()}
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
          <div class="cart-total"><span>Jami:</span><span id="cartTotalVal">${cashierCartTotal()} so'm</span></div>
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

    loadCashierMenu(restaurantName);
  }

  // ---- Kassir: "Buyurtmalar holati" tabi — real-vaqtda ro'yxat, faqat "Tayyor" tugmasi bilan ----
  function renderCashierOrdersTab(restaurantName, onBack) {
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">${escapeHtml(restaurantName || 'Kassir')}</div>
        ${onBack ? `<button class="btn ikkinchi" id="cashierBackBtn" style="margin-bottom:12px;">← Orqaga</button>` : ''}
        ${cashierTabRowHtml()}
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
    return `
      <div class="menu-item">
        <div class="menu-item-info">
          ${thumbHtml}
          <div>
            <div class="m-name">${escapeHtml(m.name)}</div>
            <div class="m-price">${escapeHtml(String(m.price))} so'm</div>
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
    if (el) el.textContent = cashierCartTotal() + " so'm";
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
      topMsg.innerHTML = `${icon('check-circle', 'icon-xs icon-success')} Buyurtma yuborildi (${res.total} so'm)`;
      document.querySelector('.panel').prepend(topMsg);
    } else {
      if (sendBtn) sendBtn.disabled = false; // xato bo'lsa — qayta urinib ko'rish uchun tugma yoqiladi
      msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
      msgEl.className = 'xabar err';
    }
  }


  // ---- Oshpaz va kassir uchun umumiy: buyurtmalar taxtasi (real-vaqtda) ----
  const ORDER_STATUS_LABELS = { yangi: 'Yangi', tayyorlanmoqda: 'Tayyorlanmoqda', tayyor: 'Tayyor' };
  let ordersPollTimer = null;
  let lastOrdersSnapshot = null;

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
        <div class="order-items">${itemsHtml}</div>
        ${deliveredNote}
        <div class="order-bottom">
          <span class="order-total">${order.total} so'm</span>
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
    ekran(`
      <div class="panel">
        <div class="salom" style="font-size:20px;">Kelgan buyurtmalar</div>
        ${onBack ? `<button class="btn ikkinchi" id="kitchenBackBtn" style="margin-bottom:12px;">← Orqaga</button>` : ''}
        <div class="bosh">Pastdagi tugmalar bilan holatini o'zgartiring.</div>
        <div id="ordersBoard" class="orders-board-large" style="margin-top:14px;"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);
    if (onBack) document.getElementById('kitchenBackBtn').addEventListener('click', () => { stopOrdersPolling(); onBack(); });
    startOrdersPolling('oshpaz');
  }

  // ---- Kuryer: yetkazib berish uchun tayyor bo'lgan dostavka buyurtmalari, real-vaqtda ----
  function deliveryCardHtml(order) {
    const itemsHtml = order.items.map(it => `${escapeHtml(it.name)} x${it.qty}`).join('<br>');
    // 20-bosqich: yetkazib bo'lingan buyurtmaning holati (status) hali ham
    // "tayyor" bo'lib qoladi (faqat deliveredBy/deliveredAt qo'yiladi) —
    // shuning uchun bu yerda ko'rinadigan yorliq shu belgiga qarab
    // "Tayyor" o'rniga "Yetkazildi" deb yoziladi, tugma esa endi bosilmaydigan
    // holatga o'tadi (qayta bosilib xato chiqarmasligi uchun).
    const isDelivered = !!order.deliveredBy;
    return `
      <div class="order-card">
        <div class="order-top">
          <div>
            <div class="order-type">Dostavka</div>
            <div class="order-time">${timeAgo(order.createdAt)}</div>
          </div>
          <span class="status-badge tayyor">${isDelivered ? 'Yetkazildi' : ORDER_STATUS_LABELS.tayyor}</span>
        </div>
        <div class="order-items">${itemsHtml}</div>
        <div class="order-bottom">
          <span class="order-total">${order.total} so'm (${PAYMENT_TYPE_LABELS[order.paymentType] || order.paymentType})</span>
          ${isDelivered
            ? `<span class="order-time">✅ Yetkazib berildi (${timeAgo(order.deliveredAt)})</span>`
            : `<button class="order-action-btn ready" data-deliver-order-id="${escapeHtml(order.id)}">Yetkazildi</button>`}
        </div>
      </div>
    `;
  }

  function deliveryBoardHtml(orders) {
    // 20-bosqich: bu taxta FAQAT dostavka turidagi va "tayyor" holatidagi
    // buyurtmalarni ko'rsatishi kerak — avval bu yerda hech qanday filtr
    // yo'q edi, shuning uchun stol/olib ketish buyurtmalari ham xato
    // ravishda "Dostavka"/"Tayyor" deb chiqib, tugmasi doim yoniq ko'rinardi.
    const relevant = (orders || []).filter(o => o.orderType === 'dostavka' && o.status === 'tayyor');
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
        <div class="bosh">Tayyor bo'lgan dostavka buyurtmalari — yetkazib bergach "Yetkazildi" tugmasini bosing.</div>
        <div id="ordersBoard" class="orders-board-large" style="margin-top:14px;"><div class="bosh">Yuklanmoqda...</div></div>
      </div>
    `);
    if (onBack) document.getElementById('deliveryBackBtn').addEventListener('click', () => { stopOrdersPolling(); onBack(); });
    startDeliveryPolling();
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
        ${role === 'egasi' ? `
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
        ` : ''}
      </div>
    `);

    if (onBack) document.getElementById('stockBackBtn').addEventListener('click', onBack);

    if (role === 'egasi') {
      document.getElementById('stockBranchSelect').addEventListener('change', (e) => {
        currentStockBranchId = e.target.value || null;
        loadStockAndRender();
        loadMovementsAndRender();
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
        msgEl.textContent = res.reason || 'Xatolik yuz berdi.';
        msgEl.className = 'xabar err';
      }
    });

    document.getElementById('openAuditBtn').addEventListener('click', () => openAuditForm());

    if (role === 'egasi') {
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
    return Number(n || 0).toLocaleString('ru-RU') + " so'm";
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
    return forecast.slice(0, 10).map(f => `
      <div class="menu-item">
        <div style="flex:1;">
          <div class="m-name">${escapeHtml(f.name)}${f.shortage ? ' ' + icon('warning', 'icon-xs icon-warning') : ''}</div>
          <div class="m-price">Bor: ${f.currentQty} ${escapeHtml(f.unit)} · Kunlik o'rtacha sarf: ${f.avgDailyUsage} ${escapeHtml(f.unit)} · Ertangi ehtiyoj: ${f.predictedNeed} ${escapeHtml(f.unit)}</div>
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

    aiRenderChat();
    loadAiData();
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
      topEl.innerHTML = `<div class="xabar err">${escapeHtml(res.reason || 'Xatolik yuz berdi.')}</div>`;
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
    audit_topshirdi: 'Audit topshirdi'
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
        <div class="kartochka">
          <h2>Menejer ko'rishi</h2>
          <div class="bosh">Yoqilsa, menejer ham kuryerlar puli va hisobotini ko'ra oladi (kassaga qaytarishni ham u boshqara oladi).</div>
          <label class="rol-checkbox" style="margin-top:8px; display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="crManagerVisibilityToggle">
            <span>Menejerga ko'rinsin</span>
          </label>
          <div class="xabar" id="crManagerVisibilityMsg"></div>
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

      document.getElementById('crManagerVisibilityToggle').addEventListener('change', async (e) => {
        const msgEl = document.getElementById('crManagerVisibilityMsg');
        const visible = e.target.checked;
        e.target.disabled = true;
        msgEl.textContent = 'Saqlanmoqda...';
        msgEl.className = 'xabar';
        const res = await apiPost('/api/set-manager-courier-visibility', { initData, visible });
        e.target.disabled = false;
        if (res.ok) {
          msgEl.textContent = visible ? 'Menejerga ko\'rinadi.' : 'Menejerdan yashirildi.';
          msgEl.className = 'xabar ok';
        } else {
          e.target.checked = !visible;
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
    const managerToggle = document.getElementById('crManagerVisibilityToggle');
    if (managerToggle && document.activeElement !== managerToggle) {
      managerToggle.checked = !!res.managerCourierMoneyVisible;
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

  // ---- Menejer: kuryerlar hisoboti (egasi ruxsat bergan bo'lsa ko'rinadi) ----
  function renderManagerHomeScreen(profile) {
    renderCourierReportScreen(profile, null, false);
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
    renderAdminPanel(res.ok ? res.owners : []);
  }

  // ==================== J. Mijozlar uchun menyu (38-40-bosqich) ====================
  // Mijoz "Mijozlar havolasi" orqali kirganda bot ?customer=<ownerId> bilan Mini App'ni ochadi
  let customerState = {
    ownerId: null,
    restaurant: null,
    menu: [],
    categories: [],
    promotions: [],
    favorites: [],
    bonusPoints: 0,
    bonusEnabled: false,
    cart: {},
    orderType: 'stol',
    paymentType: 'naqd',
    tableNumber: '',
    location: null,
    addressNote: '',
    tab: 'menyu',
    category: 'hammasi',
    promoId: '',
    usePoints: false,
    lastOrderRequestId: null
  };

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
      </div>
    `;
  }

  // 30-bosqich: mijoz uchun ham xuddi shu umumiy komponent (K-bo'lim,
  // yuqorida) ishlatiladi — alohida customerMenuGroups/customerSectionId
  // endi kerak emas.
  function customerCategoriesHtml() {
    return sectionedMenuTabsHtml(customerState.menu, {
      tabRowId: 'customerCatRow', sectionIdPrefix: 'menu-section-cust', listElId: 'customerMenuList', categories: customerState.categories
    });
  }

  function customerItemCardHtml(m) {
    const qty = customerState.cart[m.id] || 0;
    const isFav = customerState.favorites.includes(m.id);
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
            <div class="m-price">${escapeHtml(String(m.price))} so'm</div>
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
    return renderSectionedMenu(customerState.menu, {
      sectionIdPrefix: 'menu-section-cust',
      itemsWrapperClass: 'catalog-grid',
      renderItem: customerItemCardHtml,
      emptyText: "Menyu hali bo'sh.",
      categories: customerState.categories
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
          <span class="cart-fab-total" id="cCartFabTotal">${customerCartTotal()} so'm</span>
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
    if (totalEl) totalEl.textContent = customerCartTotal() + " so'm";
    // Agar checkout oynasi hozir ochiq bo'lsa, undagi summani ham yangilaymiz.
    const modalTotalEl = document.getElementById('cCartTotalVal');
    if (modalTotalEl) modalTotalEl.textContent = customerCartTotal() + " so'm";
  }

  function renderCustomerMenuTab() {
    ekran(`
      <div class="panel ${customerCartQty() ? 'has-cart-fab' : ''}">
        ${customerHeaderHtml()}
        ${customerTabRowHtml()}
        ${customerPromoBannerHtml()}
        ${customerCategoriesHtml()}
        <div id="customerMenuList" style="margin-top:8px;">${customerMenuListHtml()}</div>
      </div>
      ${cartFabBarHtml()}
    `);

    attachCustomerCatalogHandlers();
    attachCustomerTabHandlers();
    attachCartFabHandler();
    attachSectionedMenuTabHandlers('customerCatRow');
    attachSectionedMenuScrollSpy('customerCatRow', 'customerMenuList');

    document.querySelectorAll('[data-promo-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-promo-id');
        customerState.promoId = customerState.promoId === id ? '' : id;
        renderCustomerMenuTab();
      });
    });
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
        <button type="button" class="btn ikkinchi" id="cLocationBtn" style="width:100%; margin-bottom:6px;">
          ${customerState.location ? icon('check-circle', 'icon-xs icon-success') + ' Joylashuv aniqlandi (qayta aniqlash)' : icon('pin', 'icon-xs') + ' Joylashuvni aniqlash'}
        </button>
        <div id="cLocationStatus" class="xabar" style="margin-bottom:6px;"></div>
        <textarea id="cAddressNoteInput" placeholder="Manzilni tushuntiring (mo'ljal, qavat, kod va h.k.) - kuryer oson topishi uchun" rows="2">${escapeHtml(customerState.addressNote)}</textarea>
      </div>
      <div class="type-row" id="cPaymentTypeRow">
        ${visiblePaymentTypeEntries(customerState.orderType).map(([k, label]) => `
          <div class="type-opt ${customerState.paymentType === k ? 'selected' : ''}" data-cpayment-type="${k}">${label}</div>
        `).join('')}
      </div>
      ${customerState.bonusEnabled && customerState.bonusPoints > 0 ? `
        <label style="display:flex; align-items:center; gap:8px; font-size:var(--fs-body); margin-bottom:10px;">
          <input type="checkbox" id="cUsePoints" ${customerState.usePoints ? 'checked' : ''}>
          Bonus ballaridan foydalanish (${customerState.bonusPoints} ball mavjud)
        </label>
      ` : ''}
      <div class="cart-total"><span>Jami:</span><span id="cCartTotalVal">${customerCartTotal()} so'm</span></div>
      <div class="xabar" id="cOrderMsg"></div>
      <div class="btn-row">
        <button type="button" class="btn ikkinchi" id="cCloseCheckoutBtn">Bekor qilish</button>
        <button type="button" class="btn" id="cSendOrderBtn">Buyurtma berish</button>
      </div>
    `;
  }

  function openCustomerCheckoutModal() {
    if (!customerCartQty()) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:380px; max-height:85vh; overflow:auto;"></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    renderCheckoutModalBody(overlay);
  }

  function renderCheckoutModalBody(overlay) {
    const modalEl = overlay.querySelector('.modal');
    modalEl.innerHTML = customerCheckoutModalBodyHtml();
    wireCheckoutModal(overlay);
  }

  function wireCheckoutModal(overlay) {
    const modalEl = overlay.querySelector('.modal');

    modalEl.querySelector('#cCloseCheckoutBtn').addEventListener('click', () => overlay.remove());

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
        locationStatusEl.textContent = 'Kechirasiz, bu qurilma/brauzer joylashuvni aniqlay olmaydi. Manzilni yozib qoldiring.';
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
        () => {
          locationStatusEl.innerHTML = `${icon('x-circle', 'icon-xs icon-danger')} Joylashuvni aniqlab bo'lmadi (ruxsat berilmagan bo'lishi mumkin). Iltimos, manzilni yozib qoldiring.`;
          locationStatusEl.className = 'xabar err';
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
    const addressNoteInput = modalEl.querySelector('#cAddressNoteInput');
    if (addressNoteInput) addressNoteInput.addEventListener('input', (e) => { customerState.addressNote = e.target.value; });

    const pointsCheckbox = modalEl.querySelector('#cUsePoints');
    if (pointsCheckbox) pointsCheckbox.addEventListener('change', (e) => { customerState.usePoints = e.target.checked; });

    modalEl.querySelector('#cSendOrderBtn').addEventListener('click', () => sendCustomerOrder(overlay));
  }


  function attachCustomerTabHandlers() {
    const tabRow = document.querySelector('.tab-row');
    if (!tabRow) return;
    tabRow.addEventListener('click', (e) => {
      const t = e.target.getAttribute('data-customer-tab');
      if (!t || t === customerState.tab) return;
      customerState.tab = t;
      disconnectSectionedMenuObserver('customerCatRow');
      if (t === 'sevimli') renderCustomerFavoritesTab();
      else if (t === 'tarix') renderCustomerHistoryTab();
      else renderCustomerMenuTab();
    });
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

  function customerOrderHistoryCardHtml(o) {
    const itemsText = o.items.map(it => `${escapeHtml(it.name)} x${it.qty}`).join(', ');
    return `
      <div class="order-card">
        <div class="order-top">
          <div>
            <div class="order-type">${ORDER_TYPE_LABELS[o.orderType] || o.orderType}${o.tableNumber ? ' — stol ' + escapeHtml(o.tableNumber) : ''}</div>
            <div class="order-time">${timeAgo(o.createdAt)}</div>
          </div>
          <span class="status-badge ${o.status}">${ORDER_STATUS_LABELS[o.status] || o.status}</span>
        </div>
        <div class="order-items">${itemsText}</div>
        <div class="order-bottom">
          <div class="order-total">${o.total} so'm${o.discountAmount ? ` <span style="opacity:0.6; font-weight:400;">(-${o.discountAmount})</span>` : ''}</div>
          ${o.pointsEarned ? `<span style="font-size:12px; color:#2fa84f;">+${o.pointsEarned} ball</span>` : ''}
        </div>
      </div>
    `;
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
    const res = await apiPost('/api/customer-orders-history', { initData, ownerId: customerState.ownerId });
    const listEl = document.getElementById('customerHistoryList');
    if (!listEl) return;
    const orders = res.ok ? res.orders : [];
    listEl.innerHTML = orders.length ? orders.map(customerOrderHistoryCardHtml).join('') : `<div class="bosh">Hali buyurtmalar yo'q.</div>`;
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
      requestId: customerState.lastOrderRequestId
    });

    if (res.ok) {
      customerState.cart = {};
      customerState.usePoints = false;
      customerState.bonusPoints = res.bonusBalance;
      customerState.location = null;
      customerState.addressNote = '';
      customerState.lastOrderRequestId = null; // keyingi buyurtma uchun yangi requestId kerak bo'ladi
      if (overlay) overlay.remove();
      if (customerState.tab === 'sevimli') renderCustomerFavoritesTab();
      else renderCustomerMenuTab();
      const topMsg = document.createElement('div');
      topMsg.className = 'xabar ok';
      if (res.paymentPending) {
        if (res.paymentConfirmMethod === 'naqd_kassa') {
          topMsg.innerHTML = `${icon('restaurant', 'icon-xs icon-success')} Buyurtma qabul qilindi (${res.total} so'm).<br>` +
            `Iltimos, kassaga borib to'lovni amalga oshiring - to'lov qabul qilingach, taomingiz tayyorlanishni boshlaydi.`;
        } else {
          // 24-bosqich: ilgari shu joyda faqat kichik, page tepasida
          // ko'rinadigan xabar (topMsg) bo'lgan — ayniqsa Dostavka+Karta
          // holatida (boshqa joylashuv/manzil xabarlari orasida) mijoz
          // buni ko'rmay qolib, skrinshot yubormasdan qolib ketishi mumkin
          // edi. 25/26-bosqich: endi bu ALOHIDA, undov belgili, qizil
          // ramkali modal sifatida ochiladi — mijoz uni yopmaguncha davom
          // eta olmaydi.
          topMsg.innerHTML = `${icon('card', 'icon-xs icon-success')} Buyurtma qabul qilindi (${res.total} so'm) — <b>tasdiqlash kutilmoqda</b>.`;
          showPaymentProofModal();
        }
      } else {
        topMsg.innerHTML = `${icon('check-circle', 'icon-xs icon-success')} Buyurtma qabul qilindi (${res.total} so'm)${res.pointsEarned ? ` · +${res.pointsEarned} bonus ball` : ''}`;
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
        <h3>${icon('warning', 'icon-sm modal-warn-icon')} Diqqat! To'lovni tasdiqlash kerak</h3>
        <p>Buyurtmangiz hali <b>tasdiqlanmagan</b>. Iltimos, to'lov chekining (skrinshotning) RASMINI shu botning shaxsiy chatiga yuboring — kassir yoki oshxona egasi tekshirib tasdiqlagach, buyurtmangiz oshxonaga yuboriladi.</p>
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
    customerState.bonusPoints = verifyRes.customer.bonusPoints || 0;
    customerState.bonusEnabled = !!verifyRes.bonusEnabled;

    const menuRes = await apiPost('/api/customer-menu-list', { initData, ownerId });
    customerState.menu = menuRes.ok ? menuRes.menu : [];
    customerState.categories = menuRes.ok ? (menuRes.categories || []) : [];
    customerState.promotions = menuRes.ok ? menuRes.promotions : [];

    renderCustomerMenuTab();
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
