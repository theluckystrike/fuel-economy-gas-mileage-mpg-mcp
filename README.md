# fuel-economy-gas-mileage-mpg-mcp

Fuel economy and gas mileage for AI assistants: the EPA city, highway and combined MPG of any car, truck, hybrid or EV by year, make and model, its EV range, what it costs to fuel a year, and side-by-side comparisons. Ask what MPG a 2026 RAV4 gets, whether a Model Y is cheaper to run than an F-150 hybrid, or what your 28 MPG car costs in gas a month.

This is a Model Context Protocol (MCP) server. It reads the U.S. Department of Energy and EPA fueleconomy.gov web services at call time. It needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `fuel_economy_lookup` | Every version of a year, make and model: EPA city, highway and combined MPG (MPGe, kWh/100 mi and range for an EV; gas MPG, electric MPGe and electric range for a plug-in hybrid), EPA annual fuel cost, 5-year savings against the average new car, CO2, EPA scores and the MPG real drivers report. |
| `fuel_economy_compare` | 2 to 4 vehicles side by side: MPG or MPGe, range, and the yearly and 5-year fuel cost difference at current national average prices for your miles. |
| `fuel_cost_calculator` | Yearly and monthly fuel cost and cost per mile from an MPG figure, a kWh/100 mi figure or a vehicle, at national average prices or your own. Plug-in hybrids get gas-only, electric-only and an EPA utility-factor blend. |
| `fuel_economy_models` | Makes with EPA ratings for a model year, the models of a make, or every version of a model (transmission, cylinders, engine) with its fueleconomy.gov id. |

Every result has structured JSON, a plain-text summary, `as_of`, `source` and `more` (a page on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=fuel-economy-gas-mileage-mpg-mcp)). Every tool is marked read-only.

## What it knows that your model does not

- The EPA label numbers for each version, not a rounded model average: a 2026 RAV4 runs from 38 to 43 combined MPG depending on the version.
- Current national average fuel and electricity prices from fueleconomy.gov, so fuel cost answers use today's prices rather than a training-time guess.
- Model years up to next year as soon as the EPA lists them, plus the average MPG that real drivers report on fueleconomy.gov when there are reports.

## Install

### Hosted (custom connector, ChatGPT developer mode, any remote MCP client)

Paste this URL. No token, no sign-up.

```
https://fuel-economy-gas-mileage-mpg-mcp.lipmichal.workers.dev/mcp
```

### Cursor

Add to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "fuel-economy-mpg": { "url": "https://fuel-economy-gas-mileage-mpg-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`.

```json
{
  "servers": {
    "fuel-economy-mpg": { "type": "http", "url": "https://fuel-economy-gas-mileage-mpg-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Local stdio

The npm package is not published. Build it from this repository with Node 20 or newer, then point your MCP client at `node /path/to/fuel-economy-gas-mileage-mpg-mcp/dist/stdio.js`.

```
git clone https://github.com/theluckystrike/fuel-economy-gas-mileage-mpg-mcp && cd fuel-economy-gas-mileage-mpg-mcp
npm install && npm run build
node dist/stdio.js
```

## Example prompts

- "What gas mileage does a 2026 Toyota RAV4 get?"
- "Is a 2025 Tesla Model Y cheaper to run than a 2026 Ford F-150 hybrid if I drive 12,000 miles a year?"
- "How much will I spend on gas a month with a 28 MPG car and 1,000 miles a month?"
- "What is the electric range of the 2026 Ford Escape plug-in hybrid?"

## Data sources

Full list in [DATA_SOURCES.md](DATA_SOURCES.md).

- fueleconomy.gov web services (U.S. Department of Energy and EPA): https://www.fueleconomy.gov/feg/ws/

## Limitations

- US-market vehicles rated by the EPA only, model years 1984 to next year.
- A make and model query picks the matching fueleconomy.gov models by name; a very broad name (Corolla) reads the first 10 matching models and 12 versions. Add a trim word or use a version id to be exact.
- Annual costs use national average prices and the EPA assumptions (15,000 miles, 55% city) unless you pass your own; local prices differ.
- My MPG averages are voluntary driver reports and exist for only some vehicles.

## More

More MCP servers that answer questions your assistant cannot answer alone are on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=fuel-economy-gas-mileage-mpg-mcp).

Part of the Zovo MCP collection at https://mcp.zovo.one

Built by [theluckystrike](https://github.com/theluckystrike).

## Development

```
npm install
npm test                              # builds, then runs the fixture tests and an offline stdio test
node scripts/stdio-transcript.mjs     # live stdio round trip, writes .live/stdio-transcript.jsonl
```

CI (`.github/workflows/bundle.yml`) runs the tests, the type check and `wrangler deploy --dry-run --outdir out`, and uploads the Worker bundle as an artifact.

## License

MIT
