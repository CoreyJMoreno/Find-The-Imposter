import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
app.use(cors());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ---------------------
// Lobbies Data
// ---------------------
const lobbies = {};
// lobbies[code] = {
//   hostId: "socket.id",
//   players: [{ id, username }]
// };

function generateCode() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

function getRandomPrompt() {
  const list = [
    "Name something you'd find in a kitchen.",
    "A vehicle people drive.",
    "A popular fruit.",
    "Something you wear.",
    "A place people visit on vacation."
  ];
  return list[Math.floor(Math.random() * list.length)];
}

// ---------------------
// Socket.io Logic
// ---------------------
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // --- HOST GAME ---
  socket.on("hostGame", ({ username }) => {
    const code = generateCode();
    lobbies[code] = {
      hostId: socket.id,
      players: [{ id: socket.id, username }],
    };

    socket.join(code);

    socket.emit("gameCreated", code);
    socket.emit("hostUpdate"); // mark client as host
    io.to(code).emit("playersUpdate", lobbies[code].players);
  });

  // --- JOIN GAME ---
  socket.on("joinGame", ({ code, username }) => {
    const lobby = lobbies[code];
    if (!lobby) {
      socket.emit("errorMessage", "Game code does not exist.");
      return;
    }

    if (lobby.players.length >= 8) {
      socket.emit("errorMessage", "Lobby full (max 8 players).");
      return;
    }

    lobby.players.push({ id: socket.id, username });
    socket.join(code);

    io.to(code).emit("playersUpdate", lobby.players);
  });

  // --- LEAVE GAME ---
  socket.on("leaveGame", (code) => {
    const lobby = lobbies[code];
    if (!lobby) return;

    const leavingPlayerIsHost = lobby.hostId === socket.id;

    lobby.players = lobby.players.filter(p => p.id !== socket.id);
    socket.leave(code);

    if (lobby.players.length === 0) {
      // No players left → delete lobby
      delete lobbies[code];
      return;
    }

    if (leavingPlayerIsHost) {
      // Assign new host to first player
      lobby.hostId = lobby.players[0].id;
      io.to(lobby.hostId).emit("hostUpdate");
    }

    io.to(code).emit("playersUpdate", lobby.players);
  });

  // --- DISCONNECT ---
  socket.on("disconnect", () => {
    for (const code in lobbies) {
      const lobby = lobbies[code];
      if (!lobby) continue;

      const player = lobby.players.find(p => p.id === socket.id);
      if (!player) continue;

      const leavingPlayerIsHost = lobby.hostId === socket.id;

      lobby.players = lobby.players.filter(p => p.id !== socket.id);

      if (lobby.players.length === 0) {
        delete lobbies[code];
      } else {
        if (leavingPlayerIsHost) {
          // Assign new host
          lobby.hostId = lobby.players[0].id;
          io.to(lobby.hostId).emit("hostUpdate");
        }
        io.to(code).emit("playersUpdate", lobby.players);
      }

      break;
    }
  });

  // --- START GAME ---
  socket.on("startGame", (code) => {
    const lobby = lobbies[code];
    if (!lobby) return;

    if (socket.id !== lobby.hostId) return;

    if (lobby.players.length < 3) {
      socket.emit("errorMessage", "Need at least 3 players to start.");
      return;
    }

    io.to(code).emit("gameStarting");

    // Countdown 3-2-1
    let count = 3;
    const countdownTimer = setInterval(() => {
      io.to(code).emit("countdown", count);
      count--;

      if (count === 0) {
        clearInterval(countdownTimer);

        // Assign imposter
        const index = Math.floor(Math.random() * lobby.players.length);
        const imposterId = lobby.players[index].id;

        lobby.players.forEach((p) => {
          io.to(p.id).emit("role", {
            role: p.id === imposterId ? "Imposter" : "Not Imposter",
          });
        });

        // After 4 seconds, send question
        setTimeout(() => {
          const prompt = getRandomPrompt();
          io.to(code).emit("question", prompt);
        }, 4000);
      }
    }, 1000);
  });
});

// ---------------------
// Start Server
// ---------------------
const PORT = process.env.PORT || 8000;
httpServer.listen(PORT, () => console.log("Server running on port", PORT));
