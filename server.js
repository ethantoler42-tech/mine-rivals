const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'public');
const games = new Map();

function send(socket, message) {
  const payload = Buffer.from(JSON.stringify(message));
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
  else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  socket.write(Buffer.concat([header, payload]));
}
function broadcast(game) { for (const [slot, p] of game.players.entries()) if (p.socket && !p.socket.destroyed) send(p.socket, { type: 'state', game: publicGame(game, slot) }); }
function publicGame(g, slot) {
  return { status: g.status, players: g.players.map((p, i) => ({ name: `Player ${i + 1}`, connected: !!p.socket, ready: p.ready, lives: p.lives, score: p.score, mines: p.mines.length })), board: g.board, yourSlot: slot, message: g.message };
}
function getGame(room) {
  if (!games.has(room)) games.set(room, { status: 'setup', players: [{ socket:null, ready:false, mines:[], lives:3, score:0 }, { socket:null, ready:false, mines:[], lives:3, score:0 }], board: {}, message: 'Place 100 mines, then lock in.' });
  return games.get(room);
}
function apply(game, slot, msg) {
  const player = game.players[slot];
  if (msg.type === 'mine' && game.status === 'setup' && !player.ready && msg.x >= 0 && msg.x < 100 && msg.y >= 0 && msg.y < 100) {
    const key = `${msg.x},${msg.y}`;
    const i = player.mines.indexOf(key);
    if (i >= 0) player.mines.splice(i, 1); else if (player.mines.length < 100) player.mines.push(key);
  }
  if (msg.type === 'ready' && game.status === 'setup' && player.mines.length === 100) {
    player.ready = true;
    if (game.players.every(p => p.ready)) { game.status = 'play'; game.message = 'Clear safe ground. A mine costs one life.'; }
  }
  if (msg.type === 'clear' && game.status === 'play') {
    const key = `${msg.x},${msg.y}`; if (game.board[key]) return;
    const enemy = game.players[1 - slot].mines.includes(key);
    const own = player.mines.includes(key);
    const all = new Set([...game.players[0].mines, ...game.players[1].mines]);
    let count = 0; for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) if ((dx || dy) && all.has(`${msg.x+dx},${msg.y+dy}`)) count++;
    if (enemy || own) { game.board[key] = { mine:true, owner: enemy ? 1-slot : slot }; player.lives--; game.message = `Player ${slot+1} hit a mine!`; }
    else { game.board[key] = { clear:true, count }; player.score++; }
    if (player.lives <= 0) { game.status = 'over'; game.message = `Player ${1-slot} wins — Player ${slot+1} is out of lives.`; }
  }
  if (msg.type === 'reveal' && game.status === 'play') {
    const key = `${msg.x},${msg.y}`; if (!game.board[key]) game.board[key] = { reveal:true };
  }
}

