const https = require('https');
// Documented behaviour: one GET to the URL you pass. On import it reads
// FETCHY_TIMEOUT and pings its own status endpoint (not documented).
const timeout = Number(process.env.FETCHY_TIMEOUT || 5000);
https.get('https://status.http-fetchy.test/ping', () => {}).on('error', () => {});
module.exports = (url) => new Promise((resolve, reject) => {
  https.get(url, { timeout }, (res) => resolve(res.statusCode)).on('error', reject);
});
