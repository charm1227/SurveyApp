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

let activeUser = null;

// TEMPORARY
// ---------
let username = 'admin';
let password = 'password';

const burstQuestionCount = 3;
// ---------

app.use(express.static(__dirname + '/public')); // make public directory accessible to client
app.use(bodyParser.urlencoded({ extended: true })); // use body parser
app.set('view engine', 'ejs');

// ROUTES

// home
app.get('/', (request, response) => {
    if(authenticated(request, response)) {
        response.redirect('/dashboard');
        return;
    }
    response.redirect('/login');
});

// display login page
app.get('/login', (request, response) => {    
    response.sendFile(__dirname + '/views/login.html');
}); 

// submit login
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

// logout
app.get('/logout', (request, response) => {
    if(authenticated(request, response)) {
        activeUser = null;
        response.redirect('/login');
        return;
    }
    response.redirect('/');
});

// display dashboard page
app.get('/dashboard', (request, response) => {
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const mySurveys = getAllSurveysIn('data/my_surveys');
    const publishedSurveys = getAllSurveysIn('data/published_surveys');
    response.render('dashboard', {data : {mySurveys, publishedSurveys}});
});

// publish survey
app.get('/publishSurvey/:surveyCode', (request, response) => {
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    route_publishSurvey(code);    
    response.redirect('/dashboard');
});

// unpublish survey
app.get('/unpublishSurvey/:surveyCode', (request, response) => {
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    route_unpublishSurvey(code);
    response.redirect('/dashboard');
});

// display create survey page
app.get('/createSurvey', (request, response) => {
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    response.render('create');
});

// create survey
app.post('/createSurvey', (request, response) => {
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const body = request.body;
    route_createSurveyFromForm(body);
    response.redirect('dashboard');
});

// edit survey
app.get('/editSurvey/:surveyCode', (request, response) => {
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
});

// delete survey
app.get('/deleteSurvey/:surveyCode', (request, response) => {
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    fs.unlinkSync('data/my_surveys/' + code + '.txt');
    response.redirect('/dashboard');
});

// download survey data
app.get('/downloadSurveyData/:surveyCode', (request, response) => {
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
    route_downloadSurveyData(code);
    response.redirect('/dashboard');
});

// display join page
app.get('/join', (request, response) => {
    response.sendFile(__dirname + '/views/join.html');
});

// submit join
app.post('/joinSurvey', (request, response) => {
    const code = request.body.code;
    const phoneNumber = request.body.phone;
    const provider = request.body.service_provider;
    let survey = getPublishedSurvey(code);

    // authenticate the code
    let validCode = isValidPublishedSurveyCode(code);
    if(!validCode) {
        response.redirect('/message/Unable to join survey/Survey code does not exist')
        return;
    }

    // authenticate phone number
    let validPhone = true;
    survey.phones.forEach(p => {
        if(phoneNumber == p.number) {
            validPhone = false;
        }
    });
    if(!validPhone) {
        response.redirect('/message/Survey already joined/No need to join twice.')
        return;
    }

    // add the phone to the survey
    const phone = new Phone(phoneNumber, provider);

    console.log('-------------------');
    console.log('before');
    console.log(survey);

    survey.addPhone(phone);
    writeSurvey(survey, 'data/published_surveys/' + code + '.txt');

    console.log('---------');
    console.log('after');
    console.log(survey);

    response.redirect('/message/Survey Joined/Successfully Joined Survey, Wait for a Text and You can Take a Survey!')
});

// push survey burst
app.get('/push/:surveyCode', (request, response) => {
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;

    // validate code - needs to published survey
    let validCode = isValidPublishedSurveyCode(code);
    if(!validCode) {
        response.redirect('/message/Unable to push survey/Survey code was not valid')
        return;
    }

    route_pushSurveyBurst(code);
    response.redirect('/message/Successful survey burst push/The next set of questions have been pushed successfully.')
});

// load take survey page
app.get('/takeSurvey/:surveyCode/:phoneNumber', (request, response) => {
    const code = request.params.surveyCode;
    const phoneNumber = request.params.phoneNumber;

    const validSurvey = isSurveyPublished(code);
    if(validSurvey) {
        response.render('survey_views/' + code, {phoneNumber : phoneNumber});
        return;
    }
    response.redirect('/message/Survey not found/The survey requested seems to be... well... not here.');
});

