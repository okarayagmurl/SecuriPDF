# SecuriPDF — Test Runbook (sabah QA)

Deploy sonrası temiz test akışı. Sırayla ilerleyin; smoke geçmeden full checklist'e geçmeyin.

**Ön koşullar**

- Tarayıcıda hard refresh: `Ctrl+Shift+R`
- Sunucuda: `cd ~/SecuriPDF && git pull && sudo bash scripts/patch-logout-deploy.sh`
- Test kullanıcısı: `pdf-user` rolü, en az 2 örnek PDF (küçük + çok sayfalı)

---

## 1. Smoke (≈15 dk)

Ortam ve kritik yollar:

| # | Kontrol | Beklenen |
|---|---------|----------|
| 1 | Giriş / çıkış | AD veya yerel kullanıcı ile giriş; menüden çıkış |
| 2 | `GET /health` veya ana sayfa | 200, SecuriPDF arayüzü |
| 3 | Belgeler — yükle / listele | PDF listede görünür |
| 4 | Belgeler — önizle / indir | PDF açılır veya indirilir |
| 5 | Belgeler — e-posta | Kuyruk → tamamlanır (SMTP yapılandırılmışsa) |
| 6 | `#/isler` | İş tablosu yüklenir, aktif iş paneli |
| 7 | `#/profil` | Kota + kullanım özeti (toplam/başarılı/başarısız/7 gün) |
| 8 | Admin `/admin` (pdf-admin) | Genel bakış: son 24s iş, başarısız sayıları |
| 8b | Admin Denetim | Kullanıcı sütununda görünen ad / e-posta |
| 8c | Bilerek hatalı iş (ör. boş dosya) | `#/isler` → Kayıt No + **Raporu kopyala** |
| 9 | Tek araç: merge-pdfs | Kuyruk → indirme |
| 10 | JSON rapor: get-info-on-pdf | Panelde JSON önizleme + indirme |

**Belgeler eylemleri (API kapsamı)**

| Eylem | Durum |
|-------|--------|
| E-posta | `POST /api/vault/v1/documents/{id}/email` — UI bağlı |
| Düzenle | Araçlar sayfasına yönlendirme (belgeyi araçta aç) |
| Paylaş | **API yok** — UI'da gösterilmez; e-posta kullanın |

---

## 2. Top-20 araç (≈45–60 dk)

[QA-TOOLS-CHECKLIST.md](QA-TOOLS-CHECKLIST.md) içindeki **Smoke test önceliği (ilk 20)** listesini sırayla işaretleyin.

Ek kontroller:

- **compare**: HTML rapor panelde iframe önizleme
- **validate-signature / verify-pdf**: JSON panel önizleme
- **ocr-pdf**: Uzun iş; `#/isler` ilerleme çubuğu

---

## 3. Full checklist (kalan gün)

[QA-TOOLS-CHECKLIST.md](QA-TOOLS-CHECKLIST.md) — tüm 69 araç, kategori kategori.

Her araç: Form → Dosya → Gönder → İndir (veya JSON/HTML önizleme).

---

## 4. Bilinen sınırlar

- Lisans/kapalı araç UX bu runbook kapsamı dışındadır.
- Mobil: tooltip `?` simgesine dokunarak açılır; dışarı tıklayınca kapanır.
- Stirling hata kodları Türkçe mesaj olarak toast/status'ta görünür.

---

## Hızlı geri dönüş

Sorun çıkarsa: [TROUBLESHOOTING.md](TROUBLESHOOTING.md), container logları (`docker compose logs securipdf-platform -f`).
