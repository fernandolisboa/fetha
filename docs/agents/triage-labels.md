# Triage labels

Canonical labels on the GitHub repo. An issue carries exactly one state label at a time.

| label             | meaning                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| `needs-triage`    | new; nobody has assessed it yet                                          |
| `needs-info`      | blocked on a question only the owner can answer                          |
| `ready-for-agent` | fully specified; an implementer agent can take it without asking         |
| `ready-for-human` | requires a login, a secret, a payment or a product decision by the owner |
| `wontfix`         | closed without action, with the reason in the closing comment            |

Area labels (additive): `engine`, `market-data`, `strategies`, `portfolio`, `decisions`, `auth`,
`ui`, `infra`, `security`, `lgpd`, `docs`.
Severity labels for security findings: `severity:critical`, `severity:high`, `severity:medium`,
`severity:low`, `severity:informational`.
