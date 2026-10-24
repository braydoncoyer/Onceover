import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../app/App';
import { registerSyntaxTheme } from '../theme/diffs';
import { DemoBar } from './DemoBar';
import { installDemoServer } from './fakeServer';
import '../styles/global.css';

// The real app over a fake server: the demo's data and storage stand in for
// git and `.git/onceover`, so the page runs anywhere as static files.
registerSyntaxTheme();

void installDemoServer(new URL('./data/demo.json', location.href).href).then(
  (server) => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    createRoot(document.getElementById('demo')!).render(
      <StrictMode>
        <DemoBar server={server} />
      </StrictMode>,
    );
  },
  (error: Error) => {
    document.getElementById('root')!.textContent = error.message;
  },
);
