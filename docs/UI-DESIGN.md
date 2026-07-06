# SecuriPDF — Kullanıcı Arayüzü Tasarımı

## Tasarım trendi

**Kurumsal intranet / belge platformu** — Stirling görünümünden bilinçli ayrışma.

| İlke | Uygulama |
|------|----------|
| Sade ve güven veren | Açık arka plan, net tipografi, bol beyaz alan |
| Kurumsal mavi | Birincil `#1d4ed8`, vurgu `#0f766e` |
| Sol navigasyon | Belgeler, Arşiv, Araçlar, Favoriler, Profil |
| Çift logo | Sol: SecuriPDF · Sağ: müşteri logosu (admin yükler) |
| Kart tabanlı içerik | Araçlar ve belgeler grid/liste |
| Eylem çubuğu | Seçili belge için: Önizle · İndir · E-posta · Düzenle · Arşivle · Paylaş |

Stirling-PDF kullanıcıya **gösterilmez**; yalnızca `/api/pdf` proxy üzerinden motor olarak çalışır.

## Gereksinim eşlemesi (17 madde)

| # | Gereksinim | UI (Faz 7) | Backend |
|---|------------|------------|---------|
| 1 | Giriş yapan kullanıcı bilgisi | Header kullanıcı menüsü | `GET /api/app/v1/me` |
| 2 | Logout | Menü → Çıkış | `/oauth2/sign_out` |
| 3 | Profil sayfası | `/profil` | `GET/PUT /api/app/v1/profile` |
| 4 | Klasör ağacı | Belgeler sol panel | `GET/POST /api/vault/v1/folders` |
| 5 | Belge işlemleri | Seçim toolbar | Vault API + PDF proxy (kademeli) |
| 6 | Favori araçlar | Yıldız + Favoriler sayfası | Profil `favoriteTools` |
| 7 | Kategorize araçlar | Araçlar sayfası gruplu | `ui-tools.yml` `category` |
| 8 | Belgeler / Arşiv ayrı | İki nav + ayrı path | `vault.storage.archive_path` (admin) |
| 9 | Logo admin | Admin → Branding | `platform_logo` + upload |
| 10 | SMTP admin | Admin → mevcut | Mevcut |
| 11 | AD admin | Admin → LDAP | Mevcut |
| 12 | Müşteri logosu | Header + Keycloak tema | `customer_logo` base64 |
| 13 | Kullanım istatistikleri | Admin + Profil özet | `GET /api/app/v1/stats/usage`, admin dashboard job özeti |
| 14 | HTML mail şablonları | Admin → mevcut | Mevcut |
| 15 | İş kuyruğu | İşlerim + progress bar | Merkezi DB kuyruk + worker (`/api/app/v1/jobs`) |
| 16 | Denetim kayıtları | Admin → Audit | Mevcut + iş tipi filtresi **Faz 8** |
| 17 | Araç politikası | Admin → Araçlar | `tools.yml` + lisans |

## Sayfa haritası

```
/  (hash router)
├── #/belgeler      — aktif çalışma alanı + klasör ağacı
├── #/arsiv         — arşivlenmiş belgeler (ayrı depo)
├── #/araclar       — kategorize araç kataloğu
├── #/favoriler     — kullanıcı favori araçları
├── #/isler         — iş kuyruğu (aktif iş + geçmiş tablo)
├── #/profil        — profil + kota + tercihler
└── #/arac/:id      — tek araç formu (araçlar eklendikçe)
```

## Bileşenler

- **AppHeader** — logolar, kullanıcı dropdown
- **AppSidebar** — ana navigasyon
- **FolderTree** — genişletilebilir klasör listesi
- **DocumentList** — tablo + çoklu seçim
- **DocumentActions** — önizle / indir / mail / …
- **ToolGrid** — kategori başlıklı kartlar
- **ProfileForm** — görünen ad, dil, favoriler

## Sonraki fazlar

1. ~~**Faz 7b** — Araç formlarını tek tek bağlama (`ui-tools.yml`)~~ **Tamamlandı**
2. ~~**Faz 8** — İş kuyruğu istatistikleri, gelişmiş audit filtreleri, profil kullanım özeti~~ **Tamamlandı**
3. **Faz 9** — Keycloak login temasında müşteri logosu otomatik senkron

## Faz 7b — Araç form UX (Tier 2)

**Durum: tamamlandı**

Tüm 69 araç `ui-tools.yml` üzerinden bağlı. Legacy özel formlar (birleştir, böl, OCR, filigran vb.) **işlem adımları**, **bağlamsal ipuçları (tooltip)** ve gerektiğinde **PDF önizleme** ile güncellendi.

### Paylaşılan modüller

| Modül | Dosya | API |
|-------|-------|-----|
| İpuçları | `ui-tooltips.js` | `SecuriTips.attach`, `wrapLabel`, `processSteps` |
| PDF önizleme | `pdf-preview-nav.js` | `SecuriPdfPreview.mount(container, form, opts)` |

### Tooltip ve işlem adımı UX

- **İşlem adımları** (`ui-process-steps`): Form üstünde `1 → 2 → 3` şeridi; kullanıcıya akışı gösterir (ör. birleştir, böl, OCR, parola ekle).
- **Tooltip** (`ui-tip`): `?` simgesi; hover/focus ile Türkçe açıklama. Etiketlere `wrapLabel`, düğmelere `attach` ile eklenir.
- **PDF önizleme** (`ui-pdf-preview-wrap`): Seçilen PDF blob URL ile iframe'de gösterilir (`#page=N&zoom=page-width`); sayfa gezinme ve temizleme fonksiyonu döner.
- **Önbellek**: Statik dosya sürümleri `index.html` içinde `?v=` ile artırılır; deploy sonrası hard refresh gerekebilir.

### Tier 2 kapsamı

Özel formlu araçların tamamı Tier 2'ye yükseltildi: process steps + tooltip + (uygun olanlarda) PDF preview. Sayfa seçimi / kırpma / numaralandırma araçları önceki sprintte tamamlanmıştı.
