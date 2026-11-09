# Integrasi n8n dengan Smart Fish Feeder

## Hasil pemeriksaan saat ini

- Struktur proyek tidak berisi Docker Compose, workflow n8n, atau konfigurasi n8n sebelumnya. Firmware dan file rahasia ESP32 tidak diubah.
- `http://localhost:5678/healthz` menjawab HTTP 200, jadi endpoint n8n merespons.
- `docker ps` tidak dapat membaca Docker Engine dari sesi Codex: akses named pipe `docker_engine` ditolak. Karena itu status container dan jaringan Compose tidak dapat diverifikasi langsung.
- GET tanpa autentikasi ke `/api/v1/workflows?limit=1` menghasilkan HTTP 401. Workflow tidak dikirim lewat API dan tidak diaktifkan.
- Port broker yang diberikan adalah `10.4.24.135:1884`. Generator konfigurasi broker proyek mengikat listener ke IP Wi-Fi itu. Koneksi TCP ke alamat tersebut berhasil dari sesi ini; konektivitas dari container n8n belum diuji.
- `host.docker.internal` adalah alamat host yang disediakan Docker Desktop dari dalam container. Karena listener Mosquitto proyek saat ini terikat khusus ke `10.4.24.135`, gunakan alamat yang terikat itu pada MQTT credential. Jangan memakai `localhost` dari container; `localhost` berarti container n8n sendiri.

Docker Desktop mendokumentasikan `host.docker.internal` sebagai nama untuk mencapai host dari container. Listener broker yang terikat ke satu IP mungkin tidak menerima koneksi ke alamat host internal Docker tersebut; perubahan broker tidak dilakukan di sini. Jika koneksi langsung ke `10.4.24.135` gagal dari container, periksa route dan cakupan firewall sebelum memutuskan perubahan listener. [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/networking-how-tos/)

## File workflow

Import `integrations/n8n/SmartFishFeeder_MQTT_Ingest.json` melalui menu **Workflows → Import from File** di `http://localhost:5678`.

Workflow berisi:

1. **MQTT Trigger** berlangganan ke `smartfish/telemetry/+` dan `smartfish/status/+`. Topic perintah servo tidak disubscribe.
2. **Build Current Snapshot** mengubah payload menjadi satu objek JSON kumulatif berisi nilai telemetry/status terakhir yang diketahui, topic/payload sumber, dan timestamp penerimaan.

Data telemetry dinormalisasi menjadi:

- `suhu_air_c` dan `suhu_wadah_c` dalam `degC`;
- `kelembapan_percent` dalam `percent`;
- `jarak_pakan_cm` dan `jarak_air_cm` dalam `cm`.

Timestamp utama (`timestamp`) adalah waktu diterima/diproses n8n dalam UTC, bukan waktu sampling ESP32. Setiap nilai memiliki `updated_at` tersendiri. Objek keluaran bisa diteruskan ke node database atau HTTP Request/dashboard; node penyimpanan belum ditambahkan karena skema database dan endpoint dashboard belum diberikan.

Snapshot terakhir disimpan sebagai workflow static data. n8n hanya menyimpan perubahan static data pada workflow yang dipublish/aktif dan berjalan melalui trigger; manual test tidak menyimpan state antar eksekusi. Dokumentasi n8n juga menyarankan Data Tables bila data perlu dipersistenkan dan diuji sebagai tabel. [Workflow static data](https://docs.n8n.io/code/cookbook/builtin/get-workflow-static-data/)

## Buat MQTT credential di UI n8n

Setelah import:

1. Buka node **MQTT Trigger** dan buat/pilih credential MQTT.
2. Atur protocol `Mqtt`, host `10.4.24.135`, port `1884`, dan username `smartfish`.
3. Masukkan password langsung di kolom credential UI menggunakan sumber konfigurasi lokal Anda. Jangan kirim password di chat atau menyimpannya di workflow JSON/dokumentasi.
4. Biarkan Client ID kosong agar n8n membuat ID sendiri. Gunakan plain MQTT sesuai listener proyek yang tidak mengonfigurasi TLS; jangan menyalakan SSL kecuali broker juga dikonfigurasi TLS.
5. Simpan credential, pilih di node, lalu **Publish** workflow agar listener MQTT berjalan.

n8n menyimpan broker login sebagai credential terpisah dari workflow. [MQTT credentials](https://docs.n8n.io/integrations/builtin/credentials/mqtt/)

## Docker host networking

Pada Docker Desktop untuk Windows, container umumnya dapat mencapai host memakai `host.docker.internal`; konfigurasi Compose khusus tidak diperlukan untuk nama itu. Dalam proyek ini gunakan host IP `10.4.24.135` karena broker terikat ke IP tersebut. Port yang harus diakses dari container adalah TCP `1884`.

Jika Anda memeriksa container dan `host.docker.internal` tidak ter-resolve, contoh fallback pada service Compose n8n adalah:

```yaml
services:
  n8n:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Jangan mengganti atau membuat ulang konfigurasi container yang sudah ada hanya untuk menambahkan ini sebelum memeriksa Compose aktif. Fallback tersebut hanya menambahkan nama host; ia tidak mengubah alamat listener Mosquitto atau firewall.

## Akses API n8n

API tanpa autentikasi menghasilkan HTTP 401. Dokumentasi n8n menyatakan API key dikirim melalui header `X-N8N-API-KEY` dan dibuat pada **Settings → n8n API**. API key tidak dibutuhkan untuk import manual di UI. Jangan kirim API key ke repository atau chat. [n8n API authentication](https://docs.n8n.io/api/authentication/)

## Pemeriksaan setelah konfigurasi

Status workflow saat ini: **belum diimpor, belum memiliki MQTT credential, belum dipublish, dan belum diuji dengan pesan broker**. Setelah memasukkan credential dan publish, periksa satu execution dan pastikan `source.topic`, `timestamp`, `telemetry`, serta `status` muncul. Karena tidak ada akses Docker Engine di sesi Codex ini, hasil tersebut harus diverifikasi di UI n8n Anda.

## Menjalankan ulang

1. Pastikan Docker Desktop dan container n8n aktif. Dari PowerShell Anda, `docker ps` menampilkan container n8n dan `http://localhost:5678/healthz` harus menjawab HTTP 200.
2. Pastikan Mosquitto tetap listen pada `10.4.24.135:1884` dan firewall mengizinkan koneksi lokal dari container.
3. Buka workflow **Smart Fish Feeder - MQTT Ingest** di n8n dan pastikan workflow dipublish/aktif serta MQTT credential masih terpilih.
4. Jika workflow belum ada, import file JSON di atas, pilih credential, lalu publish.
