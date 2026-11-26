// Profiling recorder (GDD 17.1-17.4, 17.6): an independent development service, not a gameplay
// system. It only reads: frame timings, the sim tick, and domain events the game reports
// (evidence, economy, session). It never writes game state or the career save.
//
// Exports (17.4): summary.json, events.jsonl (one JSON object per line) and manifest.json, named
//   cryptozoology_<build>_<gym>_<scenario>_<platform>_<seed>_<run-id>
// Timestamps are monotonic milliseconds from recording start (t_ms) plus the authoritative sim tick;
// wall-clock UTC only in run metadata. Unavailable metrics are explicit (status + null), never faked.

export const SCHEMA_VERSION = '1.0.0';
export const STALL_MS = 100;            // a frame interval at or above this is a stall
export const CONTENT_VERSIONS = { summary: '1.0.0', events: '1.0.0', manifest: '1.0.0' };

/** Sanitize a file-name token: lowercase letters, digits and dashes only. */
export function token(v, fallback = 'na') {
  const s = String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || fallback;
}

/** Nearest-rank percentile of a numeric array (p in 0..100). */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = Float64Array.from(values).sort();
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

export class ProfilingRecorder {
  /**
   * @param {object} o { build, gym, scenario, platform, seed, runId?, preset?,
   *   now = () => performance.now(), utc = () => new Date(), getTick = () => 0,
   *   maxFrames = 36000 (10 min at 60 Hz), maxEvents = 20000 }
   */
  constructor({ build = 'dev', gym = 'none', scenario = 'none', platform = 'desktop', seed = 0, runId = null, preset = 'summary',
    now = () => performance.now(), utc = () => new Date(), getTick = () => 0, maxFrames = 36000, maxEvents = 20000 } = {}) {
    this.meta = { build, gym, scenario, platform, seed, preset };
    this.runId = runId ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    this.now = now; this.utc = utc; this.getTick = getTick;
    this.maxFrames = maxFrames; this.maxEvents = maxEvents;
    this.reset();
  }

  reset() {
    this.recording = false;
    this.startedAt = null; this.startedUtc = null; this.stoppedAt = null;
    this.frames = new Float32Array(this.maxFrames); this.cpu = new Float32Array(this.maxFrames);
    this.frameCount = 0; this.frameWrites = 0; this.cpuSeen = false;
    this.stalls = []; this.events = []; this.droppedEvents = 0; this.nextEventId = 1;
    this.segment = 'active'; this.gaps = 0;
    this.counts = {};
  }

  get elapsedMs() { return this.startedAt == null ? 0 : (this.stoppedAt ?? this.now()) - this.startedAt; }
  tMs() { return round(this.now() - this.startedAt, 3); }

  start() {
    if (this.recording) return;
    if (this.startedAt == null) { this.startedAt = this.now(); this.startedUtc = this.utc().toISOString(); }
    else { this.gaps++; this.event('recording_resumed', { system_id: 'P01' }); }
    this.stoppedAt = null;
    this.recording = true;
    this.event('recording_started', { system_id: 'P01', data: { preset: this.meta.preset } });
  }

  /** Pause recording (adds a gap marker; does not pause the game). */
  stop() {
    if (!this.recording) return;
    this.event('recording_stopped', { system_id: 'P01' });
    this.recording = false;
    this.stoppedAt = this.now();
  }

  /** Mark what the session is doing: 'active' | 'paused' | 'hidden' | 'loading' (frames are tagged). */
  setSegment(name, reason = null) {
    if (name === this.segment) return;
    this.event('segment_change', { system_id: 'P01', data: { from: this.segment, to: name, reason } });
    this.segment = name;
  }

  /** One rendered frame: interval since the previous frame and (optionally) CPU work time. */
  frame(intervalMs, cpuMs = null) {
    if (!this.recording || !Number.isFinite(intervalMs) || intervalMs < 0) return;
    if (this.segment !== 'active') return;   // only active gameplay counts toward frame statistics
    const i = this.frameWrites % this.maxFrames;
    this.frames[i] = intervalMs;
    this.cpu[i] = Number.isFinite(cpuMs) ? cpuMs : NaN;
    if (Number.isFinite(cpuMs)) this.cpuSeen = true;
    this.frameWrites++;
    this.frameCount = Math.min(this.frameWrites, this.maxFrames);
    if (intervalMs >= STALL_MS) {
      this.stalls.push({ t_ms: this.tMs(), tick: this.getTick(), interval_ms: round(intervalMs) });
      this.event('stall', { system_id: 'P02', data: { interval_ms: round(intervalMs) } });
    }
  }

