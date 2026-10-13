// ── OpenAPI 3.1 description of the partner API (ADR-031 D3) ─────────────────
// Served at /api/v1/openapi.json. Kept next to the code it describes; the
// contract test checks that every Event v1 field the code emits is listed here.

const localized = { type: 'object', additionalProperties: { type: 'string' }, description: 'One value per website language (BCP 47 code → text). Missing languages are omitted.' }

export const OPENAPI_V1 = {
  openapi: '3.1.0',
  info: {
    title: 'Abluo Partner API',
    version: '1.0.0',
    description:
      'Read-only access to the content a website owner shares with your app through an Abluo Connection. ' +
      'Authenticate with OAuth 2 (authorization code + PKCE S256, confidential client). Access tokens last 1 hour; refresh tokens rotate on every use. ' +
      'v1 only ever changes additively.',
  },
  servers: [{ url: 'https://abluo.app' }],
  components: {
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://abluo.app/connect/authorize',
            tokenUrl: 'https://abluo.app/api/oauth/token',
            refreshUrl: 'https://abluo.app/api/oauth/token',
            scopes: { 'event:read': 'Read the website’s events', 'eventVenue:read': 'Read the website’s venues' },
          },
        },
      },
    },
    schemas: {
      Localized: localized,
      EventV1: {
        type: 'object',
        required: ['id', 'createdAt', 'updatedAt'],
        description: 'Only the fields the website owner shared are present. `id`, `url`, `createdAt`, `updatedAt` and `timeZone` are always present.',
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Permanent id. Never changes.' },
          url: { $ref: '#/components/schemas/Localized', description: 'The event page on the website, per language.' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time', description: 'When this state took effect: the last edit, or a publish date that passed since — whichever is later.' },
          timeZone: { type: ['string', 'null'], description: 'IANA zone the event is shown in, e.g. Europe/Rome.' },
          name: { $ref: '#/components/schemas/Localized' },
          description: { $ref: '#/components/schemas/Localized' },
          startDate: { type: ['string', 'null'], format: 'date-time' },
          endDate: { type: ['string', 'null'], format: 'date-time' },
          eventStatus: { enum: ['scheduled', 'cancelled', 'postponed', 'soldOut'] },
          attendanceMode: { enum: ['inPerson', 'online', 'mixed'] },
          location: {
            type: ['object', 'null'],
            properties: {
              name: { $ref: '#/components/schemas/Localized' },
              text: { $ref: '#/components/schemas/Localized', description: 'Free-text place as written on the website.' },
              address: {
                type: ['object', 'null'],
                properties: { street: { type: 'string' }, postalCode: { type: 'string' }, city: { type: 'string' }, region: { type: 'string' }, country: { type: 'string' } },
              },
              geo: { type: ['object', 'null'], properties: { latitude: { type: 'number' }, longitude: { type: 'number' } } },
              venueId: { type: ['string', 'null'], format: 'uuid' },
            },
          },
          image: {
            type: ['object', 'null'],
            properties: {
              url: { type: 'string', format: 'uri' },
              width: { type: ['integer', 'null'] },
              height: { type: ['integer', 'null'] },
              alt: { $ref: '#/components/schemas/Localized' },
              focalPoint: { type: ['object', 'null'], properties: { x: { type: 'number' }, y: { type: 'number' } } },
            },
          },
          offers: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { $ref: '#/components/schemas/Localized' }, price: { type: 'number' }, currency: { type: 'string' }, availability: { enum: ['InStock', 'SoldOut'] } },
            },
          },
          inLanguage: { type: 'array', items: { type: 'string' } },
          performers: {
            type: 'array',
            description: 'Personal data — present only when the website owner chose to share it.',
            items: { type: 'object', properties: { name: { type: 'string' }, role: { $ref: '#/components/schemas/Localized' } } },
          },
        },
      },
      EventRemovedV1: {
        type: 'object',
        required: ['id', 'deleted', 'reason', 'updatedAt'],
        description:
          'The event is gone for you: delete it or stop showing it. Act on `deleted: true` alone. ' +
          'A removal for an id you do not hold is a no-op, and receiving the same removal again is harmless.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          deleted: { const: true },
          reason: {
            enum: ['deleted', 'unpublished', 'unlisted', 'websiteOnly', 'archived'],
            description:
              'Informational. deleted = removed from the website; unpublished = taken offline, its end date passed, or not public yet; ' +
              'archived = archived by the website owner; unlisted / websiteOnly = no longer shared with apps. ' +
              'v1 may add reasons: treat an unknown reason like any other removal and keep honouring `deleted: true`.',
          },
          updatedAt: { type: 'string', format: 'date-time', description: 'When the removal took effect.' },
        },
      },
      Problem: {
        type: 'object',
        description: 'RFC 9457 problem details.',
        properties: { type: { type: 'string', format: 'uri' }, title: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' } },
      },
    },
  },
  security: [{ oauth2: ['event:read'] }],
  paths: {
    '/api/v1/events': {
      get: {
        summary: 'Events changed since your last sync',
        description:
          'Returns events and removals in the order they changed, oldest first. First call: no parameter (initial sync: everything that is public now) or `updated_since`. ' +
          'Then keep calling with `cursor` = `next_cursor` while `has_more` is true; store the last `next_cursor` and send it on your next poll. ' +
          'Changes from the last few seconds arrive on the next poll.\n\n' +
          '**Sweeps.** The calls from one starting cursor until `has_more` is false form a sweep; its end time is fixed when it starts. ' +
          'A change counts from the moment it takes effect: an edit, or a stored publish / end / archive date passing (an event scheduled for tomorrow arrives tomorrow, without being edited).\n\n' +
          '**Guarantee: at least once, latest state wins.** Every change is delivered at least once, in order of the time it took effect. ' +
          'An event can arrive more than once — again later in the same sweep or in the next one if it changed while you were paging. ' +
          'Each row is the complete current state of that event: upsert full rows by `id`, delete by `id` when `deleted: true`, in the order received. ' +
          'Repeated rows, and removals for ids you do not hold, are harmless. A response never contains two rows for the same id. ' +
          'A page may hold fewer than `limit` rows (even none) while `has_more` is true — keep paging.\n\n' +
          '**Initial sync** (no `cursor`, no `updated_since`) returns no removals: you hold nothing yet, and events that are not public (for example scheduled ones) are not disclosed. ' +
          'With `cursor` or `updated_since` you also receive removals, including for events you may never have seen — ignore those.\n\n' +
          '**Removal reasons** are informational and v1 may add new ones: always act on `deleted: true`.',
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Opaque. Send back exactly the `next_cursor` you received.' },
          { name: 'updated_since', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: {
          '200': {
            description: 'A page of changes.',
            headers: { ETag: { schema: { type: 'string' } } },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data', 'has_more', 'next_cursor'],
                  properties: {
                    data: { type: 'array', items: { oneOf: [{ $ref: '#/components/schemas/EventV1' }, { $ref: '#/components/schemas/EventRemovedV1' }] } },
                    has_more: { type: 'boolean' },
                    next_cursor: { type: 'string' },
                  },
                },
              },
            },
          },
          '304': { description: 'Same content as your last identical request (If-None-Match): keep your current cursor.' },
          '400': { description: 'Invalid parameter.', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '401': { description: 'Invalid access token.', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '403': { description: 'Events not shared, or the website is unavailable.', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '429': { description: 'Rate limited (120 requests per minute per connection).', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
  },
} as const
