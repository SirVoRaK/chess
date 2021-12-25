import Piece, {
    oppositeColor,
    posString
} from './piece.js'

import Tile from './tile.js'

import {
    startPosition
} from './startPosition.js'

import {
    tile,
    letter,
    moveString,
    moveNumber,
    gamemode,
    color,
    colorLetter,
    type,
    state as states
} from './constants.js'

import {
    play
} from './sound.js'

export function Game(gMode, playerColor, board) {
    let turn = color.white

    function setTurn(newTurn) {
        turn = newTurn
    }

    function getTurn() {
        return turn
    }

    const position = {
        fen: '',
        movesHistory: 'position startpos moves',
        fenHistory: [],
        fullMoves: 0,
        halfMoves: 0
    }

    const pieces = []

    const tiles = {
        selected: [],
        lastMove: [],
        move: [],
        check: []
    }
    const castling = {
        Q: true, //white
        K: true, //white
        q: true, //black
        k: true //black
    }
    const enPassant = {
        x: null,
        y: null
    }


    let mode = gMode

    function setGameMode(newMode) {
        mode = newMode
    }
    const player = {
        color: playerColor
    }
    let state = states.start
    let moveTime = 200

    function setMoveTime(newMoveTime) {
        moveTime = newMoveTime
    }
    const stockfish = new Worker('./stockfish/stockfish.js')

    let isClicking = false

    let draggingPiece

    let ghostPiece

    const attacked = {
        [color.white]: {},
        [color.black]: {}
    }


    function startPos() {
        stockfish.postMessage("ucinewgame")
        stockfish.postMessage("position startpos")
        if (pieces.length > 0) {
            pieces.forEach(piece => piece.element.remove())
        }
        pieces.length = 0
        startPosition.forEach(piece => {
            const newPiece = new Piece(piece.type, piece.color, piece.x, piece.y, board, false, obj)
            newPiece.render()
            pieces.push(newPiece)
        })
        position.movesHistory = 'position startpos moves'
        position.fen = fenString()
        position.fenHistory.length = 0
        position.fenHistory.push(position.fen)
        position.fullMoves = 0
        position.halfMoves = 0
        turn = color.white
        tiles.selected.length = 0
        tiles.move.length = 0
        tiles.lastMove.length = 0
        enPassant.x = null
        enPassant.y = null
        castling.q = true
        castling.k = true
        castling.Q = true
        castling.K = true
    }

    function stop() {
        pieces.forEach(piece => piece.element.remove())
        state = states.end
        board.onmousedown = null
        board.onmouseleave = null
        board.onmouseup = null
        board.onmousemove = null
    }

    function start() {
        play.start()

        state = states.playing

        if (mode === gamemode.computerVsComputer) moveStockfish()
        if (mode === gamemode.playerVsComputer && player.color === color.black) moveStockfish()
    }

    function getClientRect() {
        return board.getBoundingClientRect()
    }

    board.onmousedown = ({
        target,
        clientX,
        clientY
    }) => {
        clearTiles('selected')
        clearTiles('move')

        if (state !== states.playing) return

        if (target.tagName.toLowerCase() != 'piece') {
            if (target.classList.contains('tile')) {
                move(clientX, clientY)
            }
            return
        }
        const clickedPiece = findPiece(target)
        if (mode === gamemode.playerVsPlayer) {
            if (clickedPiece.color !== turn) {
                return
            }
        } else if (mode === gamemode.computerVsComputer) {
            return
        } else if (mode === gamemode.playerVsComputer) {
            if (clickedPiece.color !== player.color || clickedPiece.color !== turn) {
                return
            }
        }
        isClicking = true
        const boardRect = getClientRect()
        const pos = {
            x: clientX - boardRect.left,
            y: clientY - boardRect.top
        }
        draggingPiece = clickedPiece
        draggingPiece.moveElement(pos.x, pos.y)
        draggingPiece.createLegalMoves()

        ghostPiece = new Piece(draggingPiece.type, draggingPiece.color, draggingPiece.x, draggingPiece.y, board, true, obj)
        ghostPiece.render()

        const newTile = new Tile(draggingPiece.x, draggingPiece.y, board, tile.selected)
        tiles.selected.push(newTile)

        for (const key in draggingPiece.legalMoves) {
            const posArray = key.replace('x', '').split('y')
            const x = posArray[0]
            const y = posArray[1]
            tiles.move.push(new Tile(x, y, board, draggingPiece.legalMoves[key] ? tile.capture : tile.move))
        }
    }
    board.onmouseleave = () => {
        resetAllPieces()
        isClicking = false
        if (ghostPiece) {
            ghostPiece.element.remove()
            ghostPiece = null
        }
    }

    //!MOVE
    board.onmouseup = ({
        clientX,
        clientY
    }) => {
        if (state !== states.playing) return
        if (!isClicking) return
        isClicking = false
        move(clientX, clientY)
    }

    function move(clientX, clientY) {
        const boardRect = getClientRect()
        const pos = {
            x: clientX - boardRect.left,
            y: clientY - boardRect.top
        }
        if (board.classList.contains('flipped')) {
            pos.x = board.offsetWidth - pos.x
            pos.y = board.offsetHeight - pos.y
        }
        const x = Math.floor(8 * (pos.x / board.offsetWidth))
        const y = Math.floor(8 * (pos.y / board.offsetHeight))

        if (draggingPiece.x === x && draggingPiece.y === y) {
            draggingPiece.resetPosition()
            removeGhostPiece()
            return
        }

        const from = `${draggingPiece.x}${draggingPiece.y}`
        const to = `${x}${y}`

        removeGhostPiece()

        if (draggingPiece) {
            if (draggingPiece.move(x, y)) {
                if (hasMoved(draggingPiece)) {
                    updatePosition(from, to)
                    draggingPiece = null
                    return
                }
                updatePosition(from, to)
                draggingPiece = null
            }
        }



        if (mode === gamemode.playerVsComputer) moveStockfish()
        else analyzeStockfish()
    }



    //!HAS MOVED
    function hasMoved(piece) {
        if (piece.type === type.pawn) {
            position.halfMoves = 0
        }
        if (turn === color.white) {
            position.fullMoves++
        }
        const isDraw = checkDraw()
        if (isDraw !== false) {
            draw(isDraw)
            return true
        }
        return false
    }

    function checkDraw() {
        if (repetitionDraw()) return 'repetition'
        if (fiftyMovesDraw()) return 'fifty moves'

        return false
    }

    function fiftyMovesDraw() {
        return position.halfMoves >= 100
    }

    function repetitionDraw() {
        const fenHistory = position.fenHistory.filter((item, index) => position.fenHistory.indexOf(item) === index)
        const fenHistoryCount = fenHistory.map(item => position.fenHistory.filter(i => i === item).length)
        const repetition = fenHistoryCount.filter(item => item > 2)
        return repetition.length > 0
    }

    function draw(str) {
        alert('draw ' + str)
    }

    function removeGhostPiece() {
        if (ghostPiece) {
            ghostPiece.element.remove()
            ghostPiece = null
        }
    }

    function clearTiles(key) {
        if (!tiles[key]) return
        tiles[key].forEach(tile => tile.element.remove())
        tiles[key].length = 0
    }

    function findPiece(element) {
        return pieces.find(piece => {
            return piece.element === element
        })
    }

    function resetAllPieces() {
        pieces.forEach(piece => piece.resetPosition())
    }

    board.onmousemove = (e) => {
        if (!isClicking || !draggingPiece) return
        const boardRect = getClientRect()
        const pos = {
            x: e.clientX - boardRect.left,
            y: e.clientY - boardRect.top
        }
        draggingPiece.moveElement(pos.x, pos.y)
    }

    //!FEN
    function fenString() {
        let fen = ''

        //position
        for (let y = 0; y < 8; y++) {
            let empty = 0
            for (let x = 0; x < 8; x++) {
                const piece = pieces.find(piece => piece.x === x && piece.y === y)
                if (piece) {
                    if (empty > 0) {
                        fen += empty
                        empty = 0
                    }
                    fen += letter[piece.type][piece.color]
                } else {
                    empty++
                }
            }
            if (empty > 0) {
                fen += empty
            }
            if (y < 7) {
                fen += '/'
            }
        }

        //color to move
        fen += ' ' + colorLetter[turn]

        //castling rights
        if (castling.Q === false && castling.q === false && castling.K === false && castling.k === false) {
            fen += ' -'
        } else {
            fen += ' '
            if (castling.K) {
                fen += 'K'
            }
            if (castling.Q) {
                fen += 'Q'
            }
            if (castling.k) {
                fen += 'k'
            }
            if (castling.q) {
                fen += 'q'
            }
        }

        //en passant targets
        if (enPassant.x && enPassant.y) {
            const x = enPassant.x + ''
            const y = enPassant.y + ''
            fen += ' ' + moveNumberToString(x + y)
        } else {
            fen += ' -'
        }

        //halfMoves and fullMoves
        fen += ' ' + position.halfMoves + ' ' + position.fullMoves

        console.log(fen)

        return fen
    }

    function moveStringToNumber(str) {
        const split = str.split('')
        if (split.length === 4) {
            return moveNumber['x' + split[0]] + moveNumber['y' + split[1]] + moveNumber['x' + split[2]] + moveNumber['y' + split[3]]
        }
        if (split.length === 2) {
            return moveNumber['x' + split[0]] + moveNumber['y' + split[1]]
        }
        if (split.length === 5) {
            return moveNumber['x' + split[0]] + moveNumber['y' + split[1]] + moveNumber['x' + split[2]] + moveNumber['y' + split[3]] + split[4]
        }
    }

    function moveNumberToString(num) {
        const split = num.split('')
        if (split.length === 4) {
            return moveString['x' + split[0]] + moveString['y' + split[1]] + moveString['x' + split[2]] + moveString['y' + split[3]]
        }
        if (split.length === 2) {
            return moveString['x' + split[0]] + moveString['y' + split[1]]
        }
    }

    function updatePosition(from, to, promotion = '') {
        from = from + ''
        to = to + ''
        promotion = promotion + ''
        position.movesHistory += ' ' + moveNumberToString(from + to) + promotion
        position.fen = fenString()
        position.fenHistory.push(position.fen)
        stockfish.postMessage(position.movesHistory)
    }

    stockfish.onmessage = ({
        data
    }) => {
        const dataArr = data.split(' ')
        if (data.includes('checkmate') || data === 'info depth 0 score mate 0') {
            checkmate(oppositeColor(turn))
            return
        } else if (dataArr.includes('bestmove')) {
            if (!data.includes('(none)')) {
                if ((mode === gamemode.playerVsComputer && turn !== player.color) || mode === gamemode.computerVsComputer) {
                    const move = dataArr[1]
                    const moveNumber = moveStringToNumber(move)
                    const split = moveNumber.split('')
                    const piece = pieces.find(piece => piece.x == split[0] && piece.y == split[1])
                    piece.move(split[2], split[3], true)
                    if (hasMoved(piece)) {
                        updatePosition(split[0] + split[1], split[2] + split[3], split[4])
                        return
                    }
                    updatePosition(split[0] + split[1], split[2] + split[3], split[4])
                    if (mode === gamemode.computerVsComputer) moveStockfish()
                    else analyzeStockfish()
                }
            }
        }
    }

    function checkmate(winner) {
        play.end()
        state = states.end
        alert(`Checkmate, ${winner} wins!`)
    }

    function moveStockfish() {
        stockfish.postMessage('go movetime ' + moveTime)
    }

    function analyzeStockfish() {
        stockfish.postMessage('go depth 1')
    }

    document.onkeydown = (e) => {
        if (e.key === ' ') {
            board.classList.toggle('flipped')
        }
    }

    function getPiecesOfColor(color) {
        return pieces.filter(piece => piece.color === color)
    }

    function getPiecesOfType(type) {
        return pieces.filter(piece => piece.type === type)
    }

    function isCheck(checkingColor) {
        generateAttackTiles(oppositeColor(checkingColor))
        const king = getPiecesOfType(type.king).find(piece => piece.color === checkingColor)
        const enemyAttack = attacked[oppositeColor(checkingColor)]
        for (const str in enemyAttack) {
            const split = str.replace('x', '').split('y')
            const x = +split[0]
            const y = +split[1]
            if (x === king.x && y === king.y) return true
        }
        return false
    }

    function isAttack(x, y, color) {
        return attacked[color][posString(x, y)] === true
    }

    function generateAttackTiles(color) {
        attacked[color] = {}
        const piecesOfColor = getPiecesOfColor(color)
        for (const piece of piecesOfColor) {
            const attackedTiles = piece.createAttackTiles()
            for (const attack in attackedTiles) {
                attacked[color][attack] = true
            }
        }
    }

    function clearTiles(key) {
        if (!tiles[key]) return
        tiles[key].forEach(tile => tile.element.remove())
        tiles[key].length = 0
    }

    const obj = {
        start,
        pieces,
        getPiecesOfColor,
        getPiecesOfType,
        isCheck,
        isAttack,
        generateAttackTiles,
        position,
        turn,
        setTurn,
        getTurn,
        tiles,
        enPassant,
        castling,
        clearTiles,
        stop,
        setGameMode,
        setMoveTime
    }


    startPos()

    return obj
}