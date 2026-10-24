// Serves the built demo at the site root: dist/demo/demo.html becomes index.html.
import { renameSync } from 'node:fs';

renameSync('dist/demo/demo.html', 'dist/demo/index.html');
