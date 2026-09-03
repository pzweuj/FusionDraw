import type { IncomingMessage, ServerResponse } from "node:http";
import { parsePlotSpec } from "@fusionview/core";
import { renderFusionSvg } from "@fusionview/renderer-svg";
import { RENDER_SVG_API_PATH } from "./api-contract";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

type MiddlewareNext = (error?: unknown) => void;
export type RenderSvgMiddleware = (req: IncomingMessage, res: ServerResponse, next: MiddlewareNext) => void | Promise<void>;

class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, statusCode: number, body: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://fusiondraw.local").pathname;
  } catch {
    return req.url?.split("?")[0] ?? "";
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks: Buffer[] = [];

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.resume();
      reject(error);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > MAX_BODY_BYTES) {
        fail(new HttpError(413, `PlotSpec body exceeds the ${MAX_BODY_BYTES} byte limit.`));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = (error: Error) => fail(error);

    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
  });
}

export function renderPlotSpecJson(json: string): string {
  return renderFusionSvg(parsePlotSpec(json));
}

export function createRenderSvgMiddleware(): RenderSvgMiddleware {
  return async (req, res, next) => {
    if (requestPath(req) !== RENDER_SVG_API_PATH) {
      next();
      return;
    }

    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      sendJson(res, 405, { error: "Use POST with a PlotSpec JSON body." });
      return;
    }

    const contentLength = Number(req.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      req.resume();
      sendJson(res, 413, { error: `PlotSpec body exceeds the ${MAX_BODY_BYTES} byte limit.` });
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 400;
      sendJson(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      return;
    }

    let svg: string;
    try {
      svg = renderPlotSpecJson(body);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", Buffer.byteLength(svg));
    res.end(svg);
  };
}
