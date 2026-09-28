import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMER_PRESETS, MIN_MINUTES, MAX_MINUTES, DEFAULT_LABEL,
  isAndroid, formatDuration, buildTimerIntentUrl, parseMinutes
} from '../timer.js';

test('presets are sane', () => {
  assert.ok(TIMER_PRESETS.length >= 5);
  for (const p of TIMER_PRESETS) {
    assert.ok(p.label.length > 0);
    assert.ok(p.minutes >= MIN_MINUTES && p.minutes <= MAX_MINUTES);
  }
});

test('isAndroid uses client hints first, then the user agent', () => {
  assert.equal(isAndroid({ userAgentData: { platform: 'Android' }, userAgent: 'x' }), true);
  assert.equal(isAndroid({ userAgentData: { platform: 'Windows' }, userAgent: 'Android' }), false);
  assert.equal(isAndroid({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/128' }), true);
  assert.equal(isAndroid({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5)' }), false);
  assert.equal(isAndroid(null), false);
  assert.equal(isAndroid({}), false);
});

test('formatDuration', () => {
  assert.equal(formatDuration(30), '30 min');
  assert.equal(formatDuration(60), '1 h');
  assert.equal(formatDuration(90), '1 h 30 min');
  assert.equal(formatDuration(240), '4 h');
});

test('intent url carries length in seconds, an encoded label and SKIP_UI', () => {
  const url = buildTimerIntentUrl({ minutes: 30, label: 'Stretch & fold', fallbackUrl: 'https://x.test/#t=unsupported' });
  assert.ok(url.startsWith('intent:#Intent;'));
  assert.ok(url.endsWith(';end'));
  assert.ok(url.includes('action=android.intent.action.SET_TIMER'));
  assert.ok(url.includes('i.android.intent.extra.alarm.LENGTH=1800'));
  assert.ok(url.includes('S.android.intent.extra.alarm.MESSAGE=Stretch%20%26%20fold'));
  assert.ok(url.includes('B.android.intent.extra.alarm.SKIP_UI=true'));
  assert.ok(url.includes('S.browser_fallback_url=https%3A%2F%2Fx.test%2F%23t%3Dunsupported'));
  assert.ok(!url.includes('browser_fallback_url') || url.split('browser_fallback_url').length === 2);
});

test('intent url clamps the duration and defaults the label', () => {
  assert.ok(buildTimerIntentUrl({ minutes: 0, label: '' }).includes(`LENGTH=${MIN_MINUTES * 60}`));
  assert.ok(buildTimerIntentUrl({ minutes: 99999, label: '  ' }).includes(`LENGTH=${MAX_MINUTES * 60}`));
  assert.ok(buildTimerIntentUrl({ minutes: 5, label: '  ' }).includes(`MESSAGE=${encodeURIComponent(DEFAULT_LABEL)}`));
  assert.ok(!buildTimerIntentUrl({ minutes: 5, label: 'x' }).includes('browser_fallback_url'));
  // A semicolon in the label must never break the intent syntax.
  const url = buildTimerIntentUrl({ minutes: 5, label: 'a;b=c' });
  assert.ok(url.includes('MESSAGE=a%3Bb%3Dc'));
});

test('parseMinutes accepts whole minutes in range only', () => {
  assert.equal(parseMinutes('45'), 45);
  assert.equal(parseMinutes(' 720 '), 720);
  assert.equal(parseMinutes('0'), null);
  assert.equal(parseMinutes('721'), null);
  assert.equal(parseMinutes('2.5'), null);
  assert.equal(parseMinutes('abc'), null);
  assert.equal(parseMinutes(''), null);
  assert.equal(parseMinutes(30), null);
});
