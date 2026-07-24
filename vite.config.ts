import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

const LOCAL_NETLIFY_FUNCTIONS = new Set([
  'account-data',
  'auth-login',
  'auth-logout',
  'auth-register',
  'focus-friends',
  'spectate-link',
  'spectate-og',
]);

const readRequestBody = (req: IncomingMessage) => new Promise<Buffer>((resolve, reject) => {
  const chunks: Buffer[] = [];
  req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const writeFunctionResponse = async (res: ServerResponse, response: Response) => {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
};

const localNetlifyFunctionsPlugin = () => ({
  name: 'local-netlify-functions',
  configureServer(server: any) {
    server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
      const originalUrl = req.url || '';
      const match = originalUrl.match(/^\/\.netlify\/functions\/([^/?#]+)/);
      if (!match) {
        next();
        return;
      }

      const functionName = match[1];
      if (!LOCAL_NETLIFY_FUNCTIONS.has(functionName)) {
        next();
        return;
      }

      try {
        const body = req.method && !['GET', 'HEAD'].includes(req.method)
          ? await readRequestBody(req)
          : undefined;
        const request = new Request(`http://127.0.0.1${originalUrl}`, {
          method: req.method,
          headers: req.headers as HeadersInit,
          body,
          duplex: body ? 'half' : undefined,
        } as RequestInit & { duplex?: 'half' });
        const mod = await import(`./netlify/functions/${functionName}.js`);
        const response = await mod.default(request);
        await writeFunctionResponse(res, response);
      } catch (error) {
        next(error);
      }
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [localNetlifyFunctionsPlugin(), react()],
});
