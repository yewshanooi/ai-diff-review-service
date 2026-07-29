import { createApp } from './app';
import { config } from './config';

const app = createApp();

app.listen(config.port, () => {
  console.log(`AI Diff Review Service running on port ${config.port}`);
  console.log(`Health: http://localhost:${config.port}/health`);
  console.log(`Spec:   http://localhost:${config.port}/spec`);
});
