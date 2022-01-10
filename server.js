import express from 'express'
import http from 'http'
import socketio from 'socket.io'
import stockfish from 'stockfish'
import path from 'path'

import { moveString, moveNumber } from './public/modules/constants.js'

import randStr, { randInt } from './modules/randomString.js'

import Timer, { msToSec } from './public/modules/timer.js'

import { randomPuzzle } from './modules/puzzle.js'

import { mysqlQuery, insertInto } from './modules/mysql.js'

import { encrypt } from './modules/encript.js'

import { sendEmail } from './modules/email.js'

const __dirname = path.resolve()

const app = express()
const server = http.createServer(app)
const sockets = socketio(server)

app.use(express.static('public'))
app.use(express.json())
// app.use((req, res) => {
//     res.sendFile('public/404.html', { root: __dirname })
// })

let serverDelay = 2
let oldServerDelay = 2
setInterval(() => {
    if (serverDelay === oldServerDelay) return
    sockets.sockets.emit('server-delay', serverDelay ?? 2)
    oldServerDelay = serverDelay
}, 5000)

async function getEloFromToken(token) {
    if (!token) {
        return {
            elo: null,
            username: null,
        }
    }
    const user = await mysqlQuery(`select * from users where token = '${token}'`)
    if (user.length === 0) {
        return {
            elo: null,
            username: null,
        }
    }
    return {
        elo: user[0].elo,
        username: user[0].username,
    }
}

async function login(username, password) {
    return new Promise(async (resolve, reject) => {
        try {
            const encryptedPassword = encrypt(password)
            const user = await mysqlQuery(
                `select * from users where (username = '${username}' or email = '${username}') and password = '${encryptedPassword}'`
            )
            if (user.length === 0) {
                reject(new Error('Invalid username or password'))
                return
            }
            if (!user[0].verified) {
                reject(new Error('Invalid username or password'))
                return
            }
            const curToken = user[0].token
            if (curToken) {
                resolve(user[0])
                return
            }
            let newToken = randStr(40)
            const token = await mysqlQuery(`select token from users where token = '${newToken}'`)
            if (token.length > 0) {
                while (newToken === token[0].token) {
                    newToken = randStr(10)
                }
            }
            await mysqlQuery(
                `update users set token = '${newToken}' where (username = '${username}' or email = '${username}') and password = '${encryptedPassword}'`
            )
            resolve((await mysqlQuery(`select * from users where token = '${newToken}'`))[0])
        } catch (error) {
            reject(error)
        }
    })
}

async function insertToUsers(values) {
    return new Promise(async (resolve, reject) => {
        try {
            await insertInto('users', values)
            resolve()
        } catch (e) {
            if (e.message.includes('Duplicate entry')) {
                if (e.message.includes('username')) reject(new Error('Username already registered'))
                else if (e.message.includes('email')) reject(new Error('Email already registered'))
            } else {
                reject(e)
            }
        }
    })
}

app.get('/ping', (req, res) => {
    res.send('pong')
})

app.post('/account/login', (req, res) => {
    let { username, password } = req.body

    username = username.trim()
    password = password.trim()

    if (username.length === 0) {
        res.json({
            success: false,
            error: 'Username cannot be empty',
        })
        return
    }
    if (password.length === 0) {
        res.json({
            success: false,
            error: 'Password cannot be empty',
        })
        return
    }

    login(username, password)
        .then((user) => {
            if (user.token) {
                res.json({
                    success: true,
                    token: user.token,
                    username: user.username,
                })
            } else {
                res.json({
                    success: false,
                })
            }
        })
        .catch((e) => {
            res.json({
                success: false,
                error: e.message,
            })
        })
})

function validadeUsername(username) {
    const reg = /[a-zA-Z0-9]+/
    return reg.test(username) && username.length >= 4 && username.length <= 20
}

function validadePassword(password) {
    return password.length >= 6 && password.length <= 30
}

function validadeEmail(email) {
    const reg = /\S+@\S+\.\S+/
    return reg.test(email)
}

function error(message) {
    return {
        success: false,
        error: message,
    }
}

const verifications = {}

const verificationCodeLength = 4

