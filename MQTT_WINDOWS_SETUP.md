# Setup Mosquitto Windows — Smart Fish Feeder

> **Pembaruan:** panduan operasional terkini ada di [MQTT_GUIDE.md](MQTT_GUIDE.md) dan script `tools/mqtt/start_mqtt.ps1` / `tools/mqtt/stop_mqtt.ps1`. Dokumen ini merekam pemeriksaan sebelum password file `passwords.txt` dilaporkan tersedia.

## Status pemeriksaan

Pemeriksaan dilakukan dari sesi Codex yang berjalan sebagai `CIEL\CodexSandboxOffline`, bukan sesi Administrator interaktif Windows.

- Mosquitto 2.1.2 ditemukan di `C:\Program Files\mosquitto\` bersama `mosquitto_passwd.exe`, `mosquitto_pub.exe`, dan `mosquitto_sub.exe`.
- Service Windows `mosquitto` sudah **Running** dengan startup **Automatic**. Setup Smart Fish Feeder harus berjalan sebagai proses kedua dengan konfigurasi terpisah. Jangan menghentikan atau mengubah service tersebut.
- Port TCP 1884 belum terlihat listening saat diperiksa.
- Folder `%USERPROFILE%\mosquitto-smartfish` belum ada saat diperiksa.
- IP `10.4.24.135` tidak muncul pada hasil pemeriksaan interface sesi Codex, sehingga alamat itu belum dapat diverifikasi dari sesi ini.
- Sesi PowerShell Codex bukan Administrator. Pembacaan aturan firewall berakhir dengan `Access denied`; status aturan port 1884 belum diketahui.
- Tidak ada konfigurasi broker, password file, broker kedua, aturan firewall, atau hasil tes publish/subscribe yang dibuat/dijalankan dari sesi ini. Service yang sudah ada tidak disentuh.

## Konfigurasi yang direncanakan

Jalankan langkah ini pada PowerShell Windows interaktif sebagai akun Anda. Password diminta oleh `mosquitto_passwd` secara tersembunyi; jangan gunakan opsi `-b`, jangan menaruh password di command line, dan jangan menyalin password ke dokumentasi.

```powershell
$mosq = 'C:\Program Files\mosquitto'
$dir = Join-Path $env:USERPROFILE 'mosquitto-smartfish'
New-Item -ItemType Directory -Path $dir -Force | Out-Null

# Buat password file baru dan isi password secara interaktif.
# Opsi -c menimpa file yang sudah ada; periksa dahulu sebelum menjalankan ulang.
if (Test-Path -LiteralPath (Join-Path $dir 'passwordfile')) {
    throw 'Password file sudah ada. Jangan gunakan -c; tinjau file dan gunakan perintah update tanpa -c bila memang diperlukan.'
}
& (Join-Path $mosq 'mosquitto_passwd.exe') -c (Join-Path $dir 'passwordfile') smartfish
if ($LASTEXITCODE -ne 0) { throw "mosquitto_passwd gagal: exit code $LASTEXITCODE" }
```

Setelah password file berhasil dibuat, isi `%USERPROFILE%\mosquitto-smartfish\mosquitto.conf` seperti berikut. IP bind mengikuti alamat Wi-Fi yang Anda berikan; pastikan masih terpasang pada adapter Wi-Fi sebelum menjalankan broker.

```conf
listener 1884 10.4.24.135
allow_anonymous false
password_file C:/Users/Lusinous/mosquitto-smartfish/passwordfile
log_dest file C:/Users/Lusinous/mosquitto-smartfish/mosquitto.log
```

> `password_file` harus dapat dibaca oleh proses Mosquitto. Konfigurasi listener terikat khusus ke `10.4.24.135`, bukan semua interface. Rule firewall di bawah membatasi koneksi masuk ke `LocalSubnet`. Jangan membuat port forwarding pada router.

## Firewall

Penambahan Windows Firewall rule memerlukan PowerShell Administrator. Sesi Codex saat pemeriksaan bukan Administrator dan tidak dapat membaca firewall policy. Tidak ada rule yang dibuat. Setelah memastikan tidak ada rule duplikat yang sudah sesuai, jalankan perintah berikut dari PowerShell yang Anda buka sendiri dengan **Run as administrator**:

```powershell
New-NetFirewallRule `
  -DisplayName 'Mosquitto SmartFish MQTT 1884' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 1884 `
  -RemoteAddress LocalSubnet -Profile Any
