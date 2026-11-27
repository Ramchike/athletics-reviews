export function clockSample(t0, t1, t2, t3) {
  return { offset: ((t1 - t0) + (t2 - t3)) / 2, rtt: (t3 - t0) - (t2 - t1) };
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
