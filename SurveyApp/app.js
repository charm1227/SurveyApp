// init
const express = require('express');
const app = express(); 
const bodyParser = require('body-parser'); // allows us to access data from forms
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { debug } = require('console');

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

    const mySurveys = GetSurveyTitles('data/my_surveys');
    const activeSurveys = GetSurveyTitles('data/active_surveys');

    response.render('dashboard', {data : {mySurveys, activeSurveys}});
    response.end();
    return;
});

function GetSurveyTitles(directory) {
    const files = fs.readdirSync(directory);
    let fileArray = [];
    files.forEach(file => {
        let s = '';
        s += path.parse(file).name + ' - ';
        const content = fs.readFileSync(directory + '/' + file, 'utf-8');
        const lineEnd = content.indexOf('\n');
        const title = content.substring(0, lineEnd);
        s += title;
        fileArray.push(s);
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

const server = http.createServer(app);
server.listen(3000);
console.log('running server');
