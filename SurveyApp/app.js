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

    const mySurveys = GetSurveyData('data/my_surveys');
    const publishedSurveys = GetSurveyData('data/published_surveys');

    response.render('dashboard', {data : {mySurveys, publishedSurveys: publishedSurveys}});
    response.end();
    return;
});

app.get('/publishSurvey/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }
    let code = request.params.surveyCode;

    console.log('publish ' + code);
});

app.get('/unpublishSurvey/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }
    let code = request.params.surveyCode;

    console.log('unpublish ' + code);
});

app.get('/createSurvey', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }

    console.log('create survey');
});

app.get('/editSurvey/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }
    let code = request.params.surveyCode;

    console.log('edit ' + code);
});

app.get('/deleteSurvey/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }
    let code = request.params.surveyCode;

    console.log('delete ' + code);
});

app.get('/downloadSurveyData/:surveyCode', (request, response) => {
    // check authentication
    if(!authenticated(request, response)) {
        response.redirect('/');
        response.end();
        return;
    }
    let code = request.params.surveyCode;

    console.log('download ' + code);
})

function GetSurveyData(directory) {
    const files = fs.readdirSync(directory);
    let fileArray = [];
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

class FileData {
    constructor(code, name) {
        this.code = code;
        this.name = name;
    }
}

function authenticated(request, response) {
    let loggedIn = activeUser != null;
    let currentUser = JSON.stringify(activeUser) === JSON.stringify(request.socket.remoteAddress);
    if(!loggedIn || !currentUser) {
        return false;
    }
    return true;
}

const server = http.createServer(app);
server.listen(3000);
console.log('running server');
