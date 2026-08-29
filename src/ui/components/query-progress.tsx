/**
 * The in-flight indicator for a panel that already has a result.
 *
 * Deliberately does not replace the content it sits above. Blanking a chart while a new query runs
 * throws away the answer the user is currently reading and makes a two-second query feel like a
 * failure; keeping the previous result visible and marking it stale is both faster to perceive and
 * more honest about what is on screen.
 *
 * `aria-busy` on the region rather than an alert: this is a status change, not something demanding
 * attention, and a live region firing on every filter keystroke would be unusable.
 */
export const QueryProgress = ({ label = 'Updating' }: { label?: string }) => (
  <span className="query-progress" role="status" aria-live="polite">
    <span className="query-progress__spinner" aria-hidden="true" />
    {label}
  </span>
);

/**
 * The placeholder shown when there is no previous result to keep.
 *
 * A skeleton rather than a spinner, because it reserves the space the result will occupy and so does
 * not shift the layout when the rows arrive.
 */
export const QuerySkeleton = ({ label = 'Loading chart' }: { label?: string }) => (
  <div className="query-skeleton" role="status" aria-live="polite" aria-label={label}>
    <span className="query-skeleton__bar" />
    <span className="query-skeleton__bar" />
    <span className="query-skeleton__bar" />
  </div>
);
