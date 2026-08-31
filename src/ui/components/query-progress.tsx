// Shows query progress while preserving the previous result.
export const QueryProgress = ({ label = 'Updating' }: { label?: string }) => (
  <span className="query-progress" role="status" aria-live="polite">
    <span className="query-progress__spinner" aria-hidden="true" />
    {label}
  </span>
);

// Placeholder for panels without a previous result.
export const QuerySkeleton = ({ label = 'Loading chart' }: { label?: string }) => (
  <div className="query-skeleton" role="status" aria-live="polite" aria-label={label}>
    <span className="query-skeleton__bar" />
    <span className="query-skeleton__bar" />
    <span className="query-skeleton__bar" />
  </div>
);
