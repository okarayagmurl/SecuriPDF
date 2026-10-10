SecuriPDF Windows uygulaması, Stirling-PDF masaüstü uygulamasının yapısını izler:
Tauri penceresi ve yanında paketlenmiş Java ile Stirling-PDF motoru.

Bu dizindeki Rust ve arayüz kaynakları SecuriPDF için yazılmıştır. Stirling-PDF
`frontend/editor/src/desktop` ve `frontend/editor/src/proprietary` altındaki
kod (Stirling PDF User License) kopyalanmamıştır.

Kurulum dosyasına şu üçüncü taraf bileşenler eklenir:

- Stirling-PDF 2.14.3 `Stirling-PDF-server.jar`: MIT lisansı (aşağıda). JAR,
  proprietary modül içermez; içindeki kütüphaneler kendi lisanslarına tabidir.
- Eclipse Temurin 25 JRE: GPLv2 ve Classpath Exception.
- Tesseract OCR 5.4 (UB Mannheim Windows derlemesi) ve `tessdata_best` dil
  verileri: Apache License 2.0. Yanındaki DLL'ler kendi lisanslarına tabidir:
  Leptonica (BSD-2), libarchive (BSD-2), OpenSSL 3 (Apache 2.0), libtiff,
  libpng, libjpeg-turbo, libwebp, zlib, zstd, lz4, xz, bzip2, giflib, expat,
  OpenJPEG, LERC, libdeflate, libb2, jbigkit (GPLv2+), libiconv (LGPL 2.1),
  GCC çalışma zamanı (libgcc, libstdc++: GPLv3 ve GCC Runtime Library
  Exception), winpthreads (MIT). LGPL bileşenleri değiştirilmeden, ayrı DLL
  olarak dağıtılır.
- PDF.js 6.4.299 (`ui/vendor/pdfjs`): Apache License 2.0; `wasm/` altındaki
  JBIG2, OpenJPEG ve QCMS çözücüleri kendi lisans dosyalarıyla birliktedir.
  Görüntüleyici bileşeni (`web/pdf_viewer.mjs`, CSS ve simgeler) aynı lisanstadır.

Stirling-PDF MIT bildirimi:

MIT License

Copyright (c) 2025 Stirling PDF Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
