import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearProgress, forgetOutcome, getProgress, lastOutcome, rememberOutcome, setProgress } from './progress.ts';

test('progress steps and the last outcome are kept per post and can be cleared', () => {
  setProgress('f/a.md', 'Instagram is processing the image…');
  assert.equal(getProgress('f/a.md'), 'Instagram is processing the image…');
  assert.equal(getProgress('f/b.md'), null);
  clearProgress('f/a.md');
  assert.equal(getProgress('f/a.md'), null);
  rememberOutcome('f/a.md', { status: 'retry', message: 'rate limited', at: '2026-11-20T09:00:00Z' });
  assert.equal(lastOutcome('f/a.md')?.message, 'rate limited');
  forgetOutcome('f/a.md');
  assert.equal(lastOutcome('f/a.md'), null);
});