  /** A structured domain event (evidence, economy, session...). Returns its run-scoped id. */
  event(type, { system_id = null, correlation_id = null, data = {} } = {}) {
    if (!this.recording && type !== 'recording_stopped') return null;
    this.counts[type] = (this.counts[type] ?? 0) + 1;
    if (this.events.length >= this.maxEvents) { this.droppedEvents++; return null; }
    const e = { event_id: `e${this.nextEventId++}`, t_ms: this.tMs(), tick: this.getTick(), system_id, type, correlation_id, data };
    this.events.push(e);
    return e.event_id;
  }

  marker(note = '') { return this.event('marker', { system_id: 'P09', data: { note } }); }

  frameSlice(arr) {
    const n = this.frameCount, out = [];
    for (let k = 0; k < n; k++) { const v = arr[k]; if (Number.isFinite(v)) out.push(v); }
    return out;
  }

  metrics() {
    const fi = this.frameSlice(this.frames), cpu = this.cpuSeen ? this.frameSlice(this.cpu) : [];
    const dist = (a) => (a.length
      ? { status: 'measured', count: a.length, p50: round(percentile(a, 50)), p95: round(percentile(a, 95)), p99: round(percentile(a, 99)), max: round(Math.max(...a)) }
      : { status: 'not_measured', count: 0, p50: null, p95: null, p99: null, max: null });
    const median = percentile(fi, 50);
    const missed = fi.length && median ? fi.filter((v) => v > median * 1.5).length / fi.length * 100 : null;
    return {
      frame_interval_ms: dist(fi),
      cpu_app_ms: cpu.length ? dist(cpu) : { status: 'unsupported', count: 0, p50: null, p95: null, p99: null, max: null, reason: 'no cpu spans reported' },
      gpu_ms: { status: 'unsupported', p95: null, reason: 'timer query not instrumented' },
      stalls_over_100ms: { status: fi.length ? 'measured' : 'not_measured', count: this.stalls.length, max_interval_ms: this.stalls.length ? round(Math.max(...this.stalls.map((s) => s.interval_ms))) : null },
      estimated_missed_cadence_pct: { status: missed == null ? 'not_measured' : 'estimated', value: round(missed, 2), method: 'intervals_over_1.5x_median' },
      compositor_dropped_frames: { status: 'unsupported', value: null },
    };
  }

  /** Totals of the evidence and economy events (P07/P08 summary). */
  domainTotals() {
    const ev = (t) => this.events.filter((e) => e.type === t);
    const photos = ev('photo_taken');
    const sales = ev('evidence_sold');
    return {
      evidence: {
        photos_taken: photos.length,
        photos_hit: photos.filter((e) => e.data?.subject).length,
        best_photo_score: photos.length ? Math.max(0, ...photos.map((e) => e.data?.score ?? 0)) : null,
        clues_logged: ev('clue_logged').length,
      },
      economy: {
        sales: sales.length,
        revenue: sales.reduce((s, e) => s + (e.data?.earned ?? 0), 0),
        bounties_paid: ev('bounty_paid').length,
        purchases: ev('purchase').length,
        spent: ev('purchase').reduce((s, e) => s + (e.data?.cost ?? 0), 0),
      },
    };
  }

  get baseName() {
    const m = this.meta;
    return ['cryptozoology', token(m.build), token(m.gym), token(m.scenario), token(m.platform), token(m.seed, '0'), token(this.runId)].join('_');
  }

  summary() {
    const metrics = this.metrics();
    const complete = this.droppedEvents === 0 && this.frameWrites <= this.maxFrames;
    const enough = metrics.frame_interval_ms.count > 0;
    return {
      schema_version: SCHEMA_VERSION,
      run_id: this.runId,
      build_id: this.meta.build,
      config_hash: null,
      started_utc: this.startedUtc,
      gym_id: this.meta.gym,
      scenario_id: this.meta.scenario,
      seed: this.meta.seed,
      platform: { mode: this.meta.platform, device_class: null, browser_version: null, quality_preset: null, target_hz: null, gpu_timer_supported: false },
      capture: {
        preset: this.meta.preset, duration_ms: round(this.elapsedMs, 1), complete, dropped_events: this.droppedEvents,
        frames_recorded: this.frameWrites, frames_kept: this.frameCount, frames_truncated: Math.max(0, this.frameWrites - this.maxFrames), recording_gaps: this.gaps,
        stall_threshold_ms: STALL_MS,
      },
      metrics,
      stalls: this.stalls.slice(0, 200),
      totals: this.domainTotals(),
      event_counts: { ...this.counts },
      assertions: [
        { id: 'frames_recorded', status: enough ? 'pass' : 'fail' },
        { id: 'gpu_budget', status: 'not_evaluated', reason: 'unsupported' },
      ],
      verdict: !enough ? 'invalid' : complete ? 'incomplete_performance_coverage' : 'truncated',
    };
  }

