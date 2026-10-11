import assert from 'node:assert/strict';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const NOTIFIER = '/Users/malabdullah/Applications/terminal-notifier.app/Contents/MacOS/terminal-notifier';
export const NOTIFIER_SHA256 = 'dfc5e0d43eac93cbea69e35d4736b3c662300269236062037a297889caa9d7c5';
export function verifyNotifier() {
  assert.equal(process.platform, 'darwin');
  for (const path of ['/Users/malabdullah/Applications', '/Users/malabdullah/Applications/terminal-notifier.app',
    '/Users/malabdullah/Applications/terminal-notifier.app/Contents', '/Users/malabdullah/Applications/terminal-notifier.app/Contents/MacOS', NOTIFIER]) {
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o022) === 0);
    assert.ok(path === NOTIFIER ? stat.isFile() : stat.isDirectory());
  }
  assert.equal(createHash('sha256').update(readFileSync(NOTIFIER)).digest('hex'), NOTIFIER_SHA256);
  const state = execFileSync(NOTIFIER, ['-diagnose'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(state, /authorization\s+authorized/);
  assert.match(state, /alerts\s+enabled/);
  assert.match(state, /notification centre\s+enabled/);
}
export function notifyStaging(message) {
  assert.equal(typeof message, 'string'); assert.ok(message.length > 0 && message.length <= 500);
  verifyNotifier();
  execFileSync(NOTIFIER, ['-title', 'Barber staging', '-message', message, '-group', 'barber-staging'], { stdio: 'ignore', timeout: 10000 });
}
