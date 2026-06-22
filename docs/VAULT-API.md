# SecuriPDF Vault — REST API Taslağı (v1)

Vault, Stirling login olmadan kullanıcı bazlı belge, görsel imza ve sertifika depolar.

**Kimlik:** oauth2-proxy / Keycloak JWT — `X-Auth-Request-User`, `X-Auth-Request-Email`, `X-Auth-Request-Groups` header’ları.

**Base URL (planlanan):** `https://pdf.sirket.local/api/vault/v1`

---

## Ortak

### Hata gövdesi

```json
{
  "error": "quota_exceeded",
  "message": "Kullanıcı kotası aşıldı (1024 MB)."
}
```

### HTTP kodları

| Kod | Anlam |
|-----|--------|
| 401 | Oturum yok / geçersiz token |
| 403 | Başka kullanıcının kaynağı veya yetersiz rol |
| 413 | Dosya veya kota limiti |
| 404 | Kayıt yok |

---

## Belgeler

### `GET /documents`

Kullanıcının arşiv listesi.

**Query:** `page`, `size`, `sort=modifiedAt,desc`

**Response 200:**

```json
{
  "items": [
    {
      "id": "doc_8f3a2b",
      "name": "sozlesme.pdf",
      "sizeBytes": 245760,
      "mimeType": "application/pdf",
      "createdAt": "2026-06-19T10:00:00Z",
      "modifiedAt": "2026-06-19T10:00:00Z"
    }
  ],
  "total": 1,
  "quotaBytes": 1073741824,
  "usedBytes": 245760
}
```

### `POST /documents`

Yeni belge yükle (multipart).

**Form:** `file` (PDF, max tek dosya limiti)

**Response 201:** belge metadata + `id`

### `GET /documents/{id}`

Belge indir (decrypted stream).

### `DELETE /documents/{id}`

Belge sil.

### `POST /documents/{id}/email`

Arşivdeki belgeyi oturum açmış kullanıcının kayıtlı e-posta adresine gönderir (SMTP gerekir).

**Response 200:**

```json
{
  "sentTo": "kullanici@sirket.local",
  "documentName": "sozlesme.pdf",
  "documentId": "doc_8f3a2b"
}
```

### `POST /documents/email`

Açık PDF’i (multipart `file`) kullanıcının kendi e-posta adresine gönderir.

---

## Görsel imzalar

### `GET /signatures`

Kullanıcının kayıtlı imza listesi.

### `POST /signatures`

**Form:** `file` (PNG/SVG), `label` (opsiyonel)

Dosya sunucuda **encrypted** saklanır.

### `GET /signatures/{id}`

İmza görseli (yetkili kullanıcı).

### `DELETE /signatures/{id}`

---

## Sertifikalar

### `GET /certificates`

Metadata listesi (private key içeriği dönülmez).

```json
{
  "items": [
    {
      "id": "cert_a1",
      "subject": "CN=Ahmet Yilmaz",
      "expiresAt": "2027-01-01T00:00:00Z",
      "label": "Kurumsal imza"
    }
  ]
}
```

### `POST /certificates`

**Form:** `file` (.pfx/.p12), `password` (yükleme anında; sunucuda şifreli saklanır)

### `GET /certificates/{id}/use`

Stirling `cert-sign` entegrasyonu için **kısa ömürlü token** veya geçici decrypt (PoC’te netleştirilecek).

### `DELETE /certificates/{id}`

---

## Kota (User)

### `GET /quota`

```json
{
  "userId": "ahmet.yilmaz",
  "maxBytes": 1073741824,
  "usedBytes": 245760,
  "remainingBytes": 1073496064
}
```

---

## Admin (`pdf-admin` rolü)

### `GET /admin/users/{userId}/quota`

### `PUT /admin/users/{userId}/quota`

```json
{
  "maxBytes": 2147483648
}
```

### `GET /admin/audit`

**Query:** `userId`, `action`, `from`, `to`, `page`

---

## Depolama düzeni (sunucu)

```
/vault-data/
├── documents/{userId}/{docId}.enc
├── signatures/{userId}/{sigId}.enc
└── certificates/{userId}/{certId}.enc
```

Metadata: PostgreSQL (`vault` schema).

---

## Stirling entegrasyon notları

1. Kullanıcı PDF işler → Stirling (geçici oturum dosyası).
2. **Arşive kaydet** → `POST /documents`.
3. **İmzala** → Vault’tan imza/sertifika al → Stirling sign/cert-sign API’sine besle (orchestration katmanı, Faz 4).

Stirling login **kullanılmaz**.
