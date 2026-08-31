import type { SamplingDisclosure } from '@/application/queries/adaptive-sampling.ts';
import { describeSampling } from '@/application/queries/sampling-disclosure.ts';

// Explains when a chart result is approximate.
export const SamplingBadge = ({ disclosure }: { disclosure: SamplingDisclosure }) => {
  const { label, explanation } = describeSampling(disclosure);

  return (
    <span className="sampling-badge" title={explanation}>
      <span aria-hidden="true">{label}</span>
      <span className="sampling-badge__explanation">{explanation}</span>
    </span>
  );
};
