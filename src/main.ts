import { app } from './app';
import { config } from './config';

export type { AppType } from './app';

export default { port: config.port, fetch: app.fetch };
