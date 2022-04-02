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
let username = 'admin';
let password = 'password';
// ---------

app.use(express.static(__dirname + '/public')); // make public directory accessible to client
app.use(bodyParser.urlencoded({ extended: true })); // use body parser
app.set('view engine', 'ejs');

// get site
app.get('/', (request, response) => {
    // check authentication
    if(authenticated(request, response)) {
        response.redirect('/dashboard');
        return;
    }

    response.redirect('/login');
    return;
});

// get login page
app.get('/login', (request, response) => {    
    response.sendFile(__dirname + '/views/login.html');
    return;
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

    response.redirect('/');
    return;
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
    return;
});

// load dashboard
app.get('/dashboard', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }

    const mySurveys = getAllSurveyData('data/my_surveys');
    const publishedSurveys = getAllSurveyData('data/published_surveys');

    response.render('dashboard', {data : {mySurveys, publishedSurveys}});
    response.end();
    return;
});

// publish survey
app.get('/publishSurvey/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }
    let code = request.params.surveyCode;

    // move file to published surveys directory
    fs.renameSync('data/my_surveys/' + code + '.txt', 'data/published_surveys/' + code + '.txt');
    response.redirect('/dashboard');

    response.end();
    return;
});

// unpublish survey
app.get('/unpublishSurvey/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }
    let code = request.params.surveyCode;

    // move file to my surveys directory
    fs.renameSync('data/published_surveys/' + code + '.txt', 'data/my_surveys/' + code + '.txt');
    response.redirect('/dashboard');

    response.end();
    return;
});

// create survey
app.get('/createSurvey', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }

    response.render('create');
    response.end();
    return;
});

// edit survey
app.get('/editSurvey/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }
    let code = request.params.surveyCode;

    console.log('edit ' + code);

    response.end();
    return;
});

// delete survey
app.get('/deleteSurvey/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }
    let code = request.params.surveyCode;

    fs.unlinkSync('data/my_surveys/' + code + '.txt');
    response.redirect('/dashboard');
    response.end();
    return;
});

// download survey data
app.get('/downloadSurveyData/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }
    let code = request.params.surveyCode;

    console.log('download ' + code);

    response.end();
    return;
});

app.get('/takeSurvey/:surveyCode', (request, response) => {
    let code = request.params.surveyCode;
    let survey = getSurveyData('data/published_surveys/' + code + '.txt')

    response.end();
    return;
});

function parseQuestion(questionLine) {
    let questionParts = questionLine.split(',');

    const type = questionParts[0].trim();
    const ques = questionParts[1].trim();

    let question = new Question(type, ques, null);
    if(type == 'MC') {
        let responses = [];
        if(questionParts.length > 2) {
            for(let i=2; i<questionParts.length; i++) {
                responses.push(questionParts[i].trim());
            }
        }
        question.responses = responses;
    }
    return question;
}

function parsePhoneNumbers(phoneNumbersLine) {
    const phoneNumbers = phoneNumbersLine.split(',');
    const trimmedPhoneNumbers = phoneNumbers.map(s => {
        return s.trim();
    });
    return trimmedPhoneNumbers;
}

function getSurveyData(filePath) {
    let file = fs.readFileSync(filePath, 'utf-8');
    file = file.trim();
    const content = file.split('\n');

    const code = path.parse(filePath).name;
    const name = content[0];
    const phoneNumbers = parsePhoneNumbers(content[1]);
    let questions = [];

    for(let i=2; i<content.length; i++) {
        let question = parseQuestion(content[i]);
        questions.push(question);
    }

    let survey = new Survey(code, name, phoneNumbers, questions);
    return survey;
}

function getAllSurveyData(directory) {
    let fileArray = [];
    const files = fs.readdirSync(directory);
    files.forEach(file => {
        let surveyCode = path.parse(file).name;
        let content = fs.readFileSync(directory + '/' + file, 'utf-8');
        let lineEnd = content.indexOf('\n');
        let surveyName = content.substring(0, lineEnd);

        let fileData = new FileData(surveyCode, surveyName);
        fileArray.push(fileData);
    });
    return fileArray;
}

function authenticated(request, response) {
    let loggedIn = activeUser != null;
    let currentUser = JSON.stringify(activeUser) === JSON.stringify(request.socket.remoteAddress);
    if(!loggedIn || !currentUser) {
        return false;
    }
    return true;
}

class Question {
    constructor(type, question, responses) {
        this.type = type;
        this.question = question;
        this.responses = responses;
    }
}

class Survey {
    constructor(code, name, phoneNumbers, questions) {
        this.code = code;
        this.name = name;
        this.phoneNumbers = phoneNumbers;
        this.questions = questions;
    }
}

class FileData {
    constructor(code, name) {
        this.code = code;
        this.name = name;
    }
}

const server = http.createServer(app);
server.listen(3000);
console.log('running server');
