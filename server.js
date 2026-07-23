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
    // 1. Get the current URL path
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    // 2. Build the Homepage HTML content directly in code
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
                    body { font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #121212; color: white; }
                    h1 { color: #ff4757; }
                </style>
            </head>
            <body>
                <h1>Welcome to Mine Rivals!</h1>
                <p>Your server is running successfully on Render.</p>
            </body>
            </html>
        `);
        return;
    }

    // 3. Fallback for any other pages
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Page not found');
});

// 4. Turn the server on for Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
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
