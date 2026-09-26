# SIGAP-DM — Panduan Setup di VS Code

Aplikasi web sederhana (HTML/CSS/JS murni, tanpa framework, tanpa build tool) untuk pemantauan gula darah pasien Diabetes Melitus. Semua data tersimpan di **localStorage browser** — tidak butuh server atau database untuk mencoba.

## Isi folder

```
sigapdm/
├── index.html            -> struktur halaman & semua layar (login, dashboard, dst)
├── style.css             -> tampilan visual + mode gelap
├── app.js                -> semua logika: auth, data, WhatsApp, SOS, lokasi, dasbor perawat
├── manifest.json          -> identitas PWA (nama, ikon, warna) agar bisa di-install di Android
├── sw.js                  -> service worker (syarat wajib PWA installable)
├── icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon.png -> ikon aplikasi
├── vercel.json            -> konfigurasi kecil untuk deploy ke Vercel
└── README.md              -> panduan ini
```

## Cara menjalankan (3 langkah)

1. **Buka folder di VS Code**
   `File → Open Folder...` lalu pilih folder `sigapdm`.

2. **Pasang ekstensi "Live Server"** (oleh Ritwick Dey) dari tab Extensions (`Ctrl+Shift+X`), kalau belum ada.
   > Kenapa bukan langsung buka `index.html` dua kali klik? Bisa saja, tapi beberapa fitur (font Google, localStorage) lebih stabil lewat server lokal, dan Live Server otomatis refresh saat kamu edit kode.

3. **Klik kanan `index.html` → "Open with Live Server"**.
   Browser akan terbuka di `http://127.0.0.1:5500` (atau port serupa).

Tidak ada `npm install`, tidak ada langkah build — file langsung jalan.

## Mencoba aplikasi

- Klik **"🚀 Coba Demo Pasien"** di layar login untuk masuk dengan akun contoh yang sudah berisi data gula darah & obat.
- Atau isi email + password baru di form login — sistem otomatis mendaftarkan akun baru.
- Untuk mencoba sisi tenaga medis, klik tab **"Perawat / Tenaga Medis"** di layar login, isi nama bebas + kode akses (minimal 4 karakter, bebas — mis. `PKM2024`).

## Fitur yang sudah ada

| Fitur | Lokasi |
|---|---|
| Login/registrasi otomatis, PIN keamanan, mode gelap | Login, Profil |
| Catat & lihat riwayat gula darah, klasifikasi otomatis (normal/tinggi/rendah) | Menu "Gula" |
| Kelola daftar obat + centang "sudah diminum hari ini" | Menu "Terapi" |
| Grafik tren gula darah | Menu "Progress" |
| Edukasi diabetes (gejala, pola makan, olahraga, tanda bahaya) | Menu "Edukasi" |
| **🚨 Tombol SOS mengambang** — tersedia di semua halaman, buka panel darurat | Kanan bawah, semua layar aplikasi |
| **Kirim ke WhatsApp keluarga** — otomatis, dari tiap data gula darah, dari dashboard ("Kirim Ringkasan"), atau dari panel darurat | Dashboard, riwayat gula, panel SOS |
| **📍 Lokasi otomatis saat darurat** — begitu panel SOS dibuka, aplikasi mendeteksi koordinat GPS dan menyertakan link Google Maps di pesan WhatsApp darurat. Tombol "Bagikan Lokasi Saat Ini" di dashboard untuk berbagi lokasi kapan saja (bukan hanya saat darurat) | Panel SOS, Dashboard |
| **Bisa di-install seperti aplikasi Android** (PWA) — ikon muncul di layar utama HP, terbuka layar penuh tanpa address bar | Setelah deploy ke HTTPS (lihat bagian Deploy) |
| **Deteksi kondisi kritis otomatis** — banner peringatan merah muncul di dashboard bila gula darah sangat tinggi/rendah | Dashboard |
| **Mode Perawat** — login terpisah untuk melihat daftar pasien, riwayat gula darah & obat tiap pasien, tombol telepon/WA langsung ke pasien, dan kirim catatan balik ke pasien | Tab "Perawat" di login |
| **Catatan dari perawat** muncul sebagai banner di dashboard pasien | Dashboard |

## Cara mengisi kontak darurat (WA keluarga & perawat)

1. Login sebagai pasien → menu **Profil**.
2. Isi **"Nomor HP / WhatsApp Pasien"** dan simpan.
3. Isi form **"Kontak Darurat"**: nama keluarga, nomor WA keluarga, dan (opsional) nomor WA perawat/puskesmas → simpan.
4. Setelah itu, tombol 🚨 SOS dan "Kirim Ringkasan ke Keluarga" akan langsung membuka WhatsApp dengan pesan yang sudah terisi otomatis.

> Nomor bisa diisi format `08xx...` — sistem otomatis mengubahnya ke format internasional `62xx...` untuk link WhatsApp.

## 🚀 Deploy dari GitHub ke Vercel, lalu install di Android

Lokasi GPS dan status "installable" **hanya aktif di HTTPS** (bukan di `file://` atau `localhost` biasa dari HP lain) — ini alasan utama kenapa perlu deploy ke Vercel, bukan sekadar dibuka dari file lokal.

