// System timer hand-off. On Android, Chrome (and the installed app, which runs
// in Chrome) can start a timer in the phone's Clock app through an intent link.
// The Clock app then owns the countdown, so it rings with Rise closed and the
// screen off. Pure: no DOM.

export const TIMER_PRESETS = Object.freeze([
  { label: 'Autolyse', minutes: 30 },
  { label: 'Stretch & fold', minutes: 30 },
  { label: 'Bench rest', minutes: 20 },
  { label: 'Preheat', minutes: 45 },
  { label: 'Bake covered', minutes: 20 },
  { label: 'Bake uncovered', minutes: 25 },
  { label: 'Bulk ferment', minutes: 240 }
]);

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 720;
export const DEFAULT_LABEL = 'Rise timer';

export function isAndroid(nav) {
  if (!nav) return false;
  const platform = nav.userAgentData && nav.userAgentData.platform;
  if (typeof platform === 'string' && platform !== '') return /android/i.test(platform);
  return /android/i.test(nav.userAgent || '');
}

export function formatDuration(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// Builds an Android intent URL for AlarmClock.ACTION_SET_TIMER. SKIP_UI makes
// the Clock app start the timer at once instead of opening its editor. When no
// app can take the intent, Chrome navigates to fallbackUrl instead.
export function buildTimerIntentUrl({ minutes, label, fallbackUrl }) {
  const seconds = Math.round(Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Number(minutes))) * 60);
  const message = (typeof label === 'string' && label.trim() !== '') ? label.trim() : DEFAULT_LABEL;
  const parts = [
    'action=android.intent.action.SET_TIMER',
    `i.android.intent.extra.alarm.LENGTH=${seconds}`,
    `S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(message)}`,
    'B.android.intent.extra.alarm.SKIP_UI=true'
  ];
  if (fallbackUrl) parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`);
  return `intent:#Intent;${parts.join(';')};end`;
}

// Parses the custom minutes field. Whole minutes within the allowed range.
export function parseMinutes(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (n < MIN_MINUTES || n > MAX_MINUTES) return null;
  return n;
}