app.post('/account/verify', async (req, res) => {
    let { email, code } = req.body
    email = email.trim()
    code = code.trim()
    if (code.length !== verificationCodeLength) {
        res.send({
            success: false,
        })
        return
    }
    if (verifications[email] === code) {
        try {
            await mysqlQuery(`update users set verified = true where email = '${email}'`)
            delete verifications[email]
            res.json({
                success: true,
            })
        } catch (e) {
            res.json({
                success: false,
            })
        }
    } else {
        res.json({
            success: false,
        })
    }
})
app.post('/account/verify/resend', (req, res) => {
    let { email } = req.body
    email = email.trim()
    if (verifications[email]) {
        verifications[email] = '' + randInt(verificationCodeLength)
        sendEmail(email, 'Chess verification', 'Your verification code is ' + verifications[email])
    }
    res.send('sent!')
})

app.post('/account/register', (req, res) => {
    let { username, password, confirmPassword, email } = req.body

    username = username.trim()
    password = password.trim()
    confirmPassword = confirmPassword.trim()
    email = email.trim()

    //empty
    if (username.length === 0) {
        res.json(error('Username cannot be empty'))
        return
    }
    if (password.length === 0) {
        res.json(error('Password cannot be empty'))
        return
    }
    if (email.length === 0) {
        res.json(error('Email cannot be empty'))
        return
    }

    //validation
    if (!validadeUsername(username)) {
        res.json(
            error('Username must have only letter and numbers and be between 4 and 20 characters')
        )
        return
    }
    if (!validadePassword(password)) {
        res.json(error('Password must be between 6 and 30 characters'))
        return
    }
    if (!validadeEmail(email)) {
        res.json(error('Email is not valid'))
        return
    }

    //password match
    if (password !== confirmPassword) {
        res.json(error("Passwords don't match"))
        return
    }

    password = encrypt(password)

    insertToUsers({
        username,
        password,
        email,
    })
        .then(() => {
            verifications[email] = '' + randInt(verificationCodeLength)
            sendEmail(
                email,
                'Chess verification',
                'Your verification code is ' + verifications[email]
            )
            res.json({
                success: true,
            })
        })
        .catch((e) => {
            res.json({
                success: false,
                error: e.message,
            })
        })
})

app.get('/puzzle/random', async (req, res) => {
    res.json(await randomPuzzle(req.query.minRating, req.query.maxRating, req.query.themes))
})

const games = {}

function oppositeColor(color) {
    return color === 'white' ? 'black' : 'white'
}

const queue = {}

function tryToFindOpponent(socketId) {
    const queueKeys = Object.keys(queue)
    if (queueKeys.length <= 1) return
    const opponentSocketId = queueKeys[0]
    const opponentSocket = queue[opponentSocketId]
    delete queue[opponentSocketId]
    delete queue[socketId]
    let newId = randStr(10)
    while (games[newId]) newId = randStr(10)
    const roomId = newId
    games[roomId] = Game(roomId, 600, true, false)
    console.log(`> Room ${roomId}: created`)
    if (Math.random() < 0.5) {
        setTimeout(() => {
            opponentSocket.emit('match-found', roomId)
        }, 100)
        sockets.to(socketId).emit('match-found', roomId)
    } else {
        setTimeout(() => {
            sockets.to(socketId).emit('match-found', roomId)
        }, 100)
        opponentSocket.emit('match-found', roomId)
    }
}

sockets.on('connection', (socket) => {
    socket.emit('server-delay', serverDelay ?? 2)

    socket.on('join-room', ({ roomId, token, color }) => {
        if (games[roomId]) {
            socket.emit('join-room', 'success')
            games[roomId].join(socket, token, color)

            socket.on('disconnect', () => {
                if (games[roomId]) games[roomId].leave(socket)
            })
        } else {
            socket.emit('not-found')
        }
    })

    socket.on('get-rooms', () => {
        const rooms = []
        for (const roomId in games) {
            if (!games[roomId].isPublic) continue
            rooms.push({
                roomId,
                player: games[roomId].getOwnerInfo(),
                time: games[roomId].getTime(),
            })
        }
        socket.emit('get-rooms', rooms)
    })

    socket.on('find-room', () => {
        queue[socket.id] = socket
        tryToFindOpponent(socket.id)
    })
    socket.on('find-room-cancel', () => {
        if (queue[socket.id]) delete queue[socket.id]
    })
    socket.on('disconnect', () => {
        if (queue[socket.id]) delete queue[socket.id]
    })

    socket.on('create-room', ({ time, rated, isPublic }) => {
        if (isNaN(time)) {
            socket.emit('create-room', 'error:Time must be a number')
            return
        }
        time = +time
        if (time < 10) {
            socket.emit('create-room', 'error:Time must be greater than 10 seconds')
            return
        }
        if (time > 10800) {
            socket.emit('create-room', 'error:Time limit is 180 minutes')
            return
        }

        let newId = randStr(10)
        while (games[newId]) {
            newId = randStr(10)
        }
        const roomId = newId
        games[roomId] = Game(roomId, +time, !!rated, !!isPublic)
        console.log(`> Room created ${roomId}`)
        socket.emit('create-room', roomId)
    })
})

