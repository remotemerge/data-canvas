import type { DomainError } from '@/shared/errors/domain-error.ts';

interface ActionErrorBannerProps {
  error: DomainError | null;
  onDismiss: () => void;
}

// Shows a rejected action's stable code and message.
export const ActionErrorBanner = ({ error, onDismiss }: ActionErrorBannerProps): React.JSX.Element | null => {
  if (error === null) return null;

  return (
    <div className="action-error" role="alert">
      <span className="action-error__code">{error.code}</span>
      <span className="action-error__message">{error.message}</span>
      <button type="button" className="action-error__dismiss" onClick={onDismiss} aria-label="Dismiss error">
        ×
      </button>
    </div>
  );
};
