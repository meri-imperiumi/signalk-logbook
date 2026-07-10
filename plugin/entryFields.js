/**
 * Apply the request-body fields of POST /logs onto an entry produced by
 * stateToEntry. Body values win over auto-captured ones, but observations
 * merge key-by-key so a manual visibility doesn't drop an auto-captured
 * sea state. Invalid vhf values are ignored here so they can't fail Entry
 * schema validation at append time.
 */
module.exports = function applyBodyFields(data, body) {
  const entry = {
    ...data,
  };
  if (body.category) {
    entry.category = body.category;
  } else {
    entry.category = 'navigation';
  }
  if (body.observations) {
    entry.observations = {
      ...data.observations,
      ...body.observations,
    };
  }
  if (typeof body.vhf === 'string' && body.vhf.length >= 1 && body.vhf.length <= 2) {
    entry.vhf = body.vhf;
  }
  if (body.position) {
    entry.position = {
      ...body.position,
    };
  }
  if (typeof body.author === 'string' && body.author.length >= 1) {
    // Delegation: an authenticated client (voice assistant, crew app) writes
    // the line on behalf of the person who authored it.
    entry.author = body.author;
  }
  if (['manual', 'auto', 'agent'].includes(body.origin)) {
    entry.origin = body.origin;
  }
  return entry;
};
