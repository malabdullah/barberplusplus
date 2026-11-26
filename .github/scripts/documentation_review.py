"""Read-only PR documentation policy. No dependencies, network calls or app tests."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys


FIELDS = ('PRD', 'PRD reason', 'AGENTS', 'AGENTS reason', 'Feature status', 'Release evidence')
PLACEHOLDER = re.compile(r'^(?:TODO|TBD|REPLACE|SELECT)\b|^(?:\.{3}|…)$', re.I)


def meaningful(value):
    return len(value.strip()) >= 15 and not PLACEHOLDER.search(value)


def review(body, changed):
    """Return fixed error messages; never echo untrusted PR text into logs."""
    body = re.sub(r'<!--.*?-->', '', body or '', flags=re.S)
    body = re.sub(r'^```[^\n]*\n.*?^```[^\n]*$', '', body, flags=re.M | re.S)
    sections = re.findall(r'^## Documentation review\s*\n(.*?)(?=^## |\Z)', body, re.M | re.S)
    if len(sections) != 1:
        return ['Provide exactly one ## Documentation review section using the PR template.']
    values = {}
    errors = []
    for field in FIELDS:
        matches = re.findall(r'^' + re.escape(field) + r':[ \t]*(.*)$', sections[0], re.M | re.I)
        if len(matches) != 1:
            errors.append(f'Provide exactly one {field} field in Documentation review.')
        else:
            values[field] = matches[0].strip()
    if errors:
        return errors
    for document in ('PRD', 'AGENTS'):
        decision = values[document].lower()
        filename = document + '.md'
        state = changed.get(filename)
        if decision not in ('updated', 'unchanged'):
            errors.append(f'{document} must be updated or unchanged; replace template choices.')
        elif state == 'D':
            errors.append(f'Do not delete {filename}; preserve the project documentation.')
        elif decision == 'updated' and state not in ('A', 'M', 'T'):
            errors.append(f'{document} says updated but {filename} is not changed in this PR.')
        elif decision == 'unchanged' and state:
            errors.append(f'{document} says unchanged but {filename} is changed in this PR.')
        if not meaningful(values[document + ' reason']):
            errors.append(f'{document} reason must explain the documentation impact; replace placeholders.')
    status = values['Feature status'].lower()
    if status not in ('unchanged', 'production', 'test-only', 'planned', 'retired'):
        errors.append('Feature status must be unchanged, production, test-only, planned or retired.')
    elif status != 'unchanged' and values['PRD'].lower() != 'updated':
        errors.append('Feature status changes require an updated PRD.md in this PR.')
    if status == 'production':
        evidence = values['Release evidence']
        if not meaningful(evidence) or evidence.lower() in ('not applicable', 'none', 'n/a'):
            errors.append('Production status requires a reference to verified release evidence, not a planned merge.')
    return errors


def changed_files(base, head, cwd=None):
    for revision in (base, head):
        if not re.fullmatch(r'[0-9a-f]{40,64}', revision):
            raise ValueError('Expected an immutable Git commit SHA.')
    data = subprocess.check_output(
        ['git', 'diff', '--name-status', '--no-renames', '-z', f'{base}...{head}', '--'], cwd=cwd
    ).decode('utf-8').split('\0')
    if data[-1] == '':
        data.pop()
    if len(data) % 2:
        raise ValueError('Incomplete changed-file inventory.')
    return {data[index + 1]: data[index] for index in range(0, len(data), 2)}


def main():
    try:
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
        pr = event['pull_request']
        errors = review(pr.get('body'), changed_files(pr['base']['sha'], pr['head']['sha']))
    except (KeyError, ValueError, OSError, subprocess.CalledProcessError):
        print('Documentation check could not read the PR or complete its Git diff; failing closed.')
        return 1
    for error in errors:
        print('ERROR: ' + error)
    if not errors:
        print('Documentation declarations match the changed files. Human review must verify accuracy and release evidence.')
    return bool(errors)


if __name__ == '__main__':
    sys.exit(main())
