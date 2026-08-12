/**
 * GPS smoothing for live tracking — a 2-D constant-velocity Kalman filter.
 *
 * Raw GPS fixes jitter by several metres even when a vehicle is still, and arrive at
 * irregular intervals over a websocket. Rendering them directly makes the marker
 * "teleport". This filter fuses each noisy fix with a constant-velocity motion model,
 * producing a smooth, physically-plausible position estimate (and a velocity estimate
 * we expose for heading/speed). It is the standard technique Uber/Google use for
 * blue-dot smoothing.
 *
 * State vector x = [lat, lng, vLat, vLng]  (position + velocity, in degrees & deg/s).
 * We work in degrees directly (small-area assumption); for India-scale city tracking the
 * curvature error is negligible because process/measurement noise dominate.
 *
 * Tuning:
 *  - measurementNoise (R): metres² of GPS uncertainty. Larger ⇒ smoother but laggier.
 *    We derive it per-fix from the reported `accuracy` when available.
 *  - processNoise (Q): how much we trust the constant-velocity model. Larger ⇒ snappier.
 */

const DEG_PER_M_LAT = 1 / 111_320; // ~metres → degrees latitude
function degPerMLng(lat: number): number {
  return 1 / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);
}

export type LatLng = { lat: number; lng: number };

export class GpsKalmanFilter {
  // State estimate and covariance.
  private x: [number, number, number, number] | null = null; // lat, lng, vLat, vLng
  private P: number[][] = identity(4, 1000); // large initial uncertainty
  private lastTs = 0;

  /** Process-noise scale (deg/s²-ish). Tuned for two-wheeler city movement. */
  private readonly q: number;

  constructor(opts?: { processNoise?: number }) {
    this.q = opts?.processNoise ?? 4e-9;
  }

  /** Reset the filter (e.g. when tracking a different booking). */
  reset(): void {
    this.x = null;
    this.P = identity(4, 1000);
    this.lastTs = 0;
  }

  /**
   * Fuse one raw GPS fix and return the smoothed position + derived velocity.
   * @param accuracyMeters  Reported horizontal accuracy (1σ). Defaults to 15 m.
   * @param tsMs            Fix timestamp (ms). Defaults to now.
   */
  update(fix: LatLng, accuracyMeters = 15, tsMs = Date.now()): { position: LatLng; speedMps: number; headingDeg: number | null } {
    // First fix: initialise state directly.
    if (!this.x) {
      this.x = [fix.lat, fix.lng, 0, 0];
      this.lastTs = tsMs;
      this.P = identity(4, 100);
      return { position: { lat: fix.lat, lng: fix.lng }, speedMps: 0, headingDeg: null };
    }

    const dt = Math.min(10, Math.max(0.05, (tsMs - this.lastTs) / 1000)); // clamp Δt to sane bounds
    this.lastTs = tsMs;

    // --- Predict: x = F·x ; P = F·P·Fᵀ + Q ---
    // F is the constant-velocity transition (position += velocity·dt).
    const F = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    this.x = matVec(F, this.x) as [number, number, number, number];
    const q = this.q;
    // Process-noise covariance for a CV model (block per axis).
    const dt2 = dt * dt, dt3 = dt2 * dt / 2, dt4 = dt2 * dt2 / 4;
    const Q = [
      [dt4 * q, 0, dt3 * q, 0],
      [0, dt4 * q, 0, dt3 * q],
      [dt3 * q, 0, dt2 * q, 0],
      [0, dt3 * q, 0, dt2 * q],
    ];
    this.P = matAdd(matMul(matMul(F, this.P), transpose(F)), Q);

    // --- Update: measurement z = [lat, lng] with noise R ---
    // Convert metre accuracy → degree variance on each axis.
    const rLat = Math.pow(accuracyMeters * DEG_PER_M_LAT, 2);
    const rLng = Math.pow(accuracyMeters * degPerMLng(fix.lat), 2);
    // H maps state→measurement (we observe position only).
    const yLat = fix.lat - this.x[0];
    const yLng = fix.lng - this.x[1];
    // Innovation covariance S = H·P·Hᵀ + R (2×2, position block of P + R).
    const s00 = this.P[0][0] + rLat;
    const s01 = this.P[0][1];
    const s10 = this.P[1][0];
    const s11 = this.P[1][1] + rLng;
    const det = s00 * s11 - s01 * s10 || 1e-12;
    const sInv = [
      [s11 / det, -s01 / det],
      [-s10 / det, s00 / det],
    ];
    // Kalman gain K = P·Hᵀ·S⁻¹  (4×2). Hᵀ selects the position columns of P.
    const K: number[][] = [];
    for (let i = 0; i < 4; i++) {
      const p0 = this.P[i][0], p1 = this.P[i][1];
      K.push([p0 * sInv[0][0] + p1 * sInv[1][0], p0 * sInv[0][1] + p1 * sInv[1][1]]);
    }
    // x = x + K·y
    for (let i = 0; i < 4; i++) this.x[i] += K[i][0] * yLat + K[i][1] * yLng;
    // P = (I − K·H)·P
    const KH = identity(4, 0);
    for (let i = 0; i < 4; i++) {
      KH[i][0] = K[i][0];
      KH[i][1] = K[i][1];
    }
    const ImKH = matSub(identity(4, 1), KH);
    this.P = matMul(ImKH, this.P);

    // Derived velocity → speed (m/s) + heading (deg).
    const vLatMps = this.x[2] / DEG_PER_M_LAT;
    const vLngMps = this.x[3] / degPerMLng(this.x[0]);
    const speedMps = Math.hypot(vLatMps, vLngMps);
    // Heading from velocity (only meaningful when actually moving).
    let headingDeg: number | null = null;
    if (speedMps > 0.5) {
      headingDeg = (Math.atan2(vLngMps, vLatMps) * 180) / Math.PI;
      headingDeg = (headingDeg + 360) % 360;
    }
    return { position: { lat: this.x[0], lng: this.x[1] }, speedMps, headingDeg };
  }
}

// --- tiny matrix helpers (4×4 / 4×2, no deps) ---
function identity(n: number, diag: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? diag : 0)));
}
function transpose(a: number[][]): number[][] {
  return a[0].map((_, j) => a.map((row) => row[j]));
}
function matMul(a: number[][], b: number[][]): number[][] {
  const r = a.length, c = b[0].length, k = b.length;
  const out = Array.from({ length: r }, () => new Array(c).fill(0));
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) { let s = 0; for (let x = 0; x < k; x++) s += a[i][x] * b[x][j]; out[i][j] = s; }
  return out;
}
function matVec(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((s, val, j) => s + val * v[j], 0));
}
function matAdd(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((val, j) => val + b[i][j]));
}
function matSub(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((val, j) => val - b[i][j]));
}
