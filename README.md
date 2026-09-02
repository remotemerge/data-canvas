# Data Canvas

> Local-first visual analytics workspace where humans and AI agents share the same data, state, and analytical context.

[![Bun Version](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/remotemerge/data-canvas/main/package.json&query=$.engines.bun&label=Bun&logo=bun&style=flat)](https://github.com/remotemerge/data-canvas)
[![Tests](https://img.shields.io/github/actions/workflow/status/remotemerge/data-canvas/test.yml?style=flat&logo=counterstrike&label=test)](https://github.com/remotemerge/totp-php)
[![Sonar Quality](https://img.shields.io/sonar/quality_gate/data-canvas/main?server=https%3A%2F%2Fsonarcloud.io&style=flat&logo=sonarqubecloud&logoColor=126ED3&label=quality)](https://sonarcloud.io/summary/overall?id=data-canvas&branch=main)
[![Sonar Coverage](https://img.shields.io/sonar/coverage/data-canvas/main?server=https%3A%2F%2Fsonarcloud.io&style=flat&logo=sonarqubeserver&logoColor=126ED3)](https://sonarcloud.io/summary/overall?id=data-canvas&branch=main)
[![License](https://img.shields.io/github/license/remotemerge/data-canvas)](https://github.com/remotemerge/data-canvas?tab=MIT-1-ov-file)

Data Canvas is a browser-native environment for exploring, transforming, querying, and visualizing data.

Humans work through the visual interface. AI agents work through WebMCP. Both operate on the same workspace and the same application actions, so a filter applied by an agent is the same filter a human sees and edits. A visualization created by an agent appears directly on the canvas. There is no separate agent-side copy of the workspace.

The application runs in the browser with DuckDB-Wasm. It has no application backend, API server, cloud database, authentication service, or built-in LLM.

## What you can do

### Explore data

- Import CSV, TSV, JSON, and NDJSON files.
- Inspect inferred schemas and column types.
- Browse large datasets through a virtualized table.
- Sort and filter without loading the full dataset into JavaScript.
- Inspect column statistics and distributions.
- Work with several datasets in one workspace.

### Analyze across datasets

Define controlled relationships between datasets and analyze across them without writing join SQL.

Data Canvas supports:

- one-to-one, one-to-many, and many-to-one relationships;
- inner and left joins;
- relationship validation;
- key-quality checks;
- relationship suggestions;
- cross-dataset filters, metrics, and visualizations.

The query compiler resolves relationships and generates the SQL internally.

### Build visualizations

Create and interact with:

- line charts
- area charts
- bar charts
- scatter plots
- donut charts
- KPI cards
- histograms
- box plots
- heatmaps

Charts query DuckDB directly through the application's analytical query model. Large results are aggregated or sampled before reaching the renderer.

When Data Canvas changes the fidelity of a result, the UI tells you. Sampling is never silently applied to KPI values.

### Transform data

Create derived columns through a validated expression model instead of free-form SQL.

Supported operations include:

- arithmetic
- conditional expressions
- date parts
- casts
- numeric and temporal binning

Derived expressions are bounded, type-checked, and compiled by Data Canvas.

Metrics support ordinary aggregates as well as:

- percent of total
- running totals
- time comparisons
- absolute change
- percent change

### Work interactively

Selections and filters are shared workspace state.

You can:

- click charts to filter or highlight related data;
- propagate selections across related datasets;
- choose whether visualizations ignore, highlight, or filter by a selection;
- use additive selections;
- annotate points and ranges;
- undo and redo workspace changes.

## WebMCP

Data Canvas exposes semantic analytical capabilities through WebMCP.

Agents can work with concepts such as:

- workspace state
- datasets and schemas
- column statistics
- analysis queries
- filters
- selections
- visualizations
- metrics
- derived columns
- dataset relationships
- annotations

The WebMCP layer intentionally does not expose:

- arbitrary SQL
- arbitrary JavaScript
- DOM selectors
- screen coordinates
- arbitrary URLs
- raw ECharts configuration
- workspace export

Agent inputs pass through structural and semantic validation before they can affect the workspace.

Write operations use workspace revisions so an agent cannot silently overwrite a newer human change. A stale write is rejected instead.

WebMCP support depends on browser availability. Data Canvas remains fully usable as a human analytical workspace when WebMCP is unavailable.

## Local-first by design

Imported datasets are processed by DuckDB-Wasm inside the browser.

Workspace data and metadata persist locally through the Origin Private File System. Reloading the page restores the workspace without requiring a server.

Data Canvas also supports portable workspace archives for backup and transfer between browser profiles.

There are two export modes:

- definition-only, which exports the analytical structure without dataset contents;
- full, which includes the workspace and dataset data.

The application can also be installed for offline use.

### Privacy boundary

Local-first storage does not mean every AI interaction stays on the device.

Dataset contents stay in the browser unless you explicitly expose information through a connected agent or export the data yourself. If your AI agent runs remotely, information returned through WebMCP may leave the device.

Data Canvas minimizes that exposure.

Read operations are bounded. Schema inspection returns metadata. Analytical tools prefer aggregates. Raw previews have strict row limits. Dataset-derived content is treated as untrusted input.

The application itself does not upload imported datasets to a Data Canvas backend because there is no Data Canvas backend.

## Getting started

### Requirements

- Git
- Bun matching the version declared by the repository
- a modern Chromium-based browser

WebMCP functionality requires a browser build with WebMCP support. Human-facing Data Canvas functionality does not.

### Install

```bash
git clone <repository-url>
cd data-canvas
bun install --frozen-lockfile
```

### Run locally

```bash
bun run dev
```

Then open the local URL printed by Vite.

### Production build

```bash
bun run build
bun run preview
```

## Project principles

Data Canvas is intentionally opinionated about a few things.

Data should remain under the application's control. An agent gets explicit capabilities, not unrestricted access to the database.

The visual workspace is the shared state. Humans and agents do not work in separate copies and synchronize later.

Analytical work belongs in DuckDB. React and ECharts receive bounded results instead of becoming data-processing engines.

Local-first means the application remains useful without an application server. It does not make misleading promises about external AI processing.

Those constraints shape the project more than any individual library.
