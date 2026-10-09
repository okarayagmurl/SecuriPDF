SecuriPDF Windows uygulaması, Stirling-PDF masaüstü uygulamasının yapısını izler:
Tauri penceresi, yanında paketlenmiş Java ve Stirling-PDF motoru, araç bazında
yerel veya sunucu yönlendirmesi.

Bu dizindeki Rust ve arayüz kaynakları SecuriPDF için yazılmıştır. Stirling-PDF
`frontend/editor/src/desktop` ve `frontend/editor/src/proprietary` altındaki
kod (Stirling PDF User License) kopyalanmamıştır.

Kurulum dosyasına şu üçüncü taraf bileşenler eklenir:

- Stirling-PDF 2.14.3 `Stirling-PDF-server.jar`: MIT lisansı (aşağıda). JAR,
  proprietary modül içermez; içindeki kütüphaneler kendi lisanslarına tabidir.
- Eclipse Temurin 25 JRE: GPLv2 ve Classpath Exception.

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
