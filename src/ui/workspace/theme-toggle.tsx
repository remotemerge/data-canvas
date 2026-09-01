import { LuMoon, LuSun } from 'react-icons/lu';
import { useEffect, useState } from 'react';
import { Button } from '@/ui/components/ui/button.tsx';

type Theme = 'light' | 'dark';

const initialTheme = (): Theme => {
  const saved = localStorage.getItem('data-canvas-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const ThemeToggle = (): React.JSX.Element => {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    localStorage.setItem('data-canvas-theme', theme);
    window.dispatchEvent(new CustomEvent('data-canvas:theme-change'));
  }, [theme]);

  const next = theme === 'light' ? 'dark' : 'light';

  return (
    <Button variant="ghost" size="icon" aria-label={`Use ${next} theme`} onClick={() => setTheme(next)}>
      {theme === 'light' ? <LuMoon size={16} aria-hidden="true" /> : <LuSun size={16} aria-hidden="true" />}
    </Button>
  );
};
