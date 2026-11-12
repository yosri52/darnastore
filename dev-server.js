/**
 * DARNA Mehres Store — Local Development Server
 * Runs full-stack locally without requiring Netlify CLI installation.
 * 
 * Usage:
 *   node dev-server.js
 *   npm start
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8888;
const STATIC_DIR = path.join(__dirname, 'darna');
const FUNCTIONS_DIR = path.join(__dirname, 'netlify', 'functions');

// 1. Simple .env loader
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  });
}

loadEnv();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8'
};

// Route matching for Netlify Functions
function resolveFunction(pathname) {
  if (pathname === '/api/products' || pathname === '/.netlify/functions/get-products') {
    return path.join(FUNCTIONS_DIR, 'get-products.js');
  }
  if (pathname === '/api/create-order' || pathname === '/.netlify/functions/create-order') {
    return path.join(FUNCTIONS_DIR, 'create-order.js');
  }
  if (pathname === '/api/ai-config' || pathname === '/.netlify/functions/ai-config') {
    return path.join(FUNCTIONS_DIR, 'ai-config.js');
  }
  if (pathname.startsWith('/api/admin') || pathname.startsWith('/.netlify/functions/admin-api')) {
    return path.join(FUNCTIONS_DIR, 'admin-api.js');
  }
  if (pathname.startsWith('/api/')) {
    const fnName = pathname.replace(/^\/api\//, '').split('/')[0];
    const candidate = path.join(FUNCTIONS_DIR, fnName + '.js');
    if (fs.existsSync(candidate)) return candidate;
  }
  if (pathname.startsWith('/.netlify/functions/')) {
    const fnName = pathname.replace(/^\/\.netlify\/functions\//, '').split('/')[0];
    const candidate = path.join(FUNCTIONS_DIR, fnName + '.js');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Handle API Requests (Netlify Functions)
  const fnFile = resolveFunction(pathname);
  if (fnFile && fs.existsSync(fnFile)) {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        delete require.cache[require.resolve(fnFile)];
        const fnModule = require(fnFile);
        const event = {
          path: pathname,
          httpMethod: req.method,
          headers: req.headers,
          queryStringParameters: parsedUrl.query,
          body: bodyData,
          isBase64Encoded: false
        };

        const result = await fnModule.handler(event, {});
        const statusCode = (result && result.statusCode) || 200;
        const headers = (result && result.headers) || {};
        const body = (result && result.body) || '';

        res.writeHead(statusCode, headers);
        res.end(body);
      } catch (err) {
        console.error('Function execution error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Handle Admin SPA rewrite
  if (pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/admin/')) {
    const adminIndex = path.join(STATIC_DIR, 'admin', 'index.html');
    if (fs.existsSync(adminIndex)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(adminIndex).pipe(res);
      return;
    }
  }

  // Default to index.html for root
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  // Prevent directory traversal
  const safePath = path.normalize(path.join(STATIC_DIR, pathname));
  if (!safePath.startsWith(STATIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // 404 handler
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <div style="font-family:system-ui;text-align:center;padding:50px;direction:rtl">
          <h2>الصفحة غير موجودة (404)</h2>
          <p>الملف المطلوب: <code>${pathname}</code></p>
          <a href="/" style="display:inline-block;margin-top:15px;color:#b76543;font-weight:bold">العودة للمتجر الرئيسي</a>
        </div>
      `);
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(safePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('='.repeat(65));
  console.log(` DARNA Mehres Store is running successfully!`);
  console.log(` > Storefront: http://localhost:${PORT}`);
  console.log(` > Admin Panel: http://localhost:${PORT}/admin`);
  console.log(` > API Root:   http://localhost:${PORT}/api/`);
  console.log('='.repeat(65));
});

