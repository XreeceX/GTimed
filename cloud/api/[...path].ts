import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRequest } from "../lib/app.js";
import { createProductionDeps } from "../lib/prod.js";

const deps = createProductionDeps();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = String(req.headers.host ?? "localhost");
  const url = new URL(req.url ?? "/", `https://${host}`);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const result = await handleRequest(
    {
      method: req.method ?? "GET",
      pathname: url.pathname,
      search: url.search.startsWith("?") ? url.search.slice(1) : url.search,
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    },
    deps,
  );
  res.writeHead(result.status, result.headers);
  res.end(result.body);
}
