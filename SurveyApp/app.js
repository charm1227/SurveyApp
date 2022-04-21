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

let activeUser = null;

// TEMPORARY
// ---------
let username = 'admin';
let password = 'password';
// ---------

app.use(express.static(__dirname + '/public')); // make public directory accessible to client
app.use(bodyParser.urlencoded({ extended: true })); // use body parser
app.set('view engine', 'ejs');

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
    constructor(code, name, pushTime, pushCount, phones, questions, qIndex, rIndex, isFinished) {
        this.code = code;
        this.name = name;
        this.pushTime = pushTime;
        this.pushCount = pushCount;
        this.phones = phones;
        this.questions = questions;
        this.qIndex = qIndex;
        this.rIndex = rIndex;
        this.isFinished = isFinished;
    }
    static createFrom(survey) {
        return new Survey(survey.code, survey.name, survey.pushTime, survey.pushCount, survey.phones, survey.questions, survey.qIndex, survey.rIndex, survey.isFinished);
    }
    subscribe(phone) {
        this.phones.push(phone);
    }
    unsubscribe(phone) {
        
    }
    getNextQuestion() {
        if(this.qIndex < this.questions.length) {
            return this.questions[this.qIndex++];
        }
        return null;
    }
    outOfQuestions() {
        return this.qIndex >= this.questions.length;
    }
    reset() {
        this.phones = [];
        this.qIndex = 0;
        this.rIndex = 0;
        this.isFinished = false;
    }
    getProgressPercent() {
        return (this.qIndex / this.questions.length) * 100;
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
    fillMissingResponses(phoneNumber, questionNumber) {
        // calculate how many questions missing
        const responseNumber = this.responseDictionary[phoneNumber].length;
        const missingQuestionsCount = questionNumber - responseNumber;

        for(let i=0; i<missingQuestionsCount; i++) {
            this.responseDictionary[phoneNumber].push(null);
        }
    }
}
class Profile {
    constructor(email, username, password) {
        this.email = email;
        this.username = username;
        this.password = password;
    }
}
class Message {
    constructor(title, text) {
        this.title = title;
        this.text = text;
    }
}

// ----- VARIABLES -----
let pushTimerDict = [];
let code2fa = null;
var today = new Date();

// ----- MESSAGES -----

