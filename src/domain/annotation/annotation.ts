import type { EntityId } from '@/shared/ids/entity-id.ts';

/**
 * Where an annotation attaches to a visualization. Anchors reference domain dimensions and data
 * values, never pixel coordinates or DOM nodes, so they survive re-rendering and re-layout.
 */
export type AnnotationAnchor =
  | { kind: 'data'; dimension: EntityId; value: unknown }
  | { kind: 'point'; x: unknown; y: unknown }
  | { kind: 'range'; from: unknown; to: unknown };

export interface Annotation {
  id: EntityId;
  visualizationId: EntityId;
  /** Free text from a human or agent. Renders as plain text only, never as HTML. */
  text: string;
  anchor: AnnotationAnchor;
  origin: 'human' | 'agent';
  createdBy: 'human' | 'agent' | 'system';
}
