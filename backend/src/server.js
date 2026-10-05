require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./socket');

const PORT = process.env.PORT || 4000;

// Serveur HTTP explicite : Socket.IO est branche dessus (meme port que l'API,
// aucun port supplementaire, handshake securise par le meme JWT).
const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
  console.log(`API Zomatel demarree sur http://localhost:${PORT} (Socket.IO actif)`);
});