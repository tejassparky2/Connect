// Static server for the Expo web export with SPA fallback (single-output mode).
const http = require('http');
const handler = require('serve-handler');
const dir = process.argv[2] || '../apps/mobile/dist';
const port = Number(process.argv[3] || 8081);
http
  .createServer((req, res) => handler(req, res, { public: dir, rewrites: [{ source: '**', destination: '/index.html' }] }))
  .listen(port, () => console.log(`web on :${port}`));
