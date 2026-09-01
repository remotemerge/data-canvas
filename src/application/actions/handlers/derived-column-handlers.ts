import type { CreateDerivedColumnInput, RemoveDerivedColumnInput } from '@/application/actions/action-types.ts';
import { omitKeys } from '@/application/actions/handlers/handler-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { resolveDataset, resolveDerivedColumn } from '@/application/validation/validate-entity-refs.ts';
import { validateDerivedColumn } from '@/application/validation/validate-derived-column.ts';
import { expressionColumnIds } from '@/domain/analysis/derived-expression.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';

// Adds the definition and exposes it as a dataset column; the compiler evaluates it when a query uses it.
export const handleCreateDerivedColumn: ActionHandler<CreateDerivedColumnInput> = (workspace, payload, deps) => {
  const dataset = resolveDataset(workspace, payload.datasetId);

  if (!dataset.ok) {
    return dataset;
  }

  const validated = validateDerivedColumn(
    dataset.value,
    { name: payload.name, expression: payload.expression },
    workspace.derivedColumns,
  );

  if (!validated.ok) {
    return validated;
  }

  const derived: DerivedColumn = {
    id: createEntityId(ID_PREFIX.column),
    datasetId: dataset.value.id,
    name: validated.value.name,
    expression: payload.expression,
    logicalType: validated.value.logicalType,
    // The engine has not evaluated the expression, so this type is only an inference.
    typeVerified: false,
    createdBy: deps.actor,
  };

  const updatedDataset = {
    ...dataset.value,
    columns: [
      ...dataset.value.columns,
      {
        id: derived.id,
        name: derived.name,
        physicalName: '',
        databaseType: '',
        logicalType: derived.logicalType,
        nullable: true,
      },
    ],
  };

  return ok({
    workspace: {
      ...workspace,
      datasets: { ...workspace.datasets, [updatedDataset.id]: updatedDataset },
      derivedColumns: { ...workspace.derivedColumns, [derived.id]: derived },
    },
    changedEntityIds: [derived.id],
    summary: `Created derived column '${derived.name}' of type ${derived.logicalType}.`,
  });
};

// Removes the definition and dataset column after confirming that no definitions or charts reference it.
export const handleRemoveDerivedColumn: ActionHandler<RemoveDerivedColumnInput> = (workspace, payload) => {
  const derived = resolveDerivedColumn(workspace, payload.derivedColumnId);

  if (!derived.ok) {
    return derived;
  }

  const dependents = Object.values(workspace.derivedColumns).filter(
    (candidate) =>
      candidate.id !== derived.value.id && expressionColumnIds(candidate.expression).includes(derived.value.id),
  );

  if (dependents.length > 0) {
    return err(
      domainError('DATASET_IN_USE', `'${derived.value.name}' is used by ${dependents.length} other derived columns.`, {
        derivedColumnId: derived.value.id,
        dependentIds: dependents.map((candidate) => candidate.id),
      }),
    );
  }

  const charts = Object.values(workspace.visualizations).filter((visualization) => {
    const { binding, query } = visualization;
    const bound = [
      binding.x,
      ...(binding.y ?? []),
      binding.series,
      binding.color,
      binding.size,
      ...(binding.tooltip ?? []),
      ...query.dimensions,
      ...query.measures.flatMap((measure) => (measure.columnId === undefined ? [] : [measure.columnId])),
    ];

    return bound.includes(derived.value.id);
  });

  if (charts.length > 0) {
    return err(
      domainError('DATASET_IN_USE', `'${derived.value.name}' is used by ${charts.length} visualizations.`, {
        derivedColumnId: derived.value.id,
        visualizationIds: charts.map((chart) => chart.id),
      }),
    );
  }

  return ok({
    workspace: {
      ...workspace,
      datasets: {
        ...workspace.datasets,
        [derived.value.datasetId]: {
          ...workspace.datasets[derived.value.datasetId]!,
          columns: workspace.datasets[derived.value.datasetId]!.columns.filter(
            (column) => column.id !== derived.value.id,
          ),
        },
      },
      derivedColumns: omitKeys(workspace.derivedColumns, [derived.value.id]),
    },
    changedEntityIds: [derived.value.id],
    summary: `Removed derived column '${derived.value.name}'.`,
  });
};
