import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";

const app = express();
app.use(cors());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ---------------------
// Lobbies Data
// ---------------------
const lobbies = {};

// ---------------------
// Load Question Bank
// ---------------------
let questionBank = [];

try {
  const data = fs.readFileSync("./questions.json", "utf-8");
  const json = JSON.parse(data);

  if (!json.questions || !Array.isArray(json.questions)) {
    throw new Error("questions.txt does not contain a 'questions' array");
  }

  questionBank = json.questions.filter(
    q => q.imposter_q && Array.isArray(q.normal_q) && q.normal_q.length > 0
  );

  if (questionBank.length === 0) {
    throw new Error("No valid questions found in questions.txt");
  }

  console.log(`Loaded ${questionBank.length} question sets.`);
} catch (err) {
  console.error("Error loading questions.txt:", err);
}

// ---------------------
// Helper Functions
// ---------------------
function generateCode() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
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
    socket.emit("hostUpdate");
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
    lobby.players = lobby.players.filter((p) => p.id !== socket.id);
    socket.leave(code);

    if (lobby.players.length === 0) {
      delete lobbies[code];
      return;
    }

    if (leavingPlayerIsHost) {
      lobby.hostId = lobby.players[0].id;
      io.to(lobby.hostId).emit("hostUpdate");
    }

    io.to(code).emit("playersUpdate", lobby.players);

    if (lobby.round) {
      lobby.round.answers && delete lobby.round.answers[socket.id];
      lobby.round.submitted && lobby.round.submitted.delete(socket.id);
      checkAllSubmittedAndAdvance(code);
    }
  });

  // --- DISCONNECT ---
  socket.on("disconnect", () => {
    for (const code in lobbies) {
      const lobby = lobbies[code];
      const player = lobby.players.find(p => p.id === socket.id);
      if (!player) continue;

      const wasHost = lobby.hostId === socket.id;
      lobby.players = lobby.players.filter(p => p.id !== socket.id);

      if (!lobby.players.length) { delete lobbies[code]; break; }

      if (wasHost) {
        lobby.hostId = lobby.players[0].id;
        io.to(lobby.hostId).emit('hostUpdate');
      }

      io.to(code).emit('playersUpdate', lobby.players);

      if (lobby.round) {
        lobby.round.answers && delete lobby.round.answers[socket.id];
        lobby.round.submitted && lobby.round.submitted.delete(socket.id);
        checkAllSubmittedAndAdvance(code);
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

    let count = 3;

    const countdownTimer = setInterval(() => {
        io.to(code).emit("countdown", count);

        if (count === 0) {
          clearInterval(countdownTimer);

          // --- Assign imposter & questions immediately ---
          const imposterIndex = Math.floor(Math.random() * lobby.players.length);
          const imposterId = lobby.players[imposterIndex].id;

          const questionSet = pickRandom(questionBank);
          if (!questionSet || !questionSet.imposter_q || !Array.isArray(questionSet.normal_q)) {
          console.error("Invalid question set:", questionSet);
          return;
          }
          const normalQuestion = pickRandom(questionSet.normal_q);

          // initialize round
          lobby.round = {
            answers: {}, // id -> answer
            submitted: new Set(),
            revealOrder: [...lobby.players.map(p=>p.id)], // reveal sequence = player order (you can shuffle if desired)
            revealIndex: 0, // how many revealed so far
            imposterId,
            normalQuestion: normalQuestion,
            imposterQuestion: qs.imposter_q,
            dropdownUnlocked: false
          };
          
          // notify clients of role and their private question immediately after countdown
          lobby.players.forEach((p) => {
            if (p.id === imposterId) {
                io.to(p.id).emit("role", { role: "Imposter" });
                io.to(p.id).emit("question", questionSet.imposter_q);
            } else {
                io.to(p.id).emit("role", { role: "Not Imposter" });
                io.to(p.id).emit("question", normalQuestion);
            }
          });

          return; // exit interval function immediately
        }

    count--;
    }, 1000);
  });

  // Player submits answer for current round
  socket.on('submitAnswer', ({ code, answer }) => {
    const lobby = lobbies[code];
    if (!lobby || !lobby.round) return;

    lobby.round.answers[socket.id] = answer;
    lobby.round.submitted.add(socket.id);
    
    // optionally broadcast how many have submitted
    io.to(code).emit('submitProgress', { submitted: lobby.round.submitted.size, total: lobby.players.length });
    checkAllSubmittedAndAdvance(code);
  });

  // Player presses "show" for the current reveal sequence
  socket.on('playerShow', ({ code, playerIdToShow }) => {
    const lobby = lobbies[code];
    if (!lobby || !lobby.round) return;

    // Only allow the next reveal in sequence
    const nextId = lobby.round.revealOrder[lobby.round.revealIndex];
    if (playerIdToShow !== nextId) return socket.emit('errorMessage','Not your turn to reveal');

    // increment reveal index and broadcast that this player's answer is revealed
    lobby.round.revealIndex++;
    const revealedAnswer = lobby.round.answers[playerIdToShow] ?? "";
    io.to(code).emit('playerRevealed', { playerId: playerIdToShow, answer: revealedAnswer });

    // if all revealed, unlock dropdown
    if (lobby.round.revealIndex >= lobby.round.revealOrder.length) {
      lobby.round.dropdownUnlocked = true;
      io.to(code).emit('dropdownUnlocked', { players: lobby.players });
    }
  });

    // Utility function used in multiple places
  function checkAllSubmittedAndAdvance(code) {
    const lobby = lobbies[code];
    if (!lobby || !lobby.round) return;
    if (lobby.round.submitted.size >= lobby.players.length) {
      // all submitted: send reveal-start screen with usernames only
      const users = lobby.players.map(p => ({ id: p.id, username: p.username }));
      io.to(code).emit('allSubmitted', { players: users });
      // At this point, clients will show usernames with ':' and present the first "Show" button to the client whose id === revealOrder[0]
      // Notify which player should reveal next
      const nextId = lobby.round.revealOrder[lobby.round.revealIndex];
      io.to(code).emit('nextToReveal', { nextId });
      }
  }
  
});

// ---------------------
// Start Server
// ---------------------
const PORT = process.env.PORT || 8000;
httpServer.listen(PORT, () => console.log("Server running on port", PORT));
