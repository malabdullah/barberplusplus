#!/usr/bin/env python3
"""Select a reachable Ubuntu archive without relaxing Ubuntu signature checks."""
import pathlib
import re
import subprocess
import tempfile
import urllib.request

sources = pathlib.Path('/etc/apt/sources.list.d/ubuntu.sources')
keyring = pathlib.Path('/usr/share/keyrings/ubuntu-archive-keyring.gpg')
os_release = pathlib.Path('/etc/os-release').read_text()
codename = re.search(r'^VERSION_CODENAME=([a-z]+)$', os_release, re.M).group(1)
original = sources.read_text()
assert keyring.is_file() and 'Signed-By: ' + str(keyring) in original
assert not re.search(r'^(?:Trusted|Allow-Insecure):\s*yes', original, re.M | re.I)
suites = sorted(set(' '.join(re.findall(r'^Suites:\s*(.+)$', original, re.M)).split()))
assert suites and all(re.fullmatch(re.escape(codename) + r'(?:-updates|-backports|-security)?', s) for s in suites)
# Both endpoints serve Canonical-signed Ubuntu packages. Probe every configured
# pocket, then retain the runner's suites, components and Signed-By keyring.
mirrors = ['https://archive.ubuntu.com/ubuntu', 'https://mirrors.kernel.org/ubuntu']
chosen = None
for mirror in mirrors:
    try:
        with tempfile.TemporaryDirectory(prefix='ubuntu-archive-check-') as temporary:
            for suite in suites:
                with urllib.request.urlopen(mirror + '/dists/' + suite + '/InRelease', timeout=8) as response:
                    payload = response.read(5 * 1024 * 1024 + 1)
                assert len(payload) <= 5 * 1024 * 1024
                release = pathlib.Path(temporary) / 'InRelease'
                release.write_bytes(payload)
                subprocess.run(['gpgv', '--keyring', str(keyring), str(release)], check=True, capture_output=True)
                assert re.search(rb'^Suite: ' + suite.encode() + rb'\r?$', payload, re.M)
        chosen = mirror
        break
    except (OSError, AssertionError, subprocess.CalledProcessError):
        print('Ubuntu archive unavailable:', mirror, flush=True)
assert chosen, 'No reachable Ubuntu-signed archive; dependency checks remain required'
updated, count = re.subn(r'^URIs:\s*.+$', 'URIs: ' + chosen, original, flags=re.M)
assert count and re.findall(r'^Signed-By:.*$', updated, re.M) == re.findall(r'^Signed-By:.*$', original, re.M)
sources.write_text(updated)
pathlib.Path('/etc/apt/apt.conf.d/99-barber-ci-downloads').write_text(
    'Acquire::Retries "2";\nAcquire::ForceIPv4 "true";\nAcquire::http::Timeout "20";\nAcquire::https::Timeout "20";\n')
print('Using verified Ubuntu archive:', chosen, flush=True)