```

Periksa rule setelahnya:

```powershell
Get-NetFirewallRule -DisplayName 'Mosquitto SmartFish MQTT 1884' |
  Format-List DisplayName,Enabled,Direction,Action,Profile
Get-NetFirewallRule -DisplayName 'Mosquitto SmartFish MQTT 1884' |
  Get-NetFirewallPortFilter
Get-NetFirewallRule -DisplayName 'Mosquitto SmartFish MQTT 1884' |
  Get-NetFirewallAddressFilter
```

`LocalSubnet` membatasi sumber ke subnet lokal Windows; binding ke IP Wi-Fi membatasi interface tujuan. Jangan ubah service Mosquitto existing untuk membuka port ini.

## Jalankan broker kedua

Sesudah folder, password file, dan konfigurasi dibuat, jalankan di PowerShell biasa. Perintah ini membuat proses terpisah dan tidak menghentikan service `mosquitto`:

```powershell
$mosq = 'C:\Program Files\mosquitto'
$conf = Join-Path $env:USERPROFILE 'mosquitto-smartfish\mosquitto.conf'
$broker = Start-Process -FilePath (Join-Path $mosq 'mosquitto.exe') `
  -ArgumentList @('-c', $conf) -PassThru -WindowStyle Hidden
$broker.Id
```

> Simpan PID yang dicetak agar yang dihentikan nanti hanya broker kedua ini. Jangan memakai `Stop-Service mosquitto` atau menghentikan semua proses Mosquitto.

Periksa proses, listener, dan log:

```powershell
Get-Process -Id <PID>
Get-NetTCPConnection -LocalAddress 10.4.24.135 -LocalPort 1884 -State Listen
Get-Content (Join-Path $env:USERPROFILE 'mosquitto-smartfish\mosquitto.log') -Tail 30
Get-Service mosquitto
```

Untuk menghentikan hanya broker kedua:

```powershell
Stop-Process -Id <PID>
Get-Service mosquitto
```

Service existing harus tetap `Running`.

## Uji publisher dan subscriber berautentikasi

Gunakan topic sementara `smartfishfeeder/test` dan payload `ok`. Jangan mencantumkan password literal di command history, log, atau file dokumentasi. `mosquitto_pub` dan `mosquitto_sub` menerima password melalui opsi `-P`; karena itu masukkan nilai dari secure prompt PowerShell ke variabel hanya untuk uji, jangan mencetak variabel tersebut, lalu hapus variabelnya setelah proses selesai. Jalankan subscriber terlebih dahulu pada satu terminal:

```powershell
$secure = Read-Host 'Password MQTT (input tersembunyi)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  & 'C:\Program Files\mosquitto\mosquitto_sub.exe' -h 10.4.24.135 -p 1884 `
    -u smartfish -P $plain -t smartfish/test -C 1 -W 30
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  Remove-Variable plain,secure -ErrorAction SilentlyContinue
}
```

Di terminal kedua, ulangi secure prompt di atas dan gunakan publisher berikut. Password tidak ditulis sebagai literal di command line/history; hindari transcript PowerShell selama uji.

```powershell
$secure = Read-Host 'Password MQTT (input tersembunyi)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  & 'C:\Program Files\mosquitto\mosquitto_pub.exe' -h 10.4.24.135 -p 1884 `
    -u smartfish -P $plain -t smartfish/test -m ok
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  Remove-Variable plain,secure -ErrorAction SilentlyContinue
}
```

Subscriber harus menampilkan `ok` dan exit code sukses; publisher juga harus selesai dengan exit code `0`. Opsi `-P` tetap membuat password tersedia sesaat sebagai argumen proses untuk executable Mosquitto, jadi tutup aplikasi monitoring proses dan jangan jalankan pencatatan/transcript selama tes.

## Langkah selanjutnya untuk ESP32

Setelah broker hidup, catat IP Wi-Fi komputer, port `1884`, username `smartfish`, password yang Anda buat, dan status TLS (konfigurasi ini belum mengaktifkan TLS). Pastikan ESP32 berada pada jaringan lokal yang sama dan router tidak melakukan port forwarding. Kirim kredensial Wi-Fi dan detail broker melalui cara aman untuk tahap implementasi firmware. Target board tetap ESP32 Dev Module; firmware tidak diubah oleh setup broker ini.
