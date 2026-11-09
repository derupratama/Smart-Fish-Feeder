# Panduan MQTT — Smart Fish Feeder

## Status

Firmware sudah disiapkan untuk Wi-Fi Station dan ArduinoMqttClient. Broker kedua dikonfigurasi secara terpisah dari Windows service Mosquitto yang sudah ada. Firmware tidak otomatis memperoleh SSID/password Wi-Fi; isi sendiri file `firmware/SmartFishFeeder/secrets.h` sebelum compile.

## 1. Siapkan konfigurasi ESP32

Edit `firmware/SmartFishFeeder/secrets.h` secara lokal:

```cpp
#define WIFI_SSID "SSID_WIFI_ANDA"
#define WIFI_PASSWORD "PASSWORD_WIFI_ANDA"
#define MQTT_HOST "10.4.24.135"
#define MQTT_PORT 1884
#define MQTT_USERNAME "smartfish"
#define MQTT_PASSWORD "PASSWORD_MQTT_ANDA"
```

Nilai SSID/password Wi-Fi tidak tersedia di proyek dan tidak ditebak. `MQTT_PASSWORD` harus sama dengan password yang dibuat untuk user broker `smartfish`. File `secrets.h` dicantumkan di `.gitignore`; jangan membagikan atau commit file tersebut. `secrets.example.h` hanya berisi placeholder.

## 2. Pasang dependensi MQTT

`WiFi.h` dan `WiFiClient` berasal dari ESP32 core. Library MQTT yang dipakai sketch adalah ArduinoMqttClient. Jika belum dipasang, jalankan dari PowerShell:

```powershell
& 'C:\Program Files\Arduino CLI\arduino-cli.exe' lib install ArduinoMqttClient
```

Library sensor/servo yang dipakai tetap OneWire 2.3.8, DallasTemperature 4.0.6, DHT sensor library 1.4.7, Adafruit Unified Sensor 1.1.15, dan ESP32Servo 3.2.1.

## 3. Jalankan broker Mosquitto kedua

Service Windows `mosquitto` yang sudah ada tidak disentuh. Skrip start memakai executable di `C:\Program Files\mosquitto\`, membaca keberadaan `%USERPROFILE%\mosquitto-smartfish\passwords.txt` tanpa menampilkan isinya, lalu membuat konfigurasi broker terpisah pada port 1884 dengan:

- listener terikat ke IP Wi-Fi `10.4.24.135`;
- anonymous access dimatikan dan autentikasi memakai password file;
- persistence aktif pada folder data broker kedua;
- log dan PID terpisah untuk pengelolaan proses.

Jalankan dari PowerShell biasa pada komputer Windows yang memiliki IP tersebut:

```powershell
Set-Location 'D:\Smart-Fish-Feeder'
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\mqtt\start_mqtt.ps1
```

Skrip berhenti jika password file tidak ada, IP bind tidak terpasang, atau port 1884 sudah digunakan. Skrip tidak berhenti atau mengubah service Mosquitto lama.

Untuk memeriksa broker dan service:

```powershell
Get-NetTCPConnection -LocalAddress 10.4.24.135 -LocalPort 1884 -State Listen
Get-Service mosquitto
Get-Content (Join-Path $env:USERPROFILE 'mosquitto-smartfish\mosquitto-1884.log') -Tail 30
```

## 4. Aturan Windows Firewall lokal

Pembuatan firewall rule membutuhkan PowerShell Administrator. Buka PowerShell dengan **Run as administrator**, lalu jalankan perintah ini. Rule hanya menerima TCP/1884 dari `LocalSubnet`; firewall tetap aktif:

```powershell
$ruleName = 'Mosquitto SmartFish MQTT 1884'
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
  $existingRule | Format-List DisplayName,Enabled,Direction,Action,Profile
  $existingRule | Get-NetFirewallPortFilter
  $existingRule | Get-NetFirewallAddressFilter
  throw 'Rule dengan nama tersebut sudah ada. Pastikan port dan RemoteAddress-nya benar sebelum mengubah apa pun.'
}
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 1884 -RemoteAddress LocalSubnet -Profile Any
```

Jangan membuat port forwarding pada router. Konfigurasi broker terikat ke IP Wi-Fi tertentu, dan firewall membatasi sumber ke subnet lokal. Port 1884 pada konfigurasi ini tidak memakai TLS; gunakan hanya pada jaringan lokal tepercaya atau siapkan TLS sebelum mengirim kredensial melalui jaringan yang tidak tepercaya.

## 5. Topic MQTT

| Topic | Arah | Isi |
|---|---|---|
| `smartfish/telemetry/suhu_air` | ESP32 → broker | Suhu DS18B20, °C. |
| `smartfish/telemetry/suhu_wadah` | ESP32 → broker | Suhu DHT22, °C. |
| `smartfish/telemetry/kelembapan` | ESP32 → broker | Kelembapan DHT22, persen. |
| `smartfish/telemetry/jarak_pakan` | ESP32 → broker | Jarak HC-SR04 pakan, cm. |
| `smartfish/telemetry/jarak_air` | ESP32 → broker | Jarak permukaan air, cm. |
| `smartfish/command/servo` | broker → ESP32 | `ON` membuka; `OFF` menutup. Perintah tidak retained. |
| `smartfish/status/servo` | ESP32 → broker | `ON`/`OFF`, retained. |
| `smartfish/status/device` | ESP32 ↔ broker | `online` retained; Last Will `offline` retained saat koneksi MQTT hilang. |

Telemetry dikirim setiap 10 detik. Pembacaan sensor dan kontrol Serial tetap berjalan saat broker terputus. Wi-Fi/MQTT mencoba reconnect berkala tanpa delay panjang; jadwal pemberian pakan lokal kelak harus tetap berjalan tanpa bergantung pada koneksi broker.

## 6. Kontrol lokal dan menghentikan broker kedua

Serial Monitor tetap menerima `ON` dan `OFF`. Untuk menghentikan hanya broker Smart Fish yang dimulai oleh skrip:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\mqtt\stop_mqtt.ps1
Get-Service mosquitto
```

Stop script memverifikasi PID, executable, dan file konfigurasi sebelum menghentikan proses. Windows service Mosquitto yang lama harus tetap berjalan.

## 7. Batasan yang belum diverifikasi

- Sesi Codex tidak dapat melihat IP `10.4.24.135` pada interface lokal; skrip start memeriksa ulang IP pada komputer saat dijalankan.
- Password file ada menurut pemeriksaan keberadaan, tetapi isinya tidak dibaca. Skrip mengharapkan nama `passwords.txt` yang Anda berikan.
- ArduinoMqttClient belum terdeteksi di direktori library Arduino CLI sesi Codex. Pasang library tersebut sebelum compile.
- Tidak ada compile atau upload firmware yang dilakukan dalam perubahan ini.
