const http = require('http');
const crypto = require('crypto');

// ... (Your game state logic & getGame / apply / broadcast functions go here) ...

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>Mine Rivals</title>
  <style>
    body { font-family: sans-serif; text-align: center; background: #222; color: #fff; }
    #board { display: grid; grid-template-columns: repeat(100, 30px); gap: 1px; overflow: auto; max-width: 90vw; max-height: 70vh; margin: auto; }
    .cell { width: 30px; height: 30px; background: #444; display: flex; align-items: center; justify-content: center; cursor: pointer; user-select: none; }
    .cell.clear { background: #888; }
    .cell.mine { background: #e63946; }
    .cell.reveal { background: #457b9d; }
  </style>
</head>
<body>
  <h1>Mine Rivals</h1>
  <div id="message">Connecting...</div>
  <div id="p1-stats">Player 1: -</div>
  <div id="p2-stats">Player 2: -</div>
  <button id="ready-btn" onclick="sendReady()">Ready</button>
  <div id="board"></div>

  <script>
    let ws;
    let gameState = null;
    let mySlot = -1;

    // Connect WebSocket based on URL params
    const room = new URLSearchParams(window.location.search).get('room') || 'lobby';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + window.location.host + '/?room=' + room);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'joined') {
        mySlot = data.slot;
      } else if (data.type === 'state') {
        gameState = data.state;
        updateUI();
      } else if (data.type === 'room-full') {
        document.getElementById('message').innerText = 'Room is full!';
      }
    };

    function handleCellClick(x, y) {
      if (gameState && gameState.status === 'play') {
        ws.send(JSON.stringify({ type: 'clear', x: x, y: y }));
      }
    }

    function handleCellRightClick(e, x, y) {
      e.preventDefault();
      if (gameState && gameState.status === 'play') {
        ws.send(JSON.stringify({ type: 'reveal', x: x, y: y }));
      }
    }

    function sendReady() {
      ws.send(JSON.stringify({ type: 'ready' }));
      document.getElementById('ready-btn').disabled = true;
      document.getElementById('ready-btn').innerText = "Waiting for Opponent...";
    }

    function updateUI() {
      if (!gameState) return;
      document.getElementById('message').innerText = gameState.message || '';
      
      const p1 = gameState.players[0] || {};
      const p2 = gameState.players[1] || {};
      
      document.getElementById('p1-stats').innerHTML = 'Player 1 ' + (mySlot === 0 ? '(You)' : '') +
        '<br>Lives: ' + (p1.lives ?? '-') + ' | Score: ' + (p1.score ?? '-') + ' | Ready: ' + (p1.ready ? '✅' : '❌');
      document.getElementById('p2-stats').innerHTML = 'Player 2 ' + (mySlot === 1 ? '(You)' : '') +
        '<br>Lives: ' + (p2.lives ?? '-') + ' | Score: ' + (p2.score ?? '-') + ' | Ready: ' + (p2.ready ? '✅' : '❌');

      if (gameState.status === 'play') {
        document.getElementById('ready-btn').style.display = 'none';
      }

      // Fast update using tileData map instead of scanning 10,000 DOM elements
      if (gameState.board) {
        Object.keys(gameState.board).forEach(key => {
          const tileData = gameState.board[key];
          const [x, y] = key.split(',');
          const cell = document.getElementById('cell-' + x + '-' + y);
          if (!cell) return;

          if (tileData.mine) {
            cell.className = 'cell mine';
            cell.innerText = '💣';
          } else if (tileData.clear) {
            cell.className = 'cell clear';
            cell.innerText = tileData.count > 0 ? tileData.count : '';
          } else if (tileData.reveal) {
            cell.className = 'cell reveal';
            cell.innerText = '👁️';
          }
        });
      }
    }
  </script>
</body>
</html>
    `);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Page not found');
});

server.on('upgrade', (req, socket) => {
  const room = new URL(req.url, 'http://x').searchParams.get('room') || 'lobby';
  const game = getGame(room);
  const slot = game.players.findIndex(p => !p.socket || p.socket.destroyed);

  const secWebSocketKey = req.headers['sec-websocket-key'];
  if (!secWebSocketKey) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    return socket.end();
  }

  const accept = crypto
    .createHash('sha1')
    .update(secWebSocketKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  if (slot < 0) {
    send(socket, { type: 'room-full' });
    return socket.end();
  }

  game.players[slot].socket = socket;
  send(socket, { type: 'joined', slot });
  broadcast(game);

  socket.on('data', data => {
    if (data.length < 6) return;

    let length = data[1] & 127;
    let maskStart = 2;
    if (length === 126) maskStart = 4;
    if (length === 127) maskStart = 10;

    const mask = data.subarray(maskStart, maskStart + 4);
    const payloadStart = maskStart + 4;
    const payload = data.subarray(payloadStart, payloadStart + length);

    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }

    try {
      apply(game, slot, JSON.parse(payload.toString()));
      broadcast(game);
    } catch (e) {
      console.error("Failed to parse WS payload", e);
    }
  });

  socket.on('close', () => {
    game.players[slot].socket = null;
    broadcast(game);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mine Rivals server running on port ${PORT}`);
});
