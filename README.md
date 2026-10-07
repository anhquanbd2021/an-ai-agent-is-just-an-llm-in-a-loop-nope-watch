# Runway Replay — companion demo

Interactive lab for the article *An Agent Is Not an LLM in a Loop — It Is a
Control Loop You Can Replay*. One request — `book me a flight` — moves
through a deterministic agent control loop: plan, parallel fan-out, evidence
merge, a gate, a bounded re-plan, and exactly one booking call.

Zero dependencies — Node 24+ only. The domain model `public/lab.mjs` is a
plain ES module shared by the browser UI, the CLI, the server API, and the
tests.

## What it proves

The lab replays the article's core claim: an agent is a state machine around
the model, not the model itself. The **fixed** policy runs the one-pass script
from the article — Search returns `[]`, the script still posts `POST /book`,
the fixture answers `422 NO_ITINERARY`, and the run reports success anyway.
The **agent** policy replans after the empty search (`flexible:true`), passes
the evidence gate, and books exactly once. With `always_empty`, the same
policy blocks with `SEARCH_EMPTY` after `MAX_RETRIES` and never books.

- `npm start` — serve the lab on http://localhost:3000
- `npm test` — unit + server + e2e suites
- `npm run lab` — CLI replay of both policies

Repo: https://github.com/anhquanbd2021/an-ai-agent-is-just-an-llm-in-a-loop-nope-watch
