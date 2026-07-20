--- /tmp/orig_server.js	2026-07-20 20:01:35.108060285 +0000
+++ fastfoodbot-main/server.js	2026-07-20 20:00:52.252060023 +0000
@@ -117,6 +117,15 @@
   dostavka: 'Dostavkachi'
 };
 
+// ====== Filiallar (G. Filiallar tizimi) — har bir egasi bir nechta filial ocha oladi ======
+function findBranch(owner, branchId) {
+  return (owner.branches || []).find(b => String(b.id) === String(branchId));
+}
+
+function generateBranchId() {
+  return crypto.randomBytes(6).toString('hex');
+}
+
 // ====== Xarajat kategoriyalari (F. Moliya bo'limi uchun) ======
 const EXPENSE_CATEGORIES = {
   ijara: 'Ijara',
@@ -681,6 +690,112 @@
       saveOwners(owners);
 
       return sendJSON(res, 200, { ok: true });
+    });
+    return;
+  }
+
+  // ---- API: egasining filiallar ro'yxatini olish (egasi va uning xodimlari ko'ra oladi) ----
+  if (req.method === 'POST' && req.url === '/api/branch-list') {
+    readBody(req, (err, payload) => {
+      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
+      const check = verifyTelegramInitData(payload.initData, BOT_TOKEN);
+      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
+
+      const userId = String(check.user && check.user.id);
+      const owners = pruneExpiredOwners();
+      const ctx = resolveOwnerContext(owners, userId);
+      if (!ctx) return sendJSON(res, 200, { ok: false, reason: 'Ruxsatingiz yo\'q' });
+
+      return sendJSON(res, 200, { ok: true, branches: ctx.owner.branches || [] });
+    });
+    return;
+  }
+
+  // ---- API: yangi filial qo'shish (faqat egasi) ----
+  if (req.method === 'POST' && req.url === '/api/branch-add') {
+    readBody(req, (err, payload) => {
+      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
+      const { initData, name, address, phone } = payload;
+      const check = verifyTelegramInitData(initData, BOT_TOKEN);
+      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
+
+      const userId = String(check.user && check.user.id);
+      const owners = loadOwners();
+      const owner = findOwner(owners, userId);
+      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi filial qo\'sha oladi' });
+
+      const trimmedName = String(name || '').trim();
+      const trimmedAddress = String(address || '').trim();
+      if (!trimmedName || !trimmedAddress) {
+        return sendJSON(res, 200, { ok: false, reason: 'Filial nomi va manzilini kiriting.' });
+      }
+
+      if (!owner.branches) owner.branches = [];
+      const newBranch = {
+        id: generateBranchId(),
+        name: trimmedName,
+        address: trimmedAddress,
+        phone: phone ? String(phone).trim() : null,
+        createdAt: new Date().toISOString()
+      };
+      owner.branches.push(newBranch);
+      saveOwners(owners);
+
+      return sendJSON(res, 200, { ok: true, branch: newBranch });
+    });
+    return;
+  }
+
+  // ---- API: filial ma'lumotlarini tahrirlash (faqat egasi) ----
+  if (req.method === 'POST' && req.url === '/api/branch-rename') {
+    readBody(req, (err, payload) => {
+      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
+      const { initData, id, name, address, phone } = payload;
+      const check = verifyTelegramInitData(initData, BOT_TOKEN);
+      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
+
+      const userId = String(check.user && check.user.id);
+      const owners = loadOwners();
+      const owner = findOwner(owners, userId);
+      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'zgartira oladi' });
+      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });
+
+      const branch = findBranch(owner, id);
+      if (!branch) return sendJSON(res, 200, { ok: false, reason: 'Bunday filial topilmadi' });
+
+      const trimmedName = String(name || '').trim();
+      const trimmedAddress = String(address || '').trim();
+      if (!trimmedName || !trimmedAddress) {
+        return sendJSON(res, 200, { ok: false, reason: 'Filial nomi va manzilini kiriting.' });
+      }
+      branch.name = trimmedName;
+      branch.address = trimmedAddress;
+      branch.phone = phone ? String(phone).trim() : null;
+      saveOwners(owners);
+
+      return sendJSON(res, 200, { ok: true, branch });
+    });
+    return;
+  }
+
+  // ---- API: filialni o'chirish (faqat egasi) ----
+  if (req.method === 'POST' && req.url === '/api/branch-remove') {
+    readBody(req, (err, payload) => {
+      if (err) return sendJSON(res, 400, { ok: false, reason: 'noto\'g\'ri so\'rov' });
+      const { initData, id } = payload;
+      const check = verifyTelegramInitData(initData, BOT_TOKEN);
+      if (!check.ok) return sendJSON(res, 200, { ok: false, reason: check.reason });
+
+      const userId = String(check.user && check.user.id);
+      const owners = loadOwners();
+      const owner = findOwner(owners, userId);
+      if (!isOwnerAccessValid(owner)) return sendJSON(res, 200, { ok: false, reason: 'Faqat oshxona egasi o\'chira oladi' });
+      if (!id) return sendJSON(res, 200, { ok: false, reason: 'ID ko\'rsatilmagan' });
+
+      owner.branches = (owner.branches || []).filter(b => String(b.id) !== String(id));
+      saveOwners(owners);
+
+      return sendJSON(res, 200, { ok: true });
     });
     return;
   }
