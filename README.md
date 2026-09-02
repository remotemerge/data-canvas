# Data Canvas

> The shared visual analytics workspace where people and AI agents work on the same data together.

[![Bun Version](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/remotemerge/data-canvas/main/package.json&query=$.engines.bun&label=Bun&logo=bun&style=flat)](https://github.com/remotemerge/data-canvas)
[![Tests](https://img.shields.io/github/actions/workflow/status/remotemerge/data-canvas/test.yml?style=flat&logo=counterstrike&label=test)](https://github.com/remotemerge/data-canvas/actions/workflows/test.yml)
[![Sonar Quality](https://img.shields.io/sonar/quality_gate/data-canvas/main?server=https%3A%2F%2Fsonarcloud.io&style=flat&logo=sonarqubecloud&logoColor=126ED3&label=quality)](https://sonarcloud.io/summary/overall?id=data-canvas&branch=main)
[![Sonar Coverage](https://img.shields.io/sonar/coverage/data-canvas/main?server=https%3A%2F%2Fsonarcloud.io&style=flat&logo=sonarqubeserver&logoColor=126ED3)](https://sonarcloud.io/summary/overall?id=data-canvas&branch=main)
[![License](https://img.shields.io/github/license/remotemerge/data-canvas)](https://github.com/remotemerge/data-canvas?tab=MIT-1-ov-file)

Data Canvas is a browser-based workspace for exploring and visualizing local data. Humans use the web interface, while AI agents use semantic WebMCP tools. Both routes execute the same application actions against one workspace, so agent changes appear in the interface immediately.

DuckDB-Wasm performs ingestion and analytical queries in the browser. The application has no backend, API server, cloud database, authentication service, or built-in LLM. Workspace state is memory-only and resets when the page reloads.

## Major features

- **Local data exploration.** Import CSV, TSV, JSON, and NDJSON files up to 512 MB and 512 columns. Inspect inferred schemas and column statistics, then browse filtered and sorted data through 500-row DuckDB windows and a virtualized table.
- **Visual analysis.** Create line, bar, area, scatter, donut, KPI, histogram, box plot, and heatmap views. Data Canvas builds analytical queries from project-owned visualization definitions and converts bounded results to ECharts options.
- **Multi-dataset analysis.** Define one-to-one, one-to-many, or many-to-one relationships with inner or left joins. Relationship suggestions, key validation, and fan-out warnings help prevent invalid or inflated results.
- **Controlled transformations and metrics.** Add type-checked arithmetic or date-part columns through the interface. WebMCP also accepts structured conditionals, literals, bins, and casts. Reusable metrics support ordinary aggregates, percent of total, running totals, and period comparisons.
- **Linked interaction.** Filters and selections affect tables, charts, and agent reads through shared workspace state. Visualizations can ignore, highlight, or filter by external selections. Users and agents can also add chart annotations and undo or redo workspace changes.
- **Installable browser application.** The production build includes a web app manifest and service worker. Its precache includes the DuckDB Wasm artifacts needed to start offline after the assets have been cached.

## Technology stack

The application is built with the following core technologies and minimum supported versions.

| Technology        | Version | Purpose                                                                                                               |
| ----------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| React / React DOM | >=19.2  | Renders the workspace and user interactions.                                                                          |
| TypeScript        | >=7.0   | Defines domain, application, adapter, and UI contracts.                                                               |
| DuckDB-Wasm       | >=1.33  | Imports local files and runs filtering, sorting, joins, aggregation, statistics, and bounded row queries in a worker. |
| Zustand           | >=5.0   | Stores normalized workspace metadata, revisions, and action history. Raw dataset rows stay in DuckDB.                 |
| TanStack Table    | >=9.2   | Provides table models while sorting, filtering, and pagination remain engine-controlled.                              |
| TanStack Virtual  | >=3.14  | Limits rendered table rows to the visible window and overscan.                                                        |
| Apache ECharts    | >=6.1   | Renders chart options produced by the visualization adapter.                                                          |
| Ajv               | >=8.20  | Compiles structural validators for WebMCP inputs.                                                                     |
| Vite              | >=8.2   | Runs the development server and creates production builds.                                                            |
| vite-plugin-pwa   | >=1.3   | Generates the web app manifest, service worker, and offline asset cache.                                              |
| Bun               | >=1.4   | Installs dependencies, runs tests and quality checks, and invokes project scripts.                                    |

## WebMCP tools

Data Canvas registers the following tools when the browser supplies `document.modelContext`. It also supports the deprecated `navigator.modelContext` location as a fallback. Inputs pass through Ajv validation and semantic validation against the current workspace. Write tools use the shared dispatcher, and revision-aware writes reject stale changes. No tool accepts raw SQL, JavaScript, URLs, DOM selectors, or ECharts options.

| Tool                    | Title                       | Description                                                                                                                |
| ----------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `list_relationships`    | List dataset relationships  | Lists defined dataset joins and can return up to five suggestions inferred from matching column names and types.           |
| `get_column_statistics` | Get column statistics       | Returns bounded counts, numeric statistics, and frequent values for one column.                                            |
| `get_workspace`         | Get workspace               | Returns the revision and IDs and summaries for workspace entities without reading row values.                              |
| `get_dataset_schema`    | Get dataset schema          | Returns a page of up to five columns and can include schemas from directly related datasets.                               |
| `preview_data`          | Preview dataset rows        | Returns at most 100 filtered rows, with optional column projection and bounded string values.                              |
| `analyze_data`          | Analyze data                | Computes grouped aggregates, rankings, and time-bucketed results over filtered data, including reachable related datasets. |
| `create_relationship`   | Create dataset relationship | Connects two datasets through validated key columns, cardinality, and join type, then reports detected fan-out.            |
| `create_derived_column` | Create derived column       | Adds a computed column from a validated expression tree rather than a formula string or SQL.                               |
| `clear_selection`       | Clear selection             | Clears highlighted selections for one dataset or the whole workspace.                                                      |
| `undo`                  | Undo workspace change       | Reverses the most recent reversible human or agent workspace action.                                                       |
| `redo`                  | Redo workspace change       | Reapplies the change most recently reversed by `undo`.                                                                     |
| `create_visualization`  | Create visualization        | Adds a visualization definition and returns its ID. The application builds its query and renderer configuration.           |
| `update_visualization`  | Update visualization        | Changes supplied fields on an existing visualization while preserving its ID, annotations, and layout position.            |
| `remove_visualization`  | Remove visualization        | Removes one visualization and its annotations. The action can be undone.                                                   |
| `apply_filter`          | Apply filter                | Adds one validated condition used by charts, tables, and subsequent agent reads.                                           |
| `clear_filters`         | Clear filters               | Removes filters for one dataset or the entire workspace.                                                                   |
| `highlight_selection`   | Highlight selection         | Sets or extends a predicate selection while leaving nonmatching rows available to views that highlight rather than filter. |
| `create_metric`         | Create metric               | Adds a named aggregate with optional filter references and percent, running-total, or time-comparison behavior.            |
| `add_annotation`        | Add annotation              | Attaches a plain-text note to a point, range, or category on an existing visualization.                                    |

Raw previews and dataset-derived labels are marked as untrusted content. Read results are bounded, and quantitative analysis returns no more than 200 aggregate rows. WebMCP is optional. The human interface continues to work when the browser does not expose a model-context host.

## Architecture

```text
React UI ───────┐
                ├──> application action dispatcher ──> Zustand workspace state
WebMCP tools ───┘                    │
                                     └──> DuckDB-Wasm data engine
                                                  │
                                     bounded table and chart results
```

The dispatcher is the sole workspace mutation entry point. It serializes actions, validates expected revisions, records history, and commits normalized metadata to Zustand. DuckDB owns imported rows and analytical execution. React, TanStack, ECharts, and WebMCP remain adapters around project-owned domain types.

## Getting started

Requirements:

- Git
- Bun 1.4 or later
- a modern browser with Web Workers and WebAssembly support

Clone, install, and run the development server:

```bash
git clone git@github.com:remotemerge/data-canvas.git
cd data-canvas
bun install
bun run dev
```

Vite serves the application at `http://localhost:3000`. WebMCP tools require a browser that implements the native WebMCP model-context API.

Build and preview the production bundle:

```bash
bun run build
bun run preview
```

## Testing

```bash
bun test
```

The test suite covers domain and application behavior, SQL compilation, architectural boundaries, WebMCP contracts, human-agent action equivalence, integration flows, and performance policies.

## Privacy and security

Imported files stay in the browser application. Data Canvas does not upload them to an application backend because no backend exists. A connected AI agent may process data returned by WebMCP outside the browser, so the tools favor schemas, aggregates, statistics, and bounded samples over bulk row access.

The application generates SQL from validated domain operations and parameterizes data values. Agent inputs cannot request arbitrary SQL, scripts, network resources, DuckDB extensions, or renderer configuration.

## License

[MIT](LICENSE) © 2026 Madan Sapkota
