/**
 * The persisted-workspace migration contract.
 *
 * Migrations operate on persisted DTOs — the untyped JSON shape actually found in storage — never on
 * the current `Workspace` type. Typing them against the domain would defeat the purpose: the whole
 * reason a migration exists is that the stored shape is *not* the current one, and a compiler that
 * validated old payloads against today's interface would force each shipped migration to be rewritten
 * whenever the domain moves on.
 *
 * The storage schema version is deliberately independent of the application release version. A build
 * can ship many times without changing how a workspace is written, and the two counters would only
 * confuse each other if merged.
 */

/** An unvalidated workspace payload as read from storage, at some schema version. */
export type StoredWorkspace = Record<string, unknown>;

/**
 * One single-step transition.
 *
 * Exactly one version per migration: `from` to `from + 1`. A migration that jumped several versions
 * would collapse independently testable steps into one opaque function, and a failure inside it
 * could not be attributed to a specific transition.
 */
export interface WorkspaceMigration {
  from: number;
  to: number;
  /**
   * Must be pure. Migrations run before anything is committed, and the chain is discarded wholesale
   * on failure, so a migration that mutated its input or touched storage would leave a half-migrated
   * workspace behind exactly when the chain is meant to be abandoned.
   */
  migrate(workspace: StoredWorkspace): StoredWorkspace;
}
