'use strict';
const { randomBytes } = require('node:crypto');
let db;
function dynamo() {
  if (!db) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const lib = require('@aws-sdk/lib-dynamodb');
    db = lib.DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return db;
}
const table = process.env.TABLE_NAME;
const baseUrl = (process.env.BASE_URL || 'https://links.example.com').replace(/\/$/, '');
const ttlSeconds = 30 * 86400;
const reply = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) });
function bodyOf(event) { try { return JSON.parse(event.body || '{}'); } catch { return null; } }
function validUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.toString() : null; } catch { return null; } }
exports.shorten = async event => {
  const body = bodyOf(event); if (!body) return reply(400, { error: 'Invalid JSON body' });
  const longUrl = validUrl(body.longUrl); if (!longUrl) return reply(400, { error: 'longUrl must be a valid http or https URL' });
  const now = Math.floor(Date.now() / 1000), expiresAt = now + ttlSeconds;
  for (let i = 0; i < 4; i++) {
    const shortCode = randomBytes(5).toString('base64url');
    try {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await dynamo().send(new PutCommand({ TableName: table, Item: { shortCode, longUrl, createdAt: now, expiresAt, clickCount: 0 }, ConditionExpression: 'attribute_not_exists(shortCode)' }));
      return reply(201, { shortCode, shortUrl: `${baseUrl}/${shortCode}`, longUrl, expiresAt: new Date(expiresAt * 1000).toISOString() });
    } catch (error) { if (error.name !== 'ConditionalCheckFailedException' || i === 3) throw error; }
  }
};
exports.resolve = async event => {
  const code = event.pathParameters?.code || event.rawPath?.split('/').filter(Boolean).pop();
  if (!code || !/^[A-Za-z0-9_-]{6,16}$/.test(code)) return reply(400, { error: 'Invalid short code' });
  const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
  const found = await dynamo().send(new GetCommand({ TableName: table, Key: { shortCode: code }, ConsistentRead: true }));
  if (!found.Item) return reply(404, { error: 'Short URL not found' });
  const now = Math.floor(Date.now() / 1000);
  if (found.Item.expiresAt <= now) return reply(410, { error: 'Short URL expired' });
  try {
    await dynamo().send(new UpdateCommand({ TableName: table, Key: { shortCode: code }, UpdateExpression: 'ADD clickCount :one', ConditionExpression: 'expiresAt > :now', ExpressionAttributeValues: { ':one': 1, ':now': now } }));
  } catch (error) { if (error.name === 'ConditionalCheckFailedException') return reply(410, { error: 'Short URL expired' }); throw error; }
  return reply(200, { longUrl: found.Item.longUrl });
};
exports._test = { validUrl, bodyOf, ttlSeconds };
