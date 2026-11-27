'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../src');

class GetCommand { constructor(input) { this.input = input; } }
class QueryCommand { constructor(input) { this.input = input; } }
class TransactWriteCommand { constructor(input) { this.input = input; } }
const commands = { GetCommand, QueryCommand, TransactWriteCommand };
const event = longUrl => ({ body: JSON.stringify({ longUrl }) });
function makeShortener(send, options = {}) {
  return _test.createShortener({
    client: { send },
    commands,
    table: 'urls',
    publicBaseUrl: 'https://short.example.com',
    now: () => options.now ?? 1_800_000_000,
    makeCode: options.makeCode ?? (() => 'newCode1')
  });
}

test('allows only HTTP(S) destinations', () => {
  assert.equal(_test.validUrl('javascript:alert(1)'), null);
  assert.equal(_test.validUrl('https://example.com/a'), 'https://example.com/a');
});

test('rejects malformed JSON', () => assert.equal(_test.bodyOf({ body: '{' }), null));
test('sets expiration to 30 days', () => assert.equal(_test.ttlSeconds, 30 * 86400));

test('normalizes equivalent URL forms to the same mapping key', () => {
  const first = _test.validUrl('https://www.google.com');
  const second = _test.validUrl('https://www.google.com/');
  assert.equal(_test.urlKey(first), _test.urlKey(second));
});

test('returns the existing unexpired short link for a duplicate URL', async () => {
  const now = 1_800_000_000;
  const normalized = 'https://www.google.com/';
  const code = 'existing1';
  const mapping = { shortCode: _test.urlKey(normalized), targetShortCode: code, expiresAt: now + 1000 };
  const link = { shortCode: code, longUrl: normalized, expiresAt: now + 1000, clickCount: 6 };
  let calls = 0;
  const shorten = makeShortener(async command => {
    calls++;
    assert.ok(command instanceof GetCommand);
    return command.input.Key.shortCode === mapping.shortCode ? { Item: mapping } : { Item: link };
  }, { now });

  const result = await shorten(event('https://www.google.com'));
  const body = JSON.parse(result.body);
  assert.equal(result.statusCode, 200);
  assert.equal(body.shortCode, code);
  assert.equal(body.shortUrl, `https://short.example.com/${code}`);
  assert.equal(body.reused, true);
  assert.equal(calls, 2);
});

test('creates the URL mapping and short link atomically for a new URL', async () => {
  let transaction;
  const shorten = makeShortener(async command => {
    if (command instanceof GetCommand) return {};
    if (command instanceof QueryCommand) return { Items: [] };
    assert.ok(command instanceof TransactWriteCommand);
    transaction = command.input;
    return {};
  });

  const result = await shorten(event('https://www.google.com'));
  const body = JSON.parse(result.body);
  assert.equal(result.statusCode, 201);
  assert.equal(body.shortCode, 'newCode1');
  assert.equal(body.reused, false);
  assert.equal(transaction.TransactItems.length, 2);
  assert.ok(transaction.TransactItems[0].Put.Item.shortCode.startsWith('URL#'));
  assert.equal(transaction.TransactItems[0].Put.Item.targetShortCode, 'newCode1');
  assert.equal(transaction.TransactItems[1].Put.Item.shortCode, 'newCode1');
});

test('finds and maps an existing link that predates URL mappings', async () => {
  const now = 1_800_000_000;
  const normalized = 'https://www.google.com/';
  const link = { shortCode: 'legacy01', longUrl: normalized, createdAt: now - 50, expiresAt: now + 1000 };
  let transaction;
  const shorten = makeShortener(async command => {
    if (command instanceof GetCommand) {
      if (command.input.Key.shortCode.startsWith('URL#')) return {};
      return { Item: link };
    }
    if (command instanceof QueryCommand) {
      assert.equal(command.input.IndexName, 'byLongUrl');
      assert.equal(command.input.ExpressionAttributeValues[':url'], normalized);
      return { Items: [{ shortCode: link.shortCode }] };
    }
    transaction = command.input;
    return {};
  }, { now });

  const result = await shorten(event('https://www.google.com'));
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).shortCode, 'legacy01');
  assert.equal(transaction.TransactItems.length, 2);
  assert.equal(transaction.TransactItems[0].Put.Item.targetShortCode, 'legacy01');
  assert.match(transaction.TransactItems[1].ConditionCheck.ConditionExpression, /expiresAt > :now/);
});

test('reuses the winner when concurrent duplicate creation loses the transaction race', async () => {
  const now = 1_800_000_000;
  const normalized = 'https://www.google.com/';
  const code = 'winner01';
  const mapping = { shortCode: _test.urlKey(normalized), targetShortCode: code, expiresAt: now + 1000 };
  const link = { shortCode: code, longUrl: normalized, expiresAt: now + 1000 };
  let transactionCount = 0;
  let getCount = 0;
  const shorten = makeShortener(async command => {
    if (command instanceof GetCommand) {
      getCount++;
      if (getCount === 1) return {};
      return getCount === 2 ? { Item: mapping } : { Item: link };
    }
    if (command instanceof QueryCommand) return { Items: [] };
    transactionCount++;
    const error = new Error('Conditional transaction conflict');
    error.name = 'TransactionCanceledException';
    throw error;
  }, { now, makeCode: () => 'loser001' });

  const result = await shorten(event('https://www.google.com/'));
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).shortCode, code);
  assert.equal(transactionCount, 1);
});

test('replaces an expired URL mapping with a fresh 30-day link', async () => {
  const now = 1_800_000_000;
  const normalized = 'https://www.google.com/';
  let transaction;
  const shorten = makeShortener(async command => {
    if (command instanceof GetCommand) {
      return { Item: { shortCode: _test.urlKey(normalized), targetShortCode: 'expired1', expiresAt: now - 1 } };
    }
    transaction = command.input;
    return {};
  }, { now, makeCode: () => 'fresh001' });

  const result = await shorten(event(normalized));
  assert.equal(result.statusCode, 201);
  assert.equal(JSON.parse(result.body).shortCode, 'fresh001');
  assert.match(transaction.TransactItems[0].Update.ConditionExpression, /expiresAt <= :now/);
  assert.equal(transaction.TransactItems[0].Update.ExpressionAttributeValues[':expiry'], now + 30 * 86400);
});
