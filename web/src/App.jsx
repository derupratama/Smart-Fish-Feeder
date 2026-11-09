import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, supabaseConfigured } from './lib/supabase.js';
import Schedules from './Schedules.jsx';

const SENSOR_DEFS = [
  { key: 'suhu_air_c', label: 'Suhu air', unit: '°C', icon: 'water', color: '#168a8a', tint: '#e5f5f1', decimals: 1 },
  { key: 'suhu_wadah_c', label: 'Suhu wadah', unit: '°C', icon: 'thermo', color: '#d17b4c', tint: '#fff0e6', decimals: 1 },
  { key: 'kelembapan_percent', label: 'Kelembapan', unit: '%', icon: 'humidity', color: '#6577d8', tint: '#eef0ff', decimals: 1 },
  { key: 'jarak_pakan_cm', label: 'Jarak pakan', unit: 'cm', icon: 'feed', color: '#9b7a43', tint: '#f7f0df', decimals: 1 },
  { key: 'jarak_air_cm', label: 'Jarak air', unit: 'cm', icon: 'ruler', color: '#3d99a7', tint: '#e8f5f6', decimals: 1 },
];

const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

function BrandMark({ compact = false }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none">
          <rect width="40" height="40" rx="14" fill="#0C5957" />
          <path d="M8 21.5c4.6-6.1 11.8-8.8 20.5-6.4-2.3 1.6-3.6 3.6-4 6.1 1.8 1.4 3.1 3.1 3.8 5.2-8.6 2.7-15.8.1-20.3-4.9Z" fill="#BCE9D8" />
          <path d="m27.1 15.5 5.4-3v6.2l-5.4 2.5" fill="#6CB9A5" />
          <circle cx="15.2" cy="19.2" r="1.1" fill="#0C5957" />
          <path d="M9 30.5c2.9-1.6 5.8-1.6 8.7 0m4-1.8c2-1.1 4-1.1 6 0" stroke="#6CB9A5" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && <span className="brand__name">smart<span>pond</span></span>}
    </div>
  );
}

function SensorIcon({ name }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const shapes = {
    water: <><path d="M12 3.5S6.5 10 6.5 14.5a5.5 5.5 0 0 0 11 0C17.5 10 12 3.5 12 3.5Z" /><path d="M9 15.5a2.7 2.7 0 0 0 2.7 2.7" /></>,
    thermo: <><path d="M10 14.5V6a3 3 0 0 1 6 0v8.5a5 5 0 1 1-6 0Z" /><path d="M13 10v8" /></>,
    humidity: <><path d="M12 3.5S5.5 11 5.5 15.5a6.5 6.5 0 0 0 13 0C18.5 11 12 3.5 12 3.5Z" /><path d="M9 16.2a3 3 0 0 0 3 3" /></>,
    feed: <><path d="M5 8.5h14l-1.2 11H6.2L5 8.5Z" /><path d="M8 8.5c.5-2.4 1.8-3.5 4-3.5s3.5 1.1 4 3.5M9 13h6" /></>,
    ruler: <><path d="M4 17.5 17.5 4l3 3L7 20.5l-3-3Z" /><path d="m13.5 8 2.5 2.5M10.5 11l1.5 1.5M7.5 14l2 2" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>{shapes[name] ?? shapes.water}</svg>;
}

function formatValue(value, decimals = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(Number(value));
}

function relativeTime(value) {
  if (!value) return 'Belum ada pembacaan';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (!Number.isFinite(elapsed)) return 'Waktu tidak tersedia';
  if (elapsed < 60_000) return 'Baru saja';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} menit lalu`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} jam lalu`;
  return `${Math.floor(elapsed / 86_400_000)} hari lalu`;
}

function deviceStatus(status) {
  const states = {
    online: { label: 'Online', className: 'is-online' },
    offline: { label: 'Offline', className: 'is-offline' },
    disabled: { label: 'Nonaktif', className: 'is-muted' },
    unknown: { label: 'Belum diketahui', className: 'is-unknown' },
  };
  return states[status] ?? states.unknown;
}

