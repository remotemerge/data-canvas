// Shared by every write tool so the wording stays identical and inside the parameter budget.
export const expectedRevisionSchema = {
  type: 'integer',
  minimum: 0,
  description:
    'Revision from get_workspace this call assumes. Fails with STALE_WORKSPACE_REVISION if it moved on. Omit to apply unconditionally.',
} as const;
