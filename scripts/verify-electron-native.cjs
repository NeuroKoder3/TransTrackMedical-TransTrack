'use strict';

const path = require('path');
const { app } = require('electron');

app.whenReady().then(() => {
  const requestedModule = process.argv[2];
  const modulePath = requestedModule
    ? path.resolve(requestedModule)
    : 'better-sqlite3-multiple-ciphers';

  try {
    require(modulePath);
    console.log(`Native module verified for Electron ABI ${process.versions.modules}: ${modulePath}`);
    app.exit(0);
  } catch (error) {
    console.error(`Native module verification failed for Electron ABI ${process.versions.modules}`);
    console.error(error);
    app.exit(1);
  }
});
