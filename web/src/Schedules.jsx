import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase.js';

const DAYS = [
  { value: 1, short: 'Sen', label: 'Senin' },
  { value: 2, short: 'Sel', label: 'Selasa' },
  { value: 3, short: 'Rab', label: 'Rabu' },
  { value: 4, short: 'Kam', label: 'Kamis' },
  { value: 5, short: 'Jum', label: 'Jumat' },
  { value: 6, short: 'Sab', label: 'Sabtu' },
  { value: 7, short: 'Min', label: 'Minggu' },
];

const TIME_ZONE = 'Asia/Jakarta';
const WEBHOOK_URL = import.meta.env.VITE_N8N_SCHEDULE_WEBHOOK_URL;
const DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const NEXT_DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'short',
});

function blankForm() {
  return { name: '', schedule_time: '07:00', active_days: [1, 2, 3, 4, 5, 6, 7], is_active: true, servo_duration_ms: '1000' };
}

function timeLabel(value) {
  return String(value ?? '').slice(0, 5);
}

function daysLabel(values) {
  const active = DAYS.filter((day) => (values ?? []).includes(day.value));
  if (active.length === 7) return 'Setiap hari';
  if (active.length === 0) return 'Tidak ada hari';
  return active.map((day) => day.label).join(', ');
}

function getNextSchedule(schedules) {
  const now = new Date();
  const parts = Object.fromEntries(DATE_PARTS.formatToParts(now).map(({ type, value }) => [type, value]));
  const weekdayNumber = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const candidates = [];

  for (const schedule of schedules) {
    if (!schedule.is_active) continue;
    const [hour, minute] = timeLabel(schedule.schedule_time).split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
    for (const day of schedule.active_days ?? []) {
      let dayOffset = (Number(day) - weekdayNumber + 7) % 7;
      if (dayOffset === 0 && hour * 60 + minute <= currentMinutes) dayOffset = 7;
      candidates.push({ schedule, dayOffset, minuteOfDay: hour * 60 + minute });
    }
  }

  candidates.sort((a, b) => a.dayOffset - b.dayOffset || a.minuteOfDay - b.minuteOfDay);
  if (!candidates.length) return null;
  const next = candidates[0];
  const date = new Date(now.getTime() + next.dayOffset * 86_400_000);
  return { ...next, dateLabel: NEXT_DATE_FORMAT.format(date) };
}

function syncLabel(sync) {
  if (!sync || sync.status === 'pending' || sync.central_schedule_version !== sync.device_schedule_version) {
    return { title: 'Pending Sync', detail: 'Jadwal tersimpan; menunggu konfirmasi dari ESP32.', className: 'is-pending' };
  }
  if (sync.status === 'synced') return { title: 'Tersinkron', detail: sync.last_synced_at ? `Terakhir sinkron ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE }).format(new Date(sync.last_synced_at))}` : 'Versi perangkat cocok.', className: 'is-synced' };
  if (sync.status === 'error') return { title: 'Sinkronisasi gagal', detail: sync.error_message || 'Periksa koneksi perangkat.', className: 'is-error' };
  return { title: 'Belum sinkron', detail: 'Jadwal perangkat berbeda dengan jadwal website.', className: 'is-pending' };
}

