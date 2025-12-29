// server.js
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
// In-memory Lobbies
// ---------------------
const lobbies = {};

// ---------------------
// Load Question Bank
// ---------------------
let questionBank = [];

try {
  const data = fs.readFileSync("./questions_clean.json", "utf-8");
  const json = JSON.parse(data);

  if (!json.questions || !Array.isArray(json.questions)) {
    throw new Error("questions.json does not contain a 'questions' array");
  }

  // Only keep sets that have imposter_q and normal_q array with at least one entry
  questionBank = json.questions.filter(
    (q) => q.imposter_q && Array.isArray(q.normal_q) && q.normal_q.length > 0
  );

  if (questionBank.length === 0) {
    throw new Error("No valid question sets found in questions.json");
  }

  console.log(`Loaded ${questionBank.length} question sets.`);
} catch (err) {
  console.error("Error loading questions.json:", err);
}

// ---------------------
// Helpers
// ---------------------
function generateCode() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------
// Core round lifecycle utilities
// ---------------------

function initializeRoundForLobby(lobby) {
  // create blank round structure
  lobby.round = {
    answers: {}, // playerId -> answer string
    submitted: new Set(), // set of playerIds who submitted answers
    revealOrder: [], // array of playerIds (order of reveal)
    revealIndex: 0, // how many revealed so far
    imposterId: null,
    normalQuestion: null,
    imposterQuestion: null,
    votes: {}, // voterId -> accusedPlayerId
    voted: new Set(), // set of voterIds
    playAgain: {}, // playerId -> true when clicked play again
    dropdownUnlocked: false,
  };
}

function startNewRound(code) {
  const lobby = lobbies[code];
  if (!lobby) return;

  // safety: if <3 players, go back to lobby state (emit error)
  if (!lobby.players || lobby.players.length < 3) {
    io.to(code).emit("errorMessage", "Not enough players to start a round (min 3).");
    // clear any existing round
    lobby.round = null;
    return;
  }

  // Reset / initialize round
  initializeRoundForLobby(lobby);

  // Choose imposter and questions
  const imposterIndex = Math.floor(Math.random() * lobby.players.length);
  const imposterId = lobby.players[imposterIndex].id;
  const questionSet = pickRandom(questionBank);
  if (!questionSet || !questionSet.imposter_q || !Array.isArray(questionSet.normal_q)) {
    console.error("Invalid question set when starting new round:", questionSet);
    io.to(code).emit("errorMessage", "Server error: invalid question set");
    return;
  }
  const normalQuestion = pickRandom(questionSet.normal_q);

  // assign round fields
  lobby.round.imposterId = imposterId;
  lobby.round.normalQuestion = normalQuestion;
  lobby.round.imposterQuestion = questionSet.imposter_q;

  // create reveal order (use player order or shuffle)
  lobby.round.revealOrder = shuffleArray(lobby.players.map((p) => p.id));
  lobby.round.revealIndex = 0;
  lobby.round.dropdownUnlocked = false;

  // notify clients that a round is about to start (client can show countdown)
  io.to(code).emit("nextRoundCountdown", { seconds: 3 });

  // small delay to let clients show countdown; then send gameStarting and private questions/roles
  setTimeout(() => {
    io.to(code).emit("gameStarting");

    // send role & question to each player privately
    lobby.players.forEach((p) => {
      if (p.id === imposterId) {
        io.to(p.id).emit("role", { role: "Imposter" });
        io.to(p.id).emit("question", lobby.round.imposterQuestion);
      } else {
        io.to(p.id).emit("role", { role: "Not Imposter" });
        io.to(p.id).emit("question", lobby.round.normalQuestion);
      }
    });
  }, 3000);
}

function checkAllSubmittedAndAdvance(code) {
  const lobby = lobbies[code];
  if (!lobby || !lobby.round) return;

  // if all players submitted answers
  if (lobby.round.submitted.size >= lobby.players.length) {
    // emit allSubmitted with simple user list (id and username)
    const users = lobby.players.map((p) => ({ id: p.id, username: p.username }));
    io.to(code).emit("allSubmitted", { players: users });

    // send which player should reveal first (the id at revealIndex)
    const nextId = lobby.round.revealOrder[lobby.round.revealIndex];
    io.to(code).emit("nextToReveal", { nextId });
  }
}

