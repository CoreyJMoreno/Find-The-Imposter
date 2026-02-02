// server/index.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const questions = JSON.parse(fs.readFileSync("questions_explicit.json", "utf-8")).questions;
const games = {}; // { [code]: { players: [], imposter: null, question: {} } }

io.on("connection", (socket) => {
  socket.on("hostGame", ({ username }) => {
    const code = Math.floor(10000 + Math.random() * 90000).toString();
    games[code] = { host: socket.id, players: [{ id: socket.id, username }], started: false };
    socket.join(code);
    socket.emit("gameCreated", code);
  });

  socket.on("joinGame", ({ code, username }) => {
    const game = games[code];
    if (game && game.players.length < 8) {
      game.players.push({ id: socket.id, username });
      socket.join(code);
      io.to(code).emit("playersUpdate", game.players);
    } else {
      socket.emit("errorMessage", "Game not found or full");
    }
  });

  socket.on("startGame", (code) => {
    const game = games[code];
    const question = questions[Math.floor(Math.random() * questions.length)];
    const imposterIndex = Math.floor(Math.random() * game.players.length);
    game.imposter = game.players[imposterIndex];
    game.question = question;
    game.started = true;

    game.players.forEach((p, i) => {
      const q = i === imposterIndex
        ? question.imposter_q
        : question.normal_q[Math.floor(Math.random() * question.normal_q.length)];
      io.to(p.id).emit("receiveQuestion", q);
    });
  });
});

server.listen(4000, () => console.log("Server running on port 4000"));
