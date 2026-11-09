# Arduino CLI dan ESP32 (Windows)

> Status lama di bawah sudah usang. Menurut konfirmasi pemilik proyek, Arduino CLI 1.5.1 dan ESP32 Core 3.3.12 sudah terpasang. Board target: ESP32 Dev Module (`esp32:esp32:esp32`).

Status per 2026-11-03: Arduino CLI belum terpasang. Percobaan mengunduh binary resmi gagal karena terminal tidak dapat tersambung ke `downloads.arduino.cc` (`Unable to connect to the remote server`). Karena itu konfigurasi CLI, indeks, core ESP32, deteksi board, dan compile belum dapat dijalankan.

## Instalasi resmi

Arduino menyediakan unduhan Windows 64-bit pada [halaman instalasi Arduino CLI](https://arduino.github.io/arduino-cli/latest/installation/). Binary portable dapat diekstrak ke direktori yang berada di `PATH`; alternatifnya gunakan MSI resmi. Instalasi ke lokasi sistem atau perubahan `PATH` sistem mungkin memerlukan hak Administrator. Binary portable pada folder pengguna biasanya tidak memerlukan Administrator.

## Setelah CLI dapat dijalankan

Buka PowerShell/CMD baru, lalu jalankan:

```powershell
arduino-cli version
arduino-cli config init
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32
arduino-cli board listall esp32
arduino-cli core list
```

URL indeks stabil dan prosedur pemasangan core Arduino-ESP32 merujuk dokumentasi resmi [Espressif](https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html).

Untuk menguji compile tanpa mengunggah firmware, gunakan sketch ESP32 proyek dan FQBN board yang sesuai:

```powershell
arduino-cli compile --fqbn esp32:esp32:<board-id> <folder-sketch>
```

Ganti `<board-id>` dengan ID yang tampil di `board listall esp32` dan `<folder-sketch>` dengan folder sketch proyek. Perintah compile tidak mengunggah firmware. Jangan lanjut ke instalasi library sensor sebelum `esp32:esp32` berhasil dipasang.

## Pemeriksaan CLI

```powershell
arduino-cli version
Get-Command arduino-cli
```

Jika perintah tidak ditemukan, buka terminal baru setelah menambahkan lokasi executable ke `PATH`, atau jalankan `arduino-cli.exe` menggunakan path lengkap.
