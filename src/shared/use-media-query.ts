import { useEffect, useState } from 'react';

export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);

  useEffect(() => {
    const media = matchMedia(query);
    const update = (): void => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
};
