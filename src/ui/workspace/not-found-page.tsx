import { Link } from 'react-router-dom';

export const NotFoundPage = (): React.JSX.Element => (
  <div className="not-found">
    <div>
      <h1>Page not found</h1>
      <Link to="/">Back to workspace</Link>
    </div>
  </div>
);
