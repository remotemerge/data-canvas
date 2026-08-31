import type { AddAnnotationInput, RemoveAnnotationInput } from '@/application/actions/action-types.ts';
import { omitKeys } from '@/application/actions/handlers/handler-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { resolveAnnotation, resolveVisualization } from '@/application/validation/validate-entity-refs.ts';
import type { Annotation } from '@/domain/annotation/annotation.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';

// Maximum annotation length shared by UI and WebMCP actions.
export const MAX_ANNOTATION_TEXT_LENGTH = 280;

export const handleAddAnnotation: ActionHandler<AddAnnotationInput> = (workspace, payload, deps) => {
  const visualization = resolveVisualization(workspace, payload.visualizationId);

  if (!visualization.ok) return visualization;

  const text = payload.text.trim();

  if (text.length === 0 || text.length > MAX_ANNOTATION_TEXT_LENGTH) {
    return err(
      domainError(
        'UNSUPPORTED_OPERATION',
        `Annotation text must be between 1 and ${MAX_ANNOTATION_TEXT_LENGTH} characters.`,
        { maxLength: MAX_ANNOTATION_TEXT_LENGTH },
      ),
    );
  }

  const annotation: Annotation = {
    id: createEntityId(ID_PREFIX.annotation),
    visualizationId: visualization.value.id,
    text,
    anchor: payload.anchor,
    origin: payload.origin,
    createdBy: deps.actor,
  };

  return ok({
    workspace: { ...workspace, annotations: { ...workspace.annotations, [annotation.id]: annotation } },
    changedEntityIds: [annotation.id],
    // Do not include annotation text in history; it is untrusted free text.
    summary: `Added an annotation to '${visualization.value.title}'.`,
  });
};

export const handleRemoveAnnotation: ActionHandler<RemoveAnnotationInput> = (workspace, payload) => {
  const annotation = resolveAnnotation(workspace, payload.annotationId);

  if (!annotation.ok) return annotation;

  return ok({
    workspace: { ...workspace, annotations: omitKeys(workspace.annotations, [annotation.value.id]) },
    changedEntityIds: [annotation.value.id],
    summary: 'Removed an annotation.',
  });
};
