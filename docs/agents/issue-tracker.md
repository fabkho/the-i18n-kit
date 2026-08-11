# Issue tracker

Specs and issues for this project live in **GitHub Issues** on
`fabkho/the-i18n-kit`, managed with the `gh` CLI.

## Creating a spec

```bash
gh issue create --title "<title>" --label "ready-for-agent" --body-file <file>
```

Add a topical label alongside `ready-for-agent` where one fits
(`documentation`, `enhancement`, `bug`).

## Labels

| Label | Meaning |
|---|---|
| `ready-for-agent` | Spec is complete; an agent can pick this up. No further triage needed. |
| `documentation` | Docs and reference material. |
| `enhancement` | New capability. |
| `bug` | Defect in existing behaviour. |

Do not use the local `.scratch/` markdown tracker for this project.
