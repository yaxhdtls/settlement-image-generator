import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";

const root = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (url.pathname === "/sheet.csv") {
    proxySheetCsv(url, response);
    return;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requestedPath));

  if (!filePath.startsWith(normalize(root)) || !existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  const localUrl = host === "0.0.0.0" ? `http://127.0.0.1:${port}` : `http://${host}:${port}`;
  console.log(localUrl);
});

async function proxySheetCsv(url, response) {
  const target = url.searchParams.get("url");
  if (!target || !target.startsWith("https://docs.google.com/spreadsheets/")) {
    response.writeHead(400);
    response.end("Invalid sheet URL");
    return;
  }

  try {
    const upstream = await fetch(target);
    if (!upstream.ok) {
      response.writeHead(upstream.status);
      response.end(await upstream.text());
      return;
    }

    response.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
    response.end(await upstream.text());
  } catch (error) {
    response.writeHead(502);
    response.end(error instanceof Error ? error.message : "Failed to fetch sheet");
  }
}
