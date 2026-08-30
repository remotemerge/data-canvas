import { useMemo, useState } from 'react';
import { validateDerivedColumn } from '@/application/validation/validate-derived-column.ts';
import type { ArithmeticOperator, DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import { ARITHMETIC_OPERATORS, DATE_PARTS } from '@/domain/analysis/derived-expression.ts';
import type { DatePart } from '@/domain/analysis/derived-expression.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

/**
 * The two shapes the form can build.
 *
 * A general tree editor would be the eventual product, but the value here is proving the tree
 * survives from a human control to the compiler. These two cover the plan's own examples, arithmetic
 * between two columns and a date part, and both exercise the same validation an agent's tree meets.
 */
type FormMode = 'arithmetic' | 'datePart';

const OPERATOR_LABEL: Readonly<Record<ArithmeticOperator, string>> = {
  add: '+',
  sub: '-',
  mul: '×',
  div: '÷',
};

export const DerivedColumnEditor = ({
  dataset,
  onError,
}: {
  dataset: Dataset;
  onError(error: DomainError | null): void;
}): React.JSX.Element => {
  const workspace = useWorkspace((state) => state.workspace);
  const { createDerivedColumn, removeDerivedColumn } = useActions();
  const [mode, setMode] = useState<FormMode>('arithmetic');
  const [name, setName] = useState('');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [operator, setOperator] = useState<ArithmeticOperator>('div');
  const [part, setPart] = useState<DatePart>('month');
  const [dateColumn, setDateColumn] = useState('');

  const numericColumns = dataset.columns.filter((column) => column.logicalType === 'number');
  const temporalColumns = dataset.columns.filter(
    (column) => column.logicalType === 'date' || column.logicalType === 'timestamp',
  );

  const existing = useMemo(
    () => Object.values(workspace.derivedColumns).filter((column) => column.datasetId === dataset.id),
    [workspace.derivedColumns, dataset.id],
  );

  const expression = useMemo<DerivedExpression | null>(() => {
    if (mode === 'datePart') {
      return dateColumn === '' ? null : { kind: 'datePart', part, columnId: dateColumn };
    }

    if (left === '' || right === '') return null;

    return {
      kind: 'arithmetic',
      op: operator,
      left: { kind: 'column', columnId: left },
      right: { kind: 'column', columnId: right },
    };
  }, [mode, dateColumn, part, left, right, operator]);

  // Validated as the form changes, using the same function the handler runs. The button cannot
  // submit a definition the dispatcher would reject, and the message explains why while typing.
  const validation =
    expression === null || name.trim() === ''
      ? null
      : validateDerivedColumn(dataset, { name, expression }, workspace.derivedColumns);

  const submit = (): void => {
    if (expression === null || validation === null || !validation.ok) return;

    void createDerivedColumn({ datasetId: dataset.id, name, expression }).then((result) => {
      onError(result.ok ? null : result.error);
      if (result.ok) setName('');
    });
  };

  return (
    <section className="derived-column-editor" aria-labelledby="derived-column-title">
      <h3 id="derived-column-title">Derived columns</h3>
      <p>Build a column from existing data. DuckDB calculates its values when you query the dataset.</p>

      <label>
        Name
        <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      </label>

      <label>
        Kind
        <select value={mode} onChange={(event) => setMode(event.target.value as FormMode)}>
          <option value="arithmetic">Arithmetic</option>
          <option value="datePart">Date part</option>
        </select>
      </label>

      {mode === 'arithmetic' ? (
        <>
          <label>
            Left
            <select value={left} onChange={(event) => setLeft(event.target.value)}>
              <option value="">Choose</option>
              {numericColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Operator
            <select value={operator} onChange={(event) => setOperator(event.target.value as ArithmeticOperator)}>
              {ARITHMETIC_OPERATORS.map((item) => (
                <option key={item} value={item}>
                  {OPERATOR_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Right
            <select value={right} onChange={(event) => setRight(event.target.value)}>
              <option value="">Choose</option>
              {numericColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          {operator === 'div' ? <small>Division by zero returns null instead of an error.</small> : null}
        </>
      ) : (
        <>
          <label>
            Column
            <select value={dateColumn} onChange={(event) => setDateColumn(event.target.value)}>
              <option value="">Choose</option>
              {temporalColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Part
            <select value={part} onChange={(event) => setPart(event.target.value as DatePart)}>
              {DATE_PARTS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <button type="button" disabled={validation === null || !validation.ok} onClick={submit}>
        Add column
      </button>

      {validation !== null && !validation.ok ? (
        <p className="derived-column-editor__hint">{validation.error.message}</p>
      ) : null}

      {existing.length === 0 ? null : (
        <ul className="derived-column-editor__list">
          {existing.map((column) => (
            <li key={column.id}>
              <span>
                {column.name} ({column.logicalType})
              </span>
              <button
                type="button"
                onClick={() => {
                  void removeDerivedColumn({ derivedColumnId: column.id }).then((result) =>
                    onError(result.ok ? null : result.error),
                  );
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
