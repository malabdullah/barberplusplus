#!/usr/bin/env python3
"""PROPOSED one-file conditional tightening. No contents, creation or key access."""
import errno
import fcntl
import json
import os
import pathlib
import stat
import sys

LOCK = pathlib.Path('/var/lib/barber-release-backend/backend.lock')


def metadata(info):
    return {'uid': info.st_uid, 'gid': info.st_gid, 'mode': format(stat.S_IMODE(info.st_mode), '04o'),
            'regular': stat.S_ISREG(info.st_mode), 'directory': stat.S_ISDIR(info.st_mode),
            'symlink': stat.S_ISLNK(info.st_mode), 'links': info.st_nlink, 'size': info.st_size,
            'device': info.st_dev, 'inode': info.st_ino}


def same_inode(left, right):
    return (left.st_dev, left.st_ino) == (right.st_dev, right.st_ino)


def conditional_tighten(path, *, expected_uid=0):
    """Path/UID injection is for disposable tests; main has one fixed root target."""
    path = pathlib.Path(path)
    result = {'path': str(path), 'status': 'STOP_UNVERIFIED', 'modeChanged': False, 'contentsRead': False,
              'inodeReplaced': False, 'ownershipChanged': False}
    parent = path.parent
    parent_info = parent.lstat()
    result['parent'] = metadata(parent_info)
    if (not stat.S_ISDIR(parent_info.st_mode) or parent_info.st_uid != expected_uid
            or stat.S_IMODE(parent_info.st_mode) != 0o700 or parent.resolve() != parent):
        result['status'] = 'STOP_PARENT'
        return result
    directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    file = None
    try:
        if not same_inode(parent_info, os.fstat(directory)):
            result['status'] = 'STOP_PARENT_DRIFT'
            return result
        initial = os.stat(path.name, dir_fd=directory, follow_symlinks=False)
        result['before'] = metadata(initial)
        permitted = (stat.S_ISREG(initial.st_mode) and initial.st_uid == expected_uid
                     and initial.st_nlink == 1 and initial.st_size == 0
                     and stat.S_IMODE(initial.st_mode) in (0o600, 0o640, 0o644))
        if not permitted:
            result['status'] = 'STOP_FILE_INVARIANTS'
            return result
        file = os.open(path.name, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        opened = os.fstat(file)
        if not same_inode(initial, opened):
            result['status'] = 'STOP_OPEN_DRIFT'
            return result
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno not in (errno.EAGAIN, errno.EACCES):
                raise
            result['status'] = 'STOP_BUSY'
            return result
        current = os.fstat(file)
        named = os.stat(path.name, dir_fd=directory, follow_symlinks=False)
        parent_now = parent.lstat()
        if (metadata(current) != metadata(initial) or metadata(named) != metadata(initial)
                or metadata(parent_now) != metadata(parent_info)):
            result['status'] = 'STOP_LOCKED_DRIFT'
            return result
        if stat.S_IMODE(current.st_mode) != 0o600:
            os.fchmod(file, 0o600)
            result['modeChanged'] = True
        after = os.fstat(file)
        named_after = os.stat(path.name, dir_fd=directory, follow_symlinks=False)
        result['after'] = metadata(after)
        if (not same_inode(after, initial) or not same_inode(named_after, initial)
                or after.st_uid != initial.st_uid or after.st_gid != initial.st_gid
                or after.st_size != 0 or after.st_nlink != 1 or stat.S_IMODE(after.st_mode) != 0o600
                or metadata(parent.lstat()) != metadata(parent_info)):
            result['status'] = 'STOP_POSTCONDITION_REVIEW_REQUIRED'
            return result
        result['status'] = 'TIGHTENED_SAME_INODE' if result['modeChanged'] else 'ALREADY_SECURE_NOOP'
        return result
    finally:
        if file is not None:
            os.close(file)
        os.close(directory)


def main():
    if len(sys.argv) != 1 or os.geteuid() != 0 or os.uname().nodename.split('.')[0] != 'srv1073968':
        raise ValueError('FIXED_ROOT_DB_TARGET_ONLY')
    result = conditional_tighten(LOCK)
    print(json.dumps(result))
    return 0 if result['status'] in ('ALREADY_SECURE_NOOP', 'TIGHTENED_SAME_INODE') else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'status': 'STOP_METADATA_UNAVAILABLE', 'reason': type(error).__name__, 'contentsRead': False}))
        raise SystemExit(2)
