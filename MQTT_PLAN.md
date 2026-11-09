# Rencana Integrasi MQTT — Smart Fish Feeder

> **Status:** dokumen ini adalah rancangan awal. Implementasi firmware dan prosedur broker saat ini dijelaskan di [MQTT_GUIDE.md](MQTT_GUIDE.md). Topic aktif menggunakan awalan `smartfish/` sesuai permintaan terbaru.

## Status pemeriksaan

- Sketch aktif: `firmware/SmartFishFeeder/SmartFishFeeder.ino`.
- Target board yang dikonfirmasi pemilik proyek: **ESP32 Dev Module** (`esp32:esp32:esp32`). Sketch tidak menyimpan pilihan board di dalam file `.ino`; folder proyek saat ini juga tidak berisi konfigurasi profile/FQBN yang menimpanya.
- Library yang dipakai sketch sekarang:
  - OneWire 2.3.8 — DS18B20 melalui `OneWire.h`.
  - DallasTemperature 4.0.6 — pembacaan suhu DS18B20 melalui `DallasTemperature.h`.
  - DHT sensor library 1.4.7 — DHT22 melalui `DHT.h`.
  - Adafruit Unified Sensor 1.1.15 — dependensi DHT sensor library.
  - ESP32Servo 3.2.1 — servo melalui `ESP32Servo.h`.
- Sketch mempertahankan GPIO DS18B20 4, DHT22 25, HC-SR04 pakan TRIG/ECHO 26/18, HC-SR04 air TRIG/ECHO 19/21, dan servo 23.
- Pembacaan sensor dan kontrol servo tersedia di sketch. Perintah Serial `ON` dan `OFF` mengendalikan servo.
- Pemeriksaan ini hanya membaca proyek. Sketch utama belum diubah, MQTT belum diterapkan, dan firmware tidak diunggah.

## Arsitektur yang diusulkan

ESP32 memakai Wi-Fi mode Station untuk masuk ke access point, lalu membuka koneksi ke broker MQTT. Sensor tetap dibaca oleh ESP32. ESP32 menerbitkan nilai sensor ke topic telemetry dan berlangganan topic perintah servo. Pesan MQTT `ON` dan `OFF` memanggil fungsi servo yang sama dengan kontrol Serial yang sudah ada, sehingga Serial Monitor tetap berfungsi.

Broker tidak menjadi bagian dari loop kontrol lokal. Jika kelak ditambahkan jadwal pemberian pakan, jadwal itu harus dijalankan di ESP32 menggunakan waktu lokal (`millis()`/timer lokal) dan tetap aktif saat Wi-Fi atau broker terputus. MQTT hanya menjadi jalur pemantauan dan kendali jarak jauh.

Setiap topic memakai awalan `smartfishfeeder/{device_id}/`. `{device_id}` adalah placeholder; nilainya belum ditentukan. Nilai telemetry berupa angka teks dalam satuan pada nama topic. Sensor yang gagal dibaca tidak menerbitkan nilai numerik palsu; kegagalan tetap dapat dicatat melalui Serial atau topic diagnostik yang disepakati nanti.

### Daftar topic

| Topic | Arah | Payload yang direncanakan | Keterangan |
|---|---|---|---|
| `smartfishfeeder/{device_id}/telemetry/water_temperature_c` | ESP32 → broker | Angka suhu °C | DS18B20; hanya kirim ketika pembacaan valid. |
| `smartfishfeeder/{device_id}/telemetry/feed_container_temperature_c` | ESP32 → broker | Angka suhu °C | Suhu wadah pakan dari DHT22. |
| `smartfishfeeder/{device_id}/telemetry/feed_container_humidity_percent` | ESP32 → broker | Angka persen | Kelembapan dari DHT22. |
| `smartfishfeeder/{device_id}/telemetry/feed_distance_cm` | ESP32 → broker | Angka jarak cm | Jarak HC-SR04 pakan; estimasi sisa pakan memerlukan dimensi dan kalibrasi wadah yang belum diberikan. |
| `smartfishfeeder/{device_id}/telemetry/water_surface_distance_cm` | ESP32 → broker | Angka jarak cm | Jarak permukaan air dari HC-SR04 kedua. |
| `smartfishfeeder/{device_id}/command/servo` | broker → ESP32 | `ON` atau `OFF` | `ON` membuka dan `OFF` menutup servo. Pesan perintah tidak retained agar perintah lama tidak dijalankan setelah perangkat tersambung kembali. |
| `smartfishfeeder/{device_id}/state/servo` | ESP32 → broker | `ON` atau `OFF` | Status aktual setelah fungsi kontrol servo dijalankan; dapat retained agar dashboard membaca status terakhir. |
| `smartfishfeeder/{device_id}/status/availability` | ESP32 ↔ broker | `online` atau `offline` | ESP32 menerbitkan `online` setelah MQTT tersambung. Broker memakai Last Will retained `offline` jika koneksi klien terputus tanpa disconnect normal. |

QoS telemetry dapat dimulai pada QoS 0. Topic perintah sebaiknya diterbitkan dengan QoS 1 oleh pengirim dan diterima melalui subscription QoS 1. Keberhasilan tindakan tetap dikonfirmasi melalui `state/servo`; pengiriman QoS tidak menggantikan konfirmasi status perangkat.

## Siklus koneksi dan pengiriman

