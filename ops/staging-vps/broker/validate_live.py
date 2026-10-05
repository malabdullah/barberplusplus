"""Read-only Linux acceptance probe; run via administrator stdin, never a workflow."""
import grp
import json
import os
from pathlib import Path
import pwd
import socket
import stat
import subprocess

SOCKET = '/run/barber-staging-broker.sock'
PREFIX = 'barber-staging-broker'


def request(raw):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(10)
        client.connect(SOCKET)
        client.sendall(raw)
        result = bytearray()
        while not result.endswith(b'\n'):
            block = client.recv(4096)
            assert block and len(result) + len(block) <= 4096
            result.extend(block)
        return json.loads(result)


def peer_probe(name, socket_group=False):
    # Only the disposable child changes identity. No persistent group changes.
    child = os.fork()
    if child == 0:
        try:
            account = pwd.getpwnam(name)
            os.setgroups([grp.getgrnam('barber-staging-release').gr_gid] if socket_group else [])
            os.setgid(account.pw_gid)
            os.setuid(account.pw_uid)
            with socket.socket(socket.AF_UNIX) as client:
                client.settimeout(5)
                try:
                    client.connect(SOCKET)
                except PermissionError:
                    os._exit(0 if not socket_group else 1)
                assert socket_group
                # Kernel peer rejection happens without reading a request.
                assert json.loads(client.recv(4096))['code'] == 'FORBIDDEN'
            os._exit(0)
        except Exception:
            os._exit(1)
    _, status = os.waitpid(child, 0)
    assert os.waitstatus_to_exitcode(status) == 0, 'Peer isolation failed.'


def main():
    assert os.getuid() == 0 and socket.gethostname() == 'srv1207055'
    info = os.stat(SOCKET)
    assert stat.S_ISSOCK(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o660
    assert info.st_uid == 0 and info.st_gid == grp.getgrnam('barber-staging-release').gr_gid
    for name in (PREFIX, 'barber-staging-deploy'):
        account = pwd.getpwnam(name)
        assert account.pw_uid > 0 and account.pw_shell == '/usr/sbin/nologin'
        assert os.getgrouplist(name, account.pw_gid) == [account.pw_gid]
        locked = subprocess.run(['/usr/bin/passwd', '-S', name], capture_output=True,
                                text=True, check=True, timeout=5).stdout.split()
        assert locked[1] == 'L'
    for path in ('/usr/local/libexec/barber-staging-broker/broker.py',
                 '/etc/systemd/system/barber-staging-broker.socket',
                 '/etc/systemd/system/barber-staging-broker.service'):
        info = os.lstat(path)
        assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
    result = request(b'{"version":1,"operation":"status.inspect"}\n')
    assert result['code'] == 'OK' and result['automationReady'] is False
    assert result['liveStackVerified'] is False and result['capabilities'] == ['status.inspect']
    for operation in ('release.deploy', 'migration.apply', 'backup.capture', 'images.rollback'):
        response = request((json.dumps({'version': 1, 'operation': operation}) + '\n').encode())
        assert response['code'] == 'OPERATION_DISABLED'
    for raw in (b'{"version":1,"version":1,"operation":"status.inspect"}\n',
                b'{"version":1,"operation":"status.inspect","command":"id"}\n', b'x' * 4097):
        assert request(raw)['code'] == 'INVALID_REQUEST'
    peer_probe('barber-staging-deploy')
    peer_probe('nobody')
    peer_probe('nobody', socket_group=True)
    pid = int(subprocess.run(['/usr/bin/systemctl', 'show', PREFIX + '.service',
                              '-p', 'MainPID', '--value'], text=True, capture_output=True,
                             check=True, timeout=5).stdout)
    assert pid > 1
    fields = dict(line.split(':', 1) for line in Path(f'/proc/{pid}/status').read_text().splitlines() if ':' in line)
    assert set(fields['Uid'].split()) == {str(pwd.getpwnam(PREFIX).pw_uid)}
    assert fields['NoNewPrivs'].strip() == '1'
    for field in ('CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'):
        assert int(fields[field].strip(), 16) == 0
    assert os.readlink(f'/proc/{pid}/ns/net') != os.readlink('/proc/1/ns/net')
    print('PASS: socket ownership, locked users, protected files, root status, disabled writes, invalid input, nonmember denial, kernel peer rejection, non-root process, zero capabilities, no-new-privileges, isolated network namespace.')
    print('NOT ACCEPTED: deployment automation, application stack, backups, migration or release readiness.')


if __name__ == '__main__':
    main()
