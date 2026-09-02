import type { RegisteredToolSummary } from '@/webmcp/registry/tool-status.ts';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/ui/components/ui/sheet.tsx';

// Annotation flags worth surfacing, in the order a reader benefits from most.
const ANNOTATION_LABELS: readonly [string, string][] = [
  ['readOnlyHint', 'read-only'],
  ['destructiveHint', 'destructive'],
  ['idempotentHint', 'idempotent'],
  ['openWorldHint', 'open-world'],
  ['untrustedContentHint', 'untrusted content'],
];

const annotationBadges = (annotations: Record<string, unknown>): string[] =>
  ANNOTATION_LABELS.filter(([key]) => annotations[key] === true).map(([, label]) => label);

// Names the arguments a tool accepts without rendering the whole schema.
const describeArguments = (schema: object): { required: string[]; optional: string[] } => {
  const { properties, required } = schema as { properties?: Record<string, unknown>; required?: string[] };
  const names = Object.keys(properties ?? {});
  const requiredNames = new Set(required ?? []);

  return {
    required: names.filter((name) => requiredNames.has(name)),
    optional: names.filter((name) => !requiredNames.has(name)),
  };
};

const ToolEntry = ({ tool }: { tool: RegisteredToolSummary }): React.JSX.Element => {
  const badges = annotationBadges(tool.annotations);
  const { required, optional } = describeArguments(tool.inputSchema);

  return (
    <li className="agent-tools__item">
      <details>
        <summary>
          <code className="agent-tools__name">{tool.name}</code>
          <span className="agent-tools__title">{tool.title}</span>
        </summary>
        <p className="agent-tools__description">{tool.description}</p>
        {badges.length > 0 ? (
          <ul className="agent-tools__badges">
            {badges.map((badge) => (
              <li key={badge}>{badge}</li>
            ))}
          </ul>
        ) : null}
        <dl className="agent-tools__arguments">
          <dt>Required</dt>
          <dd>{required.length === 0 ? 'none' : required.join(', ')}</dd>
          <dt>Optional</dt>
          <dd>{optional.length === 0 ? 'none' : optional.join(', ')}</dd>
        </dl>
      </details>
    </li>
  );
};

/**
 * Lists the tools currently exposed to an agent.
 *
 * Registration is state-aware, so this panel shows what an agent can call right now rather than a
 * fixed catalogue: tools appear as datasets and relationships make them able to succeed.
 */
export const AgentToolsSheet = ({
  tools,
  label,
  active,
}: {
  tools: readonly RegisteredToolSummary[];
  label: string;
  active: boolean;
}): React.JSX.Element => (
  <Sheet>
    <SheetTrigger
      className="agent-status"
      data-active={active}
      aria-label={`${label}. Open the agent tool list.`}
      title="Show the tools available to an agent"
    >
      {label}
    </SheetTrigger>
    <SheetContent side="right">
      <SheetTitle>Agent tools</SheetTitle>
      <div className="agent-tools">
        <p className="agent-tools__intro">
          These {tools.length} tools are registered with this page over WebMCP. Registration follows the workspace, so
          tools appear once they can succeed: importing a dataset adds the analytical tools, and a second dataset adds
          relationship tools.
        </p>
        {tools.length === 0 ? (
          <p className="workspace__empty">No tools are registered yet.</p>
        ) : (
          <ul className="agent-tools__list">
            {tools.map((tool) => (
              <ToolEntry key={tool.name} tool={tool} />
            ))}
          </ul>
        )}
      </div>
    </SheetContent>
  </Sheet>
);
