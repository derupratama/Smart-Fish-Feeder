# Smart Fish Feeder

Firmware ESP32 untuk membaca DS18B20, DHT22, dua HC-SR04, dan mengendalikan servo MG90S. Sketch mempertahankan kontrol servo melalui Serial Monitor (`ON`/`OFF`) dan mendukung telemetry/perintah MQTT.

## Struktur

```text
firmware/SmartFishFeeder/SmartFishFeeder.ino
firmware/SmartFishFeeder/secrets.h          # konfigurasi lokal, jangan dibagikan
firmware/SmartFishFeeder/secrets.example.h  # contoh tanpa kredensial
tools/mqtt/start_mqtt.ps1
tools/mqtt/stop_mqtt.ps1
integrations/n8n/SmartFishFeeder_MQTT_Ingest.json
web/                                      # dashboard Vite + React, Supabase Auth
N8N_MQTT_SETUP.md
MQTT_GUIDE.md
```

## Board dan GPIO

- Board: ESP32 Dev Module (`esp32:esp32:esp32`).
- DS18B20 data: GPIO 4.
- DHT22 data: GPIO 25.
- HC-SR04 pakan TRIG/ECHO: GPIO 26/18.
- HC-SR04 air TRIG/ECHO: GPIO 19/21.
- Servo MG90S signal: GPIO 23.

## Persiapan

Isi SSID dan password Wi-Fi serta password MQTT di `firmware/SmartFishFeeder/secrets.h`. Jangan menaruh nilai rahasia di README, `secrets.example.h`, atau commit. Library sensor/servo yang dipakai: OneWire, DallasTemperature, DHT sensor library, Adafruit Unified Sensor, dan ESP32Servo. MQTT menggunakan ArduinoMqttClient; jika belum ada, pasang melalui Arduino CLI sebelum compile:

```powershell
& 'C:\Program Files\Arduino CLI\arduino-cli.exe' lib install ArduinoMqttClient
```

Lihat [MQTT_GUIDE.md](MQTT_GUIDE.md) untuk setup broker lokal dan konfigurasi firmware. Firmware belum di-upload oleh setup ini.

## n8n

Workflow import MQTT dan petunjuk koneksi n8n Docker tersedia di [N8N_MQTT_SETUP.md](N8N_MQTT_SETUP.md). File workflow tidak menyimpan credential; buat MQTT credential langsung di UI n8n.

## Dashboard web

Frontend monitoring berada di [web/README.md](web/README.md). Jalankan `npm install` dan `npm run dev` dari folder `web`. Dashboard menggunakan Supabase Auth, publishable key, dan policy RLS untuk membaca data pemilik. Aplikasi belum dideploy ke Vercel.