function Sparkline({ rows, color, label }) {
  const values = [...rows].reverse().map((row) => Number(row.value)).filter(Number.isFinite);
  if (values.length < 2) {
    return (
      <div className="chart-empty" role="img" aria-label={`Grafik ${label}, belum cukup data`}>
        <span className="chart-empty__line" />
        <span>Grafik akan terbentuk setelah ada beberapa pembacaan</span>
      </div>
    );
  }

  const width = 560;
  const height = 132;
  const pad = 8;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(Math.abs(max) * 0.04, 1);
  const coords = values.map((value, index) => ({
    x: pad + (index / (values.length - 1)) * (width - pad * 2),
    y: height - pad - ((value - min) / range) * (height - pad * 2),
  }));
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${coords.at(-1).x.toFixed(1)} ${height} L ${coords[0].x.toFixed(1)} ${height} Z`;
  const gradientId = `gradient-${label.replaceAll(/[^a-z0-9]/gi, '-')}`;

  return (
    <div className="chart-wrap">
      <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Grafik riwayat ${label}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.55, 0.85].map((ratio) => <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} className="chart-grid" />)}
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={coords.at(-1).x} cy={coords.at(-1).y} r="4" fill={color} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-axis"><span>Lebih lama</span><span>Terbaru</span></div>
    </div>
  );
}

function SensorCard({ sensor, rows }) {
  const latest = rows[0];
  return (
    <article className="sensor-card" style={{ '--sensor-color': sensor.color, '--sensor-tint': sensor.tint }}>
      <div className="sensor-card__top">
        <div className="sensor-card__label-group">
          <span className="sensor-icon"><SensorIcon name={sensor.icon} /></span>
          <div><h3>{sensor.label}</h3><span className="sensor-key">{sensor.key}</span></div>
        </div>
        <span className="sensor-live"><i />{latest ? 'Terkini' : 'Menunggu data'}</span>
      </div>
      <div className="sensor-reading">
        <strong>{latest ? formatValue(latest.value, sensor.decimals) : '—'}</strong>
        <span>{sensor.unit}</span>
      </div>
      <div className="sensor-card__meta">
        <span>{latest ? relativeTime(latest.measured_at) : 'Belum ada pembacaan'}</span>
        <span>{rows.length ? `${rows.length} titik riwayat` : 'Riwayat kosong'}</span>
      </div>
      <Sparkline rows={rows} color={sensor.color} label={sensor.label} />
    </article>
  );
}

function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (signInError) {
      setError('Email atau kata sandi tidak cocok. Periksa kembali lalu coba lagi.');
      return;
    }
    onSignedIn(data.session);
  }

  return (
    <main className="login-shell">
      <section className="login-visual">
        <div className="login-visual__texture" />
        <div className="login-visual__content">
          <BrandMark />
          <div className="login-copy">
            <span className="eyebrow eyebrow--light"><span className="eyebrow-dot" />MONITORING YANG LEBIH TENANG</span>
            <h1>Air sehat,<br /><em>ikan bahagia.</em></h1>
            <p>Pantau kondisi kolam dan wadah pakan dari satu tempat, kapan pun Anda membutuhkannya.</p>
          </div>
          <div className="pond-art" aria-hidden="true">
            <div className="pond-art__sun" />
            <div className="pond-art__ripple ripple-one" />
            <div className="pond-art__ripple ripple-two" />
            <div className="pond-art__fish fish-one"><span /></div>
            <div className="pond-art__fish fish-two"><span /></div>
            <div className="pond-art__plant plant-one"><i /><i /><i /></div>
            <div className="pond-art__plant plant-two"><i /><i /><i /><i /></div>
          </div>
          <div className="login-visual__footer"><span>SMART FISH FEEDER</span><span>01 — MONITORING</span></div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-panel__mobile-brand"><BrandMark /></div>
        <div className="login-form-wrap">
          <div className="login-heading">
            <span className="eyebrow">SELAMAT DATANG KEMBALI</span>
            <h2>Masuk ke akun Anda</h2>
            <p>Gunakan email dan kata sandi akun pemilik Smart Fish Feeder.</p>
          </div>
          <form className="login-form" onSubmit={submit}>
            <label htmlFor="email">Alamat email</label>
            <div className="input-wrap">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="m4.5 7 7.5 6 7.5-6" /></svg>
              <input id="email" type="email" autoComplete="email" placeholder="nama@email.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div className="password-label"><label htmlFor="password">Kata sandi</label></div>
            <div className="input-wrap">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10" width="15" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2" /></svg>
              <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Masukkan kata sandi" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <button className="reveal-button" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}>
                {showPassword ? 'Sembunyikan' : 'Lihat'}
              </button>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button login-submit" type="submit" disabled={busy}>
              {busy ? <><span className="spinner" />Memeriksa akun…</> : <>Masuk ke dashboard <span aria-hidden="true">↗</span></>}
            </button>
          </form>
          <div className="login-security"><span className="security-lock">⌑</span><span>Akses terlindungi oleh Supabase Auth dan RLS.</span></div>
        </div>
        <div className="login-panel__foot">Dibuat untuk menjaga yang hidup tetap bertumbuh.</div>
      </section>
    </main>
  );
}

function EmptyDashboard({ deviceError, onRetry }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><BrandMark compact /></span>
      <h2>{deviceError ? 'Data perangkat belum dapat dimuat' : 'Belum ada perangkat terhubung'}</h2>
      <p>{deviceError || 'Perangkat yang terdaftar untuk akun ini akan muncul di sini setelah tersedia.'}</p>
      {deviceError && <button className="secondary-button" onClick={onRetry}>Coba lagi</button>}
    </div>
  );
}

function Dashboard({ session, onSignOut }) {
  const [activeView, setActiveView] = useState('monitoring');
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [readings, setReadings] = useState({});
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [loadingReadings, setLoadingReadings] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const [readingError, setReadingError] = useState('');
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState('connecting');
  const activeDeviceId = useRef('');

  const selectedDevice = useMemo(() => devices.find((device) => device.id === deviceId) ?? null, [devices, deviceId]);

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    setDeviceError('');
    const { data, error } = await supabase
      .from('sf_devices')
      .select('id, name, device_uid, status, last_seen_at, created_at')
      .order('created_at', { ascending: false });
    setLoadingDevices(false);
    if (error) {
      setDeviceError('Tidak dapat membaca perangkat dari Supabase. Pastikan akun ini memiliki akses melalui RLS.');
      return;
    }
    const nextDevices = data ?? [];
    setDevices(nextDevices);
    setDeviceId((current) => nextDevices.some((device) => device.id === current) ? current : nextDevices[0]?.id ?? '');
  }, []);

  const loadReadings = useCallback(async (id) => {
    if (!id) {
      setReadings({});
      return;
    }
    setLoadingReadings(true);
    setReadingError('');
    const results = await Promise.all(SENSOR_DEFS.map((sensor) =>
      supabase
        .from('sf_sensor_readings')
        .select('id, value, unit, measured_at, received_at')
        .eq('device_id', id)
        .eq('sensor_type', sensor.key)
        .order('measured_at', { ascending: false })
        .limit(72),
    ));
    setLoadingReadings(false);
    const failed = results.find((result) => result.error);
    if (failed) {
      setReadingError('Riwayat sensor tidak dapat dimuat. Data tetap dibatasi oleh RLS akun Anda.');
      return;
    }
    setReadings((current) => Object.fromEntries(SENSOR_DEFS.map((sensor, index) => {
      const incoming = results[index].data ?? [];
      const merged = new Map([...(current[sensor.key] ?? []), ...incoming].map((row) => [row.id, row]));
      return [sensor.key, [...merged.values()].sort((a, b) => new Date(b.measured_at) - new Date(a.measured_at)).slice(0, 72)];
    })));
    setRefreshedAt(new Date());
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadDevices();
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadDevices]);
  useEffect(() => {
    activeDeviceId.current = deviceId;
    setReadings({});
    if (!deviceId) {
      setRealtimeStatus('disconnected');
      return undefined;
    }

    let channel;
    let pollTimer;
    let retryTimer;
    let disposed = false;
    let isSubscribed = false;
    const stopPolling = () => {
      if (pollTimer) window.clearInterval(pollTimer);
      pollTimer = undefined;
    };
    const startPolling = () => {
      if (pollTimer || disposed) return;
      pollTimer = window.setInterval(() => {
        if (!disposed && document.visibilityState === 'visible') loadReadings(deviceId);
      }, 12_000);
    };
    const connect = () => {
      if (disposed) return;
      setRealtimeStatus('connecting');
      channel = supabase
        .channel(`sf-sensor-readings:${deviceId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'sf_sensor_readings',
          filter: `device_id=eq.${deviceId}`,
        }, ({ new: row }) => {
          if (disposed || activeDeviceId.current !== deviceId || !row?.id) return;
          setReadings((current) => {
            const sensorRows = current[row.sensor_type];
            if (!sensorRows) return current;
            const merged = new Map([...sensorRows, row].map((reading) => [reading.id, reading]));
            return {
              ...current,
              [row.sensor_type]: [...merged.values()]
                .sort((a, b) => new Date(b.measured_at) - new Date(a.measured_at))
                .slice(0, 72),
            };
          });
          setRefreshedAt(new Date());
        })
        .subscribe((status) => {
          if (disposed) return;
          if (status === 'SUBSCRIBED') {
            isSubscribed = true;
            setRealtimeStatus('connected');
            stopPolling();
            if (retryTimer) window.clearTimeout(retryTimer);
            return;
          }
          isSubscribed = false;
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setRealtimeStatus('disconnected');
            startPolling();
            if (!retryTimer) {
              retryTimer = window.setTimeout(() => {
                retryTimer = undefined;
                if (disposed || isSubscribed) return;
                const previous = channel;
                channel = undefined;
                if (previous) supabase.removeChannel(previous).finally(connect);
                else connect();
              }, 10_000);
            }
          }
        });
    };

    connect();
    loadReadings(deviceId);
    return () => {
      disposed = true;
      stopPolling();
      if (retryTimer) window.clearTimeout(retryTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [deviceId, loadReadings]);

  const anyReadings = SENSOR_DEFS.some((sensor) => (readings[sensor.key] ?? []).length > 0);
  const totalPoints = SENSOR_DEFS.reduce((sum, sensor) => sum + (readings[sensor.key]?.length ?? 0), 0);
  const status = deviceStatus(selectedDevice?.status);

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <BrandMark />
        <div className="sidebar__section-label">RUANG KERJA</div>
        <nav aria-label="Navigasi utama">
          <button className={`nav-item ${activeView === 'monitoring' ? 'nav-item--active' : ''}`} onClick={() => setActiveView('monitoring')} aria-current={activeView === 'monitoring' ? 'page' : undefined}><span className="nav-item__icon">◫</span>Monitoring</button>
          <button className={`nav-item ${activeView === 'schedules' ? 'nav-item--active' : ''}`} onClick={() => setActiveView('schedules')} aria-current={activeView === 'schedules' ? 'page' : undefined}><span className="nav-item__icon">◷</span>Jadwal Pakan</button>
        </nav>
        <div className="sidebar__bottom">
          <div className="connection-card"><span className="connection-card__icon">⌁</span><div><strong>Supabase</strong><span>Terhubung aman</span></div><i /></div>
          <div className="profile-row"><span className="avatar">{(session.user.email ?? 'S').slice(0, 1).toUpperCase()}</span><div className="profile-row__text"><strong>Pemilik</strong><span title={session.user.email}>{session.user.email}</span></div><button className="icon-button signout-button" onClick={onSignOut} aria-label="Keluar" title="Keluar"><svg viewBox="0 0 24 24"><path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10m5-12 4 4-4 4m4-4H9" /></svg></button></div>
        </div>
      </aside>

      <main className="main-content" id="monitoring">
        <header className="topbar">
          <div className="breadcrumb"><span>Ruang kerja</span><b>/</b><strong>{activeView === 'monitoring' ? 'Monitoring' : 'Jadwal Pakan'}</strong></div>
          <div className="topbar__right"><span className="secure-indicator"><i />Koneksi aman</span><span className="topbar__date">{new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span></div>
        </header>

        <div className="page-content">
          {activeView === 'schedules' ? <Schedules device={selectedDevice} devices={devices} onDeviceChange={setDeviceId} session={session} /> : <>
          <section className="page-heading">
            <div><span className="eyebrow">PUSAT PEMANTAUAN</span><h1>Monitoring <span>kolam.</span></h1><p>Semua kondisi penting, terlihat dalam satu pandangan.</p></div>
            <button className="refresh-button" onClick={() => { loadDevices(); if (deviceId) loadReadings(deviceId); }} disabled={loadingDevices || loadingReadings}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 9a6.5 6.5 0 0 1 10.8-2L20 12M4 12l3.1 5a6.5 6.5 0 0 0 10.8-2" /></svg>
              <span>{loadingReadings ? 'Memperbarui' : 'Perbarui data'}</span>
            </button>
          </section>

          {loadingDevices ? (
            <div className="loading-state"><span className="spinner spinner--dark" />Memuat perangkat…</div>
          ) : devices.length === 0 ? (
            <EmptyDashboard deviceError={deviceError} onRetry={loadDevices} />
          ) : (
            <>
              <section className="device-banner">
                <div className="device-banner__identity">
                  <span className="device-avatar"><BrandMark compact /></span>
                  <div><span className="eyebrow">PERANGKAT AKTIF</span><div className="device-title-line">
                    {devices.length > 1 ? <select aria-label="Pilih perangkat" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select> : <h2>{selectedDevice?.name ?? 'Smart Fish Feeder'}</h2>}
                    <span className={`status-pill ${status.className}`}><i />{status.label}</span>
                  </div><span className="device-uid">UID · {selectedDevice?.device_uid}</span></div>
                </div>
                <div className="device-banner__meta"><div><span className="meta-label">Terakhir aktif</span><strong>{selectedDevice?.last_seen_at ? relativeTime(selectedDevice.last_seen_at) : 'Belum ada heartbeat'}</strong></div><div><span className="meta-label">Sensor terpantau</span><strong>{SENSOR_DEFS.filter((sensor) => (readings[sensor.key] ?? []).length > 0).length}<small> / 5</small></strong></div><div><span className="meta-label">Catatan riwayat</span><strong>{totalPoints}<small> titik</small></strong></div></div>
              </section>

              <section className="section-heading"><div><span className="eyebrow">KONDISI SAAT INI</span><h2>Ringkasan sensor</h2></div><span className={`realtime-status realtime-status--${realtimeStatus}`}><i />Realtime: {realtimeStatus === 'connected' ? 'Connected' : realtimeStatus === 'connecting' ? 'Connecting' : 'Disconnected'}{realtimeStatus === 'disconnected' ? ' · polling cadangan 12 detik' : ''}</span></section>

              {deviceError && <div className="inline-alert" role="alert">{deviceError}</div>}
              {readingError && <div className="inline-alert" role="alert">{readingError}</div>}

              <section className="sensor-grid" aria-label="Pembacaan dan grafik lima sensor">
                {SENSOR_DEFS.map((sensor) => <SensorCard key={sensor.key} sensor={sensor} rows={readings[sensor.key] ?? []} />)}
              </section>

              {!anyReadings && !loadingReadings && <div className="no-readings"><span>◌</span><div><strong>Belum ada pembacaan sensor</strong><p>Data terbaru akan muncul di sini saat perangkat mengirim telemetry.</p></div></div>}

              <footer className="page-footer"><span><BrandMark compact />Data dibaca langsung dari Supabase dengan akses akun pemilik.</span><span>{refreshedAt ? `Sinkron terakhir ${dateFormat.format(refreshedAt)}` : 'Menunggu sinkronisasi'}</span></footer>
            </>
          )}
          </>}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(supabaseConfigured);

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    }).catch(() => setAuthLoading(false));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  if (!supabaseConfigured) {
    return <main className="config-error"><BrandMark /><h1>Konfigurasi Supabase belum lengkap</h1><p>Isi <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> pada <code>web/.env.local</code>, lalu jalankan ulang aplikasi.</p></main>;
  }
  if (authLoading) return <main className="auth-loading"><span className="spinner spinner--dark" /><span>Menyiapkan sesi aman…</span></main>;
  return session ? <Dashboard session={session} onSignOut={signOut} /> : <LoginScreen onSignedIn={setSession} />;
}
