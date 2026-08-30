import { useMemo, useState } from 'react';
import { suggestRelationships } from '@/application/relationships/suggest-relationships.ts';
import { validateRelationship } from '@/application/validation/validate-relationship.ts';
import { isNumericType, isTemporalType, isTextType } from '@/domain/logical-type.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import { JOIN_KINDS, RELATIONSHIP_KINDS } from '@/domain/relationship/relationship.ts';
import type { JoinKind, RelationshipKind } from '@/domain/relationship/relationship.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

/** Mirrors the validator's rule, so the picker only offers pairs the action would accept. */
const joinTypeClass = (type: LogicalType): string => {
  if (isNumericType(type)) return 'number';
  if (isTemporalType(type)) return 'temporal';
  if (isTextType(type)) return 'text';

  return type;
};

/**
 * Creates a relationship between two datasets.
 *
 * The key-column picker offers only type-compatible pairs, and the same `validateRelationship` the
 * action runs is called here to show the rejection reason before the user submits. Running the real
 * validator rather than a UI-local approximation is what keeps the form from ever offering something
 * the dispatcher would refuse.
 *
 * The fan-out warning is measured by the engine during the action, so it appears in the resulting
 * summary rather than in this form: it depends on data, which the form has not read.
 */
export const RelationshipEditor = ({ onError }: { onError: (error: DomainError) => void }): React.JSX.Element => {
  const workspace = useWorkspace((state) => state.workspace);
  const actions = useActions();

  const [leftDatasetId, setLeftDatasetId] = useState('');
  const [rightDatasetId, setRightDatasetId] = useState('');
  const [leftColumnId, setLeftColumnId] = useState('');
  const [rightColumnId, setRightColumnId] = useState('');
  const [kind, setKind] = useState<RelationshipKind>('many_to_one');
  const [join, setJoin] = useState<JoinKind>('inner');
  const [notice, setNotice] = useState<string | null>(null);

  const datasets = useMemo(
    () => Object.values(workspace.datasets).filter((dataset) => dataset.importStatus === 'ready'),
    [workspace.datasets],
  );

  const suggestions = useMemo(() => suggestRelationships(workspace).slice(0, 3), [workspace]);

  const left = workspace.datasets[leftDatasetId];
  const right = workspace.datasets[rightDatasetId];
  const selectedLeftColumn = left?.columns.find((column) => column.id === leftColumnId);

  // Only columns whose type class matches the chosen left key, so an impossible pair is never
  // offered. Before a left key is chosen every column is a candidate.
  const rightColumns = (right?.columns ?? []).filter(
    (column) =>
      selectedLeftColumn === undefined ||
      joinTypeClass(column.logicalType) === joinTypeClass(selectedLeftColumn.logicalType),
  );

  const candidate =
    left === undefined || right === undefined || leftColumnId === '' || rightColumnId === ''
      ? null
      : { leftDatasetId, rightDatasetId, on: [{ leftColumnId, rightColumnId }], kind };

  const validation = candidate === null ? null : validateRelationship(workspace, candidate);

  const create = async (): Promise<void> => {
    if (candidate === null || validation === null || !validation.ok) return;

    const result = await actions.createRelationship({ ...candidate, join });

    if (!result.ok) {
      onError(result.error);
      return;
    }

    // The summary carries the engine's fan-out measurement when there is one, so it is surfaced
    // here rather than discarded.
    setNotice(result.value.summary);
    setLeftColumnId('');
    setRightColumnId('');
  };

  return (
    <section className="relationship-editor" aria-labelledby="relationship-editor-title">
      <h2 id="relationship-editor-title" className="workspace__panel-heading">
        Relate datasets
      </h2>

      {datasets.length < 2 ? (
        <p className="workspace__empty">Import a second dataset to define a relationship.</p>
      ) : (
        <>
          <label>
            From
            <select
              value={leftDatasetId}
              onChange={(event) => {
                setLeftDatasetId(event.target.value);
                setLeftColumnId('');
              }}
            >
              <option value="">Choose</option>
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            To
            <select
              value={rightDatasetId}
              onChange={(event) => {
                setRightDatasetId(event.target.value);
                setRightColumnId('');
              }}
            >
              <option value="">Choose</option>
              {datasets
                .filter((dataset) => dataset.id !== leftDatasetId)
                .map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))}
            </select>
          </label>

          <label>
            From key
            <select value={leftColumnId} onChange={(event) => setLeftColumnId(event.target.value)}>
              <option value="">Choose</option>
              {(left?.columns ?? []).map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            To key
            <select value={rightColumnId} onChange={(event) => setRightColumnId(event.target.value)}>
              <option value="">Choose</option>
              {rightColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Cardinality
            <select value={kind} onChange={(event) => setKind(event.target.value as RelationshipKind)}>
              {RELATIONSHIP_KINDS.map((item) => (
                <option key={item} value={item}>
                  {item.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>

          <label>
            Join
            <select value={join} onChange={(event) => setJoin(event.target.value as JoinKind)}>
              {JOIN_KINDS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <button type="button" disabled={validation === null || !validation.ok} onClick={() => void create()}>
            Create relationship
          </button>

          {validation !== null && !validation.ok ? (
            <p className="relationship-editor__hint">{validation.error.message}</p>
          ) : null}

          {notice === null ? null : (
            <p className="relationship-editor__notice" role="status">
              {notice}
            </p>
          )}

          {suggestions.length === 0 ? null : (
            <div className="relationship-editor__suggestions">
              <h3>Suggested relationships</h3>
              <p className="relationship-editor__suggestions-note">
                Check the suggested keys before creating a relationship.
              </p>
              <ul>
                {suggestions.map((suggestion) => (
                  <li key={`${suggestion.leftColumnId}-${suggestion.rightColumnId}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setLeftDatasetId(suggestion.leftDatasetId);
                        setRightDatasetId(suggestion.rightDatasetId);
                        setLeftColumnId(suggestion.leftColumnId);
                        setRightColumnId(suggestion.rightColumnId);
                        setKind(suggestion.kind);
                      }}
                    >
                      {/* Column names come from imported headers: text children only. */}
                      {suggestion.leftColumnName} → {suggestion.rightColumnName}
                    </button>
                    <span className="relationship-editor__reason">{suggestion.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
};
