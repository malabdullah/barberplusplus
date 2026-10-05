#!/usr/bin/python3
"""Read-only first stage. No deployment, subprocesses, credentials or file writes."""

import json
import os
import platform
import pwd
import socket
import struct
import sys
import time

SOCKET_PATH = '/run/barber-staging-broker.sock'
DEPLOY_USER = 'barber-staging-deploy'
SERVICE_USER = 'barber-staging-broker'
EXPECTED_HOST = 'srv1207055'
MAX_REQUEST = 4096
REQUEST_SECONDS = 2
DISABLED = frozenset(('backup.capture', 'migration.apply', 'images.rollback', 'release.deploy'))


class InvalidRequest(Exception):
    pass


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidRequest()
        result[key] = value
    return result


def reply(code, **fields):
    return {'version': 1, 'code': code, **fields}


def evaluate(raw, peer_uid, deploy_uid):
    # Authenticate kernel-supplied identity before interpreting client data.
    if peer_uid not in (0, deploy_uid) or deploy_uid <= 0:
        return reply('FORBIDDEN')
    try:
        if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_REQUEST:
            raise InvalidRequest()
        if not raw.endswith(b'\n') or raw.count(b'\n') != 1:
            raise InvalidRequest()
        request = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object)
        if not isinstance(request, dict) or set(request) != {'version', 'operation'}:
            raise InvalidRequest()
        if type(request['version']) is not int or request['version'] != 1:
            raise InvalidRequest()
        operation = request['operation']
        if not isinstance(operation, str):
            raise InvalidRequest()
        if operation in DISABLED:
            return reply('OPERATION_DISABLED', automationReady=False)
        if operation != 'status.inspect':
            raise InvalidRequest()
        # These are implementation capabilities, NOT live stack health claims.
        # No mutable configuration flag can turn this installation into a deployer.
        return reply('OK', mode='read-only-foundation', automationReady=False,
                     capabilities=['status.inspect'], liveStackVerified=False,
                     blockers=['release-verifier-not-installed', 'live-bootstrap-not-accepted',
                               'runtime-security-gate-open', 'live-recovery-not-accepted'])
    except (InvalidRequest, ValueError, TypeError, RecursionError):
        return reply('INVALID_REQUEST')


def receive_frame(connection):
    deadline = time.monotonic() + REQUEST_SECONDS
    data = bytearray()
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise InvalidRequest()
        connection.settimeout(remaining)
        chunk = connection.recv(MAX_REQUEST + 1 - len(data))
        if not chunk:
            raise InvalidRequest()
        data.extend(chunk)
        if len(data) > MAX_REQUEST:
            raise InvalidRequest()
        if b'\n' in data:
            return bytes(data)


def serve_connection(connection, deploy_uid):
    try:
        # Linux SO_PEERCRED cannot be supplied or overridden by a JSON request.
        _, uid, _ = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid not in (0, deploy_uid):
            result = reply('FORBIDDEN')
        else:
            result = evaluate(receive_frame(connection), uid, deploy_uid)
    except (OSError, InvalidRequest, ValueError):
        result = reply('INVALID_REQUEST')
    try:
        connection.settimeout(1)
        connection.sendall((json.dumps(result, separators=(',', ':')) + '\n').encode())
    except OSError:
        pass
    # Never log request bytes, exception messages, tokens, paths or supplied IDs.


def activated_socket():
    if platform.system() != 'Linux' or platform.machine() != 'x86_64' or socket.gethostname() != EXPECTED_HOST:
        raise RuntimeError()
    if os.getuid() != pwd.getpwnam(SERVICE_USER).pw_uid or os.getuid() == 0:
        raise RuntimeError()
    if os.environ.get('LISTEN_PID') != str(os.getpid()) or os.environ.get('LISTEN_FDS') != '1':
        raise RuntimeError()
    listener = socket.socket(fileno=3)
    if listener.family != socket.AF_UNIX or listener.getsockname() != SOCKET_PATH:
        raise RuntimeError()
    if not listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN):
        raise RuntimeError()
    return listener


def main():
    try:
        deploy_uid = pwd.getpwnam(DEPLOY_USER).pw_uid
        if deploy_uid <= 0 or deploy_uid == os.getuid():
            raise RuntimeError()
        with activated_socket() as listener:
            # Exit after inactivity; systemd socket activation restarts on demand.
            listener.settimeout(60)
            while True:
                try:
                    connection, _ = listener.accept()
                except socket.timeout:
                    return 0
                with connection:
                    serve_connection(connection, deploy_uid)
    except Exception:
        print('Staging broker startup/runtime guard failed.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