// submit survey results
app.post('/submitResponse/:surveyCode/:phoneNumber/', (request, response) => {
    const code = request.params.surveyCode;
    const phoneNumber = request.params.phoneNumber;
    var data = request.body;
    route_submitSurveyResponse(code, phoneNumber, data);
    response.redirect('/message/Survey submitted/Thanks for participating!');
});

// message page
app.get('/message/:messageHeader/:message', (request, response) => {
    const messageHeader = request.params.messageHeader;
    const message = request.params.message;
    response.render('message', {data : {messageHeader, message}});
});


// FUNCTIONS

// utilities
function moveFile(name, from, to) {
    fs.renameSync(from + '/' + name, to + '/' + name);
}

// authentication
function authenticated(request, response) {
    let loggedIn = activeUser != null;
    let currentUser = JSON.stringify(activeUser) === JSON.stringify(request.socket.remoteAddress);
    if(!loggedIn || !currentUser) {
        return false;
    }
    return true;
}
function isValidPublishedSurveyCode(code) {
    let codes = getAllPublishedSurveyCodes();
    let validCode = false;
    codes.forEach(c => {
        if(code == c) {
            validCode = true;
        }
    });
    return validCode;
}

// survey management
function route_createSurveyFromForm(body) {
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

            // if no question, create question
            if(qIndex >= questions.length) {
                let newQuestion = new Question(null, null, null);
                questions.push(newQuestion);
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

    const code = generateUniqueCode();
    const survey = new Survey(code, name, [], questions, []);
    writeSurvey(survey, 'data/my_surveys/' + survey.code + '.txt');
}
function route_publishSurvey(code) {
    // move survey
    const fileName = code + '.txt';
    const fromDir = 'data/my_surveys';
    const toDir = 'data/published_surveys';
    moveFile(fileName, fromDir, toDir);

    // generate take survey page
    fs.writeFileSync('views/survey_views/' + code + '.ejs', ''); 
    updateTakeSurveyPage(code);

    // generate survey data file from survey
    const survey = getPublishedSurvey(code);
    const surveyData = new SurveyData(survey.code, survey.questions, []);
    const surveyDataString = JSON.stringify(surveyData);
    fs.writeFileSync('data/survey_data/' + code + '.txt', surveyDataString);
}
function route_unpublishSurvey(code) {
    // move file to my surveys directory
    const fileName = code + '.txt';
    const fromDir = 'data/published_surveys';
    const toDir = 'data/my_surveys';
    moveFile(fileName, fromDir, toDir);

    // delete take survey page
    fs.unlinkSync('views/survey_views/' + code + '.ejs');

    // delete survey data file
    fs.unlinkSync('data/survey_data/' + code + '.txt');
}
function route_downloadSurveyData(code) {
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
function route_submitSurveyResponse(code, phoneNumber, data) {
    // read the survey object
    const survey = getPublishedSurvey(code);
    let surveyData = getSurveyData(code);

    // add data to survey data
    let responses = [];
    for(let i=1; i<=burstQuestionCount; i++) {
        responses.push(data[i]);
    }
    surveyData.addData(survey.getAskedQuestionsCount(), phoneNumber, responses);

    // store survey data
    writeSurveyData(surveyData);
}
function route_pushSurveyBurst(code) {
    updateTakeSurveyPage(code);
    sendNotification();
}

function writeSurvey(survey, file) {
    try {
        const surveyString = JSON.stringify(survey);
        fs.writeFileSync(file, surveyString);
    }
    catch(exception) {
        console.log(exception);
    }
}
function getSurveyData(code) {
    try {
        const surveyDataString = fs.readFileSync('data/survey_data/' + code + '.txt');
        const surveyDataObject = JSON.parse(surveyDataString);
        const surveyData = SurveyData.createFrom(surveyDataObject);
        return surveyData;
    }
    catch(exception) {
        console.log(exception);
    }
}
function writeSurveyData(surveyData) {
    try {
        const surveyDataString = JSON.stringify(surveyData);
        fs.writeFileSync('data/survey_data/' + surveyData.code + '.txt', surveyDataString);
    }
    catch(exception) {
        console.log(exception);
    }
}
function getSurvey(filePath) {
    try {
        const surveyString = fs.readFileSync(filePath);
        const surveyObject = JSON.parse(surveyString);
        const survey = Survey.createFrom(surveyObject);
        return survey;
    }
    catch(exception) {
        console.log(exception);
    }
}
function getAllSurveysIn(directory) {
    let surveys = [];
    try {
        const files = fs.readdirSync(directory);
        files.forEach(file => {
            const survey = getSurvey(directory + '/' + file);
            surveys.push(survey);
        });
    }
    catch(exception) {
        console.log(exception);
    }
    return surveys;
}
function isSurveyPublished(surveyCode) {
    let foundSurvey = false;
    const publishedSurveys = getAllSurveysIn('data/published_surveys');
    publishedSurveys.forEach(survey => {
        if(surveyCode == survey.code) {
            foundSurvey = true;
        }
    });

    if(foundSurvey) {
        return true;
    }
    return false;
}
function getPublishedSurvey(surveyCode) {
    const survey = getSurvey('data/published_surveys/' + surveyCode + '.txt');
    return survey;
}
function updateTakeSurveyPage(surveyCode) {
    // get survey object
    let survey = getPublishedSurvey(surveyCode);

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
            for(let i=1; i<=burstQuestionCount; i++) {
                let question = survey.nextQuestion();
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
    
    // write to survey page
    fs.writeFileSync('views/survey_views/' + surveyCode + '.ejs', pageCode);
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

// email
function sendNotification() {

}
function unsubscribe() {

}

// MODELS
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
    constructor(code, name, phones, questions, askedQuestions) {
        this.code = code;
        this.name = name;
        this.phones = phones;
        this.questions = questions;
        this.askedQuestions = askedQuestions;
    }
    static createFrom(survey) {
        return new Survey(survey.code, survey.name, survey.phones, survey.questions, survey.askedQuestions);
    }
    addPhone(phone) {
        this.phones.push(phone);
    }
    nextQuestion() {
        const hasNextQuestion = this.questions.length > 0;
        if(hasNextQuestion) {
            let nextQuestion = this.questions[0];
            this.questions.shift();
            this.askedQuestions.push(nextQuestion);
            return nextQuestion;
        }
        return null;
    }
    getAskedQuestionsCount() {
        return this.askedQuestions.length;
    }
}
class SurveyData {
    constructor(code, questions, data) {
        this.code = code;
        this.questions = questions;
        this.data = data;
    }
    static createFrom(surveyData) {
        return new SurveyData(surveyData.code, surveyData.questions, surveyData.data);
    }
    addData(askedQuestionsCount, phoneNumber, responses) {
        // add new entry
        if(!this.hasPhoneNumber(phoneNumber)) {
            this.data.push([phoneNumber, []]);
        }

        // if missing entries add them
        this.fillMissingEntries(phoneNumber, askedQuestionsCount);

        // add new data
        this.addNewData(phoneNumber, responses, askedQuestionsCount);
    }
    hasPhoneNumber(phoneNumber) {
        let hasPhoneNumber = false;
        this.data.forEach(entry => {
            if(phoneNumber == entry[0]) {
                hasPhoneNumber = true;
            }
        });
        return hasPhoneNumber;
    }
    fillMissingEntries(phoneNumber, askedQuestionsCount) {
        this.data.forEach(entry => {
            if(phoneNumber == entry[0]) {
                if(entry[1].length <= askedQuestionsCount) {
                    for(let i=0; i<askedQuestionsCount-entry[1].length; i++) {
                        entry[1].push(null);
                    }
                }
            }
        });
    }
    addNewData(phoneNumber, responses, askedQuestionsCount) {
        this.data.forEach(entry => {
            const onSameQuestion = entry[1].length + responses.length == askedQuestionsCount;

            console.log(entry[1].length);
            console.log(responses.length);
            console.log(askedQuestionsCount);

            if(phoneNumber == entry[0] && onSameQuestion) {
                entry[1].push(responses);
            }
        });
    }
}

const server = http.createServer(app);
server.listen(3000);
console.log('running server');