1. Nyalakan Wi-Fi STA tanpa menunggu dalam loop panjang. Coba sambung ulang secara berkala jika access point belum tersedia atau koneksi hilang.
2. Setelah Wi-Fi mendapat koneksi/IP, coba koneksi MQTT dengan jeda retry bertahap dan batas maksimum yang dapat ditinjau saat implementasi. Jangan memakai loop retry tak berujung atau `delay()` panjang.
3. Saat menghubungkan MQTT, set Last Will retained `offline`; setelah koneksi berhasil, terbitkan `online` dan subscribe ke topic `command/servo`.
4. Panggil fungsi polling MQTT secara teratur di `loop()` agar pesan masuk dan keep-alive diproses. Callback perintah hanya menerima `ON`/`OFF` lalu memakai fungsi `bukaPakan()`/`tutupPakan()` yang sudah ada.
5. Terbitkan telemetry secara berkala. **Interval 10 detik adalah usulan awal**, bukan nilai final; nilai final menunggu konfirmasi. Pertahankan pembacaan Serial dan perilaku pembacaan sensor yang telah diuji.
6. Saat broker atau internet putus, sensor, kontrol Serial, dan jadwal pakan lokal nantinya tetap berjalan. Koneksi MQTT dicoba lagi tanpa memblokir loop lokal.

> **Catatan responsivitas:** sketch saat ini memakai `delay(60)`, `delay(1000)`, `pulseIn()` dengan timeout 30.000 µs, dan `Serial.readStringUntil()`. Implementasi MQTT dan jadwal lokal perlu memastikan polling jaringan serta jadwal lokal tetap mendapat waktu jalan. Perubahan loop/timing harus ditinjau terpisah agar pembacaan sensor dan perilaku servo yang sudah diuji tidak berubah tanpa alasan.

## Library untuk tahap implementasi

- Tetap gunakan lima library yang sudah ada untuk sensor dan servo (daftar versi pada bagian pemeriksaan).
- Wi-Fi dan `WiFiClient` tersedia dari core Arduino-ESP32; tidak perlu menambahkan library Wi-Fi terpisah.
- **Usulan MQTT: ArduinoMqttClient.** Library ini menyediakan API polling dan contoh resmi untuk ESP32/Wi-Fi. PubSubClient tidak dipilih sebagai default karena README pembuat PubSubClient menyatakan proyeknya tidak terawat dan menyarankan mengevaluasi alternatif. ArduinoMqttClient belum dipasang atau diuji di proyek ini.
- Jika broker mensyaratkan TLS, implementasi perlu memakai transport TLS yang sesuai serta memvalidasi sertifikat CA broker. Pilihan transport dan provisioning sertifikat menunggu detail broker.

## File yang mungkin berubah pada tahap implementasi

Pada tahap sekarang hanya file rencana ini yang dibuat. Setelah detail koneksi tersedia dan perubahan firmware disetujui:

- `firmware/SmartFishFeeder/SmartFishFeeder.ino` — akan diubah untuk Wi-Fi, MQTT, telemetry periodik, perintah servo jarak jauh, status koneksi, retry, dan pemanggilan kontrol lokal. Pin GPIO dan kontrol Serial tetap dipertahankan.
- `firmware/SmartFishFeeder/secrets.h` atau mekanisme konfigurasi lokal lain — mungkin dibuat untuk kredensial; pilihan penyimpanan perlu disepakati. Jangan masukkan kredensial nyata ke dokumentasi atau source yang dibagikan.
- `MQTT_PLAN.md` — dapat diperbarui setelah broker, topic root, interval telemetry, dan pilihan TLS disepakati.

Tidak ada Wi-Fi/MQTT, AI, n8n, atau jadwal pakan baru dalam firmware pada tahap dokumentasi ini.

## Informasi yang masih diperlukan

1. SSID Wi-Fi dan password Wi-Fi (kirim lewat cara yang aman; jangan masukkan ke file dokumentasi).
2. Alamat broker MQTT (hostname atau IP) dan port.
3. Broker berada di jaringan lokal atau di layanan cloud, serta apakah TLS wajib.
4. Jika TLS digunakan: cara memperoleh CA certificate/fingerprint yang dipercaya. Hindari mode yang mematikan validasi sertifikat.
5. Username dan password MQTT, atau konfirmasi broker tidak memakai autentikasi.
6. `device_id` dan awalan topic yang diinginkan, bila tidak memakai rancangan `smartfishfeeder/{device_id}/`.
7. Konfirmasi interval telemetry (usulan awal 10 detik) dan apakah status servo boleh retained.
8. Untuk estimasi persen sisa pakan: tinggi wadah, jarak sensor ke dasar saat kosong, serta kalibrasi rentang penuh/kosong. Tanpa data ini, firmware hanya mengirim jarak dalam cm.

## Referensi

- [Dokumentasi Wi-Fi Arduino-ESP32 (Espressif)](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html)
- [ArduinoMqttClient (repositori resmi Arduino)](https://github.com/arduino-libraries/ArduinoMqttClient)
- [Contoh ArduinoMqttClient untuk ESP32, polling, dan Last Will](https://github.com/arduino-libraries/ArduinoMqttClient/blob/master/examples/WiFiAdvancedCallback/WiFiAdvancedCallback.ino)
- [README PubSubClient tentang status pemeliharaan dan batasan QoS](https://github.com/knolleary/pubsubclient/blob/master/README.md)
