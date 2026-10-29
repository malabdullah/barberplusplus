#!/usr/bin/env python3
"""Bundle two public release subjects without including local environment files."""
import argparse, pathlib, zipfile

LIMIT = 256 * 1024 * 1024

def bundle(source, destination):
    source, destination = pathlib.Path(source), pathlib.Path(destination)
    subjects = [(name, (source / name).read_bytes()) for name in ['backend.tar.gz', 'release.json']]
    if sum(len(data) for _, data in subjects) > LIMIT: raise ValueError('Release subjects too large')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'x') as archive:
        for name, data in subjects:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3; info.external_attr = 0o100600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    return destination

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('source'); parser.add_argument('destination')
    args = parser.parse_args(); bundle(args.source, args.destination)
