export type ViewportSample = { layoutHeight: number; height: number; offsetTop: number; scale: number; editing: boolean };

// Pinch zoom is an accessibility action, not a keyboard signal.
export function mobileViewport(sample: ViewportSample) {
  if (![sample.layoutHeight, sample.height, sample.offsetTop, sample.scale].every(Number.isFinite)
    || sample.layoutHeight <= 0 || sample.height <= 0 || Math.abs(sample.scale - 1) > .05) return null;
  const height = Math.min(sample.height, sample.layoutHeight);
  const top = Math.min(Math.max(0, sample.offsetTop), sample.layoutHeight - height);
  return { height: Math.round(height), top: Math.round(top), keyboard: sample.editing && sample.layoutHeight - height > 120 };
}