### A. Unggah ke GitHub

1. Buat repository baru di [github.com/new](https://github.com/new), misalnya `sigapdm`. Boleh publik atau privat.
2. Di folder proyek ini (lewat terminal VS Code, `` Ctrl+` ``), jalankan:
   ```bash
   git init
   git add .
   git commit -m "Initial commit SIGAP-DM"
   git branch -M main
   git remote add origin https://github.com/USERNAME/sigapdm.git
   git push -u origin main
   ```
   Ganti `USERNAME` dengan username GitHub kamu.

### B. Deploy ke Vercel

1. Buka [vercel.com](https://vercel.com) → daftar/masuk pakai akun GitHub.
2. Klik **"Add New... → Project"**.
3. Pilih repository `sigapdm` yang barusan di-push → klik **Import**.
4. Framework Preset biarkan **"Other"** (situs ini statis, tidak perlu build command apa pun) → klik **Deploy**.
5. Tunggu ±30 detik → Vercel memberi URL publik HTTPS, contoh: `https://sigapdm.vercel.app`.

Setiap kali kamu `git push` lagi ke `main`, Vercel otomatis deploy ulang versi terbaru.

### C. Install ke Android (jadi ikon di layar utama, seperti app native)

1. Buka URL Vercel kamu (`https://sigapdm-xxxx.vercel.app`) di **Chrome untuk Android**.
2. Ketuk menu titik tiga (⋮) di pojok kanan atas Chrome.
3. Pilih **"Add to Home screen"** / **"Install app"** (kadang Chrome menawarkan ini otomatis lewat banner di bawah).
4. Konfirmasi nama app → ikon SIGAP-DM akan muncul di layar utama HP, terbuka layar penuh tanpa address bar, terasa seperti aplikasi asli.
5. Saat pertama kali membuka fitur SOS, Chrome akan meminta **izin akses lokasi** — pilih **Allow/Izinkan** supaya fitur bagikan lokasi darurat berfungsi.

> Ini disebut **PWA (Progressive Web App)** — cara resmi & gratis untuk membuat web app "terasa" seperti aplikasi Android tanpa perlu Play Store. Ini berbeda dari file `.apk`, tapi berfungsi penuh: bisa dibuka offline (tampilan dasar), dapat ikon sendiri, dan tidak terlihat seperti "situs web" lagi.

### D. (Opsional, lebih lanjut) Kalau kamu tetap ingin file `.apk` asli / naik ke Play Store

PWA di atas **tidak bisa langsung** diupload ke Google Play sebagai APK biasa. Kalau target akhirnya publish ke Play Store, langkah berikutnya adalah membungkus PWA ini dengan **TWA (Trusted Web Activity)** memakai tool [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) dari Google — ini generate project Android Studio dari PWA yang sudah live di Vercel, lalu tinggal build APK/AAB seperti app Android biasa. Kabari saja kalau kamu mau aku bantu susun langkah ini juga.

## ⚠️ Batasan penting yang perlu kamu tahu

Aplikasi ini **belum punya backend/server** — semua data disimpan di `localStorage`, yaitu penyimpanan lokal di *browser dan perangkat yang sama*. Konsekuensinya:

- **Mode Perawat saat ini hanya bisa melihat data pasien yang tersimpan di perangkat/browser yang sama.** Ini cocok untuk skenario "perawat memeriksa memakai HP/tablet pasien saat kunjungan", tapi **belum bisa** dipakai perawat dari HP-nya sendiri untuk memantau pasien dari jarak jauh secara real-time.
- Tombol WhatsApp bekerja penuh karena WhatsApp memang diakses lewat link `wa.me` yang dibuka browser/HP — ini **tidak** butuh backend dan sudah berfungsi nyata.
- Tombol telepon darurat (119) dan telepon keluarga juga berfungsi nyata di HP (membuka aplikasi telepon).
- **Lokasi GPS** hanya berfungsi setelah di-deploy ke HTTPS (Vercel) dan pengguna mengizinkan akses lokasi di browser. Akurasi bergantung sinyal GPS HP — biasanya lebih akurat di luar ruangan. Bila pengguna menolak izin lokasi, pesan darurat tetap terkirim tanpa link lokasi.

### Kalau ingin perawat bisa akses dari jarak jauh (rekomendasi langkah lanjut)

Kamu perlu memindahkan penyimpanan dari `localStorage` ke database online, misalnya:
- **Firebase (Firestore + Authentication)** — paling cepat untuk pemula, gratis untuk skala kecil.
- **Supabase** — alternatif open-source dengan Postgres.
- Backend custom (Node.js/Express + database) bila butuh kontrol penuh.

Kalau kamu mau, aku bisa bantu migrasikan `app.js` supaya membaca/menulis ke Firebase sehingga data pasien & perawat benar-benar tersinkron real-time di perangkat berbeda — tinggal bilang saja.

## Menyesuaikan tampilan

Semua warna, font, dan ukuran diatur lewat CSS variables di bagian atas `style.css` (`:root { ... }`), termasuk versi mode gelap di `body.dark-mode { ... }`. Ganti nilai di situ untuk mengubah skema warna tanpa menyentuh bagian lain dari CSS.
