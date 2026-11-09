# Smart Fish Feeder Dashboard

Frontend monitoring untuk Supabase project `afvbkajcyfiwmwrufceq`.

## Menjalankan lokal

1. Salin `.env.example` menjadi `.env.local`.
2. Isi `VITE_SUPABASE_PUBLISHABLE_KEY` dengan publishable key project dari Supabase Dashboard.
3. Jalankan `npm install`, lalu `npm run dev`.

Aplikasi menggunakan Supabase Auth password login dan hanya menjalankan query `SELECT`. Pastikan kebijakan RLS di Supabase tetap aktif. Publishable key memang digunakan di browser; jangan menaruh `service_role` key di environment frontend.

Untuk deployment Vercel di masa mendatang, pilih `web` sebagai Root Directory dan isi kedua environment variable tersebut di pengaturan Vercel. Project ini belum dideploy.
