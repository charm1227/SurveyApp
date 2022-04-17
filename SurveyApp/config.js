module.exports.READ_MAIL_CONFIG = {
  imap: {
    user: process.env.surveyapplication2022,
    password: process.env.AdminHSB2022,
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
    user: process.env.surveyapplication2022,
    pass: process.env.AdminHSB2022,
    },
};

