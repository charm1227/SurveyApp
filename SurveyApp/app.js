// init
const express = require('express');
const app = express(); 
const bodyParser = require('body-parser'); // allows us to access data from forms
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { debug } = require('console');
const { closeDelimiter } = require('ejs');
const nodemailer = require('nodemailer');
const { SEND_MAIL_CONFIG } = require('./config');
const transporter = nodemailer.createTransport(SEND_MAIL_CONFIG);
const imaps = require('imap-simple');
const { convert } = require('html-to-text');
const { READ_MAIL_CONFIG } = require('./config');

let activeUser = null;

// TEMPORARY
// ---------
let username = 'admin';
let password = 'password';
const pushQuestionCount = 3;
// ---------

app.use(express.static(__dirname + '/public')); // make public directory accessible to client
app.use(bodyParser.urlencoded({ extended: true })); // use body parser
app.set('view engine', 'ejs');

// ----- ROUTES -----

app.get('/', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/login');
        return;
    }
    response.redirect('/dashboard');
});
app.get('/login', (request, response) => {   
    response.sendFile(__dirname + '/views/login.html');
}); 
app.post('/submitLogin', (request, response) => {
    let validUsername = username == request.body.username;
    let validPassword = password == request.body.password;
    if(validUsername && validPassword) {
        activeUser = request.socket.remoteAddress;
        response.redirect('/dashboard');
        return;
    }
    response.redirect('/login');
}); 
app.get('/logout', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    activeUser = null;
    response.redirect('/login');
});
app.get('/dashboard', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    let mySurveys = getAllSurveysIn('data/my_surveys');
    let publishedSurveys = getAllSurveysIn('data/published_surveys');
    response.render('dashboard', {data : {mySurveys, publishedSurveys}});
});
app.get('/publishSurvey/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    let survey = getSurvey('data/my_surveys/' + code + '.txt');
    publishSurvey(survey);
    response.redirect('/dashboard');
});
app.get('/unpublishSurvey/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    let survey = getSurvey('data/published_surveys/' + code + '.txt');
    unpublishSurvey(survey);
    response.redirect('/dashboard');
});
app.get('/createSurvey', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    response.render('createSurvey');
});
app.post('/submitCreateSurvey', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const body = request.body;
    
    // create survey from form
    let name = '';
    let questions = [];
    for(const key in body) {
        value = body[key];
        if(key == 'survey_name') {
            name = value;
        }
        else {
            // parse the key
            let keyParts = key.split('_');
            let qIndex = keyParts[0].replace('q', '');
            let qDataType = keyParts[1];

            // if no question, create null question
            if(qIndex >= questions.length) {
                // add null quesions to fill past deleted qIndexes
                let nullQuestionCount = qIndex - questions.length;
                for(let i=0; i<=nullQuestionCount; i++) {
                    let newQuestion = new Question(null, null, null);
                    questions.push(newQuestion);
                }
            }
            
            // assign the value to the question
            if(qDataType == 'type') {
                questions[qIndex].type = value;
            }
            else if(qDataType == 'text') {
                questions[qIndex].text = value;
            }
            else if(qDataType == 'responses') {
                questions[qIndex].responses = value;
            }
        }
    }

    // remove all null questions
    for (let i=questions.length-1; i>=0; i--) {
        if (questions[i].type == null || questions[i].text == null) {
            questions.splice(i, 1);
        }
    }

    const code = generateUniqueCode();
    const survey = new Survey(code, name, [], questions, 0);

    writeSurvey(survey, 'data/my_surveys/' + code + '.txt');
    response.redirect('dashboard');
});
// TODO
app.get('/editSurvey/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
});
app.get('/deleteSurvey/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    fs.unlinkSync('data/my_surveys/' + code + '.txt');
    response.redirect('/dashboard');
});
// TODO
app.get('/downloadSurveyData/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    downloadSurveyData(code);
    response.redirect('/dashboard');
});
app.get('/join', (request, response) => {
    response.sendFile(__dirname + '/views/join.html');
});
app.post('/submitJoin', (request, response) => {
    const code = request.body.code;
    const phoneNumber = request.body.phone;
    const provider = request.body.service_provider;

    // authenticate code
    try {
        var survey = getPublishedSurvey(code);
        // check if already joined
        let validPhone = true;
        survey.phones.forEach(p => {
            if(phoneNumber == p.number) {
                validPhone = false;
            }
        });
        if(!validPhone) {
            displayMessagePage(response, alreadyJoinedMessage);
            return;
        }

        // join survey
        const phone = new Phone(phoneNumber, provider);
        survey.subscribe(phone);
        savePublishedSurvey(survey);
        displayMessagePage(response, joinedSuccessfullyMessage);
    }
    catch(e) {
        displayMessagePage(response, invalidCodeMessage);
    }
});
// TODO - test success and error
app.get('/push/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;

    try {
        pushSurvey(code);
        displayMessagePage(response, pushSuccessfulMessage);
    }
    catch(e) {
        displayMessagePage(response, pushFailedMessage_invalidCode);
    }
});
app.get('/takeSurvey/:surveyCode/:phoneNumber', (request, response) => {
    const code = request.params.surveyCode;
    const phoneNumber = request.params.phoneNumber;

    const validSurvey = isSurveyPublished(code);
    if(validSurvey) {
        response.render('survey_views/' + code, {phoneNumber : phoneNumber});
        return;
    }
    displayMessagePage(response, surveyNotFoundMessage);
});
app.post('/submitResponse/:surveyCode/:phoneNumber/', (request, response) => {
    try {
        const code = request.params.surveyCode;
        const phoneNumber = request.params.phoneNumber;
        var data = request.body;
        submitSurveyResponse(code, phoneNumber, data);
        displayMessagePage(response, responseSuccessfullMessage);
    }
    catch(e) {
        displayMessagePage(response, responseFailedMessage);
    }
});
app.get('/message/:title/:message', (request, response) => {
    const title = request.params.title;
    const message = request.params.message;
    response.render('message', {data : {title, message}});
});

