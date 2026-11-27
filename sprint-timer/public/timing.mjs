export function clockSample(t0, t1, t2, t3) {
  return { offset: ((t1 - t0) + (t2 - t3)) / 2, rtt: (t3 - t0) - (t2 - t1) };
}

export function estimateClock(samples, now) {
  if (samples.length < 4) return null;
  let lower = -Infinity;
  let upper = Infinity;
  let best;
  for (const sample of samples) {
    // Allow for timer rounding and a small amount of drift since the probe.
    const radius = sample.rtt / 2 + 2 + Math.max(0, now - sample.at) * 0.0002;
    lower = Math.max(lower, sample.offset - radius);
    upper = Math.min(upper, sample.offset + radius);
    if (!best || sample.rtt < best.rtt) best = { ...sample, uncertainty: radius };
  }
  if (lower > upper) {
    return { ...best, uncertainty: Math.max(best.uncertainty, best.offset - upper, lower - best.offset) };
  }
  return { rtt: best.rtt, offset: (lower + upper) / 2, uncertainty: (upper - lower) / 2 };
}

export function crossing(before, after, line, direction) {
  if (!before || after.t <= before.t || after.t - before.t > 85
    || (before.x - line) * direction >= 0 || (after.x - line) * direction < 0) return null;
  return before.t + (after.t - before.t) * (line - before.x) / (after.x - before.x);
}

export function torsoPoint(landmarks, direction) {
  const torso = [11, 12, 23, 24].map(index => landmarks[index]);
  if (torso.some(point => !point || point.visibility < 0.45
    || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  return torso.reduce((edge, point) => (point.x - edge.x) * direction > 0 ? point : edge);
}

export function elapsedMs(start, finish) {
  const duration = finish - start;
  return Number.isFinite(duration) && duration >= 0 && duration <= 60_000 ? duration : null;
}
