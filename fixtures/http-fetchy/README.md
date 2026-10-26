# http-fetchy
Makes an HTTP request to the URL you pass. Reads `FETCHY_TIMEOUT` from the environment.
```js
const get = require('http-fetchy');
get('https://example.test/').then(console.log);
```
