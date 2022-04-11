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
// ---------

app.use(express.static(__dirname + '/public')); // make public directory accessible to client
app.use(bodyParser.urlencoded({ extended: true })); // use body parser
app.set('view engine', 'ejs');

// ROUTES

// home
app.get('/', (request, response) => {
    // check authentication
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
    // validate login
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
    // check authentication
    if(authenticated(request, response)) {
        activeUser = null;
        response.redirect('/login');
        return;
    }

    response.redirect('/');
});

// display dashboard page
app.get('/dashboard', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }

    const mySurveys = readAllSurveys('data/my_surveys');
    const publishedSurveys = readAllSurveys('data/published_surveys');

    response.render('dashboard', {data : {mySurveys, publishedSurveys}});
});

// publish survey
app.get('/publishSurvey/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;

    // move file
    fs.renameSync('data/my_surveys/' + code + '.txt', 'data/published_surveys/' + code + '.txt');

    // generate take survey page
    fs.writeFileSync('views/survey_views/' + code + '.ejs', ''); 
    updateTakeSurveyPage(code);

    // generate survey data file
    let survey = getPublishedSurvey(code);
    let dataString = 'id';
    survey.questions.forEach(question => {
        dataString += ', ' + question.text;
    });
    fs.writeFileSync('data/survey_data/' + code + '.txt', dataString);

    response.redirect('/dashboard');
});

// unpublish survey
app.get('/unpublishSurvey/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;

    // move file to my surveys directory
    fs.renameSync('data/published_surveys/' + code + '.txt', 'data/my_surveys/' + code + '.txt');

    // delete take survey page
    fs.unlinkSync('views/survey_views/' + code + '.ejs');

    // delete survey data file
    fs.unlinkSync('data/survey_data/' + code + '.txt');
    
    response.redirect('/dashboard');
});

// display create survey page
app.get('/createSurvey', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }

    response.render('create');
});

// create survey
app.post('/createSurvey', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const data = request.body;

    let name = '';
    let questions = [];
    for(const key in data) {
        value = data[key];

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
    const newSurvey = new Survey(code, name, null, questions);
    createSurvey(newSurvey);

    response.redirect('dashboard');
});

// edit survey
app.get('/editSurvey/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
});

// delete survey
app.get('/deleteSurvey/:surveyCode', (request, response) => {
    // check authentication
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
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        return;
    }
    const code = request.params.surveyCode;
});

// display join page
app.get('/join', (request, response) => {
    response.sendFile(__dirname + '/views/join.html');
});

// submit join
app.get('/joinSurvey/:surveyCode/:phoneNumber', (request, response) => {

});

// load take survey page
app.get('/takeSurvey/:surveyCode/:phoneNumber', (request, response) => {
    const code = request.params.surveyCode;
    const phoneNumber = request.params.phoneNumber;

    // if valid code, display take survey page
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

    const data = request.body;
    console.log(data);
    
    // write data to data file
    // be conscious of simultaneous write sessions

    response.redirect('/message/Survey submitted/Thanks for participating!');
});

// message page
app.get('/message/:messageHeader/:message', (request, response) => {
    const messageHeader = request.params.messageHeader;
    const message = request.params.message;
    response.render('message', {data : {messageHeader, message}});
});


// FUNCTIONS

function authenticated(request, response) {
    let loggedIn = activeUser != null;
    let currentUser = JSON.stringify(activeUser) === JSON.stringify(request.socket.remoteAddress);
    if(!loggedIn || !currentUser) {
        return false;
    }
    return true;
}

function createSurvey(survey) {
    try {
        const surveyString = JSON.stringify(survey);
        fs.writeFileSync('data/my_surveys/' + survey.code + '.txt', surveyString);
    }
    catch(exception) {
        console.log(exception);
    }
}

function readSurvey(filePath) {
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

function readAllSurveys(directory) {
    let surveys = [];
    try {
        const files = fs.readdirSync(directory);
        files.forEach(file => {
            const survey = readSurvey(directory + '/' + file);
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
    const publishedSurveys = readAllSurveys('data/published_surveys');
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
    const survey = readSurvey('data/published_surveys/' + surveyCode + '.txt');
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
            const questionCount = 3;
            for(let i=1; i<=questionCount; i++) {
                let question = survey.nextQuestion();

                console.log(question);

                if(question != null) {

                    console.log('writing question');

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
    // get all codes
    let codes = [];
    const mySurveys = readAllSurveys('data/my_surveys');
    mySurveys.forEach(survey => {
        codes.push(survey.code);
    });
    const publishedSurveys = readAllSurveys('data/published_surveys');
    publishedSurveys.forEach(survey => {
        codes.push(survey.code);
    });

    // generate unique 4 digit code
    let newCode = 0;
    while(true) {
        newCode = Math.floor(1000 + Math.random() * 9000);        
        if(!codes.includes(newCode)) {
            break;
        }
    }
    return newCode;
}

// MODELS

class Question {
    constructor(type, text, responses) {
        this.type = type;
        this.text = text;
        this.responses = responses;
    }
}

class Survey {
    constructor(code, name, phoneNumbers, questions) {
        this.code = code;
        this.name = name;
        this.phoneNumbers = phoneNumbers;
        this.questions = questions;
        this.askedQuestions = [];
    }

    static createFrom(survey) {
        return new Survey(survey.code, survey.name, survey.phoneNumbers, survey.questions, survey.askedQuestions);
    }

    nextQuestion() {
        if(this.questions.length > 0) {
            let nextQuestion = this.questions[0];
            this.questions.shift();
            this.askedQuestions.push(nextQuestion);
            return nextQuestion;
        }
        return null;
    }
}

const server = http.createServer(app);
server.listen(3000);
console.log('running server');
