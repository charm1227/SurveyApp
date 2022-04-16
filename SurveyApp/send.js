// const nodemailer = require('nodemailer');
// const { SEND_MAIL_CONFIG } = require('./config');
// const transporter = nodemailer.createTransport(SEND_MAIL_CONFIG);

// module.exports.sendMail = async () => {
//   try {
//     const time = new Date().toDateString();
//     let info = await transporter.sendMail({
//       from: SEND_MAIL_CONFIG.auth.user,
//       to: SEND_MAIL_CONFIG,
//       subject: 'Notification',
//       html: `
//         <h2>Time to take your survey</h2>
//         <p>Access it here!</p>
//         <p></p>
//       </div>
//     `,
//     });
//     console.log(`MAIL INFO: ${info}`);
//     console.log(`MAIL SENT AT: ${time}`);
//   } catch (error) {
//     console.log(error);
//     return false;
//   }
// };
