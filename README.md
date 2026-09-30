# صلّحها

دفتر صيانة الأجهزة للمحلات الصغيرة — يعمل على Windows وAndroid ودون إنترنت.

- `www/` واجهة التطبيق (PWA).
- `electron/` غلاف ويندوز. `npm install && npm start` للتشغيل، `npm run dist:win` لبناء ملف التثبيت.
- أندرويد عبر Capacitor: `npm run icons && npx cap add android && npx cap sync android` ثم افتح مجلد `android` في Android Studio.

GitHub Actions (`.github/workflows/build.yml`) يبني `.exe` و`.apk` تلقائياً عند كل push على `main` — تجدهما في Artifacts لصفحة التشغيل.

البيانات محفوظة محلياً على الجهاز. النسخة التالية تحتاج مزامنة مشفرة ونسخاً احتياطياً قبل الاستخدام التجاري على أكثر من جهاز.
