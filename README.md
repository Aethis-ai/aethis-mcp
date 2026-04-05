# aethis-mcp

MCP server for the [Aethis](https://aethis.ai) developer API — run regulated eligibility checks from Claude, Cursor, Windsurf, or any MCP-compatible client.

## What is Aethis?

Aethis turns legislation, policy documents, and compliance rules into executable **rule bundles** — structured decision logic that can be evaluated programmatically. This MCP server lets AI coding assistants interact with Aethis directly: query eligibility, walk users through conversational assessments, and author new rule bundles using a test-driven workflow.

**Core concepts:**
- **Rule bundle** — a published, versioned set of decision rules generated from source text
- **Project** — a workspace where you upload source legislation, add test cases, and iterate on rule generation
- **Decision** — evaluating a set of input fields against a bundle to get an eligibility outcome (`eligible`, `not_eligible`, or `undetermined`)

## Install

```bash
pip install aethis-mcp
# or run directly
uvx aethis-mcp
```

## Configure

Set your API key (get one at [aethis.ai](https://aethis.ai)):

```bash
export AETHIS_API_KEY=ak_live_...
export AETHIS_BASE_URL=https://api.aethis.ai  # optional
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aethis": {
      "command": "uvx",
      "args": ["aethis-mcp"],
      "env": { "AETHIS_API_KEY": "ak_live_..." }
    }
  }
}
```

### Claude Code

```bash
claude mcp add aethis -- uvx aethis-mcp
```

### Cursor / Windsurf

Add to `.cursor/mcp.json` (or equivalent):

```json
{
  "mcpServers": {
    "aethis": {
      "command": "uvx",
      "args": ["aethis-mcp"],
      "env": { "AETHIS_API_KEY": "ak_live_..." }
    }
  }
}
```

## Tools

### Decision tools (consume published rule bundles)

| Tool | Description |
|------|-------------|
| `aethis_schema` | Get input fields required for an eligibility check |
| `aethis_decide` | Evaluate eligibility against a published rule bundle |
| `aethis_next_question` | Get the optimal next question to ask (conversational loop) |
| `aethis_explain` | Get human-readable rule descriptions |

### Discovery tools

| Tool | Description |
|------|-------------|
| `aethis_list_projects` | List all projects in the current tenant |
| `aethis_project_status` | Check project status and generation progress |

### Authoring tools (TDD-driven rule creation)

| Tool | Description |
|------|-------------|
| `aethis_create_ruleset` | Create a project with source text + test cases (TDD-first) |
| `aethis_generate` | Trigger async rule generation |
| `aethis_generate_and_test` | Generate rules and run all tests with diagnostics |
| `aethis_add_guidance` | Add subject-matter-expert domain knowledge |
| `aethis_refine` | Add optional feedback then regenerate and test |
| `aethis_publish` | Publish a bundle (blocks on test failures unless forced) |

## Example: conversational eligibility

```
User: Check if this crew member is eligible for space_crew_cert:20490101-00000001

Claude: [calls aethis_next_question with empty field_values]
       → "How many flight hours does the crew member have?"

User: 600 hours

Claude: [calls aethis_next_question with {"space.crew.flight_hours": 600}]
       → "Is the medical certificate valid?"

User: Yes

Claude: [calls aethis_next_question with {"space.crew.flight_hours": 600, "space.medical.cert_valid": true}]
       → Decision: eligible. No more questions needed.
```

## Example: authoring rules (TDD workflow)

```
User: Create eligibility rules from this policy: "Crew members need 500+ flight hours
      and a valid medical certificate, OR 10+ years of service."

Claude: [calls aethis_create_ruleset with source text and test cases]
       → Project proj_abc created with 3 test cases.

Claude: [calls aethis_generate_and_test]
       → Iteration 1: 2/3 passing. STILL FAILING: veteran_no_medical.
         Diagnosis: service_years criterion missing from generated rules.

Claude: [calls aethis_refine with feedback about the 10-year service exemption]
       → Iteration 2: 3/3 passing. All tests passing! Call aethis_publish to publish.
```

## Development

```bash
git clone https://github.com/aethis-ai/aethis-mcp.git
cd aethis-mcp
uv sync --dev
uv run pytest tests/ -v
```

## License

MIT