function tallyVotesAndEmitResults(code) {
  const lobby = lobbies[code];
  if (!lobby || !lobby.round) return;

  const round = lobby.round;

  // tally votes: map accusedId -> count
  const tally = {};
  for (const voterId in round.votes) {
    const accused = round.votes[voterId];
    if (!accused) continue;
    tally[accused] = (tally[accused] || 0) + 1;
  }

  // find majority accused (highest count). If tie, choose null for majority (no single majority)
  let majorityId = null;
  let highest = 0;
  let tie = false;
  for (const pid in tally) {
    if (tally[pid] > highest) {
      highest = tally[pid];
      majorityId = pid;
      tie = false;
    } else if (tally[pid] === highest) {
      tie = true;
    }
  }
  if (tie) majorityId = null;

  const imposterCaught = majorityId === round.imposterId;

  // Prepare results object with votes mapped to usernames for convenience (but keep ids too)
  const votesDetailed = {};
  for (const accusedId in tally) {
    const player = lobby.players.find((p) => p.id === accusedId);
    votesDetailed[accusedId] = {
      username: player ? player.username : "Unknown",
      count: tally[accusedId],
    };
  }

  io.to(code).emit("votingResults", {
    votes: votesDetailed,
    imposterId: round.imposterId,
    imposterCaught,
  });

  // Reset playAgain structure for the round (players will click playAgain)
  round.playAgain = {};
}

