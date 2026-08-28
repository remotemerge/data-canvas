import type { AddAnnotationInput, RemoveAnnotationInput } from '@/application/actions/action-types.ts';
import { omitKeys } from '@/application/actions/handlers/handler-types.ts';
import type { ActionHandler } from '@/application/actions/handlers/handler-types.ts';
import { resolveAnnotation, resolveVisualization } from '@/application/validation/validate-entity-refs.ts';
import type { Annotation } from '@/domain/annotation/annotation.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';

/**
 * Bound on annotation text.
 *
 * Annotation text is human- or agent-authored free text that renders on the canvas, so it is
 * bounded in the domain rather than only at the protocol schema — both entry paths must be capped.
 */
export const MAX_ANNOTATION_TEXT_LENGTH = 280;

export const handleAddAnnotation: ActionHandler<AddAnnotationInput> = (workspace, payload) => {
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
  };

  return ok({
    workspace: { ...workspace, annotations: { ...workspace.annotations, [annotation.id]: annotation } },
    changedEntityIds: [annotation.id],
    // The annotation's own text is omitted: it is untrusted free text and history is rendered.
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
