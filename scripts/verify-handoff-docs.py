"""Offline validation of maintained handoff links and portable skill copies."""

import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
MAINTAINED = (
    'README.md', 'AGENTS.md', 'PRD.md', 'docs/README.md', 'docs/handoff.md',
    'docs/handoff-state.md', 'docs/architecture.md', 'docs/agent-portability.md',
    'docs/documentation-policy.md', 'docs/environments.md', 'docs/cloud-test.md',
    'docs/deployment-runbook.md', 'docs/backup-restore.md',
)
LINK = re.compile(r'\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"\n]*")?\)')


def prose(text):
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    result = []
    fence = None
    for line in text.splitlines():
        match = re.match(r'^\s*(`{3,}|~{3,})', line)
        if match:
            marker = match[1]
            if fence is None:
                fence = marker
            elif marker[0] == fence[0] and len(marker) >= len(fence):
                fence = None
            continue
        if fence is None:
            result.append(line)
    return '\n'.join(result)


def anchors(text):
    counts = {}
    found = set()
    for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', prose(text), re.M):
        slug = re.sub(r'[^\w\- ]', '', heading.lower()).replace(' ', '-')
        number = counts.get(slug, 0)
        counts[slug] = number + 1
        found.add(slug + (f'-{number}' if number else ''))
    return found


def check_links(root, relative, text=None):
    root = Path(root).resolve()
    document = root / relative
    if not document.is_file():
        return [f'Missing maintained document: {relative}']
    source = document.read_text() if text is None else text
    errors = []
    for match in LINK.finditer(prose(source)):
        destination = match[1].strip('<>')
        link = urlsplit(destination)
        if link.scheme or link.netloc:
            if link.scheme == 'file':
                errors.append(f'{relative}: machine-specific file URL is not portable')
            continue  # External/private URLs require separate authorized verification.
        path = unquote(link.path)
        if path.startswith('/'):
            errors.append(f'{relative}: absolute local link is not portable')
            continue
        target = (document.parent / path).resolve() if path else document
        if target != root and root not in target.parents:
            errors.append(f'{relative}: local link escapes repository')
        elif not target.exists():
            errors.append(f'{relative}: missing local target {destination}')
        elif link.fragment and target.suffix.lower() == '.md':
            if unquote(link.fragment) not in anchors(target.read_text()):
                errors.append(f'{relative}: missing Markdown anchor {destination}')
    return errors


def check_skills(root):
    directory = Path(root) / 'docs/agent-skills'
    manifest = json.loads((directory / 'manifest.json').read_text())
    errors = []
    expected = manifest['files']
    actual = {str(p.relative_to(directory)) for p in directory.rglob('*')
              if p.is_file() and p.name != 'manifest.json'}
    if actual != set(expected):
        errors.append('Portable skill inventory differs from its reviewed manifest')
    for name, digest in expected.items():
        target = (directory / name).resolve()
        if directory.resolve() not in target.parents or not target.is_file():
            errors.append('Invalid or missing portable skill file')
        elif hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            errors.append(f'Portable skill content changed without manifest update: {name}')
        elif target.suffix == '.md':
            errors.extend(check_links(root, str(target.relative_to(Path(root).resolve()))))
    policy = (directory / 'full-regression-testing/agents/openai.yaml').read_text()
    if not re.search(r'^policy:\s*\n\s+allow_implicit_invocation:\s*false\s*$', policy, re.M):
        errors.append('Full regression skill must retain its explicit-only invocation policy')
    return errors


def main():
    errors = []
    for relative in MAINTAINED:
        errors.extend(check_links(ROOT, relative))
    # Validate notices, without interpreting historical code samples as current setup.
    for document in (ROOT / 'docs').rglob('*.md'):
        text = document.read_text()
        if text.startswith('> **'):
            notice = text.split('\n\n', 1)[0]
            errors.extend(check_links(ROOT, str(document.relative_to(ROOT)), notice))
    try:
        errors.extend(check_skills(ROOT))
    except (KeyError, ValueError, OSError):
        errors.append('Portable skill manifest/policy cannot be validated')
    if errors:
        print('\n'.join('ERROR: ' + error for error in errors))
        return 1
    print('Maintained handoff links, historical notice links, portable skill inventory and explicit-only policy passed.')
    print('External/private URLs, credentials, runtime health and migration acceptance are not certified by this offline check.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
