# aethis-mcp

MCP server for the [Aethis](https://aethis.ai) developer API — run eligibility checks from Claude, Cursor, Windsurf, or any MCP-compatible client.

## Install

```bash
pip install aethis-mcp
# or run directly
uvx aethis-mcp
```

## Configure

Set your API key:

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

### Cursor

Add to `.cursor/mcp.json`:

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

| Tool | Description |
|------|-------------|
| `aethis_schema` | Get input fields required for an eligibility check |
| `aethis_decide` | Evaluate eligibility against a published rule bundle |
| `aethis_next_question` | Get the Z3-optimized next question to ask (conversational loop) |
| `aethis_explain` | Get human-readable rule descriptions |
| `aethis_list_projects` | List all projects in the current tenant |
| `aethis_project_status` | Check project status and generation progress |
| `aethis_generate` | Trigger rule generation for a project |

## Example: conversational eligibility

```
User: Check if this applicant is eligible for space_crew_cert:20490101-00000001

Claude: [calls aethis_next_question with empty field_values]
       → "How many simulator hours has the applicant completed?"

User: 500 hours

Claude: [calls aethis_next_question with {"simulator_hours": 500}]
       → "Is the applicant flight-fitness certified?"

User: Yes

Claude: [calls aethis_next_question with {"simulator_hours": 500, "flight_fitness_certified": true}]
       → Decision: eligible. No more questions needed.
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
