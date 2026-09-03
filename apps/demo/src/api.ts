import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

const HANDLER_MODULE = "/src/api-handler.ts";

type MiddlewareNext = (error?: unknown) => void;
type RenderSvgMiddleware = (req: IncomingMessage, res: ServerResponse, next: MiddlewareNext) => void | Promise<void>;
type HandlerModule = { createRenderSvgMiddleware: () => RenderSvgMiddleware };

function attachApi(server: ViteDevServer): void {
  let middlewarePromise: Promise<RenderSvgMiddleware> | undefined;
  const loadMiddleware = () => {
    if (!middlewarePromise) {
      const modulePromise = server.ssrLoadModule(HANDLER_MODULE) as Promise<HandlerModule>;
      middlewarePromise = modulePromise.then((module) => module.createRenderSvgMiddleware());
    }
    return middlewarePromise;
  };

  server.middlewares.use((req, res, next) => {
    void loadMiddleware()
      .then((middleware) => middleware(req, res, next))
      .catch((error) => {
        if (res.headersSent) {
          next(error);
          return;
        }
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      });
  });

  const logEndpoint = () => {
    const address = server.httpServer?.address();
    const port = typeof address === "object" && address ? address.port : server.config.server.port ?? 5173;
    server.config.logger.info(`  ➜  API:     http://127.0.0.1:${port}/api/render-svg`);
  };

  if (server.httpServer?.listening) logEndpoint();
  else server.httpServer?.once("listening", logEndpoint);
}

export function renderSvgApiPlugin(): Plugin {
  return {
    name: "fusiondraw-render-svg-api",
    configureServer: attachApi,
  };
}
