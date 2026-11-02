#!/usr/bin/env python3
"""Report bounded mismatch positions and hashes without disclosing SQL text."""
import difflib
import hashlib
import json
import pathlib
import sys

def summary(expected, actual):
    left, right = expected.splitlines(), actual.splitlines()
    digest = lambda lines: [hashlib.sha256(line.encode()).hexdigest() for line in lines[:8]]
    return [{'expectedLine':a+1,'actualLine':c+1,'expectedCount':b-a,'actualCount':d-c,
             'expectedHashes':digest(left[a:b]),'actualHashes':digest(right[c:d])}
            for kind,a,b,c,d in difflib.SequenceMatcher(None,left,right,autojunk=False).get_opcodes()
            if kind != 'equal'][:20]

if __name__ == '__main__':
    print(json.dumps({'schemaDrift':summary(pathlib.Path(sys.argv[1]).read_text(),pathlib.Path(sys.argv[2]).read_text())}))
