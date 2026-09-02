# Issue tracker

GitHub Issues on `fernandolisboa/fetha`, driven through the `gh` CLI.

- Create: `gh issue create --title "<title>" --body "<body>" --label <labels>`
- List: `gh issue list --label <label> --state open`
- Read: `gh issue view <n>`
- Close: `gh issue close <n>` (PRs close their ticket with `Closes #<n>` in the body).

Tickets are written in English. Titles are imperative (`Add candle chart for a ticker`).
Every ticket carries acceptance criteria as a checklist and names the tests that prove them.
Engine tickets are marked with the `engine` label and must be implemented with `/tdd`.
UI tickets are marked with the `ui` label and end with the design gate.

Branches are named `<n>-<slug>` (`12-candle-chart`). One PR per ticket, squash-merged.
