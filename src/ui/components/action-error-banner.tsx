import type { DomainError } from '@/shared/errors/domain-error.ts';

interface ActionErrorBannerProps {
  error: DomainError | null;
  onDismiss: () => void;
}

/**
 * Surfaces a rejected action.
 *
 * Shows the stable `code` alongside the message because the code is what a person can search for
 * and what an agent branches on — seeing the same vocabulary in both places makes a shared
 * workspace debuggable.
 *
 * `DomainError.message` is constructed by the application and is guaranteed free of dataset values,
 * but it can quote a column display name, which is imported text. It renders as plain text only.
 */
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
