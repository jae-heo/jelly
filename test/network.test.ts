import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowClientUrl, isTailnetIPv4, resolveBinding } from '../src/network.js';

test('binding rejects wildcard, LAN and public addresses', () => {
  for (const host of ['0.0.0.0', '::', '192.168.1.2', '8.8.8.8', '100.64.0.42', 'localhost']) {
    assert.throws(() => resolveBinding(host), /JELLY_HOST/);
  }
  assert.deepEqual(resolveBinding('127.0.0.1'), { host: '127.0.0.1' });
});

test('HTTP CLI connections are limited to loopback and the tailnet IPv4 range', () => {
  for (const ip of ['100.64.0.0', '100.64.0.42', '100.127.255.255']) {
    assert.ok(isTailnetIPv4(ip));
    assert.ok(allowClientUrl(new URL(`http://${ip}:47821`)));
  }
  for (const ip of ['100.63.255.255', '100.128.0.0', '100.999.1.1', '192.168.1.1', '0.0.0.0']) {
    assert.equal(isTailnetIPv4(ip), false);
  }
  for (const url of ['http://192.168.1.1:47821', 'http://example.com', 'ftp://100.64.0.1', 'http://user:password@100.64.0.1']) {
    assert.equal(allowClientUrl(new URL(url)), false);
  }
  assert.ok(allowClientUrl(new URL('http://127.0.0.1:47821')));
  assert.ok(allowClientUrl(new URL('https://example.com')));
});
