const logger = {
  info: (msg, meta = '') => {
    console.log(`\x1b[36m[${new Date().toISOString()}] [INFO]\x1b[0m ${msg}`, meta ? meta : '');
  },
  warn: (msg, meta = '') => {
    console.warn(`\x1b[33m[${new Date().toISOString()}] [WARN]\x1b[0m ${msg}`, meta ? meta : '');
  },
  error: (msg, meta = '') => {
    console.error(`\x1b[31m[${new Date().toISOString()}] [ERROR]\x1b[0m ${msg}`, meta ? meta : '');
  },
  debug: (msg, meta = '') => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\x1b[35m[${new Date().toISOString()}] [DEBUG]\x1b[0m ${msg}`, meta ? meta : '');
    }
  }
};

module.exports = logger;
