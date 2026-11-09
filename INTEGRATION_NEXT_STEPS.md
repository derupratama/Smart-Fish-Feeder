# Lanjutan Integrasi Smart Fish Feeder

Dokumen ini mencatat rancangan berdasarkan firmware dan workflow yang ada. Belum ada perubahan cloud, belum ada kredensial baru, dan firmware belum diunggah ke ESP32.

## 1. Snapshot sensor yang saat ini dihasilkan

Code node `Build Current Snapshot` mengakumulasi data terakhir yang diterima untuk setiap topic. Bentuknya:

```json
{
  "device_id": "smartfish",
  "timestamp": "waktu pemrosesan n8n dalam UTC",
  "source": { "topic": "topic pesan terakhir", "payload": "payload mentah terakhir" },
  "telemetry": {
    "suhu_air_c": { "value": 27.5, "unit": "degC", "updated_at": "..." },
    "suhu_wadah_c": { "value": 28.1, "unit": "degC", "updated_at": "..." },
    "kelembapan_percent": { "value": 61.2, "unit": "percent", "updated_at": "..." },
    "jarak_pakan_cm": { "value": 4.3, "unit": "cm", "updated_at": "..." },
    "jarak_air_cm": { "value": 8.7, "unit": "cm", "updated_at": "..." }
  },
  "status": {
    "servo": { "value": "OFF", "updated_at": "..." },
    "device": { "value": "online", "updated_at": "..." }
  },
  "updated_at": "..."
}
```

Angka di atas hanya contoh format, bukan hasil pembacaan perangkat. Firmware menerbitkan tiap sensor sebagai pesan MQTT terpisah setiap 10 detik; karena itu `source` menggambarkan pesan terbaru, sementara tiap field menyimpan waktu pembaruannya sendiri. Sensor yang gagal dibaca tidak dikirim oleh firmware, jadi nilainya akan tertinggal sebagai nilai terakhir. Dashboard/database sebaiknya menampilkan umur data (`now - updated_at`) dan menandai data kedaluwarsa, bukan menganggap angka terakhir selalu terkini.

Pemetaan topic:

| MQTT topic | Snapshot key | Unit |
| --- | --- | --- |
| `smartfish/telemetry/suhu_air` | `telemetry.suhu_air_c` | `degC` |
| `smartfish/telemetry/suhu_wadah` | `telemetry.suhu_wadah_c` | `degC` |
| `smartfish/telemetry/kelembapan` | `telemetry.kelembapan_percent` | `percent` |
| `smartfish/telemetry/jarak_pakan` | `telemetry.jarak_pakan_cm` | `cm` |
| `smartfish/telemetry/jarak_air` | `telemetry.jarak_air_cm` | `cm` |
| `smartfish/status/servo` | `status.servo` | `ON` / `OFF` |
| `smartfish/status/device` | `status.device` | `online` / `offline` |

Untuk memverifikasi data nyata, buka execution terbaru pada workflow n8n dan pilih output node **Build Current Snapshot**. Periksa kelima key telemetry, unit, waktu `updated_at`, serta kedua key status. File workflow saja tidak memuat sampel hasil eksekusi.

## 2. Pilihan penyimpanan riwayat

Jangan gunakan project Supabase yang saat ini terhubung ke Codex untuk data feeder: skema yang terlihat adalah aplikasi skincare. Pilih salah satu backend khusus sebelum membuat tabel:

- **Supabase khusus feeder**: cocok untuk dashboard web yang dapat diakses dari luar jaringan rumah. Simpan riwayat di tabel `sensor_readings` (baris per pesan sensor) dan status/aksi pakan terpisah. n8n menulis ke database lewat credential server-side; jangan menaruh `service_role` key di browser.
- **PostgreSQL lokal di Docker**: tidak bergantung pada layanan cloud untuk riwayat selama komputer lokal menyala; dashboard juga perlu berada di jaringan yang sama atau memakai VPN untuk akses jarak jauh.

Skema minimal yang disarankan untuk histori adalah `sensor_readings(id, device_id, metric, value, unit, measured_at, received_at, raw_topic, raw_payload)`, dengan index pada `(device_id, measured_at DESC)` dan `(device_id, metric, measured_at DESC)`. Simpan satu baris per pesan, bukan snapshot berulang yang menduplikasi empat nilai lama setiap kali sensor kelima datang. `received_at` adalah waktu diterima n8n; firmware saat ini belum mengirim waktu sampling perangkat.

## 3. Dashboard dan kontrol servo

Dashboard perlu menampilkan lima sensor, umur data masing-masing, status online/offline, status servo, grafik berdasarkan waktu, dan riwayat pemberian pakan. Untuk tombol buka/tutup, gunakan aksi di backend n8n yang menerbitkan `ON` atau `OFF` ke `smartfish/command/servo`. Jangan izinkan browser MQTT unauthenticated. Broker saat ini memakai MQTT TCP; browser tidak bisa terhubung langsung tanpa listener WebSocket yang dikonfigurasi dan diamankan.

## 4. Pakan terjadwal tetap di perangkat

Penjadwal utama harus berjalan di ESP32; n8n hanya mengubah konfigurasi jadwal atau menerima laporan. Namun penjadwalan berdasarkan jam dinding memerlukan sumber waktu:

- NTP dapat menyetel waktu saat Wi-Fi/internet tersedia, tetapi tidak memberi waktu yang benar setelah ESP32 mati lalu menyala kembali tanpa koneksi.
- Tambahkan modul RTC DS3231 dengan baterai cadangan untuk jadwal tetap saat internet/VPS/n8n mati dan perangkat mengalami restart/padam listrik.
- Servo perlu dibuka sebentar lalu ditutup otomatis, dengan durasi dan jam pakan yang bisa diatur serta pembatas supaya servo tidak tertinggal terbuka. Durasi dan jam belum ditentukan.

## 5. Notifikasi kondisi kolam

Aturan notifikasi perlu memakai batas yang dapat diubah, masa kedaluwarsa data, dan jeda/cooldown supaya satu kondisi tidak mengirim banyak pemberitahuan. Kandidat: suhu air di luar rentang, pembacaan sensor tidak diperbarui, perangkat offline, serta stok pakan rendah berdasarkan kalibrasi jarak wadah. Ambang suhu dan jarak harus ditetapkan dari kondisi kolam dan tinggi wadah sebenarnya.

## Urutan implementasi yang disarankan

1. Salin output snapshot nyata dari execution n8n dan pastikan unit/rentang sensor masuk akal.
2. Tentukan penyimpanan khusus feeder (Supabase khusus atau PostgreSQL lokal).
3. Tambahkan penyimpanan per-pesan MQTT dan konfirmasi beberapa baris riwayat.
4. Bangun dashboard baca-saja dan grafik; setelah itu tambahkan endpoint tombol servo.
5. Pasang RTC DS3231, tentukan waktu/durasi pakan, baru implementasikan dan uji penjadwal lokal.
6. Tentukan batas notifikasi dan kanalnya (misalnya Telegram atau email), lalu hubungkan ke n8n.

Setiap uji firmware dilakukan melalui compile/serial terlebih dahulu. Upload ke ESP32 dilakukan hanya setelah ada persetujuan eksplisit.
