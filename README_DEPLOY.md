# نظام إدارة عقود ديوان الخدمة المدنية — Railway + PostgreSQL

هذه الحزمة تنشر النظام كالتالي:

```text
المتصفح
  ↓
Railway Node.js API
  ↓
Railway PostgreSQL
```

بهذا الشكل كل المستخدمين يشاهدون نفس البيانات، وأي تعديل يتم حفظه في قاعدة PostgreSQL المشتركة.

---

## الملفات المهمة

```text
public/index.html      واجهة النظام
server.js              API للحفظ والتحميل
package.json           إعداد Node.js
railway.toml           إعداد Railway
db/schema.sql          إنشاء الجداول للمرجعية
.env.example           مثال للمتغيرات فقط
```

---

## خطوات النشر على GitHub + Railway

### 1) ارفع الملفات إلى GitHub

أنشئ Repository جديد، ثم ارفع محتويات هذه الحزمة كاملة.

يجب أن يكون الملف الرئيسي داخل:

```text
public/index.html
```

### 2) اربط GitHub مع Railway

من Railway:
- New Project
- Deploy from GitHub Repo
- اختر Repository الخاص بالنظام

### 3) اربط PostgreSQL

داخل Railway، بما أن PostgreSQL موجود عندك Online:
- افتح Service الخاص بالتطبيق Node.js
- ادخل إلى Variables
- أضف أو اربط متغير:

```text
DATABASE_URL
```

لا تضع قيمة DATABASE_URL داخل GitHub.

### 4) شغل النشر

Railway سيقرأ:

```text
package.json
```

ويشغل:

```text
npm start
```

### 5) اختبار النظام

افتح رابط Railway للتطبيق، ثم جرّب:

```text
/api/health
```

لو ظهر:

```json
{"ok":true,"db":"online"}
```

فالربط صحيح.

ثم افتح رابط النظام الرئيسي وجرب:
- اختيار عقد
- فتح صلاحية التعديل
- تعديل دفعة
- حفظ التعديل
- افتح الرابط من جهاز آخر وتأكد أن التعديل ظاهر

---

## النسخ الاحتياطي

من المتصفح افتح:

```text
/api/export
```

سيتم تنزيل نسخة JSON من بيانات النظام.

---

## استرجاع نسخة احتياطية

يمكن استخدام:

```text
POST /api/import
```

بجسم JSON مطابق للنسخة المصدرة.

---

## ملاحظات أمنية مهمة

- لا ترفع DATABASE_URL إلى GitHub.
- الأفضل أن يكون Repository خاصًا Private.
- إذا كانت البيانات تحتوي أرقامًا مدنية أو بيانات حساسة، يجب ضبط صلاحيات الدخول من Railway أو إضافة تسجيل دخول للنظام لاحقًا.
- هذه الحزمة تحفظ النظام كاملًا كـ JSON داخل PostgreSQL، وهي مناسبة كبداية سريعة للنشر المشترك الحقيقي.
