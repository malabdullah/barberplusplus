"""Fail closed before activation; no credential or application inspection."""
from pathlib import Path
import subprocess
import sys

PREFIX = 'barber-staging-broker'
EXPECTED = {
    'service': {
        'User': PREFIX,
        'Group': PREFIX,
        'NoNewPrivileges': 'yes',
        'CapabilityBoundingSet': '',
        'AmbientCapabilities': '',
        'ProtectSystem': 'strict',
        'ProtectHome': 'yes',
        'PrivateNetwork': 'yes',
        'PrivateTmp': 'yes',
        'PrivateDevices': 'yes',
        'ProtectKernelTunables': 'yes',
        'ProtectKernelModules': 'yes',
        'ProtectKernelLogs': 'yes',
        'ProtectControlGroups': 'yes',
        'ProtectClock': 'yes',
        'ProtectHostname': 'yes',
        'ProtectProc': 'invisible',
        'ProcSubset': 'pid',
        'RestrictAddressFamilies': 'AF_UNIX',
        'RestrictRealtime': 'yes',
        'RestrictSUIDSGID': 'yes',
        'LockPersonality': 'yes',
        'MemoryDenyWriteExecute': 'yes',
        'RemoveIPC': 'yes',
    },
    'socket': {
        'SocketUser': 'root',
        'SocketGroup': 'barber-staging-release',
        'SocketMode': '0660',
        'Accept': 'no',
        'RemoveOnStop': 'yes',
    },
}


def properties(unit):
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', unit],
                            text=True, capture_output=True, timeout=15, check=False)
    # systemctl may return nonzero for a nonexistent unit; inspect its LoadState.
    values = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if result.returncode and values.get('LoadState') != 'not-found':
        raise RuntimeError('Cannot inspect systemd unit.')
    return values


def validate(values, suffix, phase):
    if phase == 'preflight':
        if values.get('LoadState') != 'not-found' or values.get('FragmentPath') or values.get('DropInPaths'):
            raise RuntimeError('Existing systemd configuration requires review.')
        if values.get('ActiveState') != 'inactive':
            raise RuntimeError('Unit must not be active.')
        return
    expected = {**EXPECTED[suffix], 'LoadState': 'loaded', 'DropInPaths': '',
                'FragmentPath': f'/etc/systemd/system/{PREFIX}.{suffix}',
                'ActiveState': 'inactive'}
    for name, value in expected.items():
        if values.get(name) != value:
            raise RuntimeError(f'Unexpected systemd property: {suffix}.{name}')
    if suffix == 'service':
        command = values.get('ExecStart', '')
        expected_command = '/usr/bin/python3 -I -B /usr/local/libexec/barber-staging-broker/broker.py'
        if command.count('argv[]=') != 1 or f'argv[]={expected_command} ;' not in command:
            raise RuntimeError('Unexpected service command.')
        for name in ('ExecStartPre', 'ExecStartPost', 'ExecCondition', 'ExecStop', 'ExecStopPost'):
            if values.get(name):
                raise RuntimeError('Unexpected service command hook.')
    elif values.get('Listen') != '/run/barber-staging-broker.sock (Stream)':
        raise RuntimeError('Unexpected socket listener.')


def verify(phase):
    for suffix in EXPECTED:
        unit = f'{PREFIX}.{suffix}'
        validate(properties(unit), suffix, phase)
        if phase == 'effective':
            installed = Path('/etc/systemd/system') / unit
            if installed.read_bytes() != Path(__file__).with_name(unit).read_bytes():
                raise RuntimeError('Installed unit differs from reviewed payload.')


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in ('preflight', 'effective'):
            raise RuntimeError('Invalid verification phase.')
        verify(sys.argv[1])
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        # Errors contain static property labels only, never systemctl output.
        print(str(error) if isinstance(error, RuntimeError) else 'Systemd verification failed.', file=sys.stderr)
        sys.exit(1)
