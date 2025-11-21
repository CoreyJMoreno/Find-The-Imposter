import React, { useState, useEffect } from "react";
import { socket } from "./client/src/socket"; 
import "./App.css";

export default function App() {
  // Initialize states
  const [stage, setStage] = useState("home");
  const [joining, setJoining] = useState(false);
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [players, setPlayers] = useState([]);
  const [question, setQuestion] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [role, setRole] = useState("");

  // MAIN GAME EVENT HANDLERS
  useEffect(() => {
    // Game created → host enters lobby
    socket.on("gameCreated", (c) => {
      setCode(c);
      setStage("lobby");
    });

    // Lobby player list update
    socket.on("playersUpdate", (p) => {
      setPlayers(p);
    });

    // Host update
    socket.on("hostUpdate", () => {
      setIsHost(true);
    });

    // Game starting → go to game screen
    socket.on("gameStarting", () => {
      setStage("game");
    });

    // Countdown event
    socket.on("countdown", (num) => {
      setCountdown(num);
    });

    // Role assignment
    socket.on("role", ({ role }) => {
      setRole(role);
    });

    // Question/prompt
    socket.on("question", (q) => {
      setQuestion(q);
      setStage("question");
    });

    return () => {
      socket.off("gameCreated");
      socket.off("playersUpdate");
      socket.off("hostUpdate");
      socket.off("gameStarting");
      socket.off("countdown");
      socket.off("role");
      socket.off("question");
    };
  }, []);

  // Leave lobby
  const leaveLobby = () => {
    if (code) {
      socket.emit("leaveGame", code);
    }

    setStage("home");
    setJoining(false);
    setUsername("");
    setCode("");
    setPlayers([]);
    setIsHost(false);
  };

  // Host a game
  const host = (e) => {
    e.preventDefault();
    if (!username.trim()) return alert("Username is required!");
    socket.emit("hostGame", { username });
  };

  // Join a game
  const join = (e) => {
    e.preventDefault();
    if (!username.trim()) return alert("Username is required!");
    if (!code.trim()) return alert("Game Code is required!");

    socket.emit("joinGame", { code, username });
    setStage("lobby");
  };

  // Host starts the game
  const start = () => {
    socket.emit("startGame", code);
  };

  // =========================
  //         UI SECTION
  // =========================

  // HOME SCREEN
  if (stage === "home")
    return (
      <div className="home-main">
        <div className="home-header">
          <h2>Find the Imposter</h2>
        </div>

        <form className="home-form">
          <input
            placeholder="Username"
            className="home-inputs"
            maxLength={8}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />

          {!joining && (
            <>
              <button onClick={host} className="home-buttons" disabled={!username.trim()}>
                Host Game
              </button>

              <button onClick={() => setJoining(true)} className="home-buttons">
                Join Game
              </button>
            </>
          )}

          {joining && (
            <>
              <input
                placeholder="Game Code"
                className="home-inputs"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />

              <button onClick={join} className="home-buttons" disabled={!username.trim()}>
                Join
              </button>

              <button onClick={() => setJoining(false)} className="home-buttons">
                Back
              </button>
            </>
          )}
        </form>
      </div>
    );

  // LOBBY SCREEN
  if (stage === "lobby")
    return (
      <div className="lobby-main">
        <div className="lobby-gamecode">
          <h2>Game Code:</h2>
          <h2>{code}</h2>
        </div>

        <div className="lobby-players">
          <p>Players:</p>
          <ul className="lobby-list">
            {players.map((p) => (
              <li key={p.id}>{p.username}</li>
            ))}
          </ul>
        </div>

        {isHost && players.length >= 3 && (
          <button onClick={start} className="lobby-start-button">
            Start Game
          </button>
        )}

        <button onClick={leaveLobby} className="lobby-start-button">
          Leave
        </button>
      </div>
    );

  // GAME SCREEN (Countdown + Role Reveal)
  if (stage === "game")
    return (
      <div className="game-container">
        {countdown !== null ? (
          <h1 style={{ fontSize: 80 }}>{countdown}</h1>
        ) : role ? (
          <h2>You are: {role}</h2>
        ) : null}
      </div>
    );

  // PROMPT QUESTION SCREEN
  if (stage === "question")
    return (
      <div className="question-container">
        <h2>Your Question:</h2>
        <p>{question}</p>
        <input placeholder="Your Answer" />
        <button>Submit</button>
      </div>
    );

  return null;
}
