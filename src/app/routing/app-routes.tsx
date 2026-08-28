import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { NotFoundPage } from '@/ui/workspace/not-found-page.tsx';
import { WorkspacePage } from '@/ui/workspace/workspace-page.tsx';

/** Routing stays thin on purpose. It is a delivery concern, never a domain one. */
export const AppRoutes = (): React.JSX.Element => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<WorkspacePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </BrowserRouter>
);
