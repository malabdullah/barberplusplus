import { closeSync, fchmodSync, openSync, writeFileSync } from 'node:fs';

// Only for reviewed, non-secret source templates in a private parent directory.
// Non-root Linux containers must read these individual bind-mounted files even
// when the host installer inherits umask 077. Never use for rendered secrets.
export function writePublicContainerSource(path, data) {
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(descriptor, data);
    fchmodSync(descriptor, 0o644);
  } finally {
    closeSync(descriptor);
  }
}
