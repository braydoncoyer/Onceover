import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Playground } from './Playground';
import { registerSyntaxTheme } from '../theme/diffs';
import '../styles/global.css';

registerSyntaxTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
