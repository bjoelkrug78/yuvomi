import { op, jsonBody, idParam, withCaseReasons } from '../helpers.js';

// Gleiche Antworten wie bei den Geburtstagen: POST und PUT prüfen ihre Felder
// und antworten mit 400, `op()` führt ohne eigene Antwortmenge nur 200/401/500.
function withBadRequest(status, description, extra = {}) {
  return {
    [status]: { description },
    400: { $ref: '#/components/responses/BadRequest' },
    401: { $ref: '#/components/responses/Unauthorized' },
    ...extra,
    500: { $ref: '#/components/responses/InternalServerError' },
  };
}

const ANNIVERSARY_GONE = '`anniversaries_not_found` (404, the anniversary does not exist - deleted)';

const CASE_REASONS = {
  '/api/v1/anniversaries/{id}': { put: ANNIVERSARY_GONE, delete: ANNIVERSARY_GONE },
};

export function anniversariesPaths() {
  return withCaseReasons('anniversaries', CASE_REASONS, {
    '/api/v1/anniversaries': {
      get: op({ summary: 'List anniversaries', tag: 'Birthdays' }),
      post: op({
        summary: 'Create anniversary',
        description: 'Each of the two people is either `person_a_birthday_id` / `person_b_birthday_id` (an existing birthday) or a free name in `person_a_name` / `person_b_name`. A side with neither is refused with 400. `anniversary_date` is `YYYY-MM-DD`; `year_unknown` omits the year. The anniversary gets a yearly calendar event and reminder, like a birthday.',
        tag: 'Birthdays',
        stateChanging: true,
        requestBody: jsonBody('#/components/schemas/AnniversaryCreateInput'),
        responses: withBadRequest(201, 'Anniversary created'),
      }),
    },
    '/api/v1/anniversaries/{id}': {
      put: op({
        summary: 'Update anniversary',
        description: 'Only the fields you send change. A side sent with a birthday link or a free name replaces that side as a whole.',
        tag: 'Birthdays',
        stateChanging: true,
        params: [idParam()],
        requestBody: jsonBody('#/components/schemas/AnniversaryUpdateInput'),
        responses: withBadRequest(200, 'Anniversary updated', {
          404: { description: 'Anniversary not found' },
        }),
      }),
      delete: op({
        summary: 'Delete anniversary',
        tag: 'Birthdays',
        stateChanging: true,
        params: [idParam()],
        responses: {
          204: { description: 'Anniversary deleted' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { description: 'Anniversary not found' },
          500: { $ref: '#/components/responses/InternalServerError' },
        },
      }),
    },
  });
}
