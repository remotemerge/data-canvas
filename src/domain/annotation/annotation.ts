import type { EntityId } from '@/shared/ids/entity-id.ts';

// Domain anchor for an annotation; anchors survive re-rendering and layout changes.
export type AnnotationAnchor =
  | { kind: 'data'; dimension: EntityId; value: unknown }
  | { kind: 'point'; x: unknown; y: unknown }
  | { kind: 'range'; from: unknown; to: unknown };

export interface Annotation {
  id: EntityId;
  visualizationId: EntityId;
  // Human- or agent-authored text rendered as plain text.
  text: string;
  anchor: AnnotationAnchor;
  origin: 'human' | 'agent';
  createdBy: 'human' | 'agent' | 'system';
}