  /** { baseName, files: { 'summary.json': text, 'events.jsonl': text, 'manifest.json': text } } */
  exportBundle() {
    const summary = JSON.stringify(this.summary(), null, 2);
    const events = this.events.map((e) => JSON.stringify(e)).join('\n') + (this.events.length ? '\n' : '');
    const manifest = JSON.stringify({
      schema_version: SCHEMA_VERSION, run_id: this.runId, base_name: this.baseName, exported_utc: this.utc().toISOString(),
      files: [
        { name: `${this.baseName}.summary.json`, role: 'summary.json', content_version: CONTENT_VERSIONS.summary, records: 1, bytes: summary.length },
        { name: `${this.baseName}.events.jsonl`, role: 'events.jsonl', content_version: CONTENT_VERSIONS.events, records: this.events.length, bytes: events.length,
          truncated: this.droppedEvents > 0, dropped_records: this.droppedEvents },
      ],
    }, null, 2);
    return { baseName: this.baseName, files: { 'summary.json': summary, 'events.jsonl': events, 'manifest.json': manifest } };
  }
}

/** Validate an exported bundle: every file parses, required fields present, counts agree. Returns errors. */
export function validateBundle(files) {
  const errors = [];
  let summary, manifest, events = [];
  try { summary = JSON.parse(files['summary.json']); } catch (e) { errors.push(`summary.json does not parse: ${e.message}`); }
  try { manifest = JSON.parse(files['manifest.json']); } catch (e) { errors.push(`manifest.json does not parse: ${e.message}`); }
  const lines = (files['events.jsonl'] ?? '').split('\n').filter((l) => l.length);
  lines.forEach((l, i) => { try { events.push(JSON.parse(l)); } catch (e) { errors.push(`events.jsonl line ${i + 1} does not parse`); } });
  if (summary) {
    for (const k of ['schema_version', 'run_id', 'build_id', 'started_utc', 'gym_id', 'scenario_id', 'seed', 'platform', 'capture', 'metrics', 'verdict']) {
      if (!(k in summary)) errors.push(`summary.json is missing ${k}`);
    }
    const fi = summary.metrics?.frame_interval_ms;
    if (!fi || !['measured', 'not_measured'].includes(fi.status)) errors.push('frame_interval_ms status missing');
    if (fi?.status === 'measured' && !(Number.isFinite(fi.p95) && fi.count > 0)) errors.push('frame_interval_ms.p95 not a finite number');
    if (!Number.isFinite(summary.metrics?.stalls_over_100ms?.count)) errors.push('stalls_over_100ms.count missing');
    const walk = (o, path) => {
      if (typeof o === 'number' && !Number.isFinite(o)) errors.push(`non-finite number at ${path}`);
      else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(summary, 'summary');
  }
  const ids = new Set();
  for (const e of events) {
    for (const k of ['event_id', 't_ms', 'tick', 'type']) if (!(k in e)) errors.push(`event missing ${k}`);
    if (ids.has(e.event_id)) errors.push(`duplicate event_id ${e.event_id}`);
    ids.add(e.event_id);
  }
  if (manifest) {
    const ev = manifest.files?.find((f) => f.role === 'events.jsonl');
    if (!ev) errors.push('manifest does not list events.jsonl');
    else if (ev.records !== events.length) errors.push(`manifest says ${ev.records} events, file has ${events.length}`);
    if (summary && manifest.run_id !== summary.run_id) errors.push('manifest and summary run_id differ');
    if (!/^cryptozoology_[a-z0-9-]+_[a-z0-9-]+_[a-z0-9-]+_[a-z0-9-]+_[a-z0-9-]+_[a-z0-9-]+$/.test(manifest.base_name ?? '')) errors.push(`bad file name ${manifest.base_name}`);
  }
  return errors;
}