export default function Schedules({ device, devices, onDeviceChange, session }) {
  const [schedules, setSchedules] = useState([]);
  const [sync, setSync] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm);

  const load = useCallback(async () => {
    if (!device?.id) {
      setSchedules([]);
      setSync(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [scheduleResult, syncResult] = await Promise.all([
      supabase.from('sf_feeding_schedules')
        .select('id, name, device_id, schedule_time, timezone, active_days, is_active, servo_duration_ms, schedule_version, updated_at')
        .eq('device_id', device.id)
        .order('schedule_time', { ascending: true }),
      supabase.from('sf_device_sync')
        .select('central_schedule_version, device_schedule_version, status, last_synced_at, error_message')
        .eq('device_id', device.id)
        .maybeSingle(),
    ]);
    setLoading(false);
    if (scheduleResult.error) {
      setError('Jadwal tidak dapat dibaca. Periksa akses akun melalui RLS.');
      return;
    }
    if (syncResult.error) {
      setError('Status sinkronisasi tidak dapat dibaca.');
      return;
    }
    setError('');
    setSchedules(scheduleResult.data ?? []);
    setSync(syncResult.data ?? null);
  }, [device?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!device?.id) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [device?.id, load]);

  const nextSchedule = useMemo(() => getNextSchedule(schedules), [schedules]);
  const activeCount = schedules.filter((schedule) => schedule.is_active).length;
  const inactiveCount = schedules.length - activeCount;
  const pendingCount = sync?.status === 'synced' && sync.central_schedule_version === sync.device_schedule_version ? 0 : schedules.length;
  const currentSync = syncLabel(sync);

  function openCreate() {
    setEditing(null);
    setForm(blankForm());
    setNotice('');
    setFormOpen(true);
  }

  function openEdit(schedule) {
    setEditing(schedule);
    setForm({
      name: schedule.name,
      schedule_time: timeLabel(schedule.schedule_time),
      active_days: schedule.active_days ?? [],
      is_active: schedule.is_active,
      servo_duration_ms: String(schedule.servo_duration_ms ?? ''),
    });
    setNotice('');
    setFormOpen(true);
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleDay(day) {
    setForm((current) => ({
      ...current,
      active_days: current.active_days.includes(day)
        ? current.active_days.filter((value) => value !== day)
        : [...current.active_days, day].sort((a, b) => a - b),
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const duration = Number(form.servo_duration_ms);
    if (!form.name.trim() || form.name.trim().length > 80) return setError('Masukkan nama jadwal (maksimal 80 karakter).');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.schedule_time)) return setError('Pilih jam dan menit yang valid.');
    if (!form.active_days.length || form.active_days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) return setError('Pilih minimal satu hari pelaksanaan.');
    if (!Number.isInteger(duration) || duration < 1 || duration > 60_000) return setError('Durasi servo harus berupa bilangan bulat antara 1–60.000 ms.');
    if (!WEBHOOK_URL) return setError('Endpoint pengelolaan jadwal n8n belum dikonfigurasi. Data belum disimpan.');

    setSaving(true);
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: editing ? 'update' : 'create',
          device_id: device.id,
          schedule_id: editing?.id,
          name: form.name.trim(),
          schedule_time: `${form.schedule_time}:00`,
          timezone: TIME_ZONE,
          active_days: [...form.active_days].sort((a, b) => a - b),
          is_active: Boolean(form.is_active),
          servo_duration_ms: duration,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) throw new Error(result.message || `Permintaan gagal (${response.status}).`);
      setFormOpen(false);
      setNotice('Jadwal tersimpan. Status sinkron akan menunggu acknowledgment ESP32.');
      await load();
    } catch (saveError) {
      setError(saveError.message || 'Jadwal tidak berhasil disimpan.');
    } finally {
      setSaving(false);
    }
  }

  async function mutate(action, schedule, isActive = schedule?.is_active) {
    setError('');
    setNotice('');
    if (!WEBHOOK_URL) return setError('Endpoint pengelolaan jadwal n8n belum dikonfigurasi. Data belum diubah.');
    if (action === 'delete' && !window.confirm(`Hapus jadwal “${schedule.name}”?`)) return;
    setSaving(true);
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action,
          device_id: device.id,
          schedule_id: schedule.id,
          name: schedule.name,
          schedule_time: schedule.schedule_time,
          timezone: schedule.timezone || TIME_ZONE,
          active_days: schedule.active_days,
          is_active: Boolean(isActive),
          servo_duration_ms: schedule.servo_duration_ms,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) throw new Error(result.message || `Permintaan gagal (${response.status}).`);
      setNotice(action === 'delete' ? 'Jadwal dihapus.' : `Jadwal ${isActive ? 'diaktifkan' : 'dinonaktifkan'}. Sinkronisasi menunggu acknowledgment ESP32.`);
      await load();
    } catch (mutationError) {
      setError(mutationError.message || 'Perubahan jadwal tidak berhasil.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="schedules-page" aria-labelledby="schedules-title">
      <div className="schedules-heading">
        <div><span className="eyebrow">OTOMATISASI PERANGKAT</span><h1 id="schedules-title">Jadwal <span>pakan.</span></h1><p>Atur waktu pemberian pakan perangkat dalam zona waktu Asia/Jakarta.</p></div>
        <div className="schedules-heading__actions">
          {devices.length > 1 && <label className="schedule-device-picker">Perangkat<select value={device?.id ?? ''} onChange={(event) => onDeviceChange(event.target.value)}>{devices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <button className="primary-button schedules-add" onClick={openCreate} disabled={!device?.id || saving}><span aria-hidden="true">＋</span>Tambah jadwal</button>
        </div>
      </div>

      {!WEBHOOK_URL && <div className="inline-alert" role="status">Endpoint n8n belum dipasang. Daftar jadwal tetap dapat dibaca, tetapi perubahan tidak akan dikirim atau disimpan.</div>}
      {error && <div className="inline-alert" role="alert">{error}</div>}
      {notice && <div className="schedule-notice" role="status">{notice}</div>}

      <div className="schedule-overview">
        <article className="schedule-stat"><span className="schedule-stat__icon">◷</span><div><span>Jadwal aktif</span><strong>{activeCount}</strong></div></article>
        <article className="schedule-stat"><span className="schedule-stat__icon schedule-stat__icon--muted">◷</span><div><span>Jadwal nonaktif</span><strong>{inactiveCount}</strong></div></article>
        <article className="schedule-stat"><span className="schedule-stat__icon schedule-stat__icon--pending">↻</span><div><span>Menunggu sinkron</span><strong>{pendingCount}</strong></div></article>
      </div>

      <div className="schedule-highlight-grid">
        <article className="next-schedule-card"><span className="eyebrow eyebrow--light">PEMBERIAN BERIKUTNYA</span>
          {nextSchedule ? <><strong>{timeLabel(nextSchedule.schedule.schedule_time)}</strong><span>{nextSchedule.dateLabel} · {nextSchedule.schedule.name}</span></> : <><strong>—</strong><span>Tidak ada jadwal aktif.</span></>}
        </article>
        <article className={`sync-card ${currentSync.className}`}><div className="sync-card__top"><span className="eyebrow">STATUS PERANGKAT</span><span className="sync-badge"><i />{currentSync.title}</span></div><p>{currentSync.detail}</p><small>Jadwal tersimpan di Supabase; ESP32 menjalankan jadwal lokal terakhir sampai mengonfirmasi versi baru.</small></article>
      </div>

      <div className="schedule-list-heading"><div><span className="eyebrow">KONFIGURASI PERANGKAT</span><h2>Semua jadwal</h2></div><button className="secondary-button schedule-refresh" onClick={load} disabled={loading}>Muat ulang</button></div>
      <div className="schedule-list" aria-live="polite">
        {loading ? <div className="schedule-empty"><span className="spinner spinner--dark" />Memuat jadwal…</div> : schedules.length === 0 ? (
          <div className="schedule-empty"><span className="schedule-empty__icon">◷</span><strong>Belum ada jadwal pakan</strong><p>Tambahkan jadwal untuk mengatur waktu, hari, dan durasi servo.</p><button className="secondary-button" onClick={openCreate}>Buat jadwal pertama</button></div>
        ) : schedules.map((schedule) => (
          <article className={`schedule-row ${schedule.is_active ? '' : 'schedule-row--inactive'}`} key={schedule.id}>
            <div className="schedule-row__time"><strong>{timeLabel(schedule.schedule_time)}</strong><span>{schedule.timezone || TIME_ZONE}</span></div>
            <div className="schedule-row__details"><strong>{schedule.name}</strong><span>{daysLabel(schedule.active_days)} · Servo {schedule.servo_duration_ms ?? '—'} ms</span></div>
            <span className={`schedule-state ${schedule.is_active ? 'is-active' : 'is-inactive'}`}><i />{schedule.is_active ? 'Aktif' : 'Nonaktif'}</span>
            <div className="schedule-row__actions">
              <button className="schedule-action" onClick={() => mutate('toggle', schedule, !schedule.is_active)} disabled={saving} aria-label={schedule.is_active ? `Nonaktifkan ${schedule.name}` : `Aktifkan ${schedule.name}`}>{schedule.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
              <button className="schedule-action" onClick={() => openEdit(schedule)} disabled={saving}>Edit</button>
              <button className="schedule-action schedule-action--delete" onClick={() => mutate('delete', schedule)} disabled={saving}>Hapus</button>
            </div>
          </article>
        ))}
      </div>

      {formOpen && <div className="schedule-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}>
        <section className="schedule-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-form-title">
          <div className="schedule-modal__heading"><div><span className="eyebrow">PENGATURAN OTOMATIS</span><h2 id="schedule-form-title">{editing ? 'Edit jadwal' : 'Jadwal baru'}</h2></div><button className="icon-button" onClick={() => setFormOpen(false)} disabled={saving} aria-label="Tutup">×</button></div>
          <form className="schedule-form" onSubmit={submit}>
            <label htmlFor="schedule-name">Nama jadwal</label><input id="schedule-name" value={form.name} onChange={(event) => updateField('name', event.target.value)} maxLength={80} placeholder="Contoh: Pakan pagi" required />
            <div className="schedule-form__pair"><div><label htmlFor="schedule-time">Jam pemberian</label><input id="schedule-time" type="time" value={form.schedule_time} onChange={(event) => updateField('schedule_time', event.target.value)} required /></div><div><label htmlFor="servo-duration">Durasi servo (ms)</label><input id="servo-duration" type="number" min="1" max="60000" step="1" value={form.servo_duration_ms} onChange={(event) => updateField('servo_duration_ms', event.target.value)} required /></div></div>
            <fieldset className="schedule-days"><legend>Hari pelaksanaan <span>Pilih satu atau beberapa hari</span></legend><div>{DAYS.map((day) => <button key={day.value} type="button" className={form.active_days.includes(day.value) ? 'is-selected' : ''} onClick={() => toggleDay(day.value)} aria-pressed={form.active_days.includes(day.value)}>{day.short}</button>)}</div></fieldset>
            <label className="schedule-active-toggle"><input type="checkbox" checked={form.is_active} onChange={(event) => updateField('is_active', event.target.checked)} /><span><strong>Jadwal aktif</strong><small>Jadwal nonaktif tidak dikirim untuk dijalankan.</small></span></label>
            <p className="schedule-timezone-note">Waktu disimpan dengan zona <strong>Asia/Jakarta</strong>.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="schedule-form__actions"><button type="button" className="secondary-button" onClick={() => setFormOpen(false)} disabled={saving}>Batal</button><button type="submit" className="primary-button" disabled={saving || !WEBHOOK_URL}>{saving ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Simpan jadwal'}</button></div>
          </form>
        </section>
      </div>}
    </section>
  );
}
