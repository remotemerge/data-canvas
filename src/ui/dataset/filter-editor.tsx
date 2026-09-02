import { useEffect, useMemo, useState } from 'react';
import { getCompatibleFilterOperators } from '@/application/validation/validate-filter.ts';
import { getDistinctValues } from '@/application/queries/distinct-values-query.ts';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import { NULLARY_FILTER_OPERATORS } from '@/domain/filter/filter.ts';
import type { FilterOperator } from '@/domain/filter/filter.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { selectFilters } from '@/state/selectors/workspace-selectors.ts';

const FILTER_OPERATOR_LABEL: Readonly<Record<FilterOperator, string>> = {
  eq: 'equals',
  neq: 'does not equal',
  gt: 'is greater than',
  gte: 'is greater than or equal to',
  lt: 'is less than',
  lte: 'is less than or equal to',
  between: 'is between',
  in: 'is one of',
  not_in: 'is not one of',
  contains: 'contains',
  is_null: 'is empty',
  is_not_null: 'is not empty',
};

const parseValue = (raw: string, operator: FilterOperator, logicalType: string): unknown => {
  if (NULLARY_FILTER_OPERATORS.includes(operator)) {
    return undefined;
  }
  const entries =
    operator === 'between' || operator === 'in' || operator === 'not_in'
      ? raw.split(',').map((part) => part.trim())
      : [raw];
  const convert = (entry: string): unknown => {
    if (logicalType === 'number') {
      return Number(entry);
    }
    return logicalType === 'boolean' ? entry === 'true' : entry;
  };
  const converted = entries.map(convert);
  return operator === 'between' || operator === 'in' || operator === 'not_in' ? converted : converted[0];
};

// Maps a column's logical type to the matching native input control.
const inputType = (logicalType: string | undefined): 'number' | 'date' | 'text' => {
  if (logicalType === 'number') {
    return 'number';
  }
  return logicalType === 'date' ? 'date' : 'text';
};

export const FilterEditor = ({
  dataset,
  onError,
}: {
  dataset: Dataset;
  onError(error: DomainError | null): void;
}): React.JSX.Element => {
  const [columnId, setColumnId] = useState(dataset.columns[0]?.id ?? '');
  const column = dataset.columns.find((candidate) => candidate.id === columnId) ?? dataset.columns[0];
  const operators = column === undefined ? [] : getCompatibleFilterOperators(column);
  const { applyFilter } = useActions();
  const filterRecord = useWorkspace(selectFilters);
  const filters = useMemo(
    () => Object.values(filterRecord).filter((filter) => filter.datasetId === dataset.id),
    [dataset.id, filterRecord],
  );
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (column?.logicalType !== 'category') {
      setSuggestions([]);
      setTruncated(false);
      return;
    }
    const controller = new AbortController();
    void getDistinctValues(registeredDataEngine, {
      datasetId: dataset.id,
      columnId: column.id,
      filters,
      signal: controller.signal,
    }).then((result) => {
      if (!controller.signal.aborted && result.ok) {
        setSuggestions(result.value.values.map((entry) => String(entry.value ?? '')));
        setTruncated(result.value.truncated);
      }
    });
    return () => controller.abort();
  }, [column, dataset.id, filters]);

  return (
    <form
      className="filter-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (column === undefined) {
          return;
        }
        const form = new FormData(event.currentTarget);
        // Both fields are text controls, so `FormData` yields strings rather than files.
        const readField = (name: string): string => {
          const entry = form.get(name);
          return typeof entry === 'string' ? entry : '';
        };
        const operator = readField('operator') as FilterOperator;
        const value = parseValue(readField('value'), operator, column.logicalType);
        void applyFilter({
          datasetId: dataset.id,
          columnId: column.id,
          operator,
          ...(value === undefined ? {} : { value }),
        }).then((result) => onError(result.ok ? null : result.error));
      }}
    >
      <label>
        Column{' '}
        <select name="column" value={column?.id ?? ''} onChange={(event) => setColumnId(event.target.value)}>
          {dataset.columns.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Operator{' '}
        <select name="operator">
          {operators.map((operator) => (
            <option key={operator} value={operator}>
              {FILTER_OPERATOR_LABEL[operator]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Value{' '}
        <input
          name="value"
          list={suggestions.length > 0 ? 'filter-value-suggestions' : undefined}
          type={inputType(column?.logicalType)}
          aria-describedby="filter-value-help"
        />
      </label>
      {suggestions.length > 0 ? (
        <datalist id="filter-value-suggestions">
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
      <small id="filter-value-help">
        Use commas for between and list filters.{truncated ? ' Showing the 200 most common values.' : ''}
      </small>
      <button type="submit">Apply filter</button>
    </form>
  );
};