// ----- FUNCTIONS -----

function authorized(request) {
    let loggedIn = activeUser != null;
    let currentUser = JSON.stringify(activeUser) === JSON.stringify(request.socket.remoteAddress);
    if(!loggedIn || !currentUser) {
        return false;
    }
    return true;
}
function displayMessagePage(response, m) {
    response.redirect('/message/' + m.title + '/'+ m.text);
}

function getAllSurveysIn(dir) {
    let surveys = [];
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const survey = getSurvey(dir + '/' + file);
        surveys.push(survey);
    });
    return surveys;
}
function getSurvey(path) {
    const surveyString = fs.readFileSync(path);
    const surveyObject = JSON.parse(surveyString);
    const survey = Survey.createFrom(surveyObject);
    return survey;
}
function getPublishedSurvey(code) {
    const survey = getSurvey('data/published_surveys/' + code + '.txt');
    return survey;
}
function publishSurvey(survey) {
    // move file
    const fromDir = 'data/my_surveys/' + survey.code + '.txt';
    const toDir = 'data/published_surveys/' + survey.code + '.txt';
    fs.renameSync(fromDir, toDir);

    // generate take survey page
    fs.writeFileSync('views/survey_views/' + survey.code + '.ejs', ''); 
    updateTakeSurveyPage(survey.code);

    // generate survey data file
    let questionTexts = [];
    survey.questions.forEach(question => {
        questionTexts.push(question.text);
    });
    const surveyData = new SurveyData(survey.code, questionTexts, {});
    const surveyDataString = JSON.stringify(surveyData);
    fs.writeFileSync('data/survey_data/' + survey.code + '.txt', surveyDataString); 
}
function unpublishSurvey(survey) {
    // move file
    const fromDir = 'data/published_surveys/' + survey.code + '.txt';
    const toDir = 'data/my_surveys/' + survey.code + '.txt';
    fs.renameSync(fromDir, toDir);

    // delete take survey page
    fs.unlinkSync('views/survey_views/' + survey.code + '.ejs');

    // delete survey data file
    fs.unlinkSync('data/survey_data/' + survey.code + '.txt');
}
function isSurveyPublished(code) {
    let codes = getAllPublishedSurveyCodes();
    let validCode = false;
    codes.forEach(c => {
        if(code == c) {
            validCode = true;
        }
    });
    return validCode;
}
function writeSurvey(survey, path) {
    const surveyString = JSON.stringify(survey);
    fs.writeFileSync(path, surveyString);
}
function generateUniqueCode() {
    let codes = getAllSurveyCodes();
    let newCode = 0;
    while(true) {
        newCode = Math.floor(1000 + Math.random() * 9000);        
        if(!codes.includes(newCode)) {
            break;
        }
    }
    return newCode;
}
function getAllSurveyCodes() {
    let codes = [];
    const mySurveys = getAllSurveysIn('data/my_surveys');
    mySurveys.forEach(survey => {
        codes.push(survey.code);
    });
    const publishedSurveys = getAllSurveysIn('data/published_surveys');
    publishedSurveys.forEach(survey => {
        codes.push(survey.code);
    });
    return codes;
}
function getAllPublishedSurveyCodes() {
    let codes = [];
    const publishedSurveys = getAllSurveysIn('data/published_surveys');
    publishedSurveys.forEach(survey => {
        codes.push(survey.code);
    }); 
    return codes;
}
function savePublishedSurvey(survey) {
    writeSurvey(survey, 'data/published_surveys/' + survey.code + '.txt');
}

