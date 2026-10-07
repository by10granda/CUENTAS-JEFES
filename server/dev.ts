import 'dotenv/config';
import { createServer } from 'node:http';
import { handleRequest } from './handler.ts';

const port = Number(process.env.PORT || 3001);
createServer((req, res) => { void handleRequest(req, res); }).listen(port, '127.0.0.1', () => {
  console.log(`API listening at http://localhost:${port}`);
});
