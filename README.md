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

First publish a bundle using [`aethis-cli`](https://github.com/aethis-ai/aethis-cli) or the API, then use the MCP tools to interact with it.

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

## Development

```bash
git clone https://github.com/aethis-ai/aethis-mcp.git
cd aethis-mcp
uv sync --dev
uv run pytest tests/ -v
```

## License

MIT