const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    // 1. Render Health Check Handler (CRUCIAL)
    // If Render asks for a health check, respond with 200 OK immediately
    if (pathname === '/healthz' || pathname === '/health' || pathname === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }

    // 2. Homepage Content
    if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Mine Rivals</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; background-color: #1a1a1a; color: #fff; margin: 0; padding: 20px; }
                    h1 { color: #ff4757; margin-bottom: 5px; }
                    #status-panel { margin: 15px auto; padding: 10px; max-width: 600px; background: #2d2d2d; border-radius: 8px; border: 1px solid #444; }
                    #stats { display: flex; justify-content: space-around; font-weight: bold; margin-bottom: 10px; }
                    #message { color: #eccc68; font-style: italic; }
                    #grid { display: grid; grid-template-columns: repeat(100, 15px); grid-template-rows: repeat(100, 15px); gap: 1px; justify-content: center; margin: 20px auto; max-width: 95vw; overflow: auto; padding: 10px; background: #111; border-radius: 4px; }
                    .cell { width: 15px; height: 15px; background-color: #3a3a3a; border-radius: 2px; cursor: pointer; font-size: 10px; line-height: 15px; text-align: center; user-select: none; }
                    .cell:hover { background-color: #555; }
                    .cell.clear { background-color: #2f3542; color: #70a1ff; font-weight: bold; }
                    .cell.mine { background-color: #ff4757; color: white; font-weight: bold; }
                    .cell.reveal { background-color: #747d8c; }
                    #controls { margin-top: 15px; }
                    button { background-color: #2ed573; color: white; border: none; padding: 10px 20px; font-size: 16px; border-radius: 5px; cursor: pointer; font-weight: bold; }
                    button:hover { background-color: #26af5f; }
                    button:disabled { background-color: #57606f; cursor: not-allowed; }
                </style>
            </head>
            <body>
                <h1>💣 Mine Rivals 💣</h1>
                <div id="status-panel">
                    <div id="stats">
                        <div id="p1-stats">Player 1: Connecting...</div>
                        <div id="p2-stats">Player 2: Connecting...</div>
                    </div>
                    <div id="message">Connecting to game server...</div>
                </div>

                <div id="controls">
                    <button id="ready-btn" onclick="sendReady()" disabled>Lock In Mines (0/100)</button>
                </div>

                <div id="grid"></div>

                <script>
                    // Dynamically establish a secure or insecure WebSocket link to Render
                    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                    const roomName = new URLSearchParams(window.location.search).get('room') || 'lobby';
                    const ws = new WebSocket(\`\${protocol}//\${window.location.host}?room=\${roomName}\`);

                    let mySlot = null;
                    let gameState = null;
                    let selectedMines = new Set();

                    // Generate the physical 100x100 grid layout
                    const grid = document.getElementById('grid');
                    for (let y = 0; y < 100; y++) {
                        for (let x = 0; x < 100; x++) {
                            const cell = document.createElement('div');
                            cell.className = 'cell';
                            cell.dataset.x = x;
                            cell.dataset.y = y;
                            
                            // Event listeners handling left-click behavior based on game phase
                            cell.addEventListener('click', () => handleCellClick(x, y));
                            
                            // Right-click handles the "reveal" tool action
                            cell.addEventListener('contextmenu', (e) => {
                                e.preventDefault();
                                handleCellRightClick(x, y);
                            });
                            
                            grid.appendChild(cell);
                        }
                    }

                    ws.onmessage = (event) => {
                        const data = JSON.parse(event.data);
                        
                        if (data.type === 'joined') {
                            mySlot = data.slot;
                            document.getElementById('message').innerText = "Connected! Place 100 mines on your grid, then lock in.";
                            return;
                        }
                        
                        if (data.type === 'room-full') {
                            document.getElementById('message').innerText = "This game room is currently full.";
                            return;
                        }

                        if (data.type === 'state') {
                            gameState = data.game;
                            updateUI();
                        }
                    };

                    function handleCellClick(x, y) {
                        if (!gameState) return;
                        const key = \`\${x},\${y}\`;

                        if (gameState.status === 'setup') {
                            if (gameState.players[mySlot].ready) return;
                            
                            // Send placement to backend
                            ws.send(JSON.stringify({ type: 'mine', x, y }));
                            
                            // Track locally to update button counter quickly
                            if (selectedMines.has(key)) {
                                selectedMines.delete(key);
                            } else if (selectedMines.size < 100) {
                                selectedMines.add(key);
                            }
                            
                            const btn = document.getElementById('ready-btn');
                            btn.innerText = \`Lock In Mines (\${selectedMines.size}/100)\`;
                            btn.disabled = selectedMines.size !== 100;
                            
                            // Visually toggle local choice indicator before server locks it
                            const cell = document.querySelector(\`[data-x="\${x}"][data-y="\${y}"]\`);
                            cell.style.backgroundColor = selectedMines.has(key) ? '#eccc68' : '';
                        } else if (gameState.status === 'play') {
                            ws.send(JSON.stringify({ type: 'clear', x, y }));
                        }
                    }

                    function handleCellRightClick(x, y) {
                        if (gameState && gameState.status === 'play') {
                            ws.send(JSON.stringify({ type: 'reveal', x, y }));
                        }
                    }

                    function sendReady() {
                        ws.send(JSON.stringify({ type: 'ready' }));
                        document.getElementById('ready-btn').disabled = true;
                        document.getElementById('ready-btn').innerText = "Waiting for Opponent...";
                    }

                    function updateUI() {
                        document.getElementById('message').innerText = gameState.message;
                        
                        // Update player statistics scoreboards
                        const p1 = gameState.players[0];
                        const p2 = gameState.players[1];
                        
                        document.getElementById('p1-stats').innerHTML = \`Player 1 \${mySlot === 0 ? '(You)' : ''}<br>Lives: \${p1.lives} | Score: \${p1.score} | Ready: \${p1.ready ? '✅' : '❌'}\`;
                        document.getElementById('p2-stats').innerHTML = \`Player 2 \${mySlot === 1 ? '(You)' : ''}<br>Lives: \${p2.lives} | Score: \${p2.score} | Ready: \${p2.ready ? '✅' : '❌'}\`;

                        if (gameState.status === 'play') {
                            document.getElementById('ready-btn').style.display = 'none';
                        }

                        // Synchronize board tiles with database stream updates
                        for (let y = 0; y < 100; y++) {
                            for (let x = 0; x < 100; x++) {
                                const key = \`\${x},\${y}\`;
                                const cell = document.querySelector(\`[data-x="\${x}"][data-y="\${y}"]\`);
                                const tileData = gameState.board[key];
                                
                                if (tileData) {
                                    if (tileData.mine) {
                                        cell.className = 'cell mine';
                                        cell.innerText = '💣';
                                    } else if (tileData.clear) {
                                        cell.className = 'cell clear';
                                        cell.innerText = tileData.count > 0 ? tileData.count : '';
                                        cell.style.backgroundColor = '';
                                    } else if (tileData.reveal) {
                                        cell.className = 'cell reveal';
                                        cell.innerText = '👁️';
                                    }
                                } else if (gameState.status === 'play') {
                                    // Reset layout colors from setup screen
                                    cell.style.backgroundColor = '';
                                }

    // 3. Fallback for any unhandled routes
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Page not found');
});

    // 3. Fallback for any unhandled routes
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Page not found');
});
server.on('upgrade', (req, socket) => {
  const room = new URL(req.url, 'http://x').searchParams.get('room') || 'lobby'; const game = getGame(room);
  const slot = game.players.findIndex(p => !p.socket || p.socket.destroyed);
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  if (slot < 0) { send(socket, { type: 'room-full' }); return socket.end(); }
  game.players[slot].socket = socket; send(socket, { type:'joined', slot }); broadcast(game);
  socket.on('data', data => { const length = data[1] & 127; const mask = data.subarray(2,6); const payload = data.subarray(6,6+length); for(let i=0;i<payload.length;i++) payload[i]^=mask[i%4]; try { apply(game,slot,JSON.parse(payload)); broadcast(game); } catch {} });
  socket.on('close', () => { game.players[slot].socket = null; broadcast(game); });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Mine Rivals server running on port ${PORT}`);
});
