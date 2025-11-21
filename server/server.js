// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 10000;

// In-memory storage of games
// { gameCode: { hostId, players: [{id, username}], started: false } }
const games = {};

// Helper: generate random 5-digit code
const generateCode = () => {
  let code;
  do {
    code = Math.floor(10000 + Math.random() * 90000).toString();
  } while (games[code]); // avoid collisions
  return code;
};

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Host a game
  socket.on("hostGame", ({ username }) => {
    const code = generateCode();
    games[code] = {
      hostId: socket.id,
      players: [{ id: socket.id, username }],
      started: false
    };
    socket.join(code);
    socket.emit("gameCreated", code);
    io.to(code).emit("playersUpdate", games[code].players);
    console.log(`Game ${code} hosted by ${username}`);
  });

  // Join a game
  socket.on("joinGame", ({ code, username }) => {
    const game = games[code];
    if (!game || game.started) {
      socket.emit("errorMessage", "Game does not exist or has started.");
      return;
    }

    // **Check if lobby is full**
    if (game.players.length >= 8) {
      socket.emit("errorMessage", "Game is full. Maximum 8 players allowed.");
      return;
    }

    game.players.push({ id: socket.id, username });
    socket.join(code);
    io.to(code).emit("playersUpdate", game.players);
    console.log(`${username} joined game ${code}`);
  });

  // Start game
  socket.on("startGame", (code) => {
    const game = games[code];
    if (game && socket.id === game.hostId) {
      game.started = true;
      // Example: send a dummy question to all players
      io.to(code).emit("receiveQuestion", "Who is the imposter?");
    }
  });

  // Handle disconnects
  socket.on("disconnect", () => {
    for (const code in games) {
      const game = games[code];
      const idx = game.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        game.players.splice(idx, 1);
        io.to(code).emit("playersUpdate", game.players);
        // Delete the game if no players left
        if (game.players.length === 0) delete games[code];
      }
    }
    console.log("Disconnected:", socket.id);
  });

  socket.on("leaveGame", (code) => {
    const game = games[code];
    if (!game) return;

    // Remove player from game
    const idx = game.players.findIndex((p) => p.id === socket.id);
    if (idx !== -1) {
        game.players.splice(idx, 1);
        console.log(`${socket.id} left game ${code}`);

        // Notify remaining players
        io.to(code).emit("playersUpdate", game.players);

        // If the leaving player was the host, assign a new host
        if (game.hostId === socket.id && game.players.length > 0) {
            game.hostId = game.players[0].id;
            io.to(code).emit("playersUpdate", game.players);
            io.to(game.hostId).emit("hostUpdate"); // optional, notify new host
        }

        // Delete game if empty
        if (game.players.length === 0) delete games[code];
    }
  });
});


server.listen(PORT, () => console.log("Server running on port", PORT));