class Move {
    from = {
        x: null,
        y: null,
    }
    to = {
        x: null,
        y: null,
    }
    promotion
    constructor(fromX, fromY, toX, toY, promotion = null) {
        this.from.x = fromX
        this.from.y = fromY
        this.to.x = toX
        this.to.y = toY
        this.promotion = promotion
    }
}

function secToMs(sec) {
    return sec * 1000
}

function Game(id, time, rated = false, isPublic = false) {
    let serverDelayStart = 0

    let state = 0

    const roomOwner = {
        username: null,
        elo: null,
    }

    function getOwnerInfo() {
        return roomOwner
    }

    const gameTime = time

    function getTime() {
        return gameTime
    }

    let fen = `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`

    const players = {
        white: {
            socket: null,
            timer: new Timer(secToMs(gameTime)),
            token: null,
            info: null,
        },
        black: {
            socket: null,
            timer: new Timer(secToMs(gameTime)),
            token: null,
            info: null,
        },
    }

    setInterval(() => {
        if (msToSec(players.white.timer.getTime()) <= 0) {
            win('black')
            sockets.to(id).emit('time-out', 'white')
        } else if (msToSec(players.black.timer.getTime()) <= 0) {
            win('white')
            sockets.to(id).emit('time-out', 'black')
        }
    }, 100)

    let turn = 'w'
    const moves = []

    const engine = stockfish()

    engine.onmessage = (data) => {
        data = data + ''
        if (data.startsWith('Fen:')) {
            fen = data.split(':')[1].trim()
            const curTurn = data.split(' ')[2]
            if (curTurn === turn) {
                validMove()
            } else {
                invalidMove()
            }
        }
        if (data == 'info depth 0 score mate 0') {
            win(turn === 'b' ? 'white' : 'black')
        }
    }

    engine.postMessage('ucinewgame')
    engine.postMessage('position startpos')

    function win(color) {
        console.log(`> Room ${id}: ${color} is victorious`)
        state = 2
        if (players[color].token && rated) {
            mysqlQuery(`update users set elo = elo + 10 where token = '${players[color].token}'`)
            if (players[color].socket) players[color].socket?.emit('update-elo', 10)
        }
        if (players[oppositeColor(color)].token && rated) {
            mysqlQuery(
                `update users set elo = elo - 10 where token = '${
                    players[oppositeColor(color)].token
                }'`
            )
            if (players[oppositeColor(color)].socket)
                players[oppositeColor(color)].socket?.emit('update-elo', -10)
        }
    }

    function notYourTurn(color) {
        if (players[color].socket) players[color].socket?.emit('not-your-turn')
    }

    function invalidMove() {
        players[turn === 'w' ? 'black' : 'white'].socket?.emit('invalid-move')
        turn = turn === 'w' ? 'b' : 'w'
        moves.splice(moves.length - 1, 1)
    }

    function validMove() {
        const lastMove = moves[moves.length - 1]
        const lastMoveArr = lastMove.split('')
        const from = {
            x: +moveNumber[`x${lastMoveArr[0]}`],
            y: +moveNumber[`y${lastMoveArr[1]}`],
        }
        const to = {
            x: +moveNumber[`x${lastMoveArr[2]}`],
            y: +moveNumber[`y${lastMoveArr[3]}`],
        }
        if (turn === 'b') {
            players.white.timer.stop()
            players.black.timer.start()
        } else {
            players.black.timer.stop()
            players.white.timer.start()
        }
        engine.postMessage(`go depth 1`)
        players[turn === 'b' ? 'black' : 'white'].socket?.emit(
            'move',
            new Move(from.x, from.y, to.x, to.y)
        )
        sockets.to(id + '-spectator').emit('move', new Move(from.x, from.y, to.x, to.y))
        sockets.to(id).emit('update-timers', {
            white: players.white.timer.getTime(),
            black: players.black.timer.getTime(),
            running: turn === 'b' ? 'black' : 'white',
        })
        serverDelay = new Date().getTime() - serverDelayStart
    }

    function verifyMove(from, to, promotion = '') {
        const fromStr = moveString[`x${from.x}`] + '' + moveString[`y${from.y}`]
        const toStr = moveString[`x${to.x}`] + '' + moveString[`y${to.y}`]

        moves.push(fromStr + toStr + promotion)

        engine.postMessage('position startpos moves ' + moves.join(' '))
        engine.postMessage('d')
    }

    const rematch = {
        white: false,
        black: false,
    }
    const draw = {
        white: false,
        black: false,
    }

    async function join(socket, token, color) {
        if (state === 3) {
            socket.emit('join-room', 'error:Game already finished')
            return
        }
        if (token && (players.white.token === token || players.black.token === token)) {
            socket.emit('join-room', 'error:You are already in this room')
            return
        }
        let joined = false
        if (state === 0) {
            if (!color) {
                if (players.white.socket === null) {
                    joined = true
                    players.white.socket = socket
                    players.white.timer = new Timer(secToMs(gameTime))
                    players.white.token = token
                    socket.emit('color', 'white')
                    socket.join(id)
                } else if (players.black.socket === null) {
                    joined = true
                    players.black.socket = socket
                    players.black.timer = new Timer(secToMs(gameTime))
                    players.black.token = token
                    socket.emit('color', 'black')
                    socket.join(id)
                }
            } else {
                if (players[color].socket === null) {
                    joined = true
                    players[color].socket = socket
                    players[color].timer = new Timer(secToMs(gameTime))
                    players[color].token = token
                    socket.emit('color', color)
                    socket.join(id)
                    if (roomOwner.username === null) {
                        const info = await getEloFromToken(token)
                        if (token != null && info.username == null) {
                            players[color].socket?.emit('sign-out')
                            leave(players[color].socket)
                            return
                        }
                        roomOwner.username = info.username ?? 'Anonymous'
                        roomOwner.elo = info.elo ?? '800?'
                    }
                } else if (players[oppositeColor(color)].socket === null) {
                    joined = true
                    players[oppositeColor(color)].socket = socket
                    players[oppositeColor(color)].timer = new Timer(secToMs(gameTime))
                    players[oppositeColor(color)].token = token
                    socket.emit('color', oppositeColor(color))
                    socket.join(id)
                    if (roomOwner.username === null) {
                        const info = await getEloFromToken(token)
                        roomOwner.username = info.username || 'Anonymous'
                        roomOwner.elo = info.elo || '800?'
                    }
                }
            }
        }
        if (!joined) {
            socket.join(id)
            socket.join(id + '-spectator')
            socket.emit('spectator', {
                fen: fen,
                gameTime: gameTime,
                players: {
                    white: players.white.info,
                    black: players.black.info,
                },
            })
            let running = null
            if (players.white.timer.isRunning) {
                running = 'white'
            } else if (players.black.timer.isRunning) {
                running = 'black'
            }
            console.log('white', players.white.timer.getTime())
            console.log('black', players.black.timer.getTime())
            sockets.to(id + '-spectator').emit('update-timers', {
                white: players.white.timer.getTime(),
                black: players.black.timer.getTime(),
                running: running,
            })
        } else {
            if (players.black.socket !== null && players.white.socket !== null) {
                start()
            }
        }
        console.log(`> Room ${id}: player joined`)
    }

    function leave(socket, signOut = false) {
        console.log(`> Room ${id}: player left`)
        if (socket != players.white.socket && socket != players.black.socket) return
        if (signOut) {
            if (players.white.socket === socket) {
                players.white.socket = null
                players.white.token = null
                players.white.info = null
            } else if (players.black.socket === socket) {
                players.black.socket = null
                players.black.token = null
                players.black.info = null
            }
            return
        }
        if (state === 0 || state === 2) {
            players.white.socket = null
            players.black.socket = null
            stop()
            return
        }
        if (players.white.socket === socket) {
            if (state === 1) {
                state = 2
                players.white.socket = null
                players.white.token = null
                sockets.to(id).emit('player-disconnected', 'white')
                win('black')
            }
        } else if (players.black.socket === socket) {
            if (state === 1) {
                state = 2
                players.black.socket = null
                players.black.token = null
                sockets.to(id).emit('player-disconnected', 'black')
                win('white')
            }
        }
        endGame()
    }

    async function start() {
        state = 1

        if (players.white.token) {
            players.white.info = await getEloFromToken(players.white.token)
            if (players.white.token != null && players.white.info.username == null) {
                state = 0
                players.white.socket.emit('sign-out')
                leave(players.white.socket, true)
                return
            }
        }
        if (players.black.token) {
            players.black.info = await getEloFromToken(players.black.token)
            if (players.black.token != null && players.black.info.username == null) {
                state = 0
                players.black.socket.emit('sign-out')
                leave(players.black.socket, true)
                return
            }
        }

        sockets.to(id).emit('start', {
            gameTime,
            players: {
                white: players.white.info,
                black: players.black.info,
            },
        })

        players.white.socket?.on('move', ({ from, to, promotion }) => {
            if (turn === 'b') {
                notYourTurn('white')
                return
            }
            serverDelayStart = new Date().getTime()
            turn = 'b'
            verifyMove(from, to, promotion ? 'q' : '')
        })
        players.black.socket?.on('move', ({ from, to, promotion }) => {
            if (turn === 'w') {
                notYourTurn('black')
                return
            }
            serverDelayStart = new Date().getTime()
            turn = 'w'
            verifyMove(from, to, promotion ? 'q' : '')
        })

        players.white.socket?.on('request-rematch', () => {
            rematch.white = true
            checkRematch()
        })

        players.black.socket?.on('request-rematch', () => {
            rematch.black = true
            checkRematch()
        })

        players.white.socket?.on('draw', () => {
            draw.white = true
            checkDraw()
        })
        players.black.socket?.on('draw', () => {
            draw.black = true
            checkDraw()
        })

        players.white.socket?.on('resign', () => {
            win('black')
            sockets.to(id).emit('resign', 'white')
        })
        players.black.socket?.on('resign', () => {
            win('white')
            sockets.to(id).emit('resign', 'black')
        })
    }

    function checkDraw() {
        if (draw.white && draw.black) {
            state = 2
            console.log(`> Draw in room ${id}`)
        }
    }

    function checkRematch() {
        if (rematch.white && rematch.black) {
            turn = 'w'
            moves.length = 0
            engine.postMessage('ucinewgame')
            engine.postMessage('position startpos')

            rematch.white = false
            rematch.black = false

            players.white.timer?.stop()
            players.black.timer?.stop()

            players.white.timer?.reset()
            players.black.timer?.reset()

            sockets.to(id).emit('update-timers', {
                white: secToMs(gameTime),
                black: secToMs(gameTime),
                running: null,
            })

            sockets.to(id).emit('accepted-rematch')
        }
    }

    function endGame() {
        if (players.black.socket === null && players.white.socket === null) {
            stop()
        }
    }

    function stop() {
        console.log(`> Room ${id}: closed`)
        if (players.white.socket) players.white.socket?.emit('reset')
        if (players.black.socket) players.black.socket?.emit('reset')
        delete games[id]
    }

    return {
        join,
        leave,
        stop,
        isPublic,
        getOwnerInfo,
        getTime,
    }
}

app.get('*', (req, res) => {
    if (req.accepts('html')) {
        if (!res.secure && req.headers.host) {
            if (
                !(req.headers.host.includes('127.0.0.1') || req.headers.host.includes('localhost'))
            ) {
                res.redirect('https://' + req.headers.host + req.url)
                return
            }
        }
        res.status(404).sendFile('public/404.html', { root: __dirname })
        return
    }

    if (req.accepts('json')) {
        res.status(404).send({ error: 'Not found' })
        return
    }

    res.type('txt').send('Not found')
})

const port = process.env.PORT || 3000

server.listen(port, () => {
    console.log(`> Server listening on port ${port}`)
    console.log(`> http://127.0.0.1:${port}`)
})
