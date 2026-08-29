import type { SamplingDisclosure } from '@/application/queries/adaptive-sampling.ts';
import { describeSampling } from '@/application/queries/sampling-disclosure.ts';

/**
 * States, on the chart, that a result is approximate and exactly how.
 *
 * Rendered whenever a result carries a disclosure, with no way to suppress it. A silently
 * approximate figure is misinformation rather than a performance win, so the badge is part of the
 * result rather than a decoration on it.
 *
 * The explanation is a `title` as well as visually-hidden text, so it reaches a pointer user on
 * hover and a screen-reader user through the accessible name.
 */
export const SamplingBadge = ({ disclosure }: { disclosure: SamplingDisclosure }) => {
  const { label, explanation } = describeSampling(disclosure);

  return (
    <span className="sampling-badge" title={explanation}>
      <span aria-hidden="true">{label}</span>
      <span className="sampling-badge__explanation">{explanation}</span>
    </span>
  );
};
