/** Parse the single sender accepted by the Brevo integration and startup checks. */
function parseEmailSender(value) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return null;

  const input = value.trim();
  const named = input.match(/^([^<>]+)<([^<>]+)>$/);
  const email = named ? named[2].trim() : input;
  const name = named ? named[1].trim().replace(/^"(.*)"$/, '$1').trim() : 'HostelHive';
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) return null;

  return name ? { email, name } : { email };
}

module.exports = { parseEmailSender };
