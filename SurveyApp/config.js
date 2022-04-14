module.exports.READ_MAIL_CONFIG = {
  imap: {
    user: process.env.//Enter username,
    password: process.env.//Enter Password,
    host: 'imap.gmail.com',
    port: 993,
    authTimeout: 10000,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
  },
};

module.exports.SEND_MAIL_CONFIG = {
  service: 'gmail',
  auth: {
    user: process.env.//Enter username,
    pass: process.env.//Enter Password,
  },
};
