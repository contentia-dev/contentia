# contentia agent skills

Installable [agent skills](https://skills.sh) for working with contentia. They run in Claude Code,
Codex, Cursor, and other agents that support the SKILL.md format.

## Install

```bash
# install every contentia skill
npx skills add contentia-dev/contentia

# or pick one
npx skills add contentia-dev/contentia --skill contentia-docs

# list what's available first
npx skills add contentia-dev/contentia --list
```

Skills install into your agent's skill directory (e.g. `.claude/skills/`) and are picked up
automatically.

## Available skills

| Skill                                                                | What it does                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`contentia-docs`](./contentia-docs)                                 | Finds and reads the contentia documentation matching the exact version installed in your project — so the agent answers from version-accurate docs instead of memory.                                                                                                                               |
| [`decap-oauth2-adversarial-probe`](./decap-oauth2-adversarial-probe) | Red-teams the `decap-oauth2` authorization server against an adversary holding an unbounded botnet and a quantum computer. Fixes what is fixable and installs blocking runtime safety gates for what is not. Needs a checkout of the package source, and runs best on the strongest model you have. |
