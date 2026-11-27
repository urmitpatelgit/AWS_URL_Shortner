'use strict';

const { createHash, randomBytes } = require('node:crypto');

let documentClient;
function dynamo() {
  if (!documentClient) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return documentClient;
}

const tableName = process.env.TABLE_NAME;
const baseUrl = (process.env.BASE_URL || 'https://links.example.com').replace(/\/$/, '');
const ttlSeconds = 30 * 86400;
const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body)
});

function bodyOf(event) {
  try { return JSON.parse(event.body || '{}'); } catch { return null; }
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.toString() : null;
  } catch { return null; }
}

function urlKey(longUrl) {
  const digest = createHash('sha256').update(longUrl).digest('hex');
  return `URL#${digest}`;
}

async function findExistingActiveLink({ client, GetCommand, QueryCommand, table, longUrl, requestTime }) {
  let exclusiveStartKey;
  do {
    const result = await client.send(new QueryCommand({
      TableName: table,
      IndexName: 'byLongUrl',
      KeyConditionExpression: 'longUrl = :url',
      FilterExpression: 'expiresAt > :now',
      ExpressionAttributeValues: { ':url': longUrl, ':now': requestTime },
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
    }));
    for (const candidate of result.Items || []) {
      const current = await client.send(new GetCommand({
        TableName: table,
        Key: { shortCode: candidate.shortCode },
        ConsistentRead: true
      }));
      if (current.Item && current.Item.expiresAt > requestTime) return current.Item;
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return null;
}

function createShortener({ client, commands, table, publicBaseUrl, now = () => Math.floor(Date.now() / 1000), makeCode = () => randomBytes(5).toString('base64url') }) {
  const { GetCommand, QueryCommand, TransactWriteCommand } = commands;

  return async function shorten(event) {
    const body = bodyOf(event);
    if (!body) return reply(400, { error: 'Invalid JSON body' });

    const longUrl = validUrl(body.longUrl);
    if (!longUrl) return reply(400, { error: 'longUrl must be a valid http or https URL' });
    if (Buffer.byteLength(longUrl, 'utf8') > 2048) return reply(400, { error: 'longUrl cannot exceed 2048 bytes' });

    const mappingKey = urlKey(longUrl);

    for (let attempt = 0; attempt < 6; attempt++) {
      const requestTime = now();
      const mappingResult = await client.send(new GetCommand({
        TableName: table,
        Key: { shortCode: mappingKey },
        ConsistentRead: true
      }));
      const mapping = mappingResult.Item;

      if (mapping && mapping.expiresAt > requestTime) {
        const linkResult = await client.send(new GetCommand({
          TableName: table,
          Key: { shortCode: mapping.targetShortCode },
          ConsistentRead: true
        }));

        if (linkResult.Item && linkResult.Item.expiresAt > requestTime) {
          return reply(200, {
            shortCode: linkResult.Item.shortCode,
            shortUrl: `${publicBaseUrl}/${linkResult.Item.shortCode}`,
            longUrl: linkResult.Item.longUrl,
            expiresAt: new Date(linkResult.Item.expiresAt * 1000).toISOString(),
            reused: true
          });
        }
      }

      const shortCode = makeCode();
      const expiresAt = requestTime + ttlSeconds;
      const linkItem = { shortCode, longUrl, createdAt: requestTime, expiresAt, clickCount: 0 };
      const mappingItem = {
        shortCode: mappingKey,
        targetShortCode: shortCode,
        createdAt: requestTime,
        expiresAt
      };
      let mappingWrite;

      if (!mapping) {
        const existingLink = await findExistingActiveLink({
          client, GetCommand, QueryCommand, table, longUrl, requestTime
        });

        if (existingLink) {
          try {
            await client.send(new TransactWriteCommand({
              TransactItems: [{
                Put: {
                  TableName: table,
                  Item: {
                    shortCode: mappingKey,
                    targetShortCode: existingLink.shortCode,
                    createdAt: existingLink.createdAt,
                    expiresAt: existingLink.expiresAt
                  },
                  ConditionExpression: 'attribute_not_exists(shortCode)'
                }
              }, {
                ConditionCheck: {
                  TableName: table,
                  Key: { shortCode: existingLink.shortCode },
                  ConditionExpression: 'expiresAt > :now',
                  ExpressionAttributeValues: { ':now': requestTime }
                }
              }]
            }));
            return reply(200, {
              shortCode: existingLink.shortCode,
              shortUrl: `${publicBaseUrl}/${existingLink.shortCode}`,
              longUrl: existingLink.longUrl,
              expiresAt: new Date(existingLink.expiresAt * 1000).toISOString(),
              reused: true
            });
          } catch (error) {
            if (error.name !== 'TransactionCanceledException' && error.name !== 'ConditionalCheckFailedException') throw error;
            continue;
          }
        }

        mappingWrite = {
          Put: {
            TableName: table,
            Item: mappingItem,
            ConditionExpression: 'attribute_not_exists(shortCode)'
          }
        };
      } else {
        const isExpired = mapping.expiresAt <= requestTime;
        mappingWrite = {
          Update: {
            TableName: table,
            Key: { shortCode: mappingKey },
            UpdateExpression: 'SET targetShortCode = :code, createdAt = :created, expiresAt = :expiry',
            ConditionExpression: isExpired
              ? 'expiresAt <= :now'
              : 'targetShortCode = :oldCode AND expiresAt > :now',
            ExpressionAttributeValues: {
              ':code': shortCode,
              ':created': requestTime,
              ':expiry': expiresAt,
              ':now': requestTime,
              ...(isExpired ? {} : { ':oldCode': mapping.targetShortCode })
            }
          }
        };
      }

      try {
        await client.send(new TransactWriteCommand({
          TransactItems: [
            mappingWrite,
            {
              Put: {
                TableName: table,
                Item: linkItem,
                ConditionExpression: 'attribute_not_exists(shortCode)'
              }
            }
          ]
        }));
        return reply(201, {
          shortCode,
          shortUrl: `${publicBaseUrl}/${shortCode}`,
          longUrl,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
          reused: false
        });
      } catch (error) {
        if (error.name !== 'TransactionCanceledException' && error.name !== 'ConditionalCheckFailedException') throw error;
      }
    }

    throw new Error('Could not create or reuse a short URL after repeated concurrent updates');
  };
}

exports.shorten = async event => {
  const commands = require('@aws-sdk/lib-dynamodb');
  return createShortener({
    client: dynamo(),
    commands,
    table: tableName,
    publicBaseUrl: baseUrl
  })(event);
};

exports.resolve = async event => {
  const code = event.pathParameters?.code || event.rawPath?.split('/').filter(Boolean).pop();
  if (!code || !/^[A-Za-z0-9_-]{6,16}$/.test(code)) return reply(400, { error: 'Invalid short code' });

  const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
  const found = await dynamo().send(new GetCommand({ TableName: tableName, Key: { shortCode: code }, ConsistentRead: true }));
  if (!found.Item) return reply(404, { error: 'Short URL not found' });

  const requestTime = Math.floor(Date.now() / 1000);
  if (found.Item.expiresAt <= requestTime) return reply(410, { error: 'Short URL expired' });

  try {
    await dynamo().send(new UpdateCommand({
      TableName: tableName,
      Key: { shortCode: code },
      UpdateExpression: 'ADD clickCount :one',
      ConditionExpression: 'expiresAt > :now',
      ExpressionAttributeValues: { ':one': 1, ':now': requestTime }
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') return reply(410, { error: 'Short URL expired' });
    throw error;
  }

  return reply(200, { longUrl: found.Item.longUrl });
};

exports._test = { validUrl, bodyOf, ttlSeconds, urlKey, findExistingActiveLink, createShortener };
