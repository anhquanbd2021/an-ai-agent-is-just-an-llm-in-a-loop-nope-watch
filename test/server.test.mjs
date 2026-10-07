import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticServer } from '../app/server.js';
import { once } from 'node:events';

async function withServer(fn) {
  const server = createStaticServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test('/health and /version respond; static allowlist serves the lab', async () => {
  await withServer(async base => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'ok');

    const version = await fetch(`${base}/version`);
    assert.equal(version.status, 200);
    assert.equal((await version.json()).name, 'an-ai-agent-is-just-an-llm-in-a-loop-nope-watch-demo');

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    const html = await index.text();
    assert.match(html, /Runway Replay/);
    assert.match(html, /aria-label="Primary"/);
    assert.match(html, /href="\/guide\.html"/);
    assert.match(html, /github\.com\/anhquanbd2021\/an-ai-agent-is-just-an-llm-in-a-loop-nope-watch/);

    for (const path of ['/app.js', '/lab.mjs', '/styles.css', '/guide.html', '/pb-shell.css', '/pb-back.css']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, path);
    }
  });
});

test('unknown paths and traversal return 404; HEAD works', async () => {
  await withServer(async base => {
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/app/server.js`)).status, 404);
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
});

