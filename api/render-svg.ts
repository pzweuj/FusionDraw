import type { IncomingMessage, ServerResponse } from "node:http";
import { parsePlotSpec } from "@fusionview/core";
import { renderFusionSvg } from "@fusionview/renderer-svg";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const RENDER_SVG_API_PATH = "/api/render-svg";

type VercelRequest = IncomingMessage & { body?: unknown };

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

function parsedBody(req: VercelRequest): string | undefined {
  if (req.body === undefined) return undefined;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  return typeof req.body === "string" ? req.body : JSON.stringify(req.body);
}

function readStreamBody(req: IncomingMessage): Promise<string> {
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

async function requestBody(req: VercelRequest): Promise<string> {
  const body = parsedBody(req);
  if (body !== undefined) {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new HttpError(413, `PlotSpec body exceeds the ${MAX_BODY_BYTES} byte limit.`);
    }
    return body;
  }
  return readStreamBody(req);
}

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  setCorsHeaders(res);

  if (requestPath(req) !== RENDER_SVG_API_PATH) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }
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
    body = await requestBody(req);
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
    return;
  }

  let svg: string;
  try {
    svg = renderFusionSvg(parsePlotSpec(body));
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(svg));
  res.end(svg);
}
