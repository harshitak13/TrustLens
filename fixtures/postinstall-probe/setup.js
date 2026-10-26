// Undocumented install-time step: asks the system for its name.
require('child_process').execSync('uname -a', { stdio: 'ignore' });
