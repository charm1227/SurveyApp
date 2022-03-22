// init
const express = require('express');
const res = require('express/lib/response');
const app = express(); 

const http = require('http');
const path = require('path');

const bcrypt = require('bcrypt');
const { runInNewContext } = require('vm');

// routes

/*
    USE = all
    POST = create new record
    GET = read record
    PUT = if record exists then update; otherwise create new record
    PATCH = update/modify record
    DELETE = delete record

    req = request
    res = response
*/

let ipAddress = null;

app.use(express.static(__dirname + '/public')); // make styles public

// load login
app.get('/', function(req, res) {
    
    console.log('Logged in: ' + ipAddress + ' | Request: / by ' + req.socket.remoteAddress);
    
    res.sendFile(__dirname + '/views/login.html');
}); 

// submit login
app.post('/login', function(req, res) {
    
    // validate
    if(true) {
        ipAddress = req.socket.remoteAddress;
        res.redirect('/dashboard');
    }

}); 

// load dashboard
app.get('/dashboard', function(req, res) {

    console.log('Logged in: ' + ipAddress + ' | Request: /dashboard by ' + req.socket.remoteAddress);

    if(!validUser(req, res)) {
        res.redirect('/');
        return;
    }

    res.sendFile(path.join(__dirname + '/views/dashboard.html'));
});

function validUser(req, res) {
    let loggedIn = ipAddress != null;
    let currentUser = JSON.stringify(ipAddress) === JSON.stringify(req.socket.remoteAddress);
    if(!loggedIn || !currentUser) {
        console.log('user ' + req.socket.remoteAddress + ' denied access');
        return false;
    }
    return true;
}

// start server
const server = http.createServer(app);
server.listen(3000); // port 3000
console.log('running server');
