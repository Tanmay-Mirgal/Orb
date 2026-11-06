import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
  path: string;
}

/** A local webhook receiver whose answer the test controls. */
export async function startReceiver() {
  const received: Received[] = [];
  const answer = { status: 200, body: 'ok', hang: false };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ headers: req.headers, body, path: req.url ?? '/' });
      if (answer.hang) return;
      res.statusCode = answer.status;
      res.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    answer,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
