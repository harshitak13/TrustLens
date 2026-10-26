# pad-clean
Left-pad a string. Pure function: no network, no file access, no environment variables.
```js
const pad = require('pad-clean');
pad('5', 3, '0'); // '005'
```