var invalidCodeMessage = new Message('Invalid code', 'Please try again.');
var alreadyJoinedMessage = new Message('Join failed', 'Looks like you already joined. No need to join twice.');
var joinedSuccessfullyMessage = new Message('Joined survey successfully', 'Hang out until you get notified to take the survey.');
var pushSurveyCompleteMessage = new Message('Survey completed', 'No more questions to ask.');
var pushSuccessfulMessage = new Message('Push successful', 'Survey page updated... notifications sent... and now we wait.');
var responseSuccessfullMessage = new Message('Response recorded', 'Thank you for your response!');
var responseFailedMessage = new Message('Response failed', 'Please try again later.');
var surveyNotFoundMessage = new Message('Survey not found', 'Please try again later.');
var unsubscribedMessage = new Message('Unsubscribed', 'Sorry to see you go.');
var unsubscribeFailedMessage = new Message('Unable to unsubscribe', 'Phone number not found.');
var invalid2faCodeMessage = new Message('Invalid code', 'Please try again.');

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
    let profile = getProfile();
    let validUsername = profile.username == request.body.username;
    let validPassword = profile.password == request.body.password;

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
app.get('/profile', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    response.redirect('/profile2fa');
});
// TODO email 2fa code
app.get('/profile2fa', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }

    // generate code
    code2fa = generate2faCode();

    // send code
    console.log(code2fa);

    response.render('profile2fa');
});
app.post('/submitProfile2fa', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    
    code = null;

    // compare codes
    if(code2fa == request.body.code) {
        response.render('profile');
    }
    else {
        invalidCodeAttempt();
        displayMessagePage(response, invalid2faCodeMessage);
    }
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
    let pushTime = 3;
    let pushCount = 3;
    let questions = [];
    for(const id in body) {
        value = body[id];
        if(id == 'survey_name') {
            name = value;
        }
        else if(id == 'push_time_days') {
            pushTime = value;
        }
        else if(id == 'push_count') {
            pushCount = value;
        }
        else {
            // parse the key
            let keyParts = id.split('_');
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

    const code = generateUniqueSurveyCode();
    const survey = new Survey(code, name, pushTime, pushCount, [], questions, 0, 0, false);

    writeSurvey(survey, 'data/my_surveys/' + code + '.txt');
    response.redirect('dashboard');
});
// TODO edit survey system
app.get('/editSurvey/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    let survey = getSurvey('data/my_surveys/' + code + '.txt');
    //generateEditSurveyPage(survey);
    response.render('editSurvey');
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
app.get('/publishSurvey/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    let survey = getSurvey('data/my_surveys/' + code + '.txt');
    
    // move file
    const fromDir = 'data/my_surveys/' + survey.code + '.txt';
    const toDir = 'data/published_surveys/' + survey.code + '.txt';
    fs.renameSync(fromDir, toDir);

    // reset survey
    survey.reset();
    savePublishedSurvey(survey);

    // generate take survey page
    let pageCode = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <title>Survey App | Message</title>
            <meta charset="utf-8">
            <link rel="stylesheet" href="/css/styles.css" type="text/css">
        </head>
        <body>
            <h1>Hang Tight</h1>
            <h3>Survey starting soon!</h3>
        </body>
        <footer>
            <p class="attribution">Uicons by <a href="https://www.flaticon.com/uicons">Flaticon</a></p>
        </footer>
        </html>
    `;
    fs.writeFileSync('views/survey_views/' + survey.code + '.ejs', pageCode);

    // generate survey data file
    let questionTexts = [];
    survey.questions.forEach(question => {
        questionTexts.push(question.text);
    });
    const surveyData = new SurveyData(survey.code, questionTexts, {});
    const surveyDataString = JSON.stringify(surveyData);
    fs.writeFileSync('data/survey_data/' + survey.code + '.txt', surveyDataString); 

    response.redirect('/dashboard');
});
app.get('/unpublishSurvey/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    let survey = getSurvey('data/published_surveys/' + code + '.txt');

    // remove push timer
    removePushTimer(survey);

    // reset survey
    survey.reset();
    savePublishedSurvey(survey);

    // move file
    const fromDir = 'data/published_surveys/' + survey.code + '.txt';
    const toDir = 'data/my_surveys/' + survey.code + '.txt';
    fs.renameSync(fromDir, toDir);

    // delete take survey page
    fs.unlinkSync('views/survey_views/' + survey.code + '.ejs');

    // delete survey data file
    fs.unlinkSync('data/survey_data/' + survey.code + '.txt');

    response.redirect('/dashboard');
});
app.get('/downloadSurveyData/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    const surveyData = getSurveyData(code);
    let fileString = 'id';

    // write questions
    surveyData.questions.forEach(question => {
        fileString += ', ' + question;
    });
    fileString += '\n';

    // write responses
    if(surveyData.responseDictionary != null) {
        for(const [key, value] of Object.entries(surveyData.responseDictionary)) {
            fileString += key;
            value.forEach(response => {
                fileString += ', ' + response
            });
            fileString += '\n';
        }
    }

    // write csv file
    fs.writeFileSync(code + '.csv', fileString);

    // download csv file
    response.redirect('/download/' + code + '.csv');
});
app.get('/download/:file', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const file = request.params.file;
    response.download(file, () => {
        fs.unlinkSync(file); // remove temp file
    });
});
app.get('/startSurvey/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;

    // start push timer
    startSurvey(code);

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
app.get('/unsubscribe/:surveyCode/:phoneNumber', (request, response) => {
    const code = request.params.surveyCode;
    const phoneNumber = request.params.phoneNumber;

    // get survey 
    let survey = getPublishedSurvey(code);

    // remove phone
    let phoneRemoved = false;
    for(let i=0; i<survey.phones.length; i++) {
        if(survey.phones[i].number == phoneNumber) {
            survey.phones.splice(i, 1);
            phoneRemoved = true;
        }
    }

    // save survey
    savePublishedSurvey(survey);

    if(phoneRemoved) {
        displayMessagePage(response, unsubscribedMessage);
    }
    else {
        displayMessagePage(response, unsubscribeFailedMessage);
    }
});
app.get('/push/:surveyCode', (request, response) => {
    if(!authorized(request)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    let survey = getPublishedSurvey(code);

    for(let i=0; i<pushTimerDict.length; i++) {
        if(pushTimerDict[i].key == survey.code) {
            pushTimerDict[i].value.reset();
            push(survey.code);
            response.redirect('/');
            return;
        }
    }

    response.redirect('/');
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
    const code = request.params.surveyCode;
    const phoneNumber = request.params.phoneNumber;
    var data = request.body;
    const survey = getPublishedSurvey(code);
    let surveyData = getSurveyData(code);

    // get responses
    let newResponses = [];
    for(let i=1; i<=survey.pushCount; i++) {
        if(data[i] != undefined) {
            newResponses.push(data[i]);
        }
    }

    // add data
    for(let i=0; i<newResponses.length; i++) {
        let rAddIndex = survey.rIndex + i;      
        surveyData.add(phoneNumber, newResponses[i], rAddIndex);
    }

    // store survey data
    writeSurveyData(surveyData);

    displayMessagePage(response, responseSuccessfullMessage);
});
app.get('/settings/:settings', (request, response) => {

});
app.get('/message/:title/:message', (request, response) => {
    const title = request.params.title;
    const message = request.params.message;
    response.render('message', {data : {title, message}});
});

// ----- FUNCTIONS -----

// TODO read profile data
function getProfile() {
    // read file
    // decrypt
    // convert to object

    return new Profile('email@gmail.com', 'admin', 'password');
}
// TODO save new profile data
function updateProfile(email, username, password) {
    // convert to JSON string
    // encrypt
    // write to file
}
function authorized(request) {
    // read from login 
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
function generateUniqueSurveyCode() {
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
function generate2faCode() {
    let code = Math.floor(1000 + Math.random() * 9000);
    return code;
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
function updateTakeSurveyPage(survey) {
    // header
    let pageCode = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <title>Survey App | Take Survey</title>
        <meta charset="utf-8">
        <link rel="stylesheet" type="text/css" href="/css/styles.css">
    </head>`;

    // body
    if(survey.outOfQuestions()) {
        endSurvey(survey.code);
        pageCode += `
            </body>
                <h1>${survey.name}</h1>
                <h3>Sorry, this survey has concluded!</h3>
            </body>`;
    }
    else {
        pageCode += `
            <body>
                <h1>${survey.name}</h1>
                <form action='/submitResponse/${survey.code}/<%= phoneNumber %>' method="POST">
                <div class="question">`;

                // generate questions
                for(let i=1; i<=survey.pushCount; i++) {
                    let question = survey.getNextQuestion();
                    if(question != null) {
                        // TF question
                        if(question.type == 'tf') {
                            pageCode += `<!-- T/F -->
                                <div>
                                    <h3>${i}. ${question.text}</h3>
                                    <input type="radio" name="${i}" value="true" required>
                                    <label>True</label>
                                    <input type="radio" name="${i}" value="false" required>
                                    <label>False</label>
                                </div>`;
                        }
                        // FR question
                        else if(question.type == 'fr') {
                            pageCode += `<!-- FR -->
                                <div>
                                    <h3>${i}. ${question.text}</h3>
                                    <textarea rows="5" cols="60" name="${i}" placeholder="Enter text..." required></textarea>
                                </div>`;
                        }
                        // MC question
                        else if(question.type == 'mc') {
                            pageCode += `<!-- MC -->
                                <div>
                                    <h3>${i}. ${question.text}</h3>` 
                            question.responses.forEach(response => {
                                pageCode += `<input type="radio" name="${i}" value="${response}" required>
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
            </body>`;
    }

    // footer
    pageCode += `
        <footer>
            <p class="attribution">Uicons by <a href="https://www.flaticon.com/uicons">Flaticon</a></p>
        </footer>
        </html>`;

    savePublishedSurvey(survey);
    fs.writeFileSync('views/survey_views/' + survey.code + '.ejs', pageCode);
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

// TODO send notificaitons
function push(code) {
    if(isSurveyPublished(code)) {
        let survey = getPublishedSurvey(code);
        if(!survey.outOfQuestions()) {
            survey.rIndex += parseInt(survey.pushCount);
            savePublishedSurvey(survey);
            updateTakeSurveyPage(survey);
            sendSurveyNotification(survey);
        }
        else {
            survey.isFinished = true;
            updateTakeSurveyPage(survey);
            removePushTimer(survey);
        }
    }
}
function removePushTimer(survey) {
    for(let i=0; i<pushTimerDict.length; i++) {
        if(pushTimerDict[i].key == survey.code) {
            pushTimerDict[i].value.stop();
            pushTimerDict.splice(i, 1);
        }
    }
}
function Timer(fn, t) {
    var timerObj = setInterval(fn, t);
    this.stop = function() {
        if (timerObj) {
            clearInterval(timerObj);
            timerObj = null;
        }
        return this;
    }
    this.start = function() {
        if (!timerObj) {
            this.stop();
            timerObj = setInterval(fn, t);
        }
        return this;
    }
    this.reset = function() {
        return this.stop().start();
    }
}
function startSurvey(code) {
    let survey = getPublishedSurvey(code);
    updateTakeSurveyPage(survey);
    sendSurveyNotification(survey);
    var timer = new Timer(() => {
        push(code);
    }, survey.pushTime * 60 * 60 * 24 * 1000);
    pushTimerDict.push({key : survey.code, value : timer});
}
function restartSurvey(code) {
    let survey = getPublishedSurvey(code);

    var timer = new Timer(() => {
        push(code);
    }, survey.pushTime * 60 * 60 * 24 * 1000);
    pushTimerDict.push({key : survey.code, value : timer});
}
function continueActiveSurveys() {
    let publishedSurveys = getAllSurveysIn('data/published_surveys');
    publishedSurveys.forEach(survey => {
        if(survey.getProgressPercent() != 0) {
            restartSurvey(survey.code);
        }
    });
}

// TODO test full link
function generateUnsubscribeLink(code, phoneNumber) {
    return 'ec2-54-177-203-54.us-west-1.compute.amazonaws.com/unsubscribe/' + code + '/' + phoneNumber;
}
// TODO  test full link
function generateTakeSurveyLink(code, phoneNumber) {
    return 'ec2-54-177-203-54.us-west-1.compute.amazonaws.com/takeSurvey/' + code + '/' + phoneNumber;
}

// function generateEditSurveyPage(survey) {
//     let pageCode = '';

//     // generate html for each question
//     survey.questions.forEach(question => {
//         pageCode += 
//         ``;

//         if(question.type == 'mc') {
//             // generate html for each response
//             question.responses.forEach(response => {

//             });
//         }
//     });
//     fs.writeFileSync('views/editSurvey.ejs', pageCode);
// }

// TODO
function endSurvey(code) {
    // mark survey as complete

    // write unanswered questions as null

    // send notification to email that survey has finished

}
function sendSurveyNotification(survey) {

    survey.phones.forEach(phone => {
        let message = 'Time to take a survey! Follow this link: ';
        message += generateTakeSurveyLink(survey.code, phone.number);
        message += ' To unsubscribe follow this link: ';
        message += generateUnsubscribeLink(survey.code, phone.number);
        sendText(phone, message);
    });
}
//Notication System
function sendText(phone, message) {
     try {
        const time = new Date().toDateString();
        let info =  transporter.sendMail({
          from: SEND_MAIL_CONFIG.auth.user,
          to: phone.number+''+phone.provider,
          html: message,
        });
      } catch (error) {
        console.log(error);
        return false;
      }
}

//2FA authentication
function sendEmail(address, message) {

}

// TODO alert user via email
function invalidCodeAttempt() {

}

// run server
const server = http.createServer(app);
server.listen(3000);
console.log('running server');

// continue surveys
continueActiveSurveys();