// ---------------------
// Socket.io handlers
// ---------------------
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // --- HOST GAME ---
  socket.on("hostGame", ({ username }) => {
    const code = generateCode();
    lobbies[code] = {
      hostId: socket.id,
      players: [{ id: socket.id, username }],
      round: null,
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

    if (lobby.players.length >= 6) {
      socket.emit("errorMessage", "Lobby full (max 6 players).");
      return;
    }

    lobby.players.push({ id: socket.id, username });
    socket.join(code);

    // If lobby had an active round and it's in progress, it's okay — new joiner will participate in next round.
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
      // remove empty lobby
      delete lobbies[code];
      return;
    }

    if (leavingPlayerIsHost) {
      // assign new host
      lobby.hostId = lobby.players[0].id;
      io.to(lobby.hostId).emit("hostUpdate");
    }

    io.to(code).emit("playersUpdate", lobby.players);

    // If a round is active, remove any answers/votes from leaving player and check progress
    if (lobby.round) {
      if (lobby.round.answers) delete lobby.round.answers[socket.id];
      if (lobby.round.submitted) lobby.round.submitted.delete(socket.id);
      if (lobby.round.votes) delete lobby.round.votes[socket.id];
      if (lobby.round.voted) lobby.round.voted.delete(socket.id);

      // If revealOrder contains this player, remove them
      lobby.round.revealOrder = lobby.round.revealOrder.filter((id) => id !== socket.id);

      // If revealIndex is out of bounds after removal, adjust and possibly unlock dropdown
      if (lobby.round.revealIndex >= lobby.round.revealOrder.length) {
        lobby.round.dropdownUnlocked = true;
        io.to(code).emit("dropdownUnlocked", { players: lobby.players });
      }

      // If all remaining players have submitted, advance
      checkAllSubmittedAndAdvance(code);
    }
  });

  // --- DISCONNECT ---
  socket.on("disconnect", () => {
    for (const code in lobbies) {
      const lobby = lobbies[code];
      const player = lobby.players.find((p) => p.id === socket.id);
      if (!player) continue;

      const wasHost = lobby.hostId === socket.id;
      lobby.players = lobby.players.filter((p) => p.id !== socket.id);

      if (!lobby.players.length) {
        delete lobbies[code];
        break;
      }

      if (wasHost) {
        lobby.hostId = lobby.players[0].id;
        io.to(lobby.hostId).emit("hostUpdate");
      }

      io.to(code).emit("playersUpdate", lobby.players);

      if (lobby.round) {
        if (lobby.round.answers) delete lobby.round.answers[socket.id];
        if (lobby.round.submitted) lobby.round.submitted.delete(socket.id);
        if (lobby.round.votes) delete lobby.round.votes[socket.id];
        if (lobby.round.voted) lobby.round.voted.delete(socket.id);

        lobby.round.revealOrder = lobby.round.revealOrder.filter((id) => id !== socket.id);
        if (lobby.round.revealIndex >= lobby.round.revealOrder.length) {
          lobby.round.dropdownUnlocked = true;
          io.to(code).emit("dropdownUnlocked", { players: lobby.players });
        }

        checkAllSubmittedAndAdvance(code);
      }

      break;
    }
  });

  // --- START GAME (host triggers first round) ---
  socket.on("startGame", (code) => {
    const lobby = lobbies[code];
    if (!lobby) return;
    if (socket.id !== lobby.hostId) return;
    if (lobby.players.length < 3) {
      socket.emit("errorMessage", "Need at least 3 players to start.");
      return;
    }

    // start a new round (this will emit nextRoundCountdown and then gameStarting)
    startNewRound(code);
  });

  // --- Player submits answer for current round ---
  socket.on("submitAnswer", ({ code, answer }) => {
    const lobby = lobbies[code];
    if (!lobby || !lobby.round) return;

    // store answer and mark submitted
    lobby.round.answers[socket.id] = answer;
    lobby.round.submitted.add(socket.id);

    // optionally broadcast progress
    // io.to(code).emit('submitProgress', { submitted: lobby.round.submitted.size, total: lobby.players.length });

    checkAllSubmittedAndAdvance(code);
  });

  // --- Player presses "show" for the current reveal sequence ---
  // Only allowed if it's the next revealId in revealOrder
  socket.on("playerShow", ({ code, playerIdToShow }) => {
    const lobby = lobbies[code];
    if (!lobby || !lobby.round) return;

    const round = lobby.round;
    const nextId = round.revealOrder[round.revealIndex];
    if (playerIdToShow !== nextId) {
      socket.emit("errorMessage", "Not your turn to reveal");
      return;
    }

    // increment reveal index and broadcast revealed answer
    round.revealIndex++;
    const revealedAnswer = round.answers[playerIdToShow] ?? "";
    io.to(code).emit("playerRevealed", { playerId: playerIdToShow, answer: revealedAnswer });

    // If all revealed, unlock voting stage
    if (round.revealIndex >= round.revealOrder.length) {
      round.dropdownUnlocked = true;
      io.to(code).emit("dropdownUnlocked", { players: lobby.players });

      // move to voting stage
      const playersForVoting = lobby.players.map((p) => ({ id: p.id, username: p.username }));
      io.to(code).emit("votingStart", { 
        players: playersForVoting,
        question: round.normalQuestion,      // ← ALWAYS send normal question
        revealData: Object.entries(round.answers).map(([playerId, answer]) => {
          const player = lobby.players.find((p) => p.id === playerId);
          return {
            playerId,
            username: player?.username || "Unknown",
            answer
          };
        })
      });

      return;
    }

    // else notify which player should reveal next
    const nextRevealId = round.revealOrder[round.revealIndex];
    io.to(code).emit("nextToReveal", { nextId: nextRevealId });
  });

  // --- Player submits a vote (accuses someone) ---
  socket.on("submitVote", ({ code, accusedId }) => {
    const lobby = lobbies[code];
    if (!lobby || !lobby.round) return;

    // prevent double voting
    if (lobby.round.voted.has(socket.id)) {
      socket.emit("errorMessage", "You already voted.");
      return;
    }

    // store vote
    lobby.round.votes[socket.id] = accusedId;
    lobby.round.voted.add(socket.id);

    // check if all players voted
    if (lobby.round.voted.size >= lobby.players.length) {
      // tally and emit results
      tallyVotesAndEmitResults(code);
    } else {
      // optionally broadcast voting progress
      // io.to(code).emit('votingProgress', { voted: lobby.round.voted.size, total: lobby.players.length });
    }
  });

  // --- Player clicks "Play Again" after results ---
  socket.on("playAgain", ({ code }) => {
    const lobby = lobbies[code];
    if (!lobby || !lobby.round) return;

    lobby.round.playAgain[socket.id] = true;

    // if all players clicked play again, start next round automatically
    if (Object.keys(lobby.round.playAgain).length >= lobby.players.length) {
      // reset any round-specific transient data and start new round
      startNewRound(code);
    } else {
      // optionally emit how many have clicked play again
      io.to(code).emit("playAgainProgress", { count: Object.keys(lobby.round.playAgain).length, total: lobby.players.length });
    }
  });

  // Optional: host can force start next round (in case someone disconnects)
  socket.on("forceNextRound", (code) => {
    const lobby = lobbies[code];
    if (!lobby) return;
    if (socket.id !== lobby.hostId) return;
    startNewRound(code);
  });

  // Optional: allow host to end game & return players to lobby state
  socket.on("endGame", (code) => {
    const lobby = lobbies[code];
    if (!lobby) return;
    if (socket.id !== lobby.hostId) return;

    // clear round and notify clients to return to lobby
    lobby.round = null;
    io.to(code).emit("gameEnded");
  });
});

// ---------------------
// Start Server
// ---------------------
const PORT = process.env.PORT || 8000;
httpServer.listen(PORT, () => console.log("Server running on port", PORT));
