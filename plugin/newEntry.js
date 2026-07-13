const stateToEntry = require('./format');
const applyBodyFields = require('./entryFields');

function explicitDatetime(value) {
  if (!value) {
    return null;
  }
  const datetime = new Date(value);
  if (Number.isNaN(datetime.getTime())) {
    throw new Error('Invalid datetime');
  }
  return datetime.toISOString();
}

function newEntryFromBody(body, stats, author = '') {
  const datetime = explicitDatetime(body.datetime);
  if (datetime) {
    return applyBodyFields({
      datetime,
      text: body.text,
      author,
      origin: 'manual',
    }, body);
  }
  return applyBodyFields(stateToEntry(stats, body.text, author), body);
}

module.exports = {
  explicitDatetime,
  newEntryFromBody,
};
