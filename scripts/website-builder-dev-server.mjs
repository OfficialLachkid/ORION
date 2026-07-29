#!/usr/bin/env node

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { maybeHandleWebsiteBuilderApiRequest } from './lib/website-builder-api.mjs';

const appRoot = resolve('apps', 'website-builder');
const host = '127.0.0.1';
const port = Number.parseInt(process.env.WEBSITE_BUILDER_PORT || '4173', 10);

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function resolveRequestPath(requestUrl = '/') {
  const pathname = requestUrl.split('?')[0] || '/';
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(cleanPath).replace(/^(\.\.[/\\])+/, '');
  return join(appRoot, safePath);
}

function send(response, statusCode, body, contentType) {
  response.writeHead(statusCode, { 'Content-Type': contentType });
  response.end(body);
}

const server = createServer((request, response) => {
  maybeHandleWebsiteBuilderApiRequest(request, response).then((handled) => {
    if (handled) {
      return;
    }

    const filePath = resolveRequestPath(request.url);
    if (!filePath.startsWith(appRoot) || !existsSync(filePath)) {
      send(response, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }

    const extension = extname(filePath).toLowerCase();
    const contentType = contentTypes.get(extension) || 'application/octet-stream';
    const body = readFileSync(filePath);
    send(response, 200, body, contentType);
  }).catch((error) => {
    send(
      response,
      500,
      JSON.stringify({ error: error.message }),
      'application/json; charset=utf-8'
    );
  });
});

server.listen(port, host, () => {
  process.stdout.write(`Website Builder available at http://${host}:${port}\n`);
});
