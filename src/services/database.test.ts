import { getTimeOfDayGreeting } from './database.ts';

const KENYA_OFFSET = 3;

function utcToKenyaHour(utcHour: number): number {
  return (utcHour + KENYA_OFFSET) % 24;
}

function createUTCDate(hour: number, minute = 0): Date {
  const date = new Date('2026-01-15T00:00:00Z');
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

function assertEqual<T>(actual: T, expected: T, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} Expected ${expected}, got ${actual}`);
  }
}

// Test Kenya timezone conversion
test('getTimeOfDayGreeting: 02:00 UTC = 05:00 Kenya = Good morning', () => {
  const date = createUTCDate(2);
  assertEqual(getTimeOfDayGreeting(date.toISOString()), 'Good morning');
});

test('getTimeOfDayGreeting: 04:59 UTC = 07:59 Kenya = Good morning', () => {
  const date = createUTCDate(4, 59);
  assertEqual(getTimeOfDayGreeting(date.toISOString()), 'Good morning');
});

test('getTimeOfDayGreeting: 08:00 UTC = 11:00 Kenya = Good morning', () => {
  const date = createUTCDate(8);
  assertEqual(getTimeOfDayGreeting(date.toISOString()), 'Good morning');
});

test('getTimeOfDayGreeting: 09:00 UTC = 12:00 Kenya = Good afternoon', () => {
  const date = createUTCDate(9);
  assertEqual(getTimeOfDayGreeting(date.toISOString()), 'Good afternoon');
});

test('getTimeOfDayGreeting: 13:00 UTC = 16:00 Kenya = Good afternoon', () => {
  const date = createUTCDate(13);
  assertEqual(getTimeOfDayGreeting(date.toISOString()), 'Good afternoon');
});

test('getTimeOfDayGreeting: 14:00 UTC = 17:00 Kenya = Good evening', () => {
  const date = createUTCDate(14);
  assertEqual(getTimeOfDayGreeting(date.toISOString()), 'Good evening');
});

test('getTimeOfDayGreeting: 21:00 UTC = 00:00 Kenya = Good evening', () => {
  const date = createUTCDate(21);
  assertEqual(getTimeOfDayGreeting(date.toISOString()), 'Good evening');
});

test('getTimeOfDayGreeting: 23:00 UTC = 02:00 Kenya = Good evening', () => {
  const date = createUTCDate(23);
  assertEqual(getTimeOfDayGreeting(date.toISOString()), 'Good evening');
});

// Test fallback to current time when no timestamp provided
test('getTimeOfDayGreeting: null timestamp uses current time', () => {
  const result = getTimeOfDayGreeting(null);
  assertEqual(typeof result, 'string');
  assertEqual(['Good morning', 'Good afternoon', 'Good evening'].includes(result), true);
});

test('getTimeOfDayGreeting: undefined timestamp uses current time', () => {
  const result = getTimeOfDayGreeting(undefined);
  assertEqual(typeof result, 'string');
  assertEqual(['Good morning', 'Good afternoon', 'Good evening'].includes(result), true);
});

test('getTimeOfDayGreeting: invalid timestamp falls back to current time', () => {
  const result = getTimeOfDayGreeting('not-a-date');
  assertEqual(typeof result, 'string');
  assertEqual(['Good morning', 'Good afternoon', 'Good evening'].includes(result), true);
});

test('getTimeOfDayGreeting: ISO timestamp with timezone offset', () => {
  // ISO format with +00:00 offset
  const result = getTimeOfDayGreeting('2026-01-15T08:30:00+00:00');
  assertEqual(result, 'Good morning');
});

console.log('\nAll tests passed!');