function pushSurvey(code) {
    updateTakeSurveyPage(code);
    sendNotification();
}
function updateTakeSurveyPage(code) {
    let survey = getPublishedSurvey(code);

    if(survey.isFinished()) {
        endSurvey(code);
        return;
    }

    // generate html code
    let pageCode = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <title>Survey App | Take Survey</title>
            <meta charset="utf-8">
            <link rel="stylesheet" href="css/styles.css">
        </head>
        <body>
            <h1>${survey.name}</h1>
            <form action='/submitResponse/${survey.code}/<%= phoneNumber %>' method="POST">
            <div class="question">`;

            // generate questions
            for(let i=1; i<=pushQuestionCount; i++) {
                let question = survey.getNextQuestion();
                if(question != null) {
                    // TF question
                    if(question.type == 'tf') {
                        pageCode += `<!-- T/F -->
                            <div>
                                <h3>${i}. ${question.text}</h3>
                                <input type="radio" name="${i}" value="true">
                                <label>True</label>
                                <input type="radio" name="${i}" value="false">
                                <label>False</label>
                            </div>`;
                    }
                    // FR question
                    else if(question.type == 'fr') {
                        pageCode += `<!-- FR -->
                            <div>
                                <h3>${i}. ${question.text}</h3>
                                <textarea rows="5" cols="60" name="${i}" placeholder="Enter text..."></textarea>
                            </div>`;
                    }
                    // MC question
                    else if(question.type == 'mc') {
                        pageCode += `<!-- MC -->
                            <div>
                                <h3>${i}. ${question.text}</h3>` 
                        question.responses.forEach(response => {
                            pageCode += `<input type="radio" name="${i}" value="${response}">
                            <label>${response}</label>`;
                        });
                        pageCode += `</div>`;
                    }
                }
            }

    pageCode += `
                <br>
                <button type="submit">Submit</button>
            </div>
            </form>
        </body>
        </html>`;

    savePublishedSurvey(survey);
    fs.writeFileSync('views/survey_views/' + code + '.ejs', pageCode);
}
function endSurvey(code) {
    // mark survey as complete
}
// TODO
function sendNotification() {
    try {
        const time = new Date().toDateString();
        let info =  transporter.sendMail({
          from: SEND_MAIL_CONFIG.auth.user,
          to: SEND_MAIL_CONFIG.auth.user,
          subject: 'Hello ✔',
          html: `
          <div
            class="container"
            style="max-width: 90%; margin: auto; padding-top: 20px"
          >
            <h2>This is a testing email</h2>
            <p>Please ignore this mail</p>
            <p>sent at ${time}</p>
          </div>
        `,
        });
        console.log(`MAIL INFO: ${info}`);
        console.log(`MAIL SENT AT: ${time}`);
      } catch (error) {
        console.log(error);
        return false;
      }
      //Need to send to different emails from provider and phone number
}

function submitSurveyResponse(code, phoneNumber, data) {
    const survey = getPublishedSurvey(code);
    let surveyData = getSurveyData(code);

    // get responses
    let responses = [];
    for(let i=1; i<=pushQuestionCount; i++) {
        responses.push(data[i]);
    }

    // add data
    let i = 0;
    responses.forEach(response => {
        let questionIndex = survey.questionNumber+i;
        surveyData.add(phoneNumber, response, questionIndex);
        i++;
    }); 

    // store survey data
    writeSurveyData(surveyData);
}
function getSurveyData(code) {
    const surveyDataString = fs.readFileSync('data/survey_data/' + code + '.txt');
    const surveyDataObject = JSON.parse(surveyDataString);
    const surveyData = SurveyData.createFrom(surveyDataObject);
    return surveyData;
}
function writeSurveyData(surveyData) {
    const surveyDataString = JSON.stringify(surveyData);
    fs.writeFileSync('data/survey_data/' + surveyData.code + '.txt', surveyDataString);
}
// TODO
function downloadSurveyData(code) {
    const surveyData = getSurveyData(code);

    // generate csv file
    let fileString = 'id';

    surveyData.questions.forEach(question => {
        fileString += ', ' + question.text;
    });
    fileString += '\n';

    surveyData.data.forEach(d => {
        fileString += d[0];
        
        d[1].forEach(response => {
            fileString += ', ' + response;
        });

        fileString += '\n';
    });

    // create file
    fs.writeFileSync('' + code + '.txt', fileString);

    // download file

    // delete file
}

// TODO
function unsubscribe() {
    const readMail = async () => {
        try {
          const connection =  imaps.connect(READ_MAIL_CONFIG);
          console.log('CONNECTION SUCCESSFUL', new Date().toString());
          const box =  connection.openBox('INBOX');
          const searchCriteria = ['UNSEEN'];
          const fetchOptions = {
            bodies: ['HEADER', 'TEXT'],
            markSeen: false,
          };
          const results =  connection.search(searchCriteria, fetchOptions);
          results.forEach((res) => {
            const text = res.parts.filter((part) => {
              return part.which === 'TEXT';
            });
            //Need to take Text and remove phone number if text == STOP
            let emailHTML = text[0].body;
            let emailText = convert(emailHTML);
            console.log(emailText);
          });
          connection.end();
        } catch (error) {
          console.log(error);
        }
      };
      
}

// ----- CLASSES -----

class Question {
    constructor(type, text, responses) {
        this.type = type;
        this.text = text;
        this.responses = responses;
    }
}
class Phone {
    constructor(number, provider) {
        this.number = number;
        this.provider = provider;
    }
}
class Survey {
    constructor(code, name, phones, questions, questionNumber) {
        this.code = code;
        this.name = name;
        this.phones = phones;
        this.questions = questions;
        this.questionNumber = questionNumber;
    }
    static createFrom(survey) {
        return new Survey(survey.code, survey.name, survey.phones, survey.questions, survey.questionNumber);
    }
    subscribe(phone) {
        this.phones.push(phone);
    }
    unsubscribe(phone) {
        
    }
    getNextQuestion() {
        const haveNextQuestion = this.questionNumber <= this.questions.length;
        
        if(haveNextQuestion) {
            return this.questions[this.questionNumber++];
        }
        savePublishedSurvey(this);
        return null;
    }
    isFinished() {
        if(this.questionNumber > this.questions.length) {
            return true;
        }
        return false;
    }
}
class SurveyData {
    constructor(code, questions, responseDictionary) {
        this.code = code;
        this.questions = questions;
        this.responseDictionary = responseDictionary;
    }
    static createFrom(surveyData) {
        return new SurveyData(surveyData.code, surveyData.questions, surveyData.responseDictionary);
    }
    add(phoneNumber, response, questionNumber) {
        // add new phone number
        const newPhoneNumber = !this.isPhoneNumberInData(phoneNumber);
        if(newPhoneNumber) {
            this.addPhoneNumber(phoneNumber);
        }

        // fill missing responses
        this.fillMissingResponses(phoneNumber, questionNumber);
        
        // add response
        let responses = this.responseDictionary[phoneNumber];
        const responseNumber = responses.length;
        const hasNotRespondedYet = responseNumber <= questionNumber;

        if(hasNotRespondedYet) {
            responses.push(response);
        }
    }  
    isPhoneNumberInData(phoneNumber) {
        let hasPhoneNumber = false;
        if(phoneNumber in this.responseDictionary) {
            hasPhoneNumber = true;
        }
        return hasPhoneNumber;
    }
    addPhoneNumber(phoneNumber) {
        this.responseDictionary[phoneNumber] = [];
    }
    fillMissingResponses(phoneNumber, questionIndex) {
        // calculate how many questions missing
        const responseIndex = this.responseDictionary[phoneNumber].length;
        const missingQuestionsCount = questionIndex - responseIndex;
        for(let i=0; i<missingQuestionsCount; i++) {
            this.responseDictionary[phoneNumber].push(null);
        }
    }
}
class Message {
    constructor(title, text) {
        this.title = title;
        this.text = text;
    }
}

// ----- MESSAGES -----

var invalidCodeMessage = new Message('Invalid code', 'Please try again.');
var alreadyJoinedMessage = new Message('Join failed', 'Looks like you already joined. No need to join twice.');
var joinedSuccessfullyMessage = new Message('Joined survey successfully', 'Hang out until you get notified to take the survey.');
var pushFailedMessage_invalidCode = new Message('Push failed', 'Looks like the code was invalid.');
var pushSuccessfulMessage = new Message('Push successful', 'Survey page updated... notifications sent... and now we wait.');
var responseSuccessfullMessage = new Message('Response recorded', 'Thank you for your response!');
var responseFailedMessage = new Message('Response failed', 'Please try again later.');
var surveyNotFoundMessage = new Message('Survey not found', 'Please try again later.');

// run server
//Checks every 15 mins for new emails
setInterval(() => {
    unsubscribe();
}, 15 * 60 * 1000);

const server = http.createServer(app);
server.listen(3000);
console.log('running server');
