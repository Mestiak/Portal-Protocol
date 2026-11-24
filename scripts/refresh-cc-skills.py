#!/usr/bin/env python3
"""Regenerate src/lib/ccSkillIds.ts from the official GW2 API skill tooltips.

Run from the repo root:

    curl -s "https://api.guildwars2.com/v2/skills?ids=all&page_size=200" -o /tmp/s1.json
    curl -s "https://api.guildwars2.com/v2/skills?ids=all&page_size=200&page=1" -o /tmp/s2.json
    python scripts/refresh-cc-skills.py /tmp/s1.json /tmp/s2.json

Every tooltip that states an effect it applies to foes becomes a table entry.
Tooltips that only describe a state ("dazed foes", "disables include ...") are
skipped, as is anything about reducing incoming control effects.
"""
import io
import json
import re
import sys

EXCLUDE = re.compile(r'reduc|incoming|disables include|controls include|defiant foe')
# Verb forms only: "dazes"/"daze"/"dazing" apply it; "dazed foes" only describes it.
PATS = {
    'daze': r'\bdaz(?:e|es|ing)\b',
    'fear': r'\bfear\b(?!\w)',
    'knockdown': r'\bknock(?:s|ing)?\s?down\b',
}
OUT = 'src/lib/ccSkillIds.ts'


def load(paths):
    skills = {}
    for p in paths:
        with io.open(p, encoding='utf-8') as fh:
            for s in json.load(fh):
                if isinstance(s, dict) and s.get('id'):
                    skills[s['id']] = s
    return skills


def build(skills):
    cats = {}
    names = {}
    for sid, s in sorted(skills.items()):
        name = (s.get('name') or '').strip()
        desc = (s.get('description') or '').replace('\r', ' ').replace('\n', ' ')
        if not name or len(desc.strip()) < 10:
            continue
        hit = set()
        for sent in re.split(r'(?<=[.!]) ', desc.lower()):
            if EXCLUDE.search(sent):
                continue
            for cat, pat in PATS.items():
                if re.search(pat, sent):
                    hit.add(cat)
        if hit:
            cats[str(sid)] = sorted(hit)
            names[str(sid)] = name
    return cats, names


def render(cats, names):
    lines = [
        '/**',
        ' * Skill ids that apply a control effect to foes.',
        ' *',
        ' * Generated from the official GW2 API tooltips (`GET /v2/skills?ids=all`):',
        ' * each tooltip states the effect it applies, so the table is derived from',
        ' * source data rather than typed by hand. Regenerate with',
        ' * `scripts/refresh-cc-skills.py`.',
        ' *',
        ' * %d skills.' % len(cats),
        ' */',
        "export type CcCategory = 'daze' | 'fear' | 'knockdown';",
        '',
        'export const CC_SKILL_IDS: Record<string, CcCategory[]> = {',
    ]
    for k in sorted(cats, key=lambda x: int(x)):
        lines.append('  %s: %s, // %s' % (k, json.dumps(cats[k]), names[k].replace('/', '\\/')))
    lines += ['};', '']
    return '\n'.join(lines)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cats, names = build(load(sys.argv[1:]))
    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(render(cats, names))
    print('wrote %d entries to %s' % (len(cats), OUT))